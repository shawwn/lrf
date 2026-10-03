#!/usr/bin/env python3
"""Run lrf_calibration against a simulated turret, camera, and range finder,
and compare the result with the truth.

The range finder follows the article's model of the DLEM 20: a square
beam 0.8 mrad across from an 8 mm exit aperture, a 5 sigma detection
threshold, and the article's sensitivity (a full beam on a white board 20 m
away gives a signal to noise ratio of about 176,000 with a 50 ms
measurement). The simulation also includes things the calibration doesn't
model or gets slightly wrong, to check that it doesn't depend on them: the
true beam is rolled 1.5 degrees and its edges are 20% softer than assumed,
it has faint wings (0.5% of the power in a Gaussian five times wider), the
tag's pattern is darker than assumed, a tilted board dims (Lambertian),
and there are encoder errors, corner detection noise, range noise and
bias, 0.1 m reporting, false alarms, and sometimes a wall behind the board.
A wall closer than the discrimination distance merges with the board's echo
into one pulse, reported at their average weighted by echo strength, which
puts the sweep in depth mode.

    python3 simulate.py                   # boards at 20 m and 80 m
    python3 simulate.py --single          # one board at 20 m, origin from the drawings
    python3 simulate.py --orientations 8  # random board orientations and offsets
    python3 simulate.py --office          # boards indoors, a wall 2.5 m behind each
    python3 simulate.py --office --single # one board at 12.5 m, a wall 2.5 m behind
    python3 simulate.py --office --distances 7.5 12.5 --board 0.36 0.16
"""

from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass, replace
from typing import Optional

import numpy as np
from scipy.special import ndtr

from lrf_calibration import (TAG_CORNERS_UNIT, Board, Collector, Intrinsics, LRFSpec, MountGuess,
                             beam_direction, beam_on_board, echo_fraction, report, save_stops, solve)


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


# World: x east, y north, z up. At pan = tilt = 0 the camera looks north;
# the columns are the camera's x (right), y (down), and z (forward) axes.
CAM_HOME = np.array([[1.0, 0, 0], [0, 0, 1], [0, -1, 0]])


@dataclass
class Placement:
    """Where the board stands, relative to the turret's pivot."""
    distance_m: float               # north
    right_m: float = 0.0            # east
    up_m: float = 0.0
    yaw_deg: float = 0.0            # turned about the vertical (0: facing the turret's home direction)
    pitch_deg: float = 0.0          # leaning back
    roll_deg: float = 0.0           # turned in its own plane
    wall_behind_m: Optional[float] = None   # a wall this far behind the board (None: open sky)
    wall_albedo: float = 0.3

    def tag_frame(self):
        """Rotation (tag axes in world) and the tag center's position."""
        R = rot_z(-math.radians(self.yaw_deg)) @ rot_x(math.radians(self.pitch_deg)) @ CAM_HOME \
            @ rot_z(math.radians(self.roll_deg))
        return R, np.array([self.right_m, self.distance_m, self.up_m])


@dataclass
class Truth:
    origin_m: tuple = (0.0731, -0.0014, 0.006)  # 1.1 mm and 1.4 mm off the drawings
    yaw_mrad: float = 1.3
    pitch_mrad: float = -0.8
    range_offset_m: float = 0.3


