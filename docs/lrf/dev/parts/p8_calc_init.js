
    /* ================================================================== */
    /* Calculator                                                         */
    /* ================================================================== */

    const CALC_TARGETS = [
        ["quad10_side", "10\" quad, side"],
        ["quad10_below", "10\" quad, from below"],
        ["shahed_front", "Shahed-136, head on"],
        ["shahed_side", "Shahed-136, side"],
        ["shahed_below", "Shahed-136, from below"],
    ];

    const PRESET_KEYS = ["dlem20", "dlem20le", "dlem30", "dlem45"];

    function build_calculator() {
        let root = document.getElementById("calculator");
        if (!root)
            return;

        let state = {
            preset: preset_key,
            divergence: spec.divergence_mrad,
            gain: 1,
            rated_ms: spec.rated_time_s * 1000,
            target: "quad10_side",
            albedo: T.quad10_side.albedo,
            vis: 25,
            rate: 10,
            speed: 25,
        };

        let el = (tag, cls, html) => {
            let e = document.createElement(tag);
            if (cls) e.className = cls;
            if (html !== undefined) e.innerHTML = html;
            return e;
        };

        let grid = el("div", "calc_grid");
        let pin = el("div", "calc_panel");
        let pout = el("div", "calc_panel");
        pin.appendChild(el("h3", "", "Parameters"));
        pout.appendChild(el("h3", "", "Predictions"));
        grid.appendChild(pin);
        grid.appendChild(pout);
        root.appendChild(grid);

        let controls = {};

        function add_select(key, label, options) {
            let row = el("div", "calc_row");
            let lab = el("label", "", label);
            let sel = el("select");
            for (let o of options) {
                let opt = el("option", "", o[1]);
                opt.value = o[0];
                sel.appendChild(opt);
            }
            sel.value = state[key];
            sel.onchange = () => { state[key] = sel.value; changed(key); };
            row.appendChild(lab);
            row.appendChild(sel);
            pin.appendChild(row);
            controls[key] = { set: v => { sel.value = v; } };
        }

        function add_range(key, label, lo, hi, logscale, fmt, step) {
            let row = el("div", "calc_row");
            let lab = el("label", "", label);
            let val = el("span", "calc_value");
            let inp = el("input");
            inp.type = "range";
            inp.min = 0;
            inp.max = 1000;
            let to = x => logscale ? lo * pow(hi / lo, x / 1000) : lo + (hi - lo) * x / 1000;
            let from = v => logscale ? 1000 * log(v / lo) / log(hi / lo) : 1000 * (v - lo) / (hi - lo);
            let q = v => step ? round(v / step) * step : v;
            inp.value = from(state[key]);
            val.textContent = fmt(state[key]);
            inp.oninput = () => {
                state[key] = q(to(+inp.value));
                val.textContent = fmt(state[key]);
                changed(key);
            };
            row.appendChild(lab);
            row.appendChild(val);
            row.appendChild(inp);
            pin.appendChild(row);
            controls[key] = { set: v => { inp.value = from(v); val.textContent = fmt(v); } };
        }

        add_select("preset", "Starting module", PRESET_KEYS.map(k => [k, M.PRESETS[k].name]));
        add_range("divergence", "Beam divergence", 0.2, 2, false, v => v.toFixed(2) + " mrad", 0.05);
        add_range("gain", "Laser power (relative)", 0.25, 16, true, v => v.toFixed(v < 1 ? 2 : 1) + "×");
        add_range("rated_ms", "Measurement time behind ratings (assumed)", 10, 3000, true, v => fmt_time(v / 1000));
        add_select("target", "Target", CALC_TARGETS);
        add_range("albedo", "Target albedo", 0.02, 0.8, true, v => round(v * 100) + "%");
        add_range("vis", "Visibility", 1, 60, true, v => (v < 10 ? v.toFixed(1) : round(v)) + " km");
        add_range("rate", "Measurement rate", 1, 25, false, v => round(v) + " Hz", 1);
        add_range("speed", "Target speed toward you", 0, 60, false, v => round(v) + " m/s", 1);

        let note = el("p", "", "");
        note.style.fontSize = "0.85em";
        note.style.color = "#888";
        note.style.padding = "0.6em 0 0 0";
        note.style.lineHeight = "1.4em";
        note.innerHTML = "Divergence and power describe a modified version of the selected module, with the same receiver. Firing pulses k times faster at the same energy per pulse is worth √k in power. The module, divergence, power, and assumed measurement time also drive every demonstration above.";
        pin.appendChild(note);

        let outs = el("div");
        pout.appendChild(outs);
        let plot_div = el("div", "calc_plot");
        pout.appendChild(plot_div);
        let canvas = el("canvas");
        canvas.style.position = "absolute";
        canvas.style.left = "0";
        canvas.style.top = "0";
        plot_div.appendChild(canvas);

        let btns = el("div", "calc_buttons");
        let reset = el("button", "", "Reset");
        reset.onclick = () => {
            let base = M.make_spec(state.preset);
            state.divergence = base.divergence_mrad;
            state.gain = 1;
            state.rated_ms = base.rated_time_s * 1000;
            for (let k of ["divergence", "gain", "rated_ms"]) controls[k].set(state[k]);
            changed("reset");
        };
        btns.appendChild(reset);
        pout.appendChild(btns);

        function target() {
            return Object.assign({}, T[state.target], { albedo: state.albedo });
        }

        function make() {
            let base = M.make_spec(state.preset);
            return M.make_spec(state.preset, {
                divergence_mrad: state.divergence,
                rating_divergence_mrad: base.divergence_mrad,
                gain: state.gain,
                rated_time_s: state.rated_ms / 1000,
            });
        }

        function changed(key) {
            if (key === "preset") {
                state.divergence = M.make_spec(state.preset).divergence_mrad;
                controls.divergence.set(state.divergence);
                spec_seg_select(PRESET_KEYS.indexOf(state.preset));
            }
            if (key === "target") {
                state.albedo = T[state.target].albedo;
                controls.albedo.set(state.albedo);
            }
            if (["preset", "divergence", "gain", "rated_ms", "reset"].includes(key)) {
                let base = M.make_spec(state.preset);
                let modified = state.gain !== 1 || abs(state.rated_ms - base.rated_time_s * 1000) > 1e-6 || abs(state.divergence - base.divergence_mrad) > 1e-9;
                set_spec(make(), modified ? "custom" : state.preset, true);
            }
            render();
        }

        function row(name, value) {
            return "<div class=\"calc_out\"><span>" + name + "</span><span>" + value + "</span></div>";
        }

        function render() {
            let s = spec;
            let t = target();
            let tm = 1 / state.rate;
            let vis = state.vis;
            let res = M.detection_range(s, t, tm, { visibility_km: vis });
            let R = res.range_m;
            let motion = M.radial_motion_factor(s, state.speed, tm);
            let res_m = M.detection_range(Object.assign({}, s, { gain: s.gain * motion }), t, tm, { visibility_km: vis });
            let topt = M.optimal_measurement_time(s, state.speed);
            let w = M.beam_radius(s, R);
            let half_off = w * sqrt(log(2) / 2) / R;
            let pr = M.predicted_ratings(s);
            let html = "";
            html += row("Footprint at 1 km", fmt_len(M.beam_diameter(s, 1000)));
            html += row("Beam outgrows the target at", fmt_range(M.crossover_range(s, t.size_m)));
            html += row("Maximum range, hovering", fmt_range(R) + (res.limited_by === "max_range" ? " (module limit)" : ""));
            html += row("Maximum range at " + round(state.speed) + " m/s", fmt_range(res_m.range_m));
            html += row("Best measurement time at " + round(state.speed) + " m/s", isFinite(topt) ? fmt_time(topt) + " (" + (1 / topt).toFixed(1) + " Hz)" : "as long as possible");
            html += row("Target size in the camera at max range", (t.size_m / R * FPX).toFixed(1) + " px");
            html += row("Beam size in the camera", (s.divergence_mrad * 1e-3 * FPX).toFixed(1) + " px");
            html += row("Pointing error that halves the echo", (half_off * 1e3).toFixed(2) + " mrad (" + (half_off * FPX).toFixed(1) + " px)");
            html += row("Rated vs model, 2.3 m target", fmt_range(s.ratings.nato) + " / " + fmt_range(pr.nato));
            outs.innerHTML = html;
            draw_plot();
        }

        function draw_plot() {
            let wd = plot_div.clientWidth, ht = plot_div.clientHeight;
            if (!wd || !ht) return;
            canvas.width = round(wd * dpr);
            canvas.height = round(ht * dpr);
            canvas.style.width = wd + "px";
            canvas.style.height = ht + "px";
            let ctx = canvas.getContext("2d");
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, wd, ht);
            let fs = 12;
            let t = target();
            let s = spec;
            let rates = [];
            for (let f = 1; f <= 25; f += 0.5) rates.push(f);
            let vals = rates.map(f => M.detection_range(s, t, 1 / f, { visibility_km: state.vis }).range_m);
            let vals_m = rates.map(f => M.detection_range(Object.assign({}, s, { gain: s.gain * M.radial_motion_factor(s, state.speed, 1 / f) }), t, 1 / f, { visibility_km: state.vis }).range_m);
            let ymax = max(...vals) * 1.15;
            let plot = new Plot(ctx, 46, 8, wd - 56, ht - 8 - fs * 3, {
                xmin: 1, xmax: 25, ymin: 0, ymax, fs, xticks: [1, 5, 10, 15, 20, 25], xfmt: v => v + " Hz",
                yfmt: v => v >= 1000 ? (v / 1000) + " km" : v + " m", xlabel: "measurement rate",
            });
            plot.frame();
            let pts = rates.map((f, i) => [plot.X(f), plot.Y(vals[i])]);
            let pts_m = rates.map((f, i) => [plot.X(f), plot.Y(vals_m[i])]);
            poly(ctx, pts, state.target.startsWith("quad") ? col.quad : col.shahed, 2.5);
            poly(ctx, pts_m, col.speed, 2, [5, 4]);
            plot.vline(state.rate, col.time, 1.2, [3, 3]);
            text(ctx, "hovering", plot.x + plot.w - 4, plot.Y(vals[vals.length - 1]) - 10, state.target.startsWith("quad") ? col.quad : col.shahed, fs, "right");
            text(ctx, "at " + round(state.speed) + " m/s", plot.x + plot.w - 4, plot.Y(vals_m[vals_m.length - 1]) + 12, col.speed, fs, "right");
        }

        window.addEventListener("resize", draw_plot);

        calc_sync = () => {
            // the global spec changed elsewhere (the preset selector at the top)
            state.preset = PRESET_KEYS.includes(preset_key) ? preset_key : state.preset;
            state.divergence = spec.divergence_mrad;
            state.gain = spec.gain;
            state.rated_ms = spec.rated_time_s * 1000;
            for (let k of ["preset", "divergence", "gain", "rated_ms"]) controls[k].set(state[k]);
            render();
        };

        render();
    }

    /* ================================================================== */
    /* Initialization                                                     */
    /* ================================================================== */

    let spec_seg = null;
    let spec_seg_silent = false;

    function spec_seg_select(i) {
        if (!spec_seg || i < 0)
            return;
        spec_seg_silent = true;
        spec_seg.set_selection(i);
        spec_seg_silent = false;
    }

    document.addEventListener("DOMContentLoaded", function() {
        for (let id in SCENES) {
            if (document.getElementById(id))
                new Demo(id, SCENES[id]);
        }

        let seg_div = document.getElementById("spec_seg0");
        if (seg_div) {
            let first = true;
            spec_seg = new SegmentedControl(seg_div, k => {
                if (first) { first = false; return; }
                if (spec_seg_silent) return;
                let key = PRESET_KEYS[k];
                set_spec(M.make_spec(key), key);
            }, PRESET_KEYS.map(k => M.PRESETS[k].name));
        }

        build_calculator();
        update_text(false);
        update_spec_table();

        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver(entries => {
                entries.forEach(entry => entry.target.demo.set_visible(entry.isIntersecting));
            }, { rootMargin: "200px" });
            all_demos.forEach(d => observer.observe(d.container));
        } else {
            all_demos.forEach(d => d.set_visible(true));
        }

        window.addEventListener("resize", () => all_demos.forEach(d => d.request()));
    });

})();
