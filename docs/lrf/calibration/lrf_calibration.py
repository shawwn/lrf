#!/usr/bin/env python3
"""Find where a laser range finder's beam points, relative to the camera
mounted next to it, by sweeping the beam across an AprilTag board.

The result is the beam as a ray in the camera's coordinate frame,

    beam(s) = origin + s * direction        (s = distance along the beam)

which gives, for any target distance, the pixel the laser is hitting
(Calibration.beam_pixel), and for a distant target, the boresight pixel the
turret should aim at (Calibration.boresight_pixel).

Method
------
An AprilTag is printed in the middle of a larger white board. The turret
steps the beam across the board's edges, stopping for each measurement. At
every stop the camera finds the tag's four corners, which give the board's
exact pose (position and orientation) in the camera's frame, and the range
finder takes a measurement. What the measurement says depends on what's
behind the board:

  * Depth mode, the usual indoor setup: a wall a few meters behind the
    board, closer than the range finder's target discrimination distance
    (25 m for the DLEM 20). The board's echo and the wall's merge into one,
    and the reported distance is their average weighted by how much light
    each returns. As the footprint slides off an edge, the reading ramps
    linearly from the board's distance to the wall's.
  * Hit/miss mode: open sky, or a background more than the discrimination
    distance behind. The range finder either reports an echo at the board's
    distance (a hit) or it doesn't (a miss).

The camera can't see the 1.55 um beam, but every stop says: "a beam along
this ray would land at this point of the board, and this is what the range
finder saw". The ray that best explains all the measurements is the
calibration. The fit models how much of the beam's footprint lands on the
board, so the stops near the edges, where the footprint is only partly on
the board, carry most of the information, and that's where the sweep
spends its time. The mode is chosen automatically by looking past the
board's edges before the sweep.

The board can be at any orientation the camera can still read the tag at:
yawed, pitched, rolled in its own plane, upside down, off to the side, and
the tag needn't be centered on the board. Everything is computed in the
board's own frame from the measured pose; the sweep plans its lines along
the board's edges, the turret moves are worked out from the 3D geometry,
and the beam model uses the footprint's true stretch on a tilted board.

Nothing here depends on the turret's kinematics or the accuracy of its
encoders: the camera and the range finder share the moving plate, and the
board's pose is measured from the image at every stop. The turret only has
to move the beam roughly where it's asked to.

With the board at a single distance, a sideways shift of the beam's origin
is indistinguishable from a small change of its angle, so the origin comes
from the mechanical drawings. With two or more distances (say 20 m and
80 m), the fit also solves for the origin's sideways position.

Conventions
-----------
Camera frame (OpenCV): x right, y down, z forward, meters.
Tag frame: origin at the tag's center, x right, y down, z into the tag. The
four corners are expected in AprilTag's order: bottom left, bottom right,
top right, top left, i.e. (-h, h), (h, h), (h, -h), (-h, -h) for half size h.
Check this once against your detector by drawing the reprojected corners.
Beam angles: yaw > 0 points the beam toward +x (right in the image), pitch
> 0 toward +y (down in the image), as in the article's model.
Turret: pan > 0 turns right and tilt > 0 turns up, as seen by the camera.

Running
-------
    python3 simulate.py                  # simulated rig, compares with the truth
    python3 lrf_calibration.py stops.json --out calibration.json
                                         # re-solve from recorded stops

Requires numpy and scipy. OpenCV (cv2) is used for the tag pose when it's
installed; otherwise a small homography + least squares solver is used.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import asdict, dataclass, field, replace
from typing import Callable, Optional, Protocol, Sequence

import numpy as np
from scipy import optimize
from scipy.spatial.transform import Rotation
from scipy.special import ndtr


# ---------------------------------------------------------------------------
# Descriptions of the hardware
# ---------------------------------------------------------------------------

@dataclass
class Intrinsics:
    """Pinhole camera with OpenCV's radial-tangential distortion, from an
    ordinary camera calibration (e.g. cv2.calibrateCamera and a checkerboard).
    """
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int
    dist: tuple = (0.0, 0.0, 0.0, 0.0, 0.0)   # k1, k2, p1, p2, k3

    def matrix(self) -> np.ndarray:
        return np.array([[self.fx, 0, self.cx], [0, self.fy, self.cy], [0, 0, 1.0]])

    def _distort(self, x, y):
        k1, k2, p1, p2, k3 = self.dist
        r2 = x * x + y * y
        radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 ** 3
        xd = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)
        yd = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y
        return xd, yd

    def project_normalized(self, xy) -> np.ndarray:
        """Undistorted normalized coordinates (N, 2) to pixels (N, 2)."""
        xy = np.atleast_2d(np.asarray(xy, float))
        xd, yd = self._distort(xy[:, 0], xy[:, 1])
        return np.stack([self.fx * xd + self.cx, self.fy * yd + self.cy], axis=1)

    def project(self, P) -> np.ndarray:
        """Camera frame points (N, 3) to pixels (N, 2)."""
        P = np.atleast_2d(np.asarray(P, float))
        return self.project_normalized(P[:, :2] / P[:, 2:3])

    def normalize(self, uv) -> np.ndarray:
        """Pixels (N, 2) to undistorted normalized coordinates (N, 2)."""
        uv = np.atleast_2d(np.asarray(uv, float))
        xd = (uv[:, 0] - self.cx) / self.fx
        yd = (uv[:, 1] - self.cy) / self.fy
        x, y = xd.copy(), yd.copy()
        for _ in range(20):         # fixed point iteration; fine for mild distortion
            ex, ey = self._distort(x, y)
            x, y = x + (xd - ex), y + (yd - ey)
        return np.stack([x, y], axis=1)


@dataclass
class Board:
    """An AprilTag printed in the middle of a larger white board.

    The white border is what the sweep measures, so make it wide: at least
    two beam diameters at the farthest calibration distance (the DLEM 20's
    footprint is about 7 cm at 80 m). Measure the printed tag; a tag printed
    1% too small makes every distance 1% too long.
    """
    tag_id: int = 0
    tag_size_m: float = 0.30            # outer edge of the black square (the detector's corners)
    width_m: float = 0.60
    height_m: float = 0.60
    center_in_tag_m: tuple = (0.0, 0.0)     # board center in the tag's frame
    # Reflectance of the tag's pattern at 1.55 um relative to the white board,
    # averaged over its black and white cells. Carbon (laser printer) toner
    # is dark in the infrared; many inkjet dyes aren't.
    tag_relative_reflectance: float = 0.5

    def extents(self):
        cx, cy = self.center_in_tag_m
        return (cx - self.width_m / 2, cx + self.width_m / 2,
                cy - self.height_m / 2, cy + self.height_m / 2)


@dataclass
class LRFSpec:
    """Range finder properties the calibration needs (defaults: DLEM 20).

    The beam is a rectangle, as from a collimator that images a laser
    diode's emitter: evenly lit inside, with edges softened by diffraction
    from the exit aperture. Jenoptik describes the DLEM 20's divergence as
    about 0.8 mrad and symmetrical, so by default it's a square; the DLEM
    4k's is 0.6 x 0.7 mrad. The rectangle's sides are u and v, u at
    beam_roll_deg from the camera's x axis. beam_shape="gaussian" models a
    round Gaussian beam instead, with divergence_mrad its 1/e^2 full angle.
    """
    beam_shape: str = "rectangular"
    divergence_mrad: float = 0.8                # full angle across the u side
    divergence_v_mrad: Optional[float] = None   # across the v side, if different
    edge_blur_mrad: float = 0.1                 # 1 sigma edge softness (assumed: about diffraction at 8 mm)
    beam_roll_deg: float = 0.0
    exit_beam_mm: float = 8.0
    min_range_m: float = 10.0
    resolution_m: float = 0.1
    accuracy_m: float = 0.5
    discrimination_m: float = 25.0              # closer echoes merge into one
    threshold_sigma: float = 5.0                # detection threshold, in noise sigmas

    def profile(self, s):
        """The beam's cross section at distance s along its u and v axes:
        each a uniform distribution of half width h plus Gaussian blur.
        Returns (h_u, h_v, sigma_u, sigma_v) in meters."""
        s = np.asarray(s, float)
        d0 = self.exit_beam_mm * 1e-3
        tu = self.divergence_mrad * 1e-3
        tv = (self.divergence_v_mrad or self.divergence_mrad) * 1e-3
        if self.beam_shape == "gaussian":
            zero = np.zeros_like(s)
            # sigma is half the 1/e^2 radius, as in the article's model
            return zero, zero, 0.25 * np.sqrt(d0 * d0 + (tu * s) ** 2), 0.25 * np.sqrt(d0 * d0 + (tv * s) ** 2)
        blur = np.maximum(0.5e-3, self.edge_blur_mrad * 1e-3 * s)
        return 0.5 * (d0 + tu * s), 0.5 * (d0 + tv * s), blur, blur

    def beam_radius(self, s):
        """Rough half size of the footprint, for planning the sweep."""
        hu, hv, su, sv = self.profile(s)
        if self.beam_shape == "gaussian":
            return 2 * np.maximum(su, sv)
        return np.maximum(hu, hv) + np.maximum(su, sv)


@dataclass
class MountGuess:
    """What the mechanical drawings say, and how far off reality might be."""
    origin_m: tuple = (0.072, 0.0, 0.0)     # beam origin in the camera frame
    yaw_mrad: float = 0.0
    pitch_mrad: float = 0.0
    tolerance_mrad: float = 5.0             # worst case misalignment to search

    def direction(self) -> np.ndarray:
        return beam_direction(self.yaw_mrad, self.pitch_mrad)


class Rig(Protocol):
    """The hardware. A real implementation wraps the turret's motor
    controller, the camera driver with an AprilTag detector (see
    detect_tag_corners), and the range finder's serial protocol from its
    interface control document. See simulate.py for a complete simulated one.
    """

    def angles(self) -> tuple:
        """Current (pan, tilt) in radians, as commanded or from the encoders."""

    def move_to(self, pan: float, tilt: float) -> None:
        """Move the turret and return once it has settled: the camera image
        and the range measurement must both be taken with the plate still."""

    def tag_corners(self, tag_id: int, frames: int) -> Optional[np.ndarray]:
        """Detect the tag in `frames` fresh images; return the per corner
        median (4, 2) in pixels, AprilTag corner order, or None if the tag
        wasn't fully visible."""

    def measure(self) -> list:
        """Take one range measurement. Return every reported echo range in
        meters (empty if there was no echo)."""


