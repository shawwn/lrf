import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "calibration"))
import numpy as np
from dataclasses import replace
import lrf_calibration as L
import simulate as S
intr, spec, truth = S.camera_4k(), L.LRFSpec(), S.Truth()
rig = S.SimRig(intr, spec, truth, seed=1)
col = L.Collector(rig, intr, spec, log=print, seed=1)
guess = L.MountGuess()
pls = [S.Placement(20, right_m=0.6, up_m=0.4, yaw_deg=12, pitch_deg=-5, roll_deg=3),
       S.Placement(80, right_m=-3.0, up_m=1.5, yaw_deg=-20, pitch_deg=8, roll_deg=90, wall_behind_m=40)]
bds = [L.Board(tag_id=0), L.Board(tag_id=1, center_in_tag_m=(0.05, 0.0))]
rig.place(bds[0], pls[0])
st0, guess = col.session(bds[0], 0, guess)
print("guess after s0:", guess)
rig.place(bds[1], pls[1])
x0,x1,y0,y1 = bds[1].extents(); center=((x0+x1)/2,(y0+y1)/2)
ref = col.aim(bds[1], guess, center)
s0 = float(np.linalg.norm(ref[3]))
g1, st = col.find_board(bds[1], 1, guess, ref, s0)
print("find_board:", len(st), "hit" if st[-1].hit else "miss", g1)
kx, ky = col.stretch(g1, ref); w = float(spec.beam_radius(s0)); tol = g1.tolerance_mrad*1e-3*s0
step = max(w/2, 0.25e-3*s0)
lines = col.transects(bds[1], 1, {"x": (0.0, (tol+3*w)*kx, step*kx), "y": (0.0, (tol+3*w)*ky, step*ky)})
for line in lines: st += col.run_points(bds[1], 1, g1, ref, line)
# where did the guessed and true beams land?
o = np.array(g1.origin_m); d = g1.direction()
R = np.stack([x.R for x in st]); t = np.stack([x.t for x in st])
_, xy_g, _ = L.beam_on_board(o, d, R, t)
_, xy_t, _ = L.beam_on_board(np.array(truth.origin_m), L.beam_direction(truth.yaw_mrad, truth.pitch_mrad), R, t)
h = np.array([x.hit for x in st])
print("board extents", bds[1].extents())
print("hits true-xy range x", xy_t[h,0].min(), xy_t[h,0].max(), "y", xy_t[h,1].min(), xy_t[h,1].max())
print("miss true-xy sample", xy_t[~h][:5])
f0 = L.fit_beam(st0, {0: bds[0]}, spec, g1, fit_origin=False, bootstrap=0)
f = L.fit_beam(st0 + st, {0: bds[0], 1: bds[1]}, spec, g1, fit_origin=False, bootstrap=0)
print("fit s0 only: yaw %.3f pitch %.3f" % (f0.yaw_mrad, f0.pitch_mrad), f0.strength)
print("fit s0+s1coarse: yaw %.3f pitch %.3f" % (f.yaw_mrad, f.pitch_mrad), f.strength, "agree", f.agreement)
m = f.model
print("init angles", L._initial_angles(m, g1))
for yaw in [1.0, 1.3, 1.6, 2.5, 3.8]:
    p = f.params.copy(); p[0] = yaw
    print(" yaw", yaw, "nll", round(m.nll(p), 2))
