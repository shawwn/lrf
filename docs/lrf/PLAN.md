# Laser Range Finders: interactive article plan

Living plan for the `laser-range-finder/` post. Research notes and numbers are in
[NOTES.md](NOTES.md). Update the status checklist at the bottom as work lands.

## Goal

An interactive explainer, in the style of the other posts in this repo, about
laser range finders (LRFs): the physics, how a pulsed LRF works, why small targets
are hard, measurement rate tradeoffs, moving targets, and how to calibrate an LRF
mounted next to a camera on a robot that can spin (pan and tilt).

Every demo builds on the previous ones. The math is parameterized so the same model
can be pointed at a different LRF (narrower divergence, more power, etc.).

## Requirements from the user (in order received)

1. Read how this repo builds understanding step by step with visualizations; make a
   page in the same style.
2. Cover: the physics, how it works (with visualizations), how it calibrates when
   mounted with a camera next to it, etc.
3. Go into detail on the physics. Small target (quadcopter smaller than the beam):
   signal strength falls as the 4th power of distance. (Confirmed: 1/R^4 beyond the
   crossover range where the beam footprint equals the target size, 1/R^2 before.)
4. Thoughtful, interesting, detailed; each visualization builds on the prior ones.
5. Ask about anything, don't assume. Use 0.8 mrad beam spread. Base the LRF on the
   Jenoptik DLEM 20.
6. Context: the LRF is mounted on a robot that can spin around; camera and LRF are on
   the same mechanical surface.
7. Visualizations of tradeoffs: lower Hz vs range, moving targets, etc.
8. The robot sweeps across an AprilTag to calibrate the LRF.
9. The math must be well parameterized so different LRFs can be plugged in (e.g.
   0.6 mrad spread, higher power).
10. Write the full plan and notes under the repo as markdown (this file + NOTES.md).
11. Targets: a 10 inch quad and a Shahed-136 fixed wing drone (replaces the 5 inch FPV).
12. DLEM uses a 0.8 mrad beam; go with that.
13. Use a subagent to look up Jenoptik's patents for more details (done, stopped early at the
    user's request because of token use; results in NOTES.md "Patent research").
14. The DLEM 20 reports range in 0.1 m steps (e.g. 123.7 m, not 123.78 m).
15. Research agents must save every fetched document's raw text in the repo
    (docs/lrf/sources/).
16. Commit as you go, one logical change per commit, with explanatory messages; don't push.
17. The datasheet check plot was too noisy (overlapping labels); fixed with a legend.
18. The 10 inch quad is an FPV quad (prose updated).
19. Scattering demo: make it obvious what moves away when the distance changes (log distance
    axis with the surface moving along it, plus the hemisphere through the receiver).
20. Most sliders should animate in a loop; touching a slider stops it and shows a way to
    resume (play button next to the slider). Link buttons in the text also stop it.
21. Every slider shows its value next to it.
22. Fix the beam cone footprint label (clipped at 5 km), the beam profile tick labels, and the
    accumulation demo's colliding label; start the accumulation demo at ~390 m.
23. Bug: the measurement rate demo froze when its slider was dragged (negative arcTo radius
    for a sliver window); fixed at the root, and the framework now survives a bad frame.
24. Later review rounds: rebuilt the tracking demo (fixed sky view, ghost of the last
    sighting, drag and throw), legible rate tradeoff colors, multiple echoes aim
    visualization (Gaussian shaded beam, looking-down-the-beam inset, visible wings),
    sensor-like camera rendering, 4K camera with a blur slider.
25. The camera is 72 mm horizontally offset from the LRF.

## Decisions (from Q&A)