def detect_tag_corners(gray: np.ndarray, tag_id: int, family: str = "tag36h11"):
    """AprilTag corners in one 8 bit grayscale image, for a real Rig.

    Uses pupil_apriltags (pip install pupil-apriltags), which reports the
    corners counterclockwise starting at the bottom left, the order used here.
    """
    from pupil_apriltags import Detector     # imported lazily: only real rigs need it
    global _detector
    if "_detector" not in globals() or _detector is None:
        _detector = Detector(families=family, quad_decimate=1.0, refine_edges=True)
    for det in _detector.detect(gray):
        if det.tag_id == tag_id and det.decision_margin > 30:
            return np.asarray(det.corners, float)
    return None


_detector = None


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def beam_direction(yaw_mrad: float, pitch_mrad: float) -> np.ndarray:
    d = np.array([math.tan(yaw_mrad * 1e-3), math.tan(pitch_mrad * 1e-3), 1.0])
    return d / np.linalg.norm(d)


# The tag's corners in its own frame, in AprilTag's order, for a unit tag.
TAG_CORNERS_UNIT = np.array([[-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]])


def estimate_tag_pose(corners_px: np.ndarray, intr: Intrinsics, tag_size: float):
    """Tag pose from its four corners: returns (R, t, rms_px) such that a
    point X in the tag's frame is at R @ X + t in the camera's frame."""
    obj = np.c_[TAG_CORNERS_UNIT * tag_size, np.zeros(4)]
    corners_px = np.asarray(corners_px, float)
    try:
        import cv2
    except ImportError:
        cv2 = None
    if cv2 is not None:
        ok, rvec, tvec = cv2.solvePnP(obj, corners_px, intr.matrix(), np.array(intr.dist, float),
                                      flags=cv2.SOLVEPNP_IPPE_SQUARE)
        if not ok:
            return None
        R, t = cv2.Rodrigues(rvec)[0], tvec.ravel()
    else:
        R, t = _pose_from_homography(obj[:, :2], intr.normalize(corners_px))
        R, t = _refine_pose(R, t, obj, corners_px, intr)
    resid = intr.project(obj @ R.T + t) - corners_px
    return R, t, float(np.sqrt(np.mean(np.sum(resid ** 2, axis=1))))


def _pose_from_homography(XY: np.ndarray, xy: np.ndarray):
    A = []
    for (X, Y), (u, v) in zip(XY, xy):
        A.append([X, Y, 1, 0, 0, 0, -u * X, -u * Y, -u])
        A.append([0, 0, 0, X, Y, 1, -v * X, -v * Y, -v])
    H = np.linalg.svd(np.array(A))[2][-1].reshape(3, 3)
    if H[2, 2] < 0:                 # the tag is in front of the camera
        H = -H
    lam = 2.0 / (np.linalg.norm(H[:, 0]) + np.linalg.norm(H[:, 1]))
    r1, r2 = lam * H[:, 0], lam * H[:, 1]
    U, _, Vt = np.linalg.svd(np.c_[r1, r2, np.cross(r1, r2)])
    R = U @ Vt
    if np.linalg.det(R) < 0:
        R = U @ np.diag([1, 1, -1]) @ Vt
    return R, lam * H[:, 2]


def _refine_pose(R, t, obj, corners_px, intr):
    def resid(p):
        Rp = Rotation.from_rotvec(p[:3]).as_matrix()
        return (intr.project(obj @ Rp.T + p[3:]) - corners_px).ravel()
    p = optimize.least_squares(resid, np.r_[Rotation.from_matrix(R).as_rotvec(), t],
                               method="lm", x_scale="jac").x
    return Rotation.from_rotvec(p[:3]).as_matrix(), p[3:]


def beam_on_board(origin, direction, R, t):
    """Where a beam meets the plane of each board pose.

    R (N, 3, 3) and t (N, 3) are tag poses. Returns the distance along the
    beam s (N,), the point in the tag's frame xy (N, 2), and the beam's
    direction in the tag's frame (N, 3).
    """
    n = R[:, :, 2]                                  # the tag's z axis, in camera coordinates
    s = np.einsum("ij,ij->i", n, t - origin) / (n @ direction)
    P = origin + s[:, None] * direction
    local = np.einsum("nji,nj->ni", R, P - t)       # R^T (P - t)
    d_tag = np.einsum("nji,j->ni", R, direction)
    return s, local[:, :2], d_tag