class SimRig:
    """Implements lrf_calibration.Rig."""

    SNR_20M = 1.756e5       # full beam on white (albedo 0.8) at 20 m, 50 ms (the article's model)

    def __init__(self, intr: Intrinsics, spec: LRFSpec, truth: Truth, seed=0,
                 nd_transmission=0.1, measure_s=0.05, wing_fraction=0.005, wing_scale=5.0,
                 range_noise=0.3):
        self.intr, self.spec, self.truth = intr, spec, truth
        self.rng = np.random.default_rng(seed)
        self.nd = nd_transmission       # one way transmission of a filter over the module's window
        self.measure_s = measure_s
        self.range_noise = range_noise          # 1 sigma, meters
        # the real beam differs a little from the spec the calibration assumes
        self.beam = replace(spec, beam_roll_deg=1.5, edge_blur_mrad=spec.edge_blur_mrad * 1.2)
        self.wings = (wing_fraction, replace(spec, beam_shape="gaussian",
                                             divergence_mrad=spec.divergence_mrad * wing_scale,
                                             exit_beam_mm=spec.exit_beam_mm * wing_scale))
        self.tag_reflectance = 0.4
        self.pivot = np.array([0.0, 0.0, 0.0])
        self.cam_in_plate = np.array([-0.036, 0.03, 0.08])      # camera's offset from the pivot
        self.encoder_bias = self.rng.normal(0, 2e-3, 2)          # the turret's zero is off by ~0.1 degree
        self.pan = self.tilt = 0.0
        self.actual = np.zeros(2)
        self.clock = 0.0
        self.board = self.place_ = None

    def place(self, board: Board, placement: Placement):
        """Someone sets the board up and roughly points the turret at it."""
        self.board, self.place_ = board, placement
        R, T = placement.tag_frame()
        v = T - self.pivot
        self.move_to(math.atan2(v[0], v[1]) + self.rng.normal(0, 0.005),
                     math.atan2(v[2], math.hypot(v[0], v[1])) + self.rng.normal(0, 0.005))

    # --- turret
    def angles(self):
        return self.pan, self.tilt

    def move_to(self, pan, tilt):
        d = math.hypot(pan - self.pan, tilt - self.tilt)
        self.clock += 0.05 + d / 0.5 + 0.15                      # accelerate, slew, settle
        self.pan, self.tilt = pan, tilt
        self.actual = np.array([pan, tilt]) + self.encoder_bias + self.rng.normal(0, 2e-5, 2)

    def camera_pose(self):
        T = rot_z(-self.actual[0]) @ rot_x(self.actual[1])
        return T @ CAM_HOME, self.pivot + T @ self.cam_in_plate

    # --- camera with an AprilTag detector
    def tag_corners(self, tag_id, frames):
        self.clock += frames / 30
        if self.board is None or tag_id != self.board.tag_id:
            return None
        Rc, c = self.camera_pose()
        Rt, T = self.place_.tag_frame()
        obj = np.c_[TAG_CORNERS_UNIT * self.board.tag_size_m, np.zeros(4)]
        P = (obj @ Rt.T + T - c) @ Rc                               # camera frame
        facing = Rt[:, 2] @ (T - c) / np.linalg.norm(T - c)          # cos of the viewing angle
        if np.any(P[:, 2] <= 0) or facing < math.cos(math.radians(75)):
            return None
        uv = self.intr.project(P)
        if np.any(uv < 0) or np.any(uv[:, 0] >= self.intr.width) or np.any(uv[:, 1] >= self.intr.height):
            return None
        sigma = 0.15 / max(facing, 0.3)                              # corners blur on a turned tag
        samples = uv[None] + self.rng.normal(0, sigma, (frames, 4, 2))
        return np.median(samples, axis=0)

    # --- range finder
    def measure(self):
        self.clock += self.measure_s
        tr, spec = self.truth, self.spec
        Rc, c = self.camera_pose()
        o_c, d_c = np.array(tr.origin_m), beam_direction(tr.yaw_mrad, tr.pitch_mrad)
        o, d = c + Rc @ o_c, Rc @ d_c                                 # world frame
        snr_unit = self.SNR_20M * math.sqrt(self.measure_s / 0.05) * self.nd ** 2

        echoes = []
        Rt, T = self.place_.tag_frame()
        R, t = (Rc.T @ Rt)[None], (Rc.T @ (T - c))[None]              # tag pose, camera frame
        s, xy, d_tag = beam_on_board(o_c, d_c, R, t)
        on_board = 0.0
        if s[0] > 0:
            board = replace(self.board, tag_relative_reflectance=self.tag_reflectance)
            fw, wing_spec = self.wings
            F = (1 - fw) * echo_fraction(board, self.beam, s, xy, R, d_c)[0] \
                + fw * echo_fraction(board, wing_spec, s, xy, R, d_c)[0]
            # the beam's power intercepted by the board, dark tag or not
            on_board = echo_fraction(replace(board, tag_relative_reflectance=1.0), self.beam,
                                     s, xy, R, d_c)[0]
            s = float(s[0])
            snr = snr_unit * (20 / s) ** 2 * F * abs(d_tag[0, 2])     # Lambertian: dimmer when tilted
            if snr > 0:
                echoes.append((s, snr))
        pl = self.place_
        if pl.wall_behind_m is not None:
            # a wall facing the turret, wall_behind_m behind the board's center
            y_wall = T[1] + pl.wall_behind_m
            s_w = (y_wall - o[1]) / d[1]
            snr = snr_unit * (20 / s_w) ** 2 * (pl.wall_albedo / 0.8) * abs(d[1]) * max(0.0, 1 - on_board)
            if snr > 0:
                echoes.append((s_w, snr))
        # echoes closer together than the discrimination distance arrive as
        # one pulse, reported at their strength weighted average
        pulses = []
        for r, a in sorted(echoes):
            if pulses and r - pulses[-1][2] < spec.discrimination_m:
                r0, a0, last = pulses[-1]
                pulses[-1] = ((r0 * a0 + r * a) / (a0 + a), a0 + a, r)
            else:
                pulses.append((r, a, r))
        out = [r + tr.range_offset_m + self.rng.normal(0, self.range_noise)
               for r, a, _ in pulses if self.rng.random() < ndtr(a - spec.threshold_sigma)]
        if self.rng.random() < 0.002:                                # false alarm
            out.append(self.rng.uniform(spec.min_range_m, 3000))
        return sorted(round(r / spec.resolution_m) * spec.resolution_m for r in out)


