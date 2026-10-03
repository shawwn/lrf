# Development files for the laser range finder article

Kept from the working session that built the article (2026-10-03). Nothing
here is published to the site.

## parts/

`js/lrf.js` was written as eight files and built by concatenating them in
order:

    cat docs/lrf/dev/parts/p*.js > js/lrf.js && node --check js/lrf.js

| File | Contents |
| --- | --- |
| `p1_core.js` | helpers, colors, formatting, plotting, sprites, the beam footprint |
| `p2_3d.js` | the small painter's algorithm 3D renderer and the turret model |
| `p3_framework.js` | the Demo framework: sliders, segments, animation, `lrf_set`, `lrf_link`, live numbers in the text |
| `p4_scenes_a.js` | hero, time of flight, beam, light on target, scattering, the fourth power |
| `p5_scenes_b.js` | spectrum, atmosphere, datasheet, noise and threshold, accumulation, rates |
| `p6_scenes_c.js` | motion smear, crossing, tracking, rate tradeoff, multiple echoes |
| `p7_scenes_d.js` | camera, parallax, 3D mount, AprilTag pose, sweep, calibration |
| `p8_calc_init.js` | the calculator and initialization |

They concatenate exactly to `js/lrf.js` as of the commit that added them. If
you edit `js/lrf.js` directly, these become stale; either work in the parts
and rebuild, or treat `js/lrf.js` as the source and ignore them.

## tests/

Puppeteer scripts that drive the system Chrome. Set up and serve the repo:

    cd docs/lrf/dev/tests && npm install
    python3 -m http.server 8765 --bind 127.0.0.1    # from the repo root

They expect Chrome at `/Applications/Google Chrome.app` and the article at
`http://127.0.0.1:8765/laser-range-finder/index.html`; screenshots go to
`shots/`. The ones worth rerunning:

| Script | Checks |
| --- | --- |
| `smoke.js` | loads the page, scrolls through every demo, runs the calculator and `lrf_set`; prints "34 demos; no errors" |
| `shoot.js <ids or all> <width>` | screenshots of demos, e.g. `node shoot.js beam_cone,crossing 760` |
| `mobile.js <url>` | sideways overflow at 320 to 414 px with phone emulation |
| `mobile_time.js <url> <width>` | the same while scrolling slowly, as the demos animate |
| `jump.js` | every link in the text sets its demo and brings it fully into view |
| `tap4.js` | the spectrum readout responds to taps |
| `site_check.js`, `site_check_live.js` | the built `_site` (port 8799) and the live GitHub Pages site load without errors or missing files |

The rest are one-off checks from specific fixes (slider rates, looping
demos, the pulse rate demo's wrapping, the false alarm count, and so on).

## tools/

| File | Use |
| --- | --- |
| `stage_region.py <region> [--dry]` | stage only the hunks of `js/lrf.js` in one region (named in the script) against HEAD, to keep commits to one logical change |
| `split_hunks.py` | an earlier version of the same idea, classifying hunks by keywords |
| `numbers.js` | prints the model's headline numbers (rating predictions, detection ranges, aiming tolerance) |
| `dbg_cal.py` | steps through the calibration's sessions in the simulator for debugging |