def beam_axes(spec: LRFSpec, direction):
    """Unit vectors across the beam, along the rectangle's u and v sides
    (camera frame)."""
    d = np.asarray(direction, float)
    u0 = np.array([1.0, 0.0, 0.0]) - d[0] * d
    u0 /= np.linalg.norm(u0)
    v0 = np.cross(d, u0)
    r = math.radians(spec.beam_roll_deg)
    return math.cos(r) * u0 + math.sin(r) * v0, -math.sin(r) * u0 + math.cos(r) * v0


def board_jacobian(spec: LRFSpec, R, direction):
    """How positions across the beam map onto each board.

    A board point (x, y), relative to where the beam's center lands, sits
    at (u, v) = K (x, y) across the beam, the rows of K being the beam's u
    and v axes in the tag's frame (light travels along the beam, so this is
    a projection along it). Inverting, (x, y) = J (u, v). On a board facing
    the beam J is a rotation; turning the board away stretches it by
    1/cos of the angle. Returns J00, J01, J10, J11, each (N,).
    """
    eu, ev = beam_axes(spec, direction)
    U = np.einsum("nji,j->ni", R, eu)
    V = np.einsum("nji,j->ni", R, ev)
    det = U[:, 0] * V[:, 1] - U[:, 1] * V[:, 0]
    return V[:, 1] / det, -U[:, 1] / det, -V[:, 0] / det, U[:, 0] / det


def footprint(spec: LRFSpec, s, R, direction):
    """The footprint's spread along the board's x and y axes.

    Along x, a footprint point sits at J00 u + J01 v, the sum of the
    rectangle's two sides (uniform distributions, foreshortened and rotated
    onto the board) and their Gaussian blur. Returns (a, b, sigma) for x and
    for y: the two uniform half widths and the blur.
    """
    J00, J01, J10, J11 = board_jacobian(spec, R, direction)
    hu, hv, su, sv = spec.profile(s)
    mx = (np.abs(J00) * hu, np.abs(J01) * hv, np.hypot(J00 * su, J01 * sv))
    my = (np.abs(J10) * hu, np.abs(J11) * hv, np.hypot(J10 * su, J11 * sv))
    return mx, my


_SQRT2PI = math.sqrt(2 * math.pi)


def spread_cdf(x, a, b, sigma):
    """P(A + B + G <= x) for A uniform on [-a, a], B uniform on [-b, b],
    and G normal with standard deviation sigma.

    With chi the second antiderivative of Phi(y / sigma), the double
    integral over A and B is a second difference of chi.
    """
    x, a, b, sigma = np.broadcast_arrays(*(np.asarray(v, float) for v in (x, a, b, sigma)))
    gaussian = a + b < 1e-2 * sigma
    a = np.maximum(a, 1e-3 * sigma)
    b = np.maximum(b, 1e-3 * sigma)

    def chi(y):
        z = y / sigma
        return sigma * sigma * (0.5 * (z * z + 1) * ndtr(z) + 0.5 * z * np.exp(-0.5 * z * z) / _SQRT2PI)

    boxed = (chi(x + a + b) - chi(x + a - b) - chi(x - a + b) + chi(x - a - b)) / (4 * a * b)
    return np.where(gaussian, ndtr(x / sigma), np.clip(boxed, 0.0, 1.0))


def _inside(lo, hi, c, m):
    """Fraction of a footprint spread m = (a, b, sigma), centered at c,
    that falls between lo and hi."""
    return spread_cdf(hi - c, *m) - spread_cdf(lo - c, *m)


def echo_fraction(board: Board, spec: LRFSpec, s, xy, R, direction):
    """Echo relative to the whole beam landing on white board: the beam's
    power on the board, minus what the darker tag pattern doesn't return.

    Taking the product of the x and y spreads is exact wherever the
    footprint crosses a single edge, at any orientation of the board or the
    beam; near a corner it ignores how the footprint is sheared, and the
    sweep stays away from the corners.
    """
    mx, my = footprint(spec, s, R, direction)
    x, y = xy[:, 0], xy[:, 1]
    x0, x1, y0, y1 = board.extents()
    h = board.tag_size_m / 2
    on_board = _inside(x0, x1, x, mx) * _inside(y0, y1, y, my)
    on_tag = _inside(-h, h, x, mx) * _inside(-h, h, y, my)
    return on_board - (1 - board.tag_relative_reflectance) * on_tag


def hit_probability(F, strength, spec: LRFSpec, lapse: float):
    """Detection probability when a fraction F of a full echo comes back.
    `strength` is the signal to noise ratio of a full echo: an unknown that
    depends on the board's reflectance, the distance, and any attenuator,
    so the fit estimates it for every session. `lapse` allows for the
    occasional spurious miss or hit that no beam position explains."""
    return lapse + (1 - 2 * lapse) * ndtr(strength * F - spec.threshold_sigma)


def boundary_offset(strength, m, spec: LRFSpec):
    """How far outside a straight board edge the beam's center can be and
    still be detected half the time (negative: inside), for a footprint
    spread m = (a, b, sigma) across the edge."""
    q = spec.threshold_sigma / max(strength, 1e-9)
    if q >= 1:
        return 0.0
    a, b, sg = (float(v) for v in m)
    L = a + b + 15 * sg
    return optimize.brentq(lambda u: float(spread_cdf(-u, a, b, sg)) - q, -L, L)


def angles_for_shift(origin, direction, R, t, shift_tag):
    """Change of the beam's (yaw, pitch), in radians, that moves where it
    lands on a board at pose (R, t) by shift_tag (tag frame, meters)."""
    _, xy, _ = beam_on_board(origin, direction, R[None], t[None])
    P0 = R @ np.r_[xy[0], 0.0] + t
    P1 = R @ np.r_[xy[0] + np.asarray(shift_tag, float), 0.0] + t
    v0, v1 = P0 - origin, P1 - origin
    return (math.atan2(v1[0], v1[2]) - math.atan2(v0[0], v0[2]),
            math.atan2(v1[1], v1[2]) - math.atan2(v0[1], v0[2]))


def _az_el(v):
    return math.atan2(v[0], v[2]), math.atan2(-v[1], math.hypot(v[0], v[2]))


def pointing_delta(origin, direction, R, t, p_tag):
    """Turret move (d_pan, d_tilt) that would put the beam on point p_tag
    (tag frame) of a board seen at pose (R, t). Small angle approximation:
    the stop's actual pose is measured anyway, so this only needs to be
    roughly right."""
    P = R @ np.array([p_tag[0], p_tag[1], 0.0]) + t
    az1, el1 = _az_el(P - origin)
    az0, el0 = _az_el(direction)
    return az1 - az0, el1 - el0


# ---------------------------------------------------------------------------
# Data collection
# ---------------------------------------------------------------------------

@dataclass
class Stop:
    session: int
    pan: float
    tilt: float
    R: np.ndarray           # tag pose in the camera frame
    t: np.ndarray
    rms_px: float           # corner reprojection error of the pose
    echoes: list
    expected_m: float       # distance to the board along the beam guess at the time
    hit: bool               # hit/miss mode: an echo from the board; depth mode: reading nearer the board than the background
    range_m: Optional[float]    # the board's echo (hit/miss) or the merged reading (depth)
    mode: str = "hits"          # "hits" or "depth"

    def to_dict(self):
        d = asdict(self)
        d["R"], d["t"] = self.R.tolist(), self.t.tolist()
        return d

    @staticmethod
    def from_dict(d):
        d = dict(d)
        d["R"], d["t"] = np.array(d["R"]), np.array(d["t"])
        return Stop(**d)