def camera_4k(hfov_deg=10.0):
    """The article's camera: 4K behind a 10 degree lens (by default), with a
    principal point a little off center and slight distortion, as a real
    one has."""
    f = 1920 / math.tan(math.radians(hfov_deg / 2))
    return Intrinsics(f, f, 1919.5 + 12.3, 1079.5 - 7.8, 3840, 2160, (0.02, 0.0, 0.0, 0.0, 0.0))


def run(placements, boards, seed=0, nd=0.1, bootstrap=20, fit_origin=None, quiet=False,
        save=None, hfov=10.0):
    log = (lambda *a: None) if quiet else print
    intr, spec, truth = camera_4k(hfov), LRFSpec(), Truth()
    rig = SimRig(intr, spec, truth, seed=seed, nd_transmission=nd)
    col = Collector(rig, intr, spec, log=log, seed=seed)
    guess = MountGuess()                # the drawings: 72 mm to the right, no misalignment
    stops, used = [], {}
    for k, (pl, b) in enumerate(zip(placements, boards)):
        b = replace(b, tag_id=k)
        rig.place(b, pl)
        new, guess = col.session(b, k, guess, earlier=stops)
        stops += new
        used[k] = b
    if save:
        save_stops(save, stops, used, intr, spec, guess)
    cal = solve(stops, used, intr, spec, guess, fit_origin=fit_origin, bootstrap=bootstrap, seed=seed)
    if not quiet:
        print()
        report(cal)
        print("simulated turret time: %.1f minutes" % (rig.clock / 60))
    return cal, truth, intr, rig


def errors(cal, truth, intr):
    """Calibration minus truth."""
    d = beam_direction(truth.yaw_mrad, truth.pitch_mrad)
    bore_true = intr.project_normalized(d[:2] / d[2])[0]
    out = {"yaw_mrad": cal.yaw_mrad - truth.yaw_mrad, "pitch_mrad": cal.pitch_mrad - truth.pitch_mrad,
           "boresight_px": np.linalg.norm(cal.boresight_pixel() - bore_true)}
    for R in (10, 100):
        p_true = intr.project((np.array(truth.origin_m) + R * d)[None])[0]
        out["spot_%dm_px" % R] = np.linalg.norm(cal.beam_pixel(R) - p_true)
    out["origin_x_mm"] = 1e3 * (cal.origin_m[0] - truth.origin_m[0])
    out["origin_y_mm"] = 1e3 * (cal.origin_m[1] - truth.origin_m[1])
    if cal.range_offset_m is not None:
        out["range_offset_m"] = cal.range_offset_m - truth.range_offset_m
    return out


def random_placement(rng, distance, office=False):
    return Placement(distance, right_m=rng.uniform(-0.08, 0.08) * distance,
                     up_m=rng.uniform(-0.03, 0.06) * distance,
                     yaw_deg=rng.uniform(-50, 50), pitch_deg=rng.uniform(-35, 35),
                     roll_deg=rng.uniform(0, 360),
                     wall_behind_m=rng.uniform(1.5, 4.0) if office else rng.choice([None, 40.0, 150.0]),
                     wall_albedo=rng.uniform(0.3, 0.8) if office else 0.3)