| Question | Answer |
| --- | --- |
| Byline / location | Shawn Presser byline, new folder `laser-range-finder/` + `js/lrf.js` + `css/lrf.css`. Not added to index/archives. Bartosz's name, analytics, and social links are not used on this page. |
| Reference drones | 10 inch FPV quad (~430 mm motor to motor) and Shahed-136 (3.5 m long, 2.5 m span). Originally a 5 inch FPV; corrected by the user. |
| Beam | 0.8 mrad (DLEM), confirmed by the user |
| Mount | Pan + tilt turret; camera and LRF share one plate |
| Camera | Visible CMOS (cannot see 1.55 um). Illustrative 4K (3840x2160), 10 deg HFOV (was 1080p; changed in review). LRF 72 mm to the right of the camera (given by the user; was an assumed 4 cm) |
| Calibration target | AprilTag, swept across by the turret |
| Rating measurement time | 0.5 s (from the DLEM SR datasheet), replacing the 0.1 s guess |
| Pulse length | 30 ns (4.5 m echo), replacing the 10 ns guess; from patent research, unverified |
| Git | Work on local branch `lrf-article`, not pushed; no Co-authored-by lines |

## Files

| Path | Purpose |
| --- | --- |
| `laser-range-finder/index.html` | The article: prose, demo containers, sliders |
| `css/lrf.css` | Article specific colors, slider colors, calculator styling |
| `js/lrf_model.js` | Pure, parameterized physics model (no DOM). Works in browser (`window.LRFModel`) and Node (`require`). |
| `js/lrf.js` | All demos: drawer framework, 2D drawing helpers, tiny 3D renderer, scenes |
| `docs/lrf/PLAN.md` | This plan |
| `docs/lrf/NOTES.md` | Research notes, sources, assumptions, derived numbers |

Shared framework reused from the repo: `css/base.css`, `js/base.js` (`Slider`,
`SegmentedControl`, `TouchHandler`, matrix and vector helpers).

## Style notes (what makes these posts work)

- Open with a hero demo showing the finished system; promise to build it from first principles.
- One idea per section. Each demo adds exactly one new thing to a picture the reader already understands.
- Prose words are colored to match the demo elements they name; sliders are colored to match what they control.
- Inline "link buttons" in the prose jump a demo to an interesting state.
- Equations are short, centered, introduced only after the demo made them intuitive.
- Admit simplifications explicitly ("I'm exaggerating the divergence so it's visible").
- End with Further Reading and Final Words.
- User preference: no em dashes or en dashes anywhere in user facing text.

## Color language

| Concept | Color |
| --- | --- |
| Outgoing laser light, beam axis | red `#E5383B` |
| Returning echo | amber `#F2A007` |
| Range / distance | blue `#2F7DD3` |
| Drone / target | teal `#149C8F` |
| Background terrain | olive `#7A8B3E` |
| Noise | gray `#9AA0A6` |
| Accumulated histogram | slate `#44546A` |
| Detection threshold | raspberry `#C2185B` |
| Camera | violet `#7E57C2` |
| Mount / baseline | brown `#8D6E63` |
| Misalignment | pink `#EC407A` |
| Speed | green `#43A047` |
| Measurement time / rate | indigo `#5C6BC0` |
| Atmosphere / visibility | blue gray `#78909C` |
| AprilTag | near black `#222` |

## Article outline and demos

Each line: demo id, what it shows, controls. Demos marked (A) are animated.

0. **Intro**
   - `hero` (A): 3D turret (pan/tilt) with camera + LRF tracking a 10 inch quad; camera view inset with beam reticle; live accumulated echo histogram and range readout. Drag to orbit.
   - Spec box: DLEM 20 numbers in a table, preset selector (DLEM 20 / 20LE / 30 / 45). Changing the preset re-renders every demo and updates the dynamic numbers in the text.
1. **Time of Flight**
   - `tof_basic`: pulse leaves LRF, bounces off a wall, returns; timeline below with the detector waveform. Sliders: time, distance. R = c t / 2.
2. **A Spreading Beam**
   - `beam_cone`: side view of the beam cone (vertical exaggeration labeled), footprint to scale next to the 10" quad, the Shahed-136 head on, and the 0.75 m / 2.3 m datasheet targets. Slider: range (log). Footprint D = theta R.
   - `beam_profile`: Gaussian cross section, 1/e^2 width, encircled power vs radius. Slider: circle radius.