def classify(echoes, expected_m, gate_m):
    """A hit is an echo within the gate of the board's distance. Echoes from
    the background or the turret's surroundings are misses."""
    best = min(echoes, key=lambda r: abs(r - expected_m), default=None)
    if best is not None and abs(best - expected_m) <= gate_m:
        return True, best
    return False, None


def depth_reading(echoes, expected_m, gap_m, gate_m):
    """In depth mode, the one echo between the board and the background
    (with the gate's slack for noise and range offset), or None."""
    lo, hi = expected_m - gate_m, expected_m + gap_m + gate_m
    cand = [r for r in echoes if lo <= r <= hi]
    return min(cand, key=lambda r: abs(r - (expected_m + gap_m / 2)), default=None)


class Collector:
    """Runs the sweep for one board placement (a "session")."""

    def __init__(self, rig: Rig, intr: Intrinsics, spec: LRFSpec, frames: int = 3,
                 max_rms_px: float = 1.0, log: Callable = print, seed: int = 0):
        self.rig, self.intr, self.spec = rig, intr, spec
        self.frames, self.max_rms_px, self.log = frames, max_rms_px, log
        self.rng = np.random.default_rng(seed)
        self.gate_m = max(1.5, 3 * spec.accuracy_m)
        self.boards = {}            # session -> board, for fits that include earlier sessions
        self.modes = {}             # session -> ("hits", None) or ("depth", background gap in m)

    def pose(self, board: Board):
        corners = self.rig.tag_corners(board.tag_id, self.frames)
        if corners is None:
            return None
        pose = estimate_tag_pose(corners, self.intr, board.tag_size_m)
        if pose is None or pose[2] > self.max_rms_px:
            return None
        return pose

    def stop(self, board, session, guess: MountGuess, pan, tilt) -> Optional[Stop]:
        self.rig.move_to(pan, tilt)
        pose = self.pose(board)
        if pose is None:
            return None
        R, t, rms = pose
        s, _, _ = beam_on_board(np.array(guess.origin_m), guess.direction(), R[None], t[None])
        st = Stop(session, pan, tilt, R, t, rms, list(self.rig.measure()), float(s[0]), False, None)
        self.classify(st)
        return st

    def classify(self, st: Stop):
        """Read a stop's echoes according to its session's mode."""
        mode, gap = self.modes.get(st.session, ("hits", None))
        st.mode = mode
        if mode == "depth":
            st.range_m = depth_reading(st.echoes, st.expected_m, gap, self.gate_m)
            st.hit = st.range_m is not None and st.range_m - st.expected_m < gap / 2
        else:
            st.hit, st.range_m = classify(st.echoes, st.expected_m, self.gate_m)

    def aim(self, board, guess: MountGuess, p_tag=(0.0, 0.0), iters=4):
        """Move so the guessed beam lands on p_tag; returns the reference
        (pan, tilt, R, t) that later moves are planned from."""
        pan, tilt = self.rig.angles()
        for _ in range(iters):
            self.rig.move_to(pan, tilt)
            pose = self.pose(board)
            if pose is None:
                raise RuntimeError("tag %d not visible: point the turret at the board" % board.tag_id)
            R, t, _ = pose
            dp, dt = pointing_delta(np.array(guess.origin_m), guess.direction(), R, t, p_tag)
            if math.hypot(dp, dt) < 0.05e-3:
                break
            pan, tilt = pan + dp, tilt + dt
        return pan, tilt, R, t

    def run_points(self, board, session, guess, ref, points) -> list:
        """Visit board points (tag frame) where the guessed beam should land."""
        pan0, tilt0, R0, t0 = ref
        o, d = np.array(guess.origin_m), guess.direction()
        out = []
        for p in points:
            dp, dt = pointing_delta(o, d, R0, t0, p)
            st = self.stop(board, session, guess, pan0 + dp, tilt0 + dt)
            if st is not None:
                out.append(st)
        return out

    def transects(self, board, n_per_edge, axes):
        """Lines of points crossing each edge of the board at right angles.
        axes["x"] (left and right edges) and axes["y"] (top and bottom) are
        (offset_m, half_len_m, step_m): each line is centered offset_m
        outside the edge. Each line starts at a random fraction of a step, so
        the stops don't all land at the same place relative to the edge; the
        fit then resolves the edge to a fraction of a step."""
        x0, x1, y0, y1 = board.extents()
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        fr = [0.0] if n_per_edge == 1 else np.linspace(-0.3, 0.3, n_per_edge)
        lines = []
        for edge in ("left", "right", "top", "bottom"):
            for f in fr:
                if edge in ("left", "right"):
                    base = np.array([x0 if edge == "left" else x1, cy + f * (y1 - y0)])
                    normal = np.array([-1.0 if edge == "left" else 1.0, 0.0])
                    offset_m, half_len_m, step_m = axes["x"]
                else:
                    base = np.array([cx + f * (x1 - x0), y0 if edge == "top" else y1])
                    normal = np.array([0.0, -1.0 if edge == "top" else 1.0])
                    offset_m, half_len_m, step_m = axes["y"]
                u = np.arange(-half_len_m, half_len_m, step_m) + self.rng.uniform(0, step_m)
                if len(lines) % 2:
                    u = u[::-1]
                lines.append(base + (offset_m + u)[:, None] * normal)
        return lines

    def stretch(self, guess, ref):
        """How much a tilted board stretches distances along its x and y
        axes, as seen along the beam (1 for a board facing the beam)."""
        J00, J01, J10, J11 = (float(v[0]) for v in board_jacobian(self.spec, ref[2][None], guess.direction()))
        return math.hypot(J00, J01), math.hypot(J10, J11)

    def check_background(self, board, session, guess, ref, s0):
        """Point the beam well off each side of the board and decide the
        mode: a background within the discrimination distance behind the
        board merges with its echo (depth mode); a farther one, or none,
        leaves the board's echo on its own (hit/miss mode). Returns the
        stops, which also count as measurements."""
        x0, x1, y0, y1 = board.extents()
        kx, ky = self.stretch(guess, ref)
        far = guess.tolerance_mrad * 1e-3 * s0 + 4 * float(self.spec.beam_radius(s0))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        pts = [(x0 - far * kx, cy), (x1 + far * kx, cy), (cx, y0 - far * ky), (cx, y1 + far * ky)]
        stops = self.run_points(board, session, guess, ref, pts)
        behind = [r - st.expected_m for st in stops for r in st.echoes
                  if 2 * self.spec.accuracy_m < r - st.expected_m < self.spec.discrimination_m]
        if behind:
            gap = float(np.median(behind))
            self.modes[session] = ("depth", gap)
            self.log("  background %.1f m behind the board, within the %.0f m discrimination: depth mode"
                     % (gap, self.spec.discrimination_m))
            if gap < 3 * self.spec.accuracy_m:
                self.log("  warning: the depth step (%.1f m) is small next to the range noise" % gap)
        else:
            self.modes[session] = ("hits", None)
            self.log("  nothing echoes within %.0f m behind the board: hit/miss mode"
                     % self.spec.discrimination_m)
        for st in stops:
            self.classify(st)
        return stops

    def walk_out(self, board, session, guess, ref, s0, w, gap):
        """Depth mode's coarse pass: from inside each edge, step outward
        until the reading has passed halfway to the background a few times,
        so each line crosses the whole ramp from the board's distance to the
        background's."""
        x0, x1, y0, y1 = board.extents()
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        kx, ky = self.stretch(guess, ref)
        tol = guess.tolerance_mrad * 1e-3 * s0
        stops = []
        for base, normal, k in (((x0, cy), (-1, 0), kx), ((x1, cy), (1, 0), kx),
                                ((cx, y0), (0, -1), ky), ((cx, y1), (0, 1), ky)):
            base, normal = np.array(base), np.array(normal, float)
            u, beyond = -(tol + 2 * w) * k, 0
            while u <= (tol + 6 * w) * k and beyond < 4:
                st = self.run_points(board, session, guess, ref, [base + u * normal])
                stops += st
                if st and (st[0].range_m is None or st[0].range_m - st[0].expected_m > gap / 2):
                    beyond += 1
                u += w / 2 * k
        return stops

    def find_board(self, board, session, guess, ref, s0):
        """If the guessed beam misses the board entirely, search a grid of
        points until it hits, then shift the guess by the offset found."""
        x0, x1, y0, y1 = board.extents()
        st = self.run_points(board, session, guess, ref, [((x0 + x1) / 2, (y0 + y1) / 2)])
        if st and st[0].hit:
            return guess, st
        x0, x1, y0, y1 = board.extents()
        c = np.array([(x0 + x1) / 2, (y0 + y1) / 2])
        step = min(x1 - x0, y1 - y0) / 3
        reach = guess.tolerance_mrad * 1e-3 * s0 * max(self.stretch(guess, ref)) + max(x1 - x0, y1 - y0) / 2
        n = int(math.ceil(reach / step))
        grid = sorted((c + (i * step, j * step) for i in range(-n, n + 1) for j in range(-n, n + 1)),
                      key=lambda p: math.hypot(*(p - c)))
        tried = st
        for p in grid[1:]:
            s = self.run_points(board, session, guess, ref, [p])
            tried += s
            if s and s[0].hit:
                # the true beam lands near the board's center when the guess
                # lands at p: shift the guess by (center - p), on the board
                dyaw, dpitch = angles_for_shift(np.array(guess.origin_m), guess.direction(),
                                                ref[2], ref[3], c - p)
                return _shift_guess(guess, dyaw, dpitch, guess.tolerance_mrad / 3), tried
        raise RuntimeError("no echo from the board anywhere within the tolerance; check the "
                           "range gate, the attenuation, and the tolerance")

    def session(self, board: Board, session: int, guess: MountGuess, earlier: Sequence[Stop] = ()):
        """Sweep one board placement. Returns its stops and an improved guess."""
        t_start = time.time()
        self.boards[session] = board
        x0, x1, y0, y1 = board.extents()
        center = ((x0 + x1) / 2, (y0 + y1) / 2)
        ref = self.aim(board, guess, center)
        s0 = float(np.linalg.norm(ref[3]))
        if s0 < self.spec.min_range_m:
            raise RuntimeError("board at %.1f m is too close; the range finder's minimum is %.0f m"
                               % (s0, self.spec.min_range_m))
        w = float(self.spec.beam_radius(s0))
        kx, ky = self.stretch(guess, ref)
        _, _, d_tag = beam_on_board(np.array(guess.origin_m), guess.direction(), ref[2][None], ref[3][None])
        incidence = math.degrees(math.acos(min(1.0, abs(float(d_tag[0, 2])))))
        if incidence > 70:
            raise RuntimeError("the board is turned %.0f degrees away from the beam; keep it under 70"
                               % incidence)
        self.log("session %d: board %.1f m away, %.0f degrees from facing the beam, footprint ~%.1f cm"
                 % (session, s0, incidence, 200 * w))
        stops = self.check_background(board, session, guess, ref, s0)
        mode, gap = self.modes[session]
        guess, found = self.find_board(board, session, guess, ref, s0)
        stops += found
        if guess.tolerance_mrad * 1e-3 * s0 > min(board.width_m, board.height_m) / 2:
            # the beam could be far off: re-aim with the improved guess
            ref = self.aim(board, guess, center)

        # coarse pass, wide enough for the tolerance
        tol = guess.tolerance_mrad * 1e-3 * s0
        if mode == "depth":
            stops += self.walk_out(board, session, guess, ref, s0, w, gap)
        else:
            step = max(w / 2, 0.25e-3 * s0)
            for line in self.transects(board, 1, {"x": (0.0, (tol + 3 * w) * kx, step * kx),
                                                  "y": (0.0, (tol + 3 * w) * ky, step * ky)}):
                stops += self.run_points(board, session, guess, ref, line)
        fit = fit_beam(list(earlier) + stops, self.boards, self.spec, guess, fit_origin=False, bootstrap=0)
        sigma = max(0.1, 0.25 * w / s0 * 1e3)       # mrad; the coarse step limits it
        guess = MountGuess(guess.origin_m, fit.yaw_mrad, fit.pitch_mrad, 3 * sigma)
        if mode == "depth":
            dp = fit.depth[session]
            self.log("  coarse: %d stops, beam at yaw %.2f, pitch %.2f mrad; range noise %.2f m, "
                     "background %.0f%% as bright as the board" % (len(stops), fit.yaw_mrad, fit.pitch_mrad,
                                                                    dp["sigma_m"], 100 * dp["k"]))
        else:
            strength = fit.strength[session]
            if strength < 2 * self.spec.threshold_sigma:
                self.log("  warning: weak echo (full beam SNR ~%.0f): use less attenuation" % strength)
            self.log("  coarse: %d stops, %d hits, beam at yaw %.2f, pitch %.2f mrad, full beam SNR ~%.0f"
                     % (len(stops), sum(s.hit for s in stops), fit.yaw_mrad, fit.pitch_mrad, strength))

        # fine pass: five lines per edge across where the reading changes
        ref = self.aim(board, guess, center)
        kx, ky = self.stretch(guess, ref)
        if mode == "depth":
            # the whole ramp plus some pure board and pure background
            half = 3 * sigma * 1e-3 * s0 + 2.5 * w
            axes = {"x": (0.0, half * kx, w * kx / 4), "y": (0.0, half * ky, w * ky / 4)}
        else:
            # centered on where the hits should stop
            mx, my = footprint(self.spec, np.array([s0]), ref[2][None], guess.direction())
            half = 3 * sigma * 1e-3 * s0 + 1.5 * w
            axes = {"x": (boundary_offset(strength, mx, self.spec), half * kx, w * kx / 3),
                    "y": (boundary_offset(strength, my, self.spec), half * ky, w * ky / 3)}
        n0 = len(stops)
        for line in self.transects(board, 5, axes):
            stops += self.run_points(board, session, guess, ref, line)
        self.log("  fine: %d stops (%.0f s of computation)" % (len(stops) - n0, time.time() - t_start))
        return stops, guess