def random_board(rng, size=None):
    if size:
        # about the given size, the tag near the middle
        side, tag = size
        w, h = side * rng.uniform(0.95, 1.05), side * rng.uniform(0.95, 1.05)
        return Board(tag_size_m=tag, width_m=w, height_m=h,
                     center_in_tag_m=(rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.02)))
    w, h = rng.uniform(0.55, 0.8), rng.uniform(0.55, 0.8)
    # the tag anywhere that leaves at least 10 cm of white around it
    cx = rng.uniform(-(w / 2 - 0.25), w / 2 - 0.25)
    cy = rng.uniform(-(h / 2 - 0.25), h / 2 - 0.25)
    return Board(width_m=w, height_m=h, center_in_tag_m=(cx, cy))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--single", action="store_true", help="one board")
    ap.add_argument("--office", action="store_true", help="indoors: boards at 12.5 m and 25 m, walls 2.5 m behind")
    ap.add_argument("--distances", type=float, nargs=2, metavar=("NEAR", "FAR"),
                    help="the two boards' distances in meters")
    ap.add_argument("--hfov", type=float, default=10.0, help="the camera's horizontal field of view, degrees")
    ap.add_argument("--board", type=float, nargs=2, metavar=("SIDE", "TAG"),
                    help="board and tag size in meters (default 0.6 and 0.3; random in --orientations)")
    ap.add_argument("--orientations", type=int, metavar="N", help="N trials with random boards")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--nd", type=float, default=0.1, help="one way transmission of the attenuator")
    ap.add_argument("--bootstrap", type=int, default=20)
    ap.add_argument("--save-stops", metavar="PATH")
    ap.add_argument("--out", metavar="PATH", help="write the calibration (JSON)")
    args = ap.parse_args(argv)

    if args.orientations:
        rng = np.random.default_rng(args.seed)
        keys = ["yaw_mrad", "pitch_mrad", "boresight_px", "spot_10m_px", "spot_100m_px",
                "origin_x_mm", "origin_y_mm"]
        print("trial  " + "  ".join("%13s" % k for k in keys))
        worst = {k: 0.0 for k in keys}
        for i in range(args.orientations):
            far = args.distances or ((12.5, 25) if args.office else (20, 80))
            pls = [random_placement(rng, far[0], args.office), random_placement(rng, far[1], args.office)]
            bds = [random_board(rng, args.board), random_board(rng, args.board)]
            cal, truth, intr, _ = run(pls, bds, seed=args.seed + i, nd=args.nd, bootstrap=0, quiet=True,
                                      hfov=args.hfov)
            e = errors(cal, truth, intr)
            print("%5d  " % i + "  ".join("%+13.3f" % e[k] for k in keys) + "   boards: " +
                  ", ".join("yaw %+.0f pitch %+.0f roll %.0f" % (p.yaw_deg, p.pitch_deg, p.roll_deg)
                            for p in pls))
            for k in keys:
                worst[k] = max(worst[k], abs(e[k]))
        print("worst  " + "  ".join("%13.3f" % worst[k] for k in keys))
        return 0

    if args.office:
        pls = [Placement(12.5, right_m=0.3, up_m=0.2, yaw_deg=10, pitch_deg=-4, roll_deg=2,
                         wall_behind_m=2.5, wall_albedo=0.6),
               Placement(25, right_m=-0.8, up_m=0.4, yaw_deg=-15, pitch_deg=5, roll_deg=-3,
                         wall_behind_m=2.5, wall_albedo=0.6)]
        bds = [Board(), Board(center_in_tag_m=(0.05, 0.0))]
        if args.distances:
            pls = [replace(pl, distance_m=dist) for pl, dist in zip(pls, args.distances)]
        if args.board:
            bds = [replace(b, width_m=args.board[0], height_m=args.board[0], tag_size_m=args.board[1])
                   for b in bds]
        if args.single:
            pls, bds = pls[:1], bds[:1]
    elif args.single:
        pls, bds = [Placement(20, right_m=0.6, up_m=0.4, yaw_deg=12)], [Board()]
    else:
        pls = [Placement(20, right_m=0.6, up_m=0.4, yaw_deg=12, pitch_deg=-5, roll_deg=3),
               Placement(80, right_m=-3.0, up_m=1.5, yaw_deg=-20, pitch_deg=8, roll_deg=90,
                         wall_behind_m=40)]
        bds = [Board(), Board(center_in_tag_m=(0.05, 0.0))]
    cal, truth, intr, _ = run(pls, bds, seed=args.seed, nd=args.nd, bootstrap=args.bootstrap,
                              save=args.save_stops, hfov=args.hfov)
    print("\ncompared with the truth:")
    for k, v in errors(cal, truth, intr).items():
        print("  %-15s %+.3f" % (k, v))
    if args.out:
        with open(args.out, "w") as f:
            f.write(cal.to_json())
    return 0


if __name__ == "__main__":
    sys.exit(main())
