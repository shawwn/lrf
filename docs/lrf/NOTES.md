# Laser Range Finders: research notes

Facts, sources, assumptions, and numbers behind the article. See [PLAN.md](PLAN.md)
for the outline and status.

## Sources

- Jenoptik DLEM family brochure, "Diode Laser Rangefinder (DLEM)", 2 pages, viewed on
  DirectIndustry: https://pdf.directindustry.com/pdf/jenoptik-ag/diode-laser-rangefinder-dlem/17967-1036107.html
  (screenshots provided by the user; the site blocks automated fetches).
- Jenoptik DLEM 20LE datasheet: https://www.jenoptik.de/-/media/websitedocuments/optics/sensor/dlem-20le-edb.pdf
- "Jenoptik's Powerful DLEM 20 Laser Rangefinder Pushes the Limits", Military Technology 10/2016:
  https://www.jenoptik.com/-/media/websitedocuments/optics/sensor/dlem-20-feature-story-military-technology-magazine-10-2016.pdf
- Jenoptik DLEM product page: https://www.jenoptik.com/products/lasers/laser-distance-sensors/dlem

## DLEM family table (brochure)

| | DLEM 17 | DLEM 20 | DLEM 20LE | DLEM 30 | DLEM 45 |
| --- | --- | --- | --- | --- | --- |
| Wavelength | ~1.55 um | ~1.55 um | ~1.55 um | ~1.55 um | ~1.55 um |
| Laser class | 1 | 1 | 1 | 1 | 1 |
| Modes | single, continuous 1 to 25 Hz | same | same | same | same |
| Divergence | ~0.8 mrad | ~0.8 mrad | ~0.8 mrad | ~0.7 mrad | ~0.7 mrad |
| Measurement range | 10 to 8,000 m | 10 to 5,000 m | 10 to 8,000 m | 10 to 14,000 m | 10 to 20,000 m |
| Targets reported | 5 | 5 | 5 | 5 | 5 |
| Target discrimination | <= 25 m | <= 15 m | <= 25 m | <= 25 m | <= 25 m |
| Accuracy (1 sigma) | <= 1 m | <= 0.5 m | <= 1 m | <= 1 m | <= 1 m |
| Small target (0.75 m sq, 30%, 25 km vis) | 2,100 m | 2,100 m | 2,500 m | 3,500 m | 5,100 m |
| NATO target (2.3 m sq, 30%, 25 km vis) | 3,300 m | 3,300 m | 3,300 m | 4,100 m | 5,700 m |
| Extended (beam filling, 50%, 50 km vis) | 5,400 m | 5,000 m | 7,200 m | 12,100 m | 20,000 m |
| Weight | <= 25 g | <= 30 g | <= 30 g | <= 95 g | <= 160 g |
| Size (L x W x H) | 50 x 18 x 34 mm | 50 x 22 x 34 mm | 50 x 22 x 34 mm | 97 x 25 x 50 mm | 110 x 46 x 60 mm |
| Supply | 2 to 5.5 V | 2 to 5.5 V | 2 to 5.5 V | 4 to 16 V | 4 to 16 V |
| Power, measuring | <= 2 W | <= 2 W | <= 2 W | <= 2 W | <= 2 W |
| Startup | <= 85 ms | | | | |
| Interface | UART (LVTTL 3.3 V) | | | | |

Notes:
- The DLEM 17 and DLEM 20 small/NATO cells are merged in the table (same values).
- The DLEM 20 extended target rating (5,000 m) equals its maximum measurement range, so it is a cap, not a signal limit.
- The DLEM 20LE standalone datasheet gives NATO >= 3,500 m and extended >= 5,250 m at 10 km / 23 km visibility, and lists: measurement principle "pulse accumulation", measurement resolution 0.1 m, range gate resolution 1 m, selectable measurement time 10 ms to 3,000 ms, IEC 60825-1:2014 class 1, operating -40 to +80 C, 1,500 g shock.
- Brochure claims: "uniform illumination of the target eliminating the need for preferred orientation" (diode laser beams are often stripe shaped; this likely means a round spot).
- 2016 article: DLEM 20 ranges man sized targets to 2 km, extended to 5 km, 25 Hz continuous output, < 100 ms wake up, 1,500 g shock. Invisible to image intensifier night vision.

## Not published (assumed in the model; all editable)