def _shift_guess(guess: MountGuess, dyaw_rad, dpitch_rad, tolerance_mrad):
    return MountGuess(guess.origin_m, guess.yaw_mrad + dyaw_rad * 1e3,
                      guess.pitch_mrad + dpitch_rad * 1e3, tolerance_mrad)


# ---------------------------------------------------------------------------
# The fit
# ---------------------------------------------------------------------------

class SweepModel:
    """Predicts every stop's measurement as a function of the beam.

    Hit/miss sessions: the probability of an echo from the board, given the
    fraction of the footprint on it (hit_probability).

    Depth sessions: the reported range. The board's and the background's
    echoes merge into one pulse, and the range finder reports where its
    middle is, which is their distances averaged with weights proportional
    to the light each returns:

        range = g s + (1 - g) d + b,   g = F / (F + k (1 - F_board))

    with s the board's distance along the beam (from the camera's pose), d
    the background's, b the range finder's offset, F the footprint's echo
    from the board (relative to all of it on white), F_board the fraction of
    the footprint the board blocks, and k how bright the background is
    relative to the board. With k = 1 the reading moves linearly from the
    board's distance to the background's as the footprint slides off.

    Parameters: yaw and pitch (mrad), optionally the origin's sideways
    offset from the drawings (dx, dy in mm), and the log of each hit/miss
    session's full beam signal to noise ratio. A depth session's own
    unknowns (k, b, and d near each of the board's four edges, since the
    background needn't be parallel to the board) are solved for inside, for
    every candidate beam: for a given k the range is linear in b and d.
    """

    def __init__(self, stops: Sequence[Stop], boards: dict, spec: LRFSpec, origin0,
                 fit_origin: bool, lapse: float):
        # boards: session -> Board; every session among the stops needs one
        self.spec, self.lapse, self.fit_origin = spec, lapse, fit_origin
        self.origin0 = np.asarray(origin0, float)
        self.R = np.stack([s.R for s in stops])
        self.t = np.stack([s.t for s in stops])
        self.hit = np.array([s.hit for s in stops], bool)
        self.range = np.array([np.nan if s.range_m is None else s.range_m for s in stops])
        sess = np.array([s.session for s in stops])
        self.sessions = sorted(set(sess.tolist()))
        self.masks = [sess == k for k in self.sessions]
        self.boards = [boards[k] for k in self.sessions]
        mode = {s.session: s.mode for s in stops}
        self.depth = [mode[k] == "depth" for k in self.sessions]
        self.hit_sessions = [i for i, dpt in enumerate(self.depth) if not dpt]
        self.n_geo = 4 if fit_origin else 2
        self.log_k = {}         # warm start for each depth session's k
        # range noise of each depth session, from readings near the board's
        # distance (robust, so the ramp's readings don't inflate it)
        self.sigma = {}
        exp_m = np.array([s.expected_m for s in stops])
        for i, m in enumerate(self.masks):
            if self.depth[i]:
                r = (self.range - exp_m)[m & self.hit & np.isfinite(self.range)]
                med = np.median(r) if len(r) else 0.0
                mad = 1.4826 * np.median(np.abs(r - med)) if len(r) > 5 else 0.15
                self.sigma[i] = max(0.03, float(mad))

    def split(self, p):
        origin = self.origin0.copy()
        if self.fit_origin:
            origin[:2] += np.asarray(p[2:4]) * 1e-3
        strength = np.full(len(self.sessions), np.nan)
        strength[self.hit_sessions] = np.exp(np.asarray(p[self.n_geo:]))
        return origin, beam_direction(p[0], p[1]), strength

    def fractions(self, origin, direction, blocked=False):
        """Each stop's echo fraction F (or with blocked=True, the fraction of
        the footprint on the board at all, dark tag or not) and distance s."""
        F = np.empty(len(self.hit))
        s_all = np.empty(len(self.hit))
        for m, b in zip(self.masks, self.boards):
            if blocked:
                b = replace(b, tag_relative_reflectance=1.0)
            s, xy, _ = beam_on_board(origin, direction, self.R[m], self.t[m])
            F[m], s_all[m] = echo_fraction(b, self.spec, s, xy, self.R[m], direction), s
        return F, s_all

    def nearest_edge(self, i, origin, direction):
        """Index (left, right, top, bottom) of the board edge nearest to
        where the beam lands, for each stop of session i."""
        m = self.masks[i]
        _, xy, _ = beam_on_board(origin, direction, self.R[m], self.t[m])
        x0, x1, y0, y1 = self.boards[i].extents()
        return np.argmin(np.stack([xy[:, 0] - x0, x1 - xy[:, 0], xy[:, 1] - y0, y1 - xy[:, 1]]), axis=0)

    def probabilities(self, p):
        """Hit probability of every stop (NaN for depth sessions)."""
        origin, direction, strength = self.split(p)
        F, _ = self.fractions(origin, direction)
        a = np.full(len(F), np.nan)
        for m, st in zip(self.masks, strength):
            a[m] = st
        return hit_probability(F, a, self.spec, self.lapse)

    @staticmethod
    def _huber(z, c=2.0):
        a = np.abs(z)
        return np.where(a < c, z * z, 2 * c * a - c * c)

    def _depth_solve(self, log_k, F, Fb, s, r, edge, sigma, wts):
        """For a given k: least squares b and d (Huber weighted, by
        iterative reweighting). Returns (loss, b, d[4], residuals)."""
        g = F / (F + math.exp(log_k) * (1 - Fb) + 1e-12)
        y = r - g * s
        A = np.zeros((len(r), 5))
        A[:, 0] = 1.0
        A[np.arange(len(r)), 1 + edge] = 1 - g
        w = wts.copy()
        for _ in range(4):
            sw = np.sqrt(w)
            x = np.linalg.lstsq(A * sw[:, None], y * sw, rcond=None)[0]
            res = y - A @ x
            z = np.abs(res) / sigma
            w = wts * np.where(z < 2.0, 1.0, 2.0 / np.maximum(z, 1e-12))
        return 0.5 * float(np.sum(wts * self._huber(res / sigma))), x[0], x[1:], res

    def depth_fit(self, i, origin, direction, F, Fb, s, weights=None):
        """Profile out session i's depth unknowns: returns (loss, details)."""
        m = self.masks[i] & np.isfinite(self.range)
        mi = np.isfinite(self.range[self.masks[i]])
        edge = self.nearest_edge(i, origin, direction)[mi]
        wts = np.ones(m.sum()) if weights is None else weights[m]
        args = (F[m], Fb[m], s[m], self.range[m], edge, self.sigma[i], wts)
        f = lambda lk: self._depth_solve(lk, *args)[0]
        lk0 = self.log_k.get(i)
        if lk0 is None:
            grid = np.linspace(-2.5, 2.5, 21)
            lk0 = float(grid[np.argmin([f(v) for v in grid])])
        r = optimize.minimize_scalar(f, bounds=(lk0 - 0.6, lk0 + 0.6), method="bounded",
                                     options={"xatol": 0.01})
        self.log_k[i] = float(r.x)
        loss, b, d, res = self._depth_solve(r.x, *args)
        return loss, {"k": math.exp(r.x), "range_offset_m": float(b), "background_m": d.tolist(),
                      "sigma_m": self.sigma[i], "rms_m": float(np.sqrt(np.mean(res ** 2)))}

    def nll(self, p, weights=None):
        origin, direction, strength = self.split(p)
        F, s = self.fractions(origin, direction)
        total = 0.0
        if self.hit_sessions:
            a = np.full(len(F), np.nan)
            for m, st in zip(self.masks, strength):
                a[m] = st
            hm = np.isfinite(a)
            P = np.clip(hit_probability(F[hm], a[hm], self.spec, self.lapse), 1e-12, 1 - 1e-12)
            ll = np.where(self.hit[hm], np.log(P), np.log1p(-P))
            total -= float(np.sum(ll if weights is None else weights[hm] * ll))
        if any(self.depth):
            Fb, _ = self.fractions(origin, direction, blocked=True)
            for i, dpt in enumerate(self.depth):
                if dpt:
                    total += self.depth_fit(i, origin, direction, F, Fb, s, weights)[0]
        return total

    def depth_details(self, p):
        origin, direction, _ = self.split(p)
        F, s = self.fractions(origin, direction)
        Fb, _ = self.fractions(origin, direction, blocked=True)
        return {self.sessions[i]: self.depth_fit(i, origin, direction, F, Fb, s)[1]
                for i, dpt in enumerate(self.depth) if dpt}


