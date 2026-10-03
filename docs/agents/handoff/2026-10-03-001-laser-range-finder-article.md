# Handoff: Laser Range Finders article and calibration code

Date: 2026-10-03. Author of the work: Claude, for Shawn Presser.

An interactive article explaining laser range finders (LRFs), in the style of
the Bartosz Ciechanowski articles mirrored in this repo, plus a Python
implementation of the LRF to camera calibration it describes. Everything is
committed and pushed; the article is live.

- Live: https://shawwn.github.io/lrf/ (redirects to `/lrf/laser-range-finder/`)
- Repo: https://github.com/shawwn/lrf (public, at the user's request, including
  the mirrored articles and their history)

## What was accomplished

### The article

- `laser-range-finder/index.html`: the prose and 34 demos, with Shawn Presser's
  byline. Not added to the site index or archives. No Bartosz byline,
  analytics, or social links; the footer credits his articles for the
  interactive style. Links to his articles point at the local mirror in the
  repo and are rewritten to ciechanow.ski in the published copy.
- `js/lrf_model.js`: the physics, with no DOM dependencies (usable from Node:
  `require("./js/lrf_model.js")`). Every device number lives in a spec built by
  `make_spec(preset, overrides)`; presets `dlem20` (default), `dlem20le`,
  `dlem30`, `dlem45`. Covers beam and fraction on target, Lambertian return,
  atmosphere (Kim model), sensitivity backed out of a datasheet rating,
  detection (5 sigma threshold), pulse accumulation (sqrt N), radial smear,
  crossing, camera projection, and parallax.
- `js/lrf.js`: all demo code (about 4,900 lines) on top of the repo's
  `js/base.js` (Slider, SegmentedControl, TouchHandler).
- `css/lrf.css`: the article's styles.
- Sections: time of flight; beam (cone, square profile, footprint on the
  quad and the Shahed); light coming back; the fourth power law; air and
  wavelength; the datasheet and backing out sensitivity; noise, threshold,
  single shots, accumulation, sub-bin centroiding; measurement rate and pulse
  rate ambiguity; moving targets (radial smear, optimum measurement time,
  crossing, tracking latency with prediction, rate tradeoff, multiple
  echoes); the camera (pinhole, sensor-like rendering with a blur slider,
  parallax, the 3D turret); calibration (AprilTag pose, sweep, hypothesis
  test, two distances); a calculator; final words.

### Calibration code (`docs/lrf/calibration/`)