3. **Light on Target**
   - `beam_fill`: looking down the beam at range R: footprint heat map + drone silhouette; fraction intercepted; log-log plot of fraction vs R. Segmented: 10" quad / Shahed-136 head on / 0.75 m square. Slider: range.
4. **Light Coming Back**
   - `scatter_back`: Lambertian lobe from the lit patch, tiny receiver aperture far away; collected fraction ~ A_r cos / (pi R^2). Segmented: matte / mirror / retroreflector. Sliders: range, surface tilt.
5. **The Fourth Power**
   - Equation: S = albedo * F(R) * T^2 / R^2, with F ~ A_t / R^2 for small targets.
   - `power_vs_range`: log-log received signal vs range for the 10" quad, Shahed-136 head on, and a wall; local slope readout (-2 area, -3 line, -4 point); marker shows "2x range means 16x less" for the quad. Slider: range marker.
   - `shapes_regimes`: why the slope changes: point (quad), line (Shahed wings), area (wall); beam footprint grows over each silhouette.
6. **Air and Wavelength**
   - `spectrum`: eye response, silicon QE, InGaAs QE, retinal hazard band; 905 nm and 1550 nm lines. Static with hover readout.
   - `atmosphere`: haze particles in the beam; one way and round trip transmission vs range. Slider: visibility.
7. **Reading the Datasheet**
   - `datasheet_check`: signal curves of the three brochure targets with dots at rated ranges; they line up on one horizontal "sensitivity" line; the quad curve crosses it at ~700 m and the Shahed (head on) at ~1.6 km (10 Hz). Segmented: spec preset.
8. **Noise**
   - `single_shot`: one pulse's waveform with noise; echo shrinks into noise as range grows; threshold line; false alarm marks. Sliders: range, threshold.
   - `threshold_stats`: noise and signal+noise distributions; P(false alarm) per bin and per measurement (5000 bins), P(detect). Slider: threshold.
9. **Pulse Accumulation**
   - `accumulate` (A): pulses fire one by one and add into a histogram; peak grows ~N, noise ~sqrt(N). Play/reset; slider: drone range.
   - `accum_range`: max range vs N for small (N^(1/8)) and extended (N^(1/4)) targets.
   - `subbin` (A): close up of an accumulated echo across 1 m bins; Gaussian fit center;
     reported value in 0.1 m steps; jitter vs SNR. Explains resolution (0.1 m) vs accuracy (0.5 m).
10. **Measurement Rate**
   - `rate_timeline` (A): a second split into 1/f windows; histogram of the current window; detection ranges for drone and wall. Slider: rate 1 to 25 Hz.
   - `prf_ambiguity`: pulse train and echoes; when PRF > c/2R the echo of pulse k lands after pulse k+1. Slider: PRF.
11. **Moving Targets**
   - `smear` (A): radial motion smears the accumulated peak across bins; optional velocity compensation (shift and add). Sliders: speed, measurement time, assumed speed.
   - `smear_optimum`: SNR vs measurement time for several speeds; optimum T* ~ echo width / v.
   - `crossing` (A): view down the beam; drone crossing or turret slewing; fraction of pulses that land on the drone. Sliders: range, angular rate, measurement time.
   - `tracking_latency` (A): camera view; tracker with latency, with/without lead; beam reticle vs drone. Sliders: latency, range. Segmented: no lead / lead.
   - `rate_tradeoff`: range vs time track of an approaching drone measured at f Hz; misses at long range, sparse points, velocity estimate. Slider: rate.
12. **Multiple Echoes**
   - `two_echoes`: beam partly on drone, rest continues to a tree line; histogram with two peaks; merge inside the discrimination distance. Sliders: background distance, pointing offset. Segmented: trees / sky.
13. **The Camera**
   - `pinhole`: top view, focal length in pixels, pixel angle (IFOV). Slider: target angle.
   - `camera_sizes`: zoomed camera image: drone vs beam reticle in pixels. Slider: range. Equal size at the crossover range.