HitModel = SweepModel       # the earlier name


@dataclass
class FitResult:
    yaw_mrad: float
    pitch_mrad: float
    origin_m: np.ndarray
    strength: dict              # hit/miss session -> full beam SNR
    depth: dict                 # depth session -> k, range offset, background distances, noise, rms
    nll: float
    agreement: float            # fraction of hit/miss stops the fit classifies correctly (NaN if none)
    samples: Optional[np.ndarray] = None    # bootstrap parameter vectors
    model: Optional[SweepModel] = None
    params: Optional[np.ndarray] = None


def _initial_angles(model: SweepModel, guess: MountGuess):
    """Shift of the beam that centers the hits on the boards: when the
    guessed beam lands at q and the true beam at q + delta, the hits are
    the stops with q + delta on the board, centered on (center - delta).
    In depth mode a "hit" is a reading nearer the board than the background."""
    o, d = np.asarray(guess.origin_m, float), guess.direction()
    shifts = []
    for m, b in zip(model.masks, model.boards):
        _, xy, _ = beam_on_board(o, d, model.R[m], model.t[m])
        h = model.hit[m]
        if not h.any():
            raise RuntimeError("a session has no hits")
        x0, x1, y0, y1 = b.extents()
        q = xy[h]
        delta = ((x0 + x1) / 2 - (q[:, 0].min() + q[:, 0].max()) / 2,
                 (y0 + y1) / 2 - (q[:, 1].min() + q[:, 1].max()) / 2)
        k = np.flatnonzero(m)[np.flatnonzero(h)[0]]       # any stop's pose will do
        shifts.append(angles_for_shift(o, d, model.R[k], model.t[k], delta))
    dyaw, dpitch = np.mean(shifts, axis=0)
    return guess.yaw_mrad + dyaw * 1e3, guess.pitch_mrad + dpitch * 1e3


