# Range finder to camera calibration

Python implementation of the calibration described in the article: sweep the
range finder's beam across the edges of an AprilTag board and work out, from
what the range finder measures as its footprint slides off the board, where
the beam points relative to the camera.

- `lrf_calibration.py`: the algorithm. Hardware independent: a real rig
  implements the four methods of `Rig` (turret move, tag corners, angles,
  range measurement). Also solves recorded data:
  `python3 lrf_calibration.py stops.json --out calibration.json`.
- `simulate.py`: a simulated turret, 4K camera, and DLEM 20, used to check the
  algorithm against known truth. `python3 simulate.py` (two boards outdoors),
  `--office` (two boards indoors, a wall 2.5 m behind each), `--single` (one
  board), `--orientations N` (random board placements; combine with
  `--office`).

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

At each stop the camera measures the board's pose from the tag's corners and
the range finder fires. Before sweeping, the beam is pointed well past each
edge to see what's behind the board, which picks one of two modes.

### Depth mode: a wall close behind the board (indoors)

A wall a few meters behind the board is well within the DLEM's 25 m target
discrimination, so the board's echo and the wall's arrive as one pulse, and
the range finder reports a distance between the two, weighted by how much
light each returns. As the footprint slides off an edge, the reading moves
linearly from the board's distance to the wall's (exactly linearly if the
wall is as bright as the board). The middle of that ramp is where the
footprint's center crosses the edge.

1. Coarse pass: from inside each edge, step outward half a footprint at a
   time until the reading has passed halfway to the wall a few times. Then
   a quick fit.
2. Fine pass: five lines across each edge, covering the whole ramp and a
   bit of pure board and pure wall on either side, a quarter footprint
   apart.
3. The fit models each reading as `g s + (1 - g) d + b`, with `s` the
   board's distance along the beam (from the camera's pose of the board),
   `d` the wall's, `b` the range finder's zero offset, and
   `g = F / (F + k (1 - F_board))` the board's share of the echo: `F` the
   footprint's echo from the board, `F_board` the part of the footprint
   the board blocks, `k` the wall's brightness relative to the board. For
   each candidate beam, `b`, the wall's distance near each of the four
   edges (it needn't be parallel to the board), and `k` are solved by
   (Huber weighted) least squares, so the outer search is only over the
   beam's yaw, pitch, and origin.

Every stop on a ramp measures how much of the footprint is on the board,
so with 0.3 m of range noise against a 2.5 m step, each reading locates the
edge to a few percent of the footprint.

### Hit/miss mode: open sky or a distant background (outdoors)

1. An echo within 1.5 m of the board's distance is a hit; anything else,
   including the background's own echo, is a miss.
2. Coarse pass: one line of stops across each of the board's four edges,
   long enough to cover the worst case misalignment, then a quick fit.
3. Fine pass: five lines across each edge, centered on where the fit says
   the hits should stop, stepping a third of the footprint.
4. The fit: the probability that the range finder detected the board's
   echo, given the fraction of the footprint on the white board (minus the
   darker tag) and each session's unknown echo strength.

### Both

The two kinds of sessions can be mixed in one fit. The beam's yaw and pitch
(and with two distances, the origin's sideways offset) maximize the
likelihood of all the measurements, and bootstrap resampling of the stops
gives the uncertainties.

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
- Indoors (depth mode): a wall 1.5 m or more behind the board, a plain
  matte wall at whatever angle. Nothing else between the board's edges and
  the wall (chairs, cables, the board's stand directly behind an edge).
  No attenuation is needed, since nothing depends on how strong the echo
  is. The DLEM measures down to 1 m, though its datasheet's range starts
  at 10 m; the code warns below that.
- Outdoors (hit/miss mode): open sky, or nothing within 25 m behind the
  board.
- Distances: with one board the origin comes from the drawings, and any
  error in them turns into an angle error of (origin error) / (distance):
  1 mm at 12.5 m is 0.08 mrad, almost 2 pixels at long range. Two
  distances fix that by measuring the origin too. What matters is how much
  1/R differs between them: 7.5 and 12.5 m (0.053 per meter) work about as
  well as 12.5 and 25 m (0.04 per meter) or 20 and 80 m (0.0375), while 40
  and 80 m (0.0125) barely constrain the origin. In simulation, 7.5 + 12.5 m
  and 12.5 + 25 m both gave a median boresight error near 1 px.
- Camera view: the tag has to stay in the image while the beam is on each
  of the board's edges, so the board can't be much bigger than the camera's
  view at that distance. The code checks this before sweeping. With the
  4K camera at 7.5 m, a 47 cm board with a 30 cm tag needs a horizontal
  field of view of about 15 degrees (10 or 12 is too narrow); a 4.7 m board
  with a 1 m tag in its middle needs about 75 degrees.
- Attenuation (hit/miss mode only): up close the echo is enormous (by the
  article's model, a signal to noise ratio around 180,000 for a full
  footprint on white at 20 m), so even the footprint's dim, blurred edges
  register as hits and the hit region grows past the board. The fit
  estimates the echo strength, so this still works, but an ND 1.0 filter
  over the module's window (10% each way, 1% for the round trip) brings the
  full beam SNR to roughly 1,800 at 20 m and 110 at 80 m, keeping the hit
  boundary near the footprint's edge.
- Hold still for each stop: the sweep moves, settles, takes the frames and
  the measurement, then moves again.

## Simulated results

The simulated range finder has 0.3 m of range noise (1 sigma) and reports
in 0.1 m steps.

Indoors (`--office`): boards at 12.5 m and 25 m, a wall 2.5 m behind each
(60% albedo against the board's 80%), about 1,200 stops and 7 minutes of
turret time. The boresight comes out within 1 px of the truth (reported
uncertainty 0.8 px), the origin within 0.5 mm, the range offset within
1 cm. Over 10 random placements (walls 1.5 to 4 m behind, 30 to 80%
albedo, any board orientation) the worst boresight error was 2.5 px
(0.11 mrad), the median about 1.2 px. With a single board at 12.5 m and
the drawings 1.1 and 1.4 mm off, the error is 3 px, all of it from the
drawings.

Outdoors: two boards (20 m, 12 degrees of yaw; 80 m, rolled 90 degrees, tag off
center, wall 40 m behind), about 790 stops and 5 minutes of turret time:

| | error | reported 1 sigma |
|---|---|---|
| yaw | 0.020 mrad | 0.014 mrad |
| pitch | 0.003 mrad | 0.016 mrad |
| boresight pixel | 0.45 px | 0.3 to 0.4 px |
| origin sideways | 0.6 mm, 0.1 mm | 0.6 mm, 0.5 mm |
| range offset | 1 mm | 2 cm |

One 4K pixel is 0.046 mrad and the beam is about 17.6 px across. Over 12
random outdoor placements (yaw up to 50 degrees, pitch up to 35, any roll, tags off
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