| Parameter | Value used | Why |
| --- | --- | --- |
| Divergence definition | 1/e^2 full angle of a Gaussian beam | common convention; datasheet doesn't define it |
| Exit beam diameter | 8 mm | the module is 22 mm wide |
| Internal pulse rate (PRF) | 10 kHz | must be < c / 2R_max = 30 kHz for 5 km |
| Echo width (FWHM, in range) | 1.5 m (~10 ns) | typical for pulsed diode lasers |
| Measurement time behind the ratings | 100 ms | unknown; because range ~ t^(1/8) for small targets, a 10x error only moves predictions by 33% |
| Detection probability at rated range | 90% | unknown |
| Threshold | 5 sigma | ~1.4e-3 false alarms per measurement over 4,990 bins |
| 10 inch quad | silhouettes from rectangles: 0.019 m^2 side, 0.029 m^2 below (props as 8 to 30% filled blur), 10% albedo | carbon fiber and black plastic; 430 mm motor to motor |
| Shahed-136 | 3.5 m long, 2.5 m span (published); fuselage 0.45 m wide, wing 0.08 m average thickness, fins 0.55 m (estimated from photos); 25% albedo (gray paint), 5% if painted black | 0.34 m^2 head on, 1.6 m^2 side, 4.4 m^2 below |
| Camera | 1920 x 1080, 10 deg HFOV | illustrative; f = 10,973 px, IFOV 0.091 mrad |
| Mount | LRF 4 cm right of the camera | illustrative |

## Physics notes

### Range equation (direct detection, Lambertian target)

P_r = P_t * eta * F(R) * albedo * (A_r / (pi R^2)) * T(R)^2

- F(R): fraction of beam power intercepted by the target. For a target larger than the
  footprint F ~ 1 (extended); for a target much smaller, F ~ A_t * 2 / (pi w^2) with
  w = theta R / 2, so F ~ 8 A_t / (pi theta^2 R^2).
- So P_r ~ 1/R^2 for beam filling targets and ~1/R^4 for small targets. Line targets
  (wires) give 1/R^3.
- Crossover: beam 1/e^2 diameter equals target size: R_x = d / theta. At 0.8 mrad:
  10 inch quad core (~0.15 m) ~190 m, whole quad (0.43 m) ~540 m; Shahed fuselage
  (0.45 m) ~560 m, Shahed span (2.5 m) ~3.1 km. The crossover is also where the target
  and the beam have the same angular size in the camera.
- Local log slope (model, 25 km visibility):
  10 inch quad side: -2.1 (50 m), -2.8 (200 m), -3.5 (500 m), -3.8 (1 km), -4.1 (2 km).
  Shahed head on: -2.0 (200 m), -2.4 (500 m), -3.3 (1 km), -3.65 (2 km), -3.8 (3 km), -4.1 (5 km).
  The Shahed's wings are long thin line targets, so between ~1 and 3 km it sits near -3
  (plus atmosphere). Beyond the span it goes to -4.
- Narrower beam on the same hardware: small target signal ~ 1/theta^2, range ~ theta^(-1/2)
  (0.8 -> 0.6 mrad: +15.5% before atmosphere; model gives 673 -> 767 m).
- More power (gain g): small target range ~ g^(1/4); extended ~ g^(1/2).

### Atmosphere

Kim model: alpha = 3.912 / V * (lambda / 550 nm)^(-q), q = 1.6 (V > 50 km), 1.3
(6 to 50 km), 0.16 V + 0.34 (1 to 6 km), V - 0.5 (0.5 to 1 km), 0 (< 0.5 km, fog).
At 1550 nm: 25 km visibility -> 0.0407 /km; 50 km -> 0.0203 /km.

### Self consistency check (DLEM 20)

Signal S = albedo * F * T^2 / R^2 at each rated range:

| Target | Rated range | S (1/m^2) |
| --- | --- | --- |
| Small 0.75 m, 30%, 25 km | 2,100 m | 2.26e-8 |
| NATO 2.3 m, 30%, 25 km | 3,300 m | 1.78e-8 |
| Extended, 50%, 50 km | 5,000 m (cap) | 1.63e-8 |

All within ~30% of each other, so a single sensitivity explains the brochure.
Calibrating from the small target predicts NATO 3,030 m (rated 3,300) and extended
4,310 m at its 50 km visibility (rated 5,000 = instrument cap).

For DLEM 30 / 45 the NATO and extended ratings are more conservative than the small target
rating implies (predicted NATO 5,440 / 8,090 m vs rated 4,100 / 5,700 m). Calibrating
from the small target is the most relevant choice for drones (point like regime).

### Pulse accumulation and rate

- SNR after N pulses = sqrt(N) * SNR per pulse (signal adds coherently in its range bin,
  noise adds in quadrature).
- Small target: S ~ R^-4 -> R_max ~ N^(1/8) ~ t^(1/8) ~ rate^(-1/8).
- Extended: R_max ~ N^(1/4).
- Detection range, DLEM 20 model, 25 km visibility, at 1 / 5 / 10 / 25 Hz:
  10 inch quad side 951 / 767 / 698 / 615 m; below 1060 / 854 / 777 / 683 m.
  Shahed head on (gray) 2215 / 1776 / 1614 / 1419 m; black paint (5%) 10 Hz 1015 m.
  Shahed side 2845 / 2196 / 1961 / 1686 m; below 3731 / 2850 / 2522 / 2135 m.