def _minimize(f, p0, scale):
    p0, scale = np.asarray(p0, float), np.asarray(scale, float)
    g = lambda z: f(p0 + z * scale)
    z = np.zeros(len(p0))
    for _ in range(3):      # restarts shake Nelder-Mead out of a collapsed simplex
        simplex = np.vstack([z, z + np.eye(len(z))])
        r = optimize.minimize(g, z, method="Nelder-Mead",
                              options=dict(initial_simplex=simplex, xatol=1e-4, fatol=1e-5,
                                           maxiter=6000, maxfev=12000))
        if np.linalg.norm(r.x - z) < 1e-3:
            z = r.x
            break
        z = r.x
    return p0 + z * scale


def fit_beam(stops: Sequence[Stop], boards: dict, spec: LRFSpec, guess: MountGuess,
             fit_origin: Optional[bool] = None, lapse: float = 0.01, bootstrap: int = 40,
             seed: int = 0) -> FitResult:
    """Maximum likelihood beam from all the measurements; bootstrap
    resampling of the stops gives the uncertainties."""
    if fit_origin is None:
        # the origin is only observable with clearly different distances
        dist = [np.median(np.linalg.norm(np.stack([s.t for s in stops if s.session == k]), axis=1))
                for k in sorted(set(s.session for s in stops))]
        fit_origin = len(dist) >= 2 and max(dist) / min(dist) > 1.8
    model = SweepModel(stops, boards, spec, guess.origin_m, fit_origin, lapse)
    yaw0, pitch0 = _initial_angles(model, guess)
    geo0 = [yaw0, pitch0] + ([0.0, 0.0] if fit_origin else [])

    # each hit/miss session's echo strength: a 1D search with the angles held
    logs = []
    for j, k in enumerate(model.hit_sessions):
        best = None
        for la in np.arange(0.0, 18.0, 0.5):
            p = np.r_[geo0, [la if jj == j else 4.0 for jj in range(len(model.hit_sessions))]]
            m = model.masks[k]
            P = np.clip(model.probabilities(p)[m], 1e-12, 1 - 1e-12)
            v = -np.sum(np.where(model.hit[m], np.log(P), np.log1p(-P)))
            if best is None or v < best[0]:
                best = (v, la)
        logs.append(best[1])
    p0 = np.r_[geo0, logs]
    beam_mrad = spec.divergence_mrad
    scale = np.r_[[0.1 * beam_mrad] * 2, [2.0, 2.0] if fit_origin else [], [0.5] * len(logs)]
    p = _minimize(model.nll, p0, scale)

    samples = None
    if bootstrap:
        rng = np.random.default_rng(seed)
        samples = []
        n = len(model.hit)
        for _ in range(bootstrap):
            # resample stops within each session
            wts = np.zeros(n)
            for m in model.masks:
                idx = np.flatnonzero(m)
                np.add.at(wts, rng.choice(idx, len(idx)), 1.0)
            samples.append(_minimize(lambda q: model.nll(q, wts), p, scale * 0.5))
        samples = np.array(samples)

    origin, direction, strength = model.split(p)
    P = model.probabilities(p)
    hm = np.isfinite(P)
    agree = float(np.mean((P[hm] > 0.5) == model.hit[hm])) if hm.any() else float("nan")
    yaw = math.atan2(direction[0], direction[2]) * 1e3
    pitch = math.atan2(direction[1], direction[2]) * 1e3
    strengths = {model.sessions[i]: float(strength[i]) for i in model.hit_sessions}
    return FitResult(yaw, pitch, origin, strengths, model.depth_details(p), model.nll(p), agree,
                     samples, model, p)


# ---------------------------------------------------------------------------
# The result
# ---------------------------------------------------------------------------

@dataclass
class Calibration:
    origin_m: list
    direction: list
    yaw_mrad: float
    pitch_mrad: float
    intrinsics: Intrinsics
    sigma: dict = field(default_factory=dict)   # 1 sigma uncertainties
    range_offset_m: Optional[float] = None      # reported range minus distance along the beam
    origin_fitted: bool = False
    info: dict = field(default_factory=dict)

    def beam_point(self, R: float) -> np.ndarray:
        """The beam's center at distance R along the beam, camera frame."""
        return np.asarray(self.origin_m) + R * np.asarray(self.direction)

    def beam_pixel(self, R: float) -> np.ndarray:
        """Pixel the laser is hitting on a target R meters away."""
        return self.intrinsics.project(self.beam_point(R))[0]

    def boresight_pixel(self) -> np.ndarray:
        """Pixel the beam's spot approaches for a distant target: put the
        target here and the beam passes a fixed baseline from its center."""
        d = np.asarray(self.direction)
        return self.intrinsics.project_normalized(d[:2] / d[2])[0]

    def to_json(self) -> str:
        d = asdict(self)
        d["boresight_px"] = self.boresight_pixel().round(2).tolist()
        return json.dumps(d, indent=2)

    @staticmethod
    def from_json(text: str) -> "Calibration":
        d = json.loads(text)
        d.pop("boresight_px", None)
        d["intrinsics"] = Intrinsics(**{**d["intrinsics"], "dist": tuple(d["intrinsics"]["dist"])})
        return Calibration(**d)