- `lrf_calibration.py`: hardware independent calibration. A real rig
  implements the `Rig` protocol (`angles`, `move_to`, `tag_corners`,
  `measure`); `detect_tag_corners` wraps pupil-apriltags. Two measurement
  modes, picked automatically by looking past the board's edges:
  - depth mode (indoors, the real setup): a wall closer than the 25 m target
    discrimination merges with the board's echo, so the reading interpolates
    between the board's and wall's distances. Coarse pass walks outward from
    inside each edge until the reading passes halfway; the fine pass covers
    the ramps. Model `range = g s + (1 - g) d + b` with the wall's distance
    per edge, range offset, and relative brightness solved by Huber weighted
    least squares inside the outer search.
  - hit/miss mode (open sky or far background).
  The fit solves yaw and pitch, plus the origin's sideways offset when the
  boards' 1/R differ by more than 0.015 per meter; bootstrap uncertainties;
  JSON output; `python3 lrf_calibration.py stops.json` re-solves recorded
  data. Works for any board orientation (all geometry in the board's frame).
  Checks before sweeping that the tag stays in the camera's view with the beam
  on every edge, and stops with an explanation if not.
- `simulate.py`: simulated turret, 4K camera, and DLEM 20, with deliberate
  model mismatch (beam roll, softer edges, wings, darker tag, range noise
  0.3 m, 0.1 m quantization, false alarms, walls). `--office` is the user's
  setup: 47 cm boards at 7.5 m and 12.5 m, a wall 2.5 m behind, 20 degree
  camera. Also `--single`, `--orientations N`, `--distances`, `--board`,
  `--hfov`, `--save-stops`.
- Results (README has details): indoors, boresight median 0.75 px (0.07 mrad),
  worst 1.9 px over 15 random placements; outdoors 20 m + 80 m, about 0.5 px.

### Publishing

- `.github/workflows/pages.yml` deploys on every push to `main`.
  `.github/scripts/build_pages.py` assembles `_site/` with only the article and
  the 12 files it loads (base.js, lrf_model.js, lrf.js, base.css, lrf.css, a
  few images, favicon), rewrites links to Bartosz's articles to ciechanow.ski,
  drops the Blog and Archives links, adds a root redirect, and fails if a
  referenced file is missing.
- The account was upgraded to allow Pages (it was needed while the repo was
  private).

### Notes and research

- `docs/lrf/PLAN.md`: the user's requirements, numbered in order (1 to 28),
  the demo list, and model decisions.
- `docs/lrf/NOTES.md`: every number and assumption with its source.
- `docs/lrf/sources/`: archived raw text of every fetched document
  (`fetch_sources.py`, `INDEX.md`, `raw/`). Patents failed with 503 and two
  sites with 403; re-running the script retries only those.

## Key decisions

- Device: Jenoptik DLEM 20. 0.8 mrad divergence. Reports range in 0.1 m steps.
  Measures down to 1 m (the datasheet's range starts at 10 m; the user says
  under 10 m works but isn't recommended).
- Beam: an evenly lit square (the user said the beam is rectangular; Jenoptik
  says "symmetrical divergence"), side d0 + theta R with an 8 mm exit
  aperture, edges blurred by a Gaussian of 0.1 mrad (assumed, roughly
  diffraction at 8 mm). `beam_shape: "gaussian"` keeps the old model and
  reproduces the old numbers exactly. The square fits the brochure better
  (NATO target predicted 3,510 m against 3,300 rated; the Gaussian gave
  3,030).
- Sensitivity: backed out of the small target rating (0.75 m square, 30%,
  2,100 m at 25 km visibility) with a 0.5 s rated measurement time (from the
  DLEM SR datasheet). 30 ns pulses (4.5 m echo) come from unverified patent
  research; 10 kHz pulse rate is assumed.
- Targets: a 10 inch FPV quad and a Shahed-136, as rectangle silhouettes in
  `lrf_model.js`.
- Turret: camera and LRF on one pan/tilt plate, LRF 72 mm to the right of the
  camera. The article's demos use a true misalignment of 1.3 mrad yaw and
  -0.8 mrad pitch.
- The article's camera: 4K (3840 x 2160) behind a 10 degree lens (0.046 mrad
  per pixel, beam 17.6 px). Chosen over 1080p so a distant quad still looks
  like a quad. Kept at 10 degrees in the article even though the calibration
  simulation assumes 20 degrees for the indoor boards, because a wider camera
  halves the pixels on distant drones.
- Calibration indoors: the user's boards are 47 cm across, used at about
  7.5 m and 12.5 m with a wall about 2.5 m behind. The tag size (30 cm) and
  the camera's field of view (20 degrees) are assumptions; the user hasn't
  given them.
- Demo conventions the user asked for: sliders animate by default with a
  play/pause button and stop when touched; every slider shows its value
  (measurement times also show their rate, "25 ms (40 Hz)"); finished
  animations loop until the reader touches the demo; the beam is drawn as a
  red fade with no outline; phrases in the text that match a demo setting are
  links (`lrf_link`) that set it and scroll the demo into view; everything
  must work on phones (no sideways scrolling, touch equivalents for hover).
- Ruled out: publishing the mirrored articles on Pages (only the LRF article
  is deployed). Later the user chose to make the repo itself public as is.

## Important context for future sessions

- Branch and remotes: the local branch is `main`, tracking `lrf/main`
  (`git@github.com:shawwn/lrf.git`), the only remote. Plain `git push`
  publishes and triggers the Pages deploy. The old `origin` (shawwn/ski) was
  removed.
- Edit `js/lrf.js` directly. During this session it was built by
  concatenating eight part files (core helpers, 3D renderer, framework, and
  scene groups) kept in the session's temporary scratchpad, which no longer
  exists. The section banners in `js/lrf.js` (`/* ---- name ---- */`) mark
  each demo.
- Keep numbers in the prose consistent with `lrf_model.js`. Live numbers in
  the text are `<span class="lrfv" data-k="...">` filled from `text_values`
  in `js/lrf.js`; their static text is a fallback and was synced to the model.
- Framework notes (`js/lrf.js`, the Demo framework): a scene can declare
  `sliders` (with `anim`, `fmt`, `visible`, `on`), `segs`, `animated`,
  `reset`, `finished`, `hover` (touch works too), `drag`, `orbit`. `d.touched`
  becomes true when the reader uses any control. `lrf_set(id, vals, segs, st)`
  sets a demo without scrolling (handy for tests); `lrf_link(...)` is for links
  in the text.
- Testing approach used: serve the repo with `python3 -m http.server 8765
  --bind 127.0.0.1`, then puppeteer-core driving the system Chrome
  (`/Applications/Google Chrome.app/...`) to load the page, scroll through
  every demo, and fail on console errors; screenshots per demo; phone checks
  at 320 to 414 px with `isMobile` and `hasTouch`, measuring
  `document.documentElement.scrollWidth`. These scripts lived in the
  scratchpad and would need recreating.
- Commit conventions: one logical change per commit, with a message that
  explains what changed and why. Never add Co-authored-by lines (the user's
  CLAUDE.md). No em or en dashes in user-facing text.
- Memory: `~/.claude/projects/-Users-shawn-ml-ski-lrf/memory/` has the project
  summary and the rule to archive every fetched research document.

## Open items

- The article's calibration section still describes the outdoor hit/miss
  sweep with a tag 50 m away, while the real procedure is the indoor depth
  ramp. Offered to rewrite it around the depth ramp with a demo; not done.
- The user's camera field of view and tag size are unknown (the simulation
  assumes 20 degrees and 30 cm).
- A real `Rig` for the hardware: the DLEM's serial protocol is in Jenoptik's
  interface control document, which isn't public.
- Re-run `docs/lrf/sources/fetch_sources.py` when Google Patents stops
  returning 503, and re-verify the patent figures (pulse length, pulse rate).
- The deploy workflow warns that its actions target the deprecated Node.js 20,
  and `ubuntu-latest` moves to Ubuntu 26 on 2026-10-19; both still deploy.
- The user asked to export this session's full transcript into a separate
  private repo; that wasn't done.