14. **Two Viewpoints (Parallax)**
   - `parallax_top`: camera and LRF side by side; beam spot appears f b / R pixels from center. Slider: range.
   - `parallax_misalign`: add yaw misalignment; plot pixel vs 1/R is a line (slope f b, intercept f alpha). Sliders: range, misalignment.
   - `parallax_image`: camera image with the beam's trace from 5 m to infinity; drone overlay. Slider: range.
15. **Calibrating with an AprilTag**
   - `mount_3d`: 3D turret; pan/tilt sliders; camera axis and beam axis drawn; rigid plate means the beam's pixel trace is fixed in the camera image.
   - `apriltag_pose`: tag corners give 6 DoF pose (PnP) and exact distance. Sliders: tag distance, tag yaw.
   - `apriltag_sweep` (A): step and stare raster across a tag 50 m away (4 px steps); each LRF sample is hit (range near tag distance) or miss; dots at the tag's center in image space. Play/reset; slider: echo strength (grows/shrinks the hit square, center fixed).
   - `calib_hypothesis`: drag a hypothesized beam pixel; samples re-plotted in tag coordinates; hits inside / misses outside only for the right hypothesis; misclassification count.
   - `calib_two_ranges`: blob centers at 2 to 3 tag distances on a pixel vs 1/R plot; line fit recovers offset (slope) and boresight (intercept). Segmented: 1 / 2 / 3 distances.
16. **Your LRF (calculator)**
   - `calculator`: presets + editable parameters (divergence, power gain, PRF, rated range, drone size/fill/albedo, visibility, rate, camera FOV/resolution). Outputs: crossover, detection range vs rate plot, beam in pixels, pointing tolerance, optimal measurement time, false alarm rate.
17. **Further Reading**, **Final Words**

## Model (js/lrf_model.js)

See the header comment in the file. Key points:

- Gaussian beam, 1/e^2 full angle = divergence; radius w(R) = 0.5 sqrt(D0^2 + (theta R)^2).
- Fraction on target via erf for squares, encircled energy for disks, point approximation available.
- Atmosphere: Kim visibility model at the spec's wavelength, two way.
- Sensitivity backed out of a datasheet rating (default: small target), measured with `rating_divergence_mrad`.
- SNR scales with sqrt(measurement time) (pulse accumulation); detection when SNR exceeds `threshold_sigma`; Pd = Phi(SNR - threshold).
- Motion: radial smear factor (Gaussian echo convolved with a box), optimal measurement time; crossing factor for angular motion.
- Camera pinhole + mount (offset + yaw/pitch) -> beam pixel at range R, boresight pixel at infinity.

## Testing

- `node -e` checks of the model numbers (see NOTES.md for the values).
- Serve the repo with `python3 -m http.server` and screenshot sections in headless Chrome; check the console for errors.
- `node --check js/lrf.js` for syntax.

## Open items

- Re-run `docs/lrf/sources/fetch_sources.py` when Google Patents stops returning 503, then
  re-verify the patent figures (pulse length, pulse rate) and commit the archived text.
- Optional model extension: a flat square beam profile (`beam_profile: "square"`) as an
  alternative to the Gaussian, since Jenoptik's beam shaping patents describe square far
  field spots. The brochure's ratings fit the Gaussian slightly better.
- Optional: velocity compensated (shift and add) accumulation in the calculator.

## Status

- [x] Study repo style (GPS, Lights and Shadows, Cameras and Lenses, Sound; base.js / base.css)
- [x] Research DLEM 20 / 20LE / family brochure
- [x] Q&A with user
- [x] `js/lrf_model.js` written and checked in Node
- [x] PLAN.md / NOTES.md
- [x] `laser-range-finder/index.html` prose and containers
- [x] `css/lrf.css`
- [x] `js/lrf.js` framework + helpers + 3D renderer
- [x] Scenes, section by section (34 demos incl. calculator)
- [x] Calculator
- [x] Browser testing at 760 px and 400 px (headless Chrome via puppeteer-core), console clean
- [x] Model updated to 0.5 s rating time and 30 ns pulses; prose numbers are live values
- [x] Sub-bin interpolation demo and 0.1 m readouts
- [x] Sources archived (datasheets, pages); patents pending (503)
- [ ] Final read through by the user