def solve(stops: Sequence[Stop], boards: dict, intr: Intrinsics, spec: LRFSpec,
          guess: MountGuess, fit_origin: Optional[bool] = None, bootstrap: int = 40,
          seed: int = 0) -> Calibration:
    """Fit all sessions together and package the result."""
    fit = fit_beam(stops, boards, spec, guess, fit_origin=fit_origin, bootstrap=bootstrap, seed=seed)
    model = fit.model
    origin, direction = fit.origin_m, beam_direction(fit.yaw_mrad, fit.pitch_mrad)

    # range offset, from stops where the whole beam was on the white board
    F, s = model.fractions(origin, direction)
    ranges = model.range
    full = (F > 0.95) & model.hit & np.isfinite(ranges)
    offset = offset_sigma = None
    if full.sum() >= 10:
        r = ranges[full] - s[full]
        offset = float(np.median(r))
        offset_sigma = float(1.4826 * np.median(np.abs(r - offset)) / math.sqrt(full.sum()))

    cal = Calibration(origin.tolist(), direction.tolist(), fit.yaw_mrad, fit.pitch_mrad, intr,
                      range_offset_m=offset, origin_fitted=model.fit_origin)
    if fit.samples is not None and len(fit.samples) > 2:
        S = fit.samples
        bore = []
        for q in S:
            o, d, _ = model.split(q)
            bore.append(intr.project_normalized(d[:2] / d[2])[0])
        cal.sigma = {"yaw_mrad": float(np.std(S[:, 0])), "pitch_mrad": float(np.std(S[:, 1])),
                     "boresight_px": np.std(np.array(bore), axis=0).tolist()}
        if model.fit_origin:
            cal.sigma["origin_mm"] = np.std(S[:, 2:4], axis=0).tolist()
    if offset_sigma is not None:
        cal.sigma["range_offset_m"] = offset_sigma
    sessions = {}
    for i, (k, m) in enumerate(zip(model.sessions, model.masks)):
        d = {"distance_m": float(np.median(s[m])), "stops": int(m.sum())}
        if model.depth[i]:
            dp = fit.depth[k]
            d.update(mode="depth", background_behind_m=float(np.median(dp["background_m"]) - d["distance_m"]),
                     background_brightness=dp["k"], range_noise_m=dp["sigma_m"], fit_rms_m=dp["rms_m"])
        else:
            d.update(mode="hits", hits=int(model.hit[m].sum()), full_beam_snr=fit.strength[k])
        sessions[str(k)] = d
    cal.info = {"stops": len(stops), "agreement": fit.agreement, "sessions": sessions,
                "created": time.strftime("%Y-%m-%d %H:%M:%S")}
    return cal


def report(cal: Calibration, log: Callable = print):
    f = cal.intrinsics.fx
    sg = cal.sigma
    log("beam origin (camera frame): x %+.1f, y %+.1f, z %+.1f mm%s" % (
        *(1e3 * np.asarray(cal.origin_m)),
        ("  (fitted; sideways +/- %.1f, %.1f mm)" % tuple(sg["origin_mm"])) if "origin_mm" in sg
        else "  (from the drawings)"))
    log("beam angle: yaw %+.3f +/- %.3f mrad, pitch %+.3f +/- %.3f mrad" % (
        cal.yaw_mrad, sg.get("yaw_mrad", float("nan")), cal.pitch_mrad, sg.get("pitch_mrad", float("nan"))))
    b = cal.boresight_pixel()
    bs = sg.get("boresight_px", [float("nan")] * 2)
    log("boresight pixel: (%.1f, %.1f) +/- (%.1f, %.1f); image center (%.1f, %.1f)" % (
        b[0], b[1], bs[0], bs[1], (cal.intrinsics.width - 1) / 2, (cal.intrinsics.height - 1) / 2))
    for R in (10, 50, 100, 1000):
        p = cal.beam_pixel(R)
        log("  spot at %5d m: (%.1f, %.1f), %.1f px from the boresight" % (R, p[0], p[1], np.linalg.norm(p - b)))
    if cal.range_offset_m is not None:
        log("range offset: %+.2f +/- %.2f m (reported minus distance from the beam origin)" % (
            cal.range_offset_m, sg.get("range_offset_m", float("nan"))))
    for k, d in cal.info["sessions"].items():
        if d["mode"] == "depth":
            log("session %s, depth: board %.1f m, background %.1f m behind and %.0f%% as bright; "
                "range noise %.2f m, fit rms %.2f m" % (k, d["distance_m"], d["background_behind_m"],
                                                       100 * d["background_brightness"], d["range_noise_m"],
                                                       d["fit_rms_m"]))
        else:
            log("session %s, hit/miss: board %.1f m, %d of %d stops hit, full beam SNR ~%.0f"
                % (k, d["distance_m"], d["hits"], d["stops"], d["full_beam_snr"]))
    if math.isfinite(cal.info["agreement"]):
        log("the fit explains %.1f%% of the hits and misses" % (100 * cal.info["agreement"]))
    log("one pixel is %.3f mrad" % (1e3 / f))


# ---------------------------------------------------------------------------
# Recorded data
# ---------------------------------------------------------------------------

def save_stops(path, stops, boards, intr, spec, guess):
    data = {"intrinsics": asdict(intr), "spec": asdict(spec), "guess": asdict(guess),
            "boards": {str(k): asdict(b) for k, b in boards.items()},
            "stops": [s.to_dict() for s in stops]}
    with open(path, "w") as f:
        json.dump(data, f)


def load_stops(path):
    with open(path) as f:
        d = json.load(f)
    intr = Intrinsics(**{**d["intrinsics"], "dist": tuple(d["intrinsics"]["dist"])})
    boards = {int(k): Board(**{**b, "center_in_tag_m": tuple(b["center_in_tag_m"])})
              for k, b in d["boards"].items()}
    guess = MountGuess(**{**d["guess"], "origin_m": tuple(d["guess"]["origin_m"])})
    return [Stop.from_dict(s) for s in d["stops"]], boards, intr, LRFSpec(**d["spec"]), guess


def main(argv=None):
    ap = argparse.ArgumentParser(description="Solve a range finder calibration from recorded stops.")
    ap.add_argument("stops", help="stops file written by save_stops")
    ap.add_argument("--out", help="write the calibration here (JSON)")
    ap.add_argument("--fixed-origin", action="store_true", help="keep the origin from the drawings")
    args = ap.parse_args(argv)
    stops, boards, intr, spec, guess = load_stops(args.stops)
    cal = solve(stops, boards, intr, spec, guess, fit_origin=False if args.fixed_origin else None)
    report(cal)
    if args.out:
        with open(args.out, "w") as f:
            f.write(cal.to_json())


if __name__ == "__main__":
    sys.exit(main())
