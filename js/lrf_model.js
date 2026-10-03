/*
 * lrf_model.js
 *
 * A small, parameterized model of a pulsed, direct-detection laser range
 * finder (LRF) of the kind used in handheld and gimbal-mounted modules,
 * e.g. the Jenoptik DLEM family. It has no DOM dependencies, so it can be
 * used by the article (window.LRFModel) or from Node (require).
 *
 * Every number that describes a particular LRF lives in a "spec" object.
 * Swap the spec to model a different device: a narrower beam, a more
 * powerful laser, a faster internal pulse rate, and so on.
 *
 * Model summary
 * -------------
 * Signal ("S", units of 1/m^2) for a target at range R:
 *
 *     S(R) = albedo * F(R) * T(R)^2 / R^2
 *
 *   F(R)  fraction of the transmitted beam power that lands on the target,
 *         for a Gaussian beam whose 1/e^2 full angle is the divergence.
 *   T(R)  one way atmospheric transmission, exp(-alpha * R).
 *   1/R^2 the receiver aperture's share of the light scattered back by a
 *         Lambertian (matte) target.
 *
 * Everything that does not depend on the target or range (laser pulse
 * energy, receiver aperture area, optical efficiency, detector noise) is
 * folded into a single sensitivity figure. Manufacturers rarely publish
 * those numbers, but they do publish "typical range" for a reference
 * target, so we back the sensitivity out of that rating:
 *
 *     SNR(R, t) = snr_rated * gain * (S(R) / S_rated) * sqrt(t / t_rated)
 *
 *   S_rated   signal of the rated reference target at its rated range
 *   t_rated   measurement time behind the rating (an assumption)
 *   gain      multiplier for "same device, but more power / better receiver"
 *   sqrt(t)   pulse accumulation: N = prf * t pulses are summed, signal adds
 *             as N while noise adds as sqrt(N).
 *
 * A detection happens when the accumulated echo exceeds a threshold that is
 * threshold_sigma noise standard deviations above the mean noise level.
 */