- Per pulse SNR at the 10 Hz detection range: ~0.2 (invisible in one shot).
- Max PRF without ambiguity for 5 km: c / 2R = 30 kHz.
- Eye safety (class 1) limits average power, so more pulses per second generally means
  weaker pulses.

### Moving targets

- Radial: range changes v t during a measurement; the accumulated peak smears. Peak factor
  = sigma sqrt(2 pi) / L * erf(L / (2 sqrt 2 sigma)), L = v t, sigma = echo width (0.70 m with
  the assumed 1.5 m FWHM and 1 m bins). SNR ~ sqrt(t) * factor rises then falls.
  Optimal t: 5 m/s 0.39 s, 10 m/s 0.195 s, 20 m/s 98 ms, 25 m/s 78 ms (fast quad),
  30 m/s 65 ms, 51 m/s 38 ms (Shahed at ~185 km/h, i.e. the 25 Hz maximum).
  Velocity compensated accumulation (shift and add over hypothesized speeds) recovers it.
- Angular: footprint at 500 m is 0.4 m; a 10 inch quad crossing at 20 m/s spends ~20 ms in it.
  Angular rate 0.04 rad/s; with 50 ms tracking latency the beam lags by 2 mrad (5 beam radii).
  Shahed crossing at 51 m/s at 1.5 km: 0.034 rad/s.
  Needs lead (predict) compensation.
- Search vs confirm: camera FOV (10 x 5.6 deg = 175 x 98 mrad) holds ~34,000 beam spots;
  raster scanning that with the beam at 25 Hz takes ~23 minutes. Camera searches, LRF confirms.
- Slewing: panning at 30 deg/s sweeps 21 mrad (26 beam widths) during one 40 ms measurement.

### Camera and parallax

- f = 960 / tan(5 deg) = 10,973 px; IFOV 0.091 mrad; VFOV 5.63 deg.
- Beam (0.8 mrad) = 8.8 px; 10 inch quad (0.43 m) at 700 m = 6.7 px; Shahed span at 1.6 km = 17 px.
- Parallax pixel offset = f b / R = 439 / R px for b = 4 cm: 44 px at 10 m, 8.8 px (one
  beam width) at 50 m, 0.4 px at 1 km.
- Pixel vs 1/R is a straight line: slope f b, intercept f alpha (misalignment).
- Baseline vs drone: parallax error b/R and the drone's half size both scale as 1/R,
  so a 4 cm offset never moves the beam off a drone whose solid core is wider than 8 cm.

### AprilTag calibration (user's method: sweep across a tag)

- The tag gives the camera a full pose (PnP from 4 sub-pixel corners) and an exact distance.
  A 0.3 m tag at 20 m spans ~165 px; distance precision ~1 cm, far better than the LRF's 0.5 m.
- The LRF's range accuracy is too coarse to fit the beam from plane constraints, so the
  information is in hit/miss: does the LRF report a return within a few meters of the tag's
  known distance?
- Rigid mount: in the camera frame the beam is fixed and the tag moves as the turret
  sweeps. Hits happen when the beam's pixel (at the tag's range) is inside the tag's image.
  The center of the hit region is the beam pixel; its size depends on beam width and
  signal strength (the beam's dim wings register at short range), but the center does not.
- In tag coordinates: for the right beam hypothesis, every hit maps inside the tag square
  and every miss outside. Fit = minimize misclassification / fit the edges.
- One tag distance gives the beam pixel at that range (direction, if the CAD offset is
  trusted). Two or more distances separate the offset (slope of pixel vs 1/R) from the
  misalignment (intercept).
- Sweep speed: the beam must move much less than its width during one measurement.
  At 20 m the beam is ~1.8 cm (0.9 mrad); at 25 Hz that limits continuous sweeps to a few
  mrad/s. Step and stare avoids it.
- Time sync: pair each LRF result with the camera frame at the middle of its measurement window.
- Range offset: compare LRF range on the tag with the tag's PnP distance.
- Background behind the tag should be > discrimination distance (15 m) away, or open sky.

### Wavelength

- 1.55 um is absorbed by the cornea and lens, so it doesn't focus on the retina: much
  higher allowed exposure than 905 nm (retinal hazard region is roughly 400 to 1400 nm).
- Silicon sensors stop at ~1.1 um, so a normal camera can't see the spot. InGaAs (0.9 to 1.7 um)
  can, and APDs at the receiver are InGaAs.
- Invisible to image intensifier night vision.

## Sources for the targets

- HESA Shahed 136, Wikipedia: https://en.wikipedia.org/wiki/HESA_Shahed_136 (3.5 m length,
  2.5 m span, 200 kg, ~185 km/h max, MD-550 piston engine with pusher prop, some painted black
  for night operations, Russian built airframes use fiberglass over woven carbon fiber).
- 10 inch FPV frames: typical wheelbase 405 to 435 mm (e.g. GEP-EF10 430 mm, LX10 405 mm).
