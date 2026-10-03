# Range finder to camera calibration

Python implementation of the calibration described in the article: sweep the
range finder's beam across an AprilTag board and work out, from which
measurements hit the board and which missed, where the beam points relative
to the camera.

- `lrf_calibration.py`: the algorithm. Hardware independent: a real rig
  implements the four methods of `Rig` (turret move, tag corners, angles,
  range measurement). Also solves recorded data:
  `python3 lrf_calibration.py stops.json --out calibration.json`.
- `simulate.py`: a simulated turret, 4K camera, and DLEM 20, used to check the
  algorithm against known truth. `python3 simulate.py` (two boards),
  `--single` (one board), `--orientations N` (random board placements).

Needs numpy and scipy. Uses OpenCV for the tag pose if it's installed, and
pupil-apriltags in `detect_tag_corners` for a real camera.

## What it finds

The beam as a ray in the camera's frame, `origin + s * direction`, saved as
JSON. At runtime, `Calibration.boresight_pixel()` is where to put a target
(the beam then passes a fixed baseline, 72 mm, from the target's center at
every distance) and `Calibration.beam_pixel(R)` is the pixel the laser is
hitting on something R meters away. It also reports the range finder's zero
offset relative to the beam origin.

## How it works

1. At each stop the camera measures the board's pose from the tag's corners
   and the range finder fires. An echo within 1.5 m of the board's distance
   is a hit; anything else, including echoes from behind the board, is a
   miss.
2. Coarse pass: one line of stops across each of the board's four edges,
   long enough to cover the worst case misalignment, then a quick fit.
3. Fine pass: five lines across each edge, centered on where the fit says
   the hits should stop, stepping a third of the footprint.
4. The fit: for a candidate beam, compute where it lands on the board at
   every stop and what fraction of the footprint falls on the white board
   (minus the darker tag), then the probability that the range finder
   detected that echo. Maximize the likelihood of the observed hits and
   misses over the beam's yaw and pitch (and with two distances, the
   origin's sideways offset), plus each session's unknown echo strength.
   Bootstrap resampling gives the uncertainties.

All geometry is done in the board's own frame from the measured pose, so the
board can be yawed, pitched, rolled, upside down, off to the side, with the
tag anywhere on it; the turret's kinematics and encoders never enter the fit.

### Beam model

A rectangle (the collimator images the laser diode's emitter): evenly lit,
with edges blurred by a Gaussian. Jenoptik calls the DLEM 20's divergence
about 0.8 mrad and symmetrical, so the default is a 0.8 x 0.8 mrad square.
On a tilted board the rectangle's sides are foreshortened and rotated onto
the board; along each board axis the footprint's spread is the sum of two
uniform distributions plus the blur, which has a closed form CDF
(`spread_cdf`). Using it along each axis is exact wherever the footprint
crosses a single edge, which is where the sweep measures. A Gaussian beam is
available with `LRFSpec(beam_shape="gaussian")`.

Assumed, not from a datasheet: the edge blur (0.1 mrad, about diffraction at
the 8 mm aperture) and the rectangle being aligned with the camera's x axis
(`beam_roll_deg`). The calibration is insensitive to both because the hit
region is symmetric (the simulation's true beam is rolled 1.5 degrees with
20% softer edges).

## Setting it up

- Calibrate the camera's intrinsics first, at the focus and zoom it will be
  used at.
- Board: matte white, with the tag (30 cm, laser printed: toner is dark at
  1.55 um, many inkjet inks aren't) and at least 10 to 15 cm of white around
  it, about two footprints at 80 m. Measure the printed tag: a 1% error in
  its size is a 1% error in every distance.
- Background: open sky, or nothing within 25 m behind the board (the DLEM's
  target discrimination; closer echoes merge with the board's at its edges).
  The sweep checks this and warns.
- Distances: one board at 20 m gives the misalignment with the origin taken
  from the drawings. Add a second at 80 m to also measure the origin. The
  DLEM's minimum range is 10 m.
- Attenuation: up close the echo is enormous (by the article's model, a
  signal to noise ratio around 180,000 for a full footprint on white at
  20 m), so even the beam's faint outer wings register as hits and the hit
  region grows well past the board. The fit estimates the echo strength, so
  this still works in the simulation, but the beam model is least
  trustworthy far out in the wings. An ND 1.0 filter over the module's
  window (10% each way, 1% for the round trip) brings the full beam SNR to
  roughly 1,800 at 20 m and 110 at 80 m, keeping the hit boundary near the
  beam's edge. A darker board or a shorter measurement time helps too.
- Hold still for each stop: the sweep moves, settles, takes the frames and
  the measurement, then moves again.

## Simulated results

Two boards (20 m, 12 degrees of yaw; 80 m, rolled 90 degrees, tag off
center, wall 40 m behind), about 790 stops and 5 minutes of turret time:

| | error | reported 1 sigma |
|---|---|---|
| yaw | 0.020 mrad | 0.014 mrad |
| pitch | 0.003 mrad | 0.016 mrad |
| boresight pixel | 0.45 px | 0.3 to 0.4 px |
| origin sideways | 0.6 mm, 0.1 mm | 0.6 mm, 0.5 mm |
| range offset | 1 mm | 2 cm |

One 4K pixel is 0.046 mrad and the beam is about 17.6 px across. Over 12
random placements (yaw up to 50 degrees, pitch up to 35, any roll, tags off
center, offsets, walls), the worst boresight error was 1.7 px and the
median about 0.6 px. With one board at 20 m and the origin from the
drawings, the error is about 1 px, dominated by the drawings being off by
1.1 and 1.4 mm in the simulation.

## Not done

- A real `Rig`: the DLEM's serial protocol is in Jenoptik's interface control
  document, which isn't public; the turret and camera drivers depend on the
  hardware.
- The tag's corner order is AprilTag's (bottom left first,
  counterclockwise); verify it once with a real detector by drawing the
  reprojected corners.