(function(root) {
    "use strict";

    const C = 299792458;

    /* ------------------------------------------------------------------ */
    /* Presets                                                             */
    /* ------------------------------------------------------------------ */

    /*
     * Brochure values come from the Jenoptik "Diode Laser Rangefinder (DLEM)"
     * family table: small target 0.75 m x 0.75 m, albedo 30%, 25 km
     * visibility; NATO target 2.3 m x 2.3 m, albedo 30%, 25 km visibility;
     * extended target beam filling, albedo 50%, 50 km visibility.
     *
     * Fields marked "assumed" are not published and are illustrative.
     */
    const PRESETS = {
        dlem20: {
            name: "DLEM 20",
            wavelength_nm: 1550,
            divergence_mrad: 0.8,       // full angle; treated as 1/e^2 width
            // rating_divergence_mrad: divergence the ratings were measured with
            // (defaults to divergence_mrad; set it when exploring a different beam
            // on the same laser and receiver)
            exit_beam_mm: 8,            // assumed beam diameter at the exit aperture
            min_range_m: 10,
            max_range_m: 5000,
            max_rate_hz: 25,
            gate_m: 1,                  // range gate resolution
            pulse_m: 4.5,               // assumed echo width (FWHM) in range: 30 ns pulses (see docs/lrf/NOTES.md)
            discrimination_m: 15,
            accuracy_m: 0.5,            // 1 sigma
            prf_hz: 10000,              // assumed internal pulse repetition rate
            rated_time_s: 0.5,          // measurement time behind the ratings (the DLEM SR datasheet rates at 0.5 s)
            rated_pd: 0.9,              // assumed detection probability at rated range
            threshold_sigma: 5,
            gain: 1,
            calibrate_from: "small",
            ratings: { small: 2100, nato: 3300, extended: 5000 },
        },
        dlem20le: {
            name: "DLEM 20LE",
            divergence_mrad: 0.8,
            max_range_m: 8000,
            discrimination_m: 25,
            accuracy_m: 1,
            ratings: { small: 2500, nato: 3300, extended: 7200 },
        },
        dlem30: {
            name: "DLEM 30",
            divergence_mrad: 0.7,
            max_range_m: 14000,
            discrimination_m: 25,
            accuracy_m: 1,
            ratings: { small: 3500, nato: 4100, extended: 12100 },
        },
        dlem45: {
            name: "DLEM 45",
            divergence_mrad: 0.7,
            max_range_m: 20000,
            discrimination_m: 25,
            accuracy_m: 1,
            ratings: { small: 5100, nato: 5700, extended: 20000 },
        },
    };

    /*
     * Build a full spec from a preset name (or object) plus overrides.
     * Overriding divergence_mrad keeps the preset's sensitivity: the model
     * remembers the divergence its ratings were measured with, so a narrower
     * beam on the same hardware ranges further.
     */
    function make_spec(preset_or_overrides, overrides) {
        let base = Object.assign({}, PRESETS.dlem20);
        base.ratings = Object.assign({}, PRESETS.dlem20.ratings);

        let a = preset_or_overrides;
        if (typeof a === "string")
            a = PRESETS[a];

        if (a) {
            for (let k in a) {
                if (k === "ratings")
                    base.ratings = Object.assign({}, base.ratings, a.ratings);
                else
                    base[k] = a[k];
            }
        }

        if (base.rating_divergence_mrad === undefined)
            base.rating_divergence_mrad = base.divergence_mrad;

        if (overrides) {
            for (let k in overrides) {
                if (k === "ratings")
                    base.ratings = Object.assign({}, base.ratings, overrides.ratings);
                else
                    base[k] = overrides[k];
            }
        }
        return base;
    }

    /* Reference targets used by datasheets. */
    const RATED_TARGETS = {
        small: { kind: "square", side_m: 0.75, albedo: 0.3, visibility_km: 25, label: "Small target" },
        nato: { kind: "square", side_m: 2.3, albedo: 0.3, visibility_km: 25, label: "NATO target" },
        extended: { kind: "extended", albedo: 0.5, visibility_km: 50, label: "Extended target" },
    };

    /*
     * Drone silhouettes, as seen by the LRF, built from axis aligned
     * rectangles in meters (x right, y up, origin at the aim point). Each
     * rectangle may carry a "fill" factor for parts that only partly block
     * the beam, like the blur of a spinning propeller. Rectangles must not
     * overlap. Gaussian beam power on a rectangle has a closed form (a
     * product of two erf differences), so these integrate exactly.
     *
     * Dimensions not published by anyone are rough estimates from photos,
     * and albedos are guesses at 1.55 um. All of them are parameters.
     */

    // 10 inch quadcopter: ~430 mm motor to motor, 10 inch (254 mm) props,
    // carbon fiber frame, 6S pack. Mostly empty space.
    const QUAD10_SIDE = {
        kind: "shapes", albedo: 0.1, size_m: 0.43, label: "10\" quad, side",
        shapes: [
            { x0: -0.05, x1: 0.05, y0: -0.02, y1: 0.02 },               // stack and plates
            { x0: -0.078, x1: 0.078, y0: 0.02, y1: 0.07 },              // battery on top
            { x0: -0.2, x1: -0.05, y0: -0.005, y1: 0.005 },             // arms (edge on)
            { x0: 0.05, x1: 0.2, y0: -0.005, y1: 0.005 },
            { x0: -0.2, x1: -0.16, y0: 0.005, y1: 0.04 },               // motors
            { x0: 0.16, x1: 0.2, y0: 0.005, y1: 0.04 },
            { x0: -0.32, x1: -0.2, y0: 0.04, y1: 0.055, fill: 0.3 },     // props, edge on blur
            { x0: 0.2, x1: 0.32, y0: 0.04, y1: 0.055, fill: 0.3 },
        ],
    };

    const QUAD10_BELOW = {
        kind: "shapes", albedo: 0.1, size_m: 0.43, label: "10\" quad, below",
        shapes: [
            { x0: -0.06, x1: 0.06, y0: -0.045, y1: 0.045 },             // center plates
            { x0: -0.17, x1: -0.06, y0: -0.0125, y1: 0.0125 },          // arms (plus layout
            { x0: 0.06, x1: 0.17, y0: -0.0125, y1: 0.0125 },            //  for simplicity)
            { x0: -0.0125, x1: 0.0125, y0: 0.045, y1: 0.17 },
            { x0: -0.0125, x1: 0.0125, y0: -0.17, y1: -0.045 },
            { x0: -0.19, x1: -0.17, y0: -0.019, y1: 0.019 },            // motors
            { x0: 0.17, x1: 0.19, y0: -0.019, y1: 0.019 },
            { x0: -0.019, x1: 0.019, y0: 0.17, y1: 0.19 },
            { x0: -0.019, x1: 0.019, y0: -0.19, y1: -0.17 },
            // prop disks (radius 0.127 m), drawn as squares of equal area, ~8% solid
            { x0: -0.293, x1: -0.19, y0: -0.0565, y1: 0.0565, fill: 0.08 },
            { x0: 0.19, x1: 0.293, y0: -0.0565, y1: 0.0565, fill: 0.08 },
            { x0: -0.0565, x1: 0.0565, y0: 0.19, y1: 0.293, fill: 0.08 },
            { x0: -0.0565, x1: 0.0565, y0: -0.293, y1: -0.19, fill: 0.08 },
        ],
    };

    // Shahed-136: 3.5 m long, 2.5 m span (published). Fuselage ~0.45 m wide,
    // wing ~0.08 m thick on average, wingtip fins ~0.55 m tall (estimates).
    const SHAHED_FRONT = {
        kind: "shapes", albedo: 0.25, size_m: 2.5, label: "Shahed-136, head on",
        shapes: [
            { x0: -0.2, x1: 0.2, y0: -0.2, y1: 0.2 },                   // fuselage (equal area to a 0.45 m circle)
            { x0: -1.235, x1: -0.2, y0: -0.04, y1: 0.04 },              // wings
            { x0: 0.2, x1: 1.235, y0: -0.04, y1: 0.04 },
            { x0: -1.25, x1: -1.235, y0: -0.25, y1: 0.3 },              // wingtip fins
            { x0: 1.235, x1: 1.25, y0: -0.25, y1: 0.3 },
        ],
    };

    const SHAHED_SIDE = {
        kind: "shapes", albedo: 0.25, size_m: 3.5, label: "Shahed-136, side",
        shapes: [
            { x0: -1.65, x1: 1.65, y0: -0.21, y1: 0.21 },               // fuselage
            { x0: -1.75, x1: -1.65, y0: -0.12, y1: 0.12 },              // nose cap / engine
            { x0: 1.65, x1: 1.75, y0: -0.12, y1: 0.12 },
            { x0: 1.1, x1: 1.65, y0: 0.21, y1: 0.55 },                  // fin above the fuselage
        ],
    };

    // Planform: cropped delta, stepped into strips.
    const SHAHED_BELOW = (() => {
        let shapes = [{ x0: -1.75, x1: 1.75, y0: -0.21, y1: 0.21 }];   // fuselage, x along the body
        let n = 6, root = 2.2, tip = 0.6, semi = 1.04;
        for (let i = 0; i < n; i++) {
            let y0 = 0.21 + semi * i / n, y1 = 0.21 + semi * (i + 1) / n;
            let chord = root + (tip - root) * (i + 0.5) / n;
            let x1 = 1.6, x0 = x1 - chord;                              // trailing edge is straight
            shapes.push({ x0, x1, y0, y1 });
            shapes.push({ x0, x1, y0: -y1, y1: -y0 });
        }
        return { kind: "shapes", albedo: 0.25, size_m: 3.5, label: "Shahed-136, below", shapes };
    })();

    const TARGETS = {
        quad10_side: QUAD10_SIDE,
        quad10_below: QUAD10_BELOW,
        shahed_front: SHAHED_FRONT,
        shahed_side: SHAHED_SIDE,
        shahed_below: SHAHED_BELOW,
    };

    function target_area(target) {
        if (target.kind === "shapes")
            return target.shapes.reduce((a, s) => a + (s.x1 - s.x0) * (s.y1 - s.y0) * (s.fill === undefined ? 1 : s.fill), 0);
        if (target.kind === "square")
            return target.side_m * target.side_m;
        if (target.kind === "disk")
            return Math.PI * target.diameter_m * target.diameter_m / 4 * (target.fill === undefined ? 1 : target.fill);
        if (target.kind === "point")
            return target.area_m2;
        return Infinity;
    }

    /* ------------------------------------------------------------------ */
    /* Math helpers                                                        */
    /* ------------------------------------------------------------------ */

    function erf(x) {
        // Abramowitz and Stegun 7.1.26, |error| < 1.5e-7
        let s = x < 0 ? -1 : 1;
        x = Math.abs(x);
        let t = 1 / (1 + 0.3275911 * x);
        let y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
        return s * y;
    }

    function norm_cdf(x) {
        return 0.5 * (1 + erf(x / Math.SQRT2));
    }

    // Upper tail probability of a standard normal, accurate far into the tail.
    function norm_sf(x) {
        if (x < 3)
            return 1 - norm_cdf(x);
        // asymptotic series
        let p = Math.exp(-x * x / 2) / (x * Math.sqrt(2 * Math.PI));
        let x2 = x * x;
        return p * (1 - 1 / x2 + 3 / (x2 * x2) - 15 / (x2 * x2 * x2));
    }

    function norm_inv(p) {
        let lo = -10, hi = 10;
        for (let i = 0; i < 80; i++) {
            let mid = 0.5 * (lo + hi);
            if (norm_cdf(mid) < p) lo = mid;
            else hi = mid;
        }
        return 0.5 * (lo + hi);
    }

    // Find R in [lo, hi] where f(R) crosses zero, f decreasing, bisection in log space.
    function solve_decreasing(f, lo, hi) {
        let flo = f(lo), fhi = f(hi);
        if (flo < 0) return lo;
        if (fhi > 0) return hi;
        let a = Math.log(lo), b = Math.log(hi);
        for (let i = 0; i < 70; i++) {
            let m = 0.5 * (a + b);
            if (f(Math.exp(m)) > 0) a = m;
            else b = m;
        }
        return Math.exp(0.5 * (a + b));
    }

    /* ------------------------------------------------------------------ */
    /* Time of flight                                                      */
    /* ------------------------------------------------------------------ */

    function round_trip_time(R) {
        return 2 * R / C;
    }

    function range_from_time(t) {
        return C * t / 2;
    }

    // Highest pulse rate that still keeps every echo inside its own period.
    function max_unambiguous_prf(R_max) {
        return C / (2 * R_max);
    }

    /* ------------------------------------------------------------------ */
    /* Beam                                                                */
    /* ------------------------------------------------------------------ */

    function theta(spec) {
        return spec.divergence_mrad * 1e-3;
    }

    // 1/e^2 beam radius at range R.
    function beam_radius(spec, R) {
        let d0 = spec.exit_beam_mm * 1e-3;
        let d = theta(spec) * R;
        return 0.5 * Math.sqrt(d0 * d0 + d * d);
    }

    function beam_diameter(spec, R) {
        return 2 * beam_radius(spec, R);
    }

    // Irradiance of a unit power Gaussian beam at distance r from its axis (1/m^2).
    function beam_irradiance(spec, R, r) {
        let w = beam_radius(spec, R);
        return 2 / (Math.PI * w * w) * Math.exp(-2 * r * r / (w * w));
    }

    // Fraction of beam power inside a centered circle of radius a.
    function fraction_disk(spec, R, a) {
        let w = beam_radius(spec, R);
        return 1 - Math.exp(-2 * a * a / (w * w));
    }

    // Fraction of beam power on an axis aligned square of side s, with its
    // center offset by (dx, dy) from the beam axis.
    function fraction_square(spec, R, s, dx = 0, dy = 0) {
        let w = beam_radius(spec, R);
        let k = Math.SQRT2 / w;
        let a = s / 2;
        let fx = 0.5 * (erf(k * (dx + a)) - erf(k * (dx - a)));
        let fy = 0.5 * (erf(k * (dy + a)) - erf(k * (dy - a)));
        return fx * fy;
    }

    // Fraction of beam power on the rectangle [x0, x1] x [y0, y1], with the
    // beam axis at the origin.
    function fraction_rect(spec, R, x0, x1, y0, y1) {
        let w = beam_radius(spec, R);
        let k = Math.SQRT2 / w;
        let fx = 0.5 * (erf(k * x1) - erf(k * x0));
        let fy = 0.5 * (erf(k * y1) - erf(k * y0));
        return fx * fy;
    }

    // Fraction of beam power intercepted by a target description.
    // The beam axis hits the target at (offset_m, offset_y_m) from its aim point.
    function fraction_on_target(spec, target, R, offset_m = 0, offset_y_m = 0) {
        if (target.kind === "extended")
            return 1;
        if (target.kind === "shapes") {
            let acc = 0;
            for (let s of target.shapes) {
                let f = s.fill === undefined ? 1 : s.fill;
                acc += f * fraction_rect(spec, R, s.x0 - offset_m, s.x1 - offset_m, s.y0 - offset_y_m, s.y1 - offset_y_m);
            }
            return acc;
        }
        if (target.kind === "square")
            return fraction_square(spec, R, target.side_m, offset_m, offset_y_m);
        if (target.kind === "disk") {
            let a = target.diameter_m / 2;
            let fill = target.fill === undefined ? 1 : target.fill;
            if (offset_m === 0)
                return fill * fraction_disk(spec, R, a);
            // equal area square is a good stand in for an offset disk
            let s = Math.sqrt(Math.PI) * a;
            return fill * fraction_square(spec, R, s, offset_m, 0);
        }
        if (target.kind === "point") {
            return target.area_m2 * beam_irradiance(spec, R, offset_m);
        }
        return 0;
    }

    // Range at which the beam's 1/e^2 diameter equals the target size.
    function crossover_range(spec, size_m) {
        let d0 = spec.exit_beam_mm * 1e-3;
        return Math.sqrt(Math.max(0, size_m * size_m - d0 * d0)) / theta(spec);
    }

    /* ------------------------------------------------------------------ */
    /* Atmosphere                                                          */
    /* ------------------------------------------------------------------ */

    // Extinction coefficient in 1/km from meteorological visibility (Kim model).
    function extinction_per_km(wavelength_nm, visibility_km) {
        let V = visibility_km;
        let q;
        if (V > 50) q = 1.6;
        else if (V > 6) q = 1.3;
        else if (V > 1) q = 0.16 * V + 0.34;
        else if (V > 0.5) q = V - 0.5;
        else q = 0;
        return 3.912 / V * Math.pow(wavelength_nm / 550, -q);
    }

    function transmission(spec, R, visibility_km) {
        let a = extinction_per_km(spec.wavelength_nm, visibility_km);
        return Math.exp(-a * R / 1000);
    }

    /* ------------------------------------------------------------------ */
    /* Signal and detection                                                */
    /* ------------------------------------------------------------------ */

    function signal(spec, target, R, visibility_km, offset_m = 0, offset_y_m = 0) {
        let vis = visibility_km === undefined ? target.visibility_km || 25 : visibility_km;
        let T = transmission(spec, R, vis);
        let F = fraction_on_target(spec, target, R, offset_m, offset_y_m);
        return target.albedo * F * T * T / (R * R);
    }

    // Local slope of log(signal) vs log(range): -2 for beam filling targets,
    // -3 for long thin (line) targets, -4 for small (point) targets.
    function signal_slope(spec, target, R, visibility_km) {
        let h = 0.01;
        let a = signal(spec, target, R * Math.exp(-h), visibility_km);
        let b = signal(spec, target, R * Math.exp(h), visibility_km);
        return (Math.log(b) - Math.log(a)) / (2 * h);
    }

    function snr_rated(spec) {
        return spec.threshold_sigma + norm_inv(spec.rated_pd);
    }

    /*
     * Signal of the rated reference target at its rated range. This is the
     * device's sensitivity: the echo strength it detects with probability
     * rated_pd after rated_time_s of accumulation.
     *
     * The rating was measured with the beam the device shipped with
     * (rating_divergence_mrad, defaulting to divergence_mrad). Keeping that
     * separate lets you ask "same laser and receiver, narrower beam" by
     * changing only divergence_mrad.
     */
    function rated_signal(spec) {
        let key = spec.calibrate_from || "small";
        let t = RATED_TARGETS[key];
        let geom = spec;
        if (spec.rating_divergence_mrad !== undefined && spec.rating_divergence_mrad !== spec.divergence_mrad)
            geom = Object.assign({}, spec, { divergence_mrad: spec.rating_divergence_mrad });
        return signal(geom, t, spec.ratings[key], t.visibility_km);
    }

    // SNR of the accumulated echo after measuring for t_s seconds.
    function snr(spec, S, t_s) {
        let t = t_s === undefined ? spec.rated_time_s : t_s;
        return snr_rated(spec) * spec.gain * (S / rated_signal(spec)) * Math.sqrt(t / spec.rated_time_s);
    }

    // SNR of a single pulse's echo.
    function snr_per_pulse(spec, S) {
        return snr(spec, S, 1 / spec.prf_hz);
    }

    function pulses_per_measurement(spec, t_s) {
        return Math.max(1, Math.round(spec.prf_hz * t_s));
    }

    function detection_probability(spec, snr_value) {
        return norm_cdf(snr_value - spec.threshold_sigma);
    }

    function false_alarms_per_measurement(spec, threshold_sigma) {
        let thr = threshold_sigma === undefined ? spec.threshold_sigma : threshold_sigma;
        let bins = (spec.max_range_m - spec.min_range_m) / spec.gate_m;
        return bins * norm_sf(thr);
    }

    /*
     * Largest range at which the target is detected with probability pd
     * (default: the rated pd) after measuring for t_s seconds.
     * Returns { range_m, limited_by } where limited_by is "signal" or "max_range".
     */
    function detection_range(spec, target, t_s, opts) {
        opts = opts || {};
        let pd = opts.pd === undefined ? spec.rated_pd : opts.pd;
        let vis = opts.visibility_km;
        let offset = opts.offset_mrad ? opts.offset_mrad * 1e-3 : 0;
        let need = spec.threshold_sigma + norm_inv(pd);
        let f = R => snr(spec, signal(spec, target, R, vis, offset * R), t_s) - need;
        let R = solve_decreasing(f, 1, 1e6);
        if (R > spec.max_range_m)
            return { range_m: spec.max_range_m, limited_by: "max_range" };
        return { range_m: R, limited_by: "signal" };
    }

    // Predict the brochure ratings from a spec (to check self consistency).
    function predicted_ratings(spec) {
        let out = {};
        for (let key in RATED_TARGETS) {
            let t = RATED_TARGETS[key];
            out[key] = detection_range(spec, t, spec.rated_time_s, { visibility_km: t.visibility_km }).range_m;
        }
        return out;
    }

    /* ------------------------------------------------------------------ */
    /* Motion                                                              */
    /* ------------------------------------------------------------------ */

    // Width (sigma, in meters of range) of the echo after binning.
    function echo_sigma(spec) {
        let sp = spec.pulse_m / 2.3548;
        return Math.sqrt(sp * sp + spec.gate_m * spec.gate_m / 12);
    }

    // Peak height loss when the target moves smear_m in range during accumulation.
    function smear_factor(spec, smear_m) {
        let s = echo_sigma(spec);
        let L = Math.abs(smear_m);
        if (L < 1e-9)
            return 1;
        return s * Math.sqrt(2 * Math.PI) / L * erf(L / (2 * Math.SQRT2 * s));
    }

    // SNR multiplier for a target moving radially at v (m/s) over a measurement of t_s.
    function radial_motion_factor(spec, v, t_s) {
        return smear_factor(spec, v * t_s);
    }

    // Measurement time that maximizes SNR for a given radial speed.
    function optimal_measurement_time(spec, v) {
        if (Math.abs(v) < 1e-6)
            return Infinity;
        let best = 0, best_t = 0;
        for (let i = 0; i <= 400; i++) {
            let t = Math.pow(10, -3 + 4 * i / 400);
            let q = Math.sqrt(t) * radial_motion_factor(spec, v, t);
            if (q > best) { best = q; best_t = t; }
        }
        return best_t;
    }

    // Average fraction of the beam's on-axis power a point target gets while
    // it moves across the beam: offset goes from offset0 to offset0 + omega * t,
    // in radians, sampled over the measurement.
    function crossing_factor(spec, R, offset0_rad, omega_rad_s, t_s) {
        let w = beam_radius(spec, R);
        let n = 64, acc = 0;
        for (let i = 0; i < n; i++) {
            let off = (offset0_rad + omega_rad_s * t_s * (i + 0.5) / n) * R;
            acc += Math.exp(-2 * off * off / (w * w));
        }
        return acc / n;
    }

    /* ------------------------------------------------------------------ */
    /* Camera                                                              */
    /* ------------------------------------------------------------------ */

    const DEFAULT_CAMERA = { width_px: 1920, height_px: 1080, hfov_deg: 10 };

    function camera_focal_px(cam) {
        return cam.width_px / 2 / Math.tan(cam.hfov_deg * Math.PI / 360);
    }

    // Angle subtended by one pixel at the image center (radians).
    function camera_ifov(cam) {
        return 1 / camera_focal_px(cam);
    }

    function camera_vfov_deg(cam) {
        return 2 * Math.atan(cam.height_px / 2 / camera_focal_px(cam)) * 180 / Math.PI;
    }

    function size_in_pixels(cam, size_m, R) {
        return size_m / R * camera_focal_px(cam);
    }

    /*
     * Mount: where the LRF sits relative to the camera.
     *   offset_m:  [x, y, z] of the LRF's beam origin in camera coordinates
     *              (x right, y down, z forward), e.g. [0.04, 0, 0]
     *   yaw_mrad, pitch_mrad: small rotations of the beam relative to the
     *              camera's optical axis (positive yaw points right,
     *              positive pitch points down)
     */
    const DEFAULT_MOUNT = { offset_m: [0.04, 0, 0], yaw_mrad: 0, pitch_mrad: 0 };

    function beam_direction(mount) {
        let a = mount.yaw_mrad * 1e-3, b = mount.pitch_mrad * 1e-3;
        let d = [Math.tan(a), Math.tan(b), 1];
        let l = Math.hypot(d[0], d[1], d[2]);
        return [d[0] / l, d[1] / l, d[2] / l];
    }

    // Pixel where the beam axis lands for a target at range R (measured along the beam).
    function beam_pixel(cam, mount, R) {
        let f = camera_focal_px(cam);
        let d = beam_direction(mount);
        let o = mount.offset_m;
        let p = [o[0] + R * d[0], o[1] + R * d[1], o[2] + R * d[2]];
        return [cam.width_px / 2 + f * p[0] / p[2], cam.height_px / 2 + f * p[1] / p[2]];
    }

    // Pixel the beam approaches as R goes to infinity.
    function boresight_pixel(cam, mount) {
        let f = camera_focal_px(cam);
        let d = beam_direction(mount);
        return [cam.width_px / 2 + f * d[0] / d[2], cam.height_px / 2 + f * d[1] / d[2]];
    }

    /* ------------------------------------------------------------------ */
    /* Summary                                                             */
    /* ------------------------------------------------------------------ */

    // A bundle of the derived numbers the article quotes.
    function summary(spec, opts) {
        opts = opts || {};
        let target = opts.target || QUAD10_SIDE;
        let cam = opts.camera || DEFAULT_CAMERA;
        let vis = opts.visibility_km === undefined ? 25 : opts.visibility_km;
        let rates = opts.rates || [1, 5, 10, 25];

        let out = {
            name: spec.name,
            target: target.label,
            reflecting_area_m2: target_area(target),
            crossover_m: crossover_range(spec, target.size_m || target.diameter_m || target.side_m || 0.2),
            footprint_at_1km_m: beam_diameter(spec, 1000),
            beam_px: spec.divergence_mrad * 1e-3 * camera_focal_px(cam),
            ifov_mrad: camera_ifov(cam) * 1e3,
            max_prf_hz: max_unambiguous_prf(spec.max_range_m),
            predicted_ratings: predicted_ratings(spec),
            ranges: {},
        };

        for (let hz of rates) {
            let t = 1 / hz;
            out.ranges[hz] = detection_range(spec, target, t, { visibility_km: vis }).range_m;
        }
        return out;
    }

    const api = {
        C,
        PRESETS,
        RATED_TARGETS,
        TARGETS,
        target_area,
        DEFAULT_CAMERA,
        DEFAULT_MOUNT,
        make_spec,
        erf,
        norm_cdf,
        norm_sf,
        norm_inv,
        round_trip_time,
        range_from_time,
        max_unambiguous_prf,
        theta,
        beam_radius,
        beam_diameter,
        beam_irradiance,
        fraction_disk,
        fraction_square,
        fraction_rect,
        fraction_on_target,
        signal_slope,
        crossover_range,
        extinction_per_km,
        transmission,
        signal,
        snr_rated,
        rated_signal,
        snr,
        snr_per_pulse,
        pulses_per_measurement,
        detection_probability,
        false_alarms_per_measurement,
        detection_range,
        predicted_ratings,
        echo_sigma,
        smear_factor,
        radial_motion_factor,
        optimal_measurement_time,
        crossing_factor,
        camera_focal_px,
        camera_ifov,
        camera_vfov_deg,
        size_in_pixels,
        beam_direction,
        beam_pixel,
        boresight_pixel,
        summary,
    };

    if (typeof module !== "undefined" && module.exports)
        module.exports = api;
    else
        root.LRFModel = api;

})(typeof window !== "undefined" ? window : this);
