
    /* ================================================================== */
    /* Scenes: wavelength, atmosphere, datasheet, noise, accumulation     */
    /* ================================================================== */

    /* ---------------------------- spectrum ---------------------------- */

    function wavelength_rgb(l) {
        let r = 0, g = 0, b = 0;
        if (l < 440) { r = -(l - 440) / 60; b = 1; }
        else if (l < 490) { g = (l - 440) / 50; b = 1; }
        else if (l < 510) { g = 1; b = -(l - 510) / 20; }
        else if (l < 580) { r = (l - 510) / 70; g = 1; }
        else if (l < 645) { r = 1; g = -(l - 645) / 65; }
        else { r = 1; }
        let f = l < 420 ? 0.3 + 0.7 * (l - 380) / 40 : l > 700 ? 0.3 + 0.7 * (750 - l) / 50 : 1;
        f = clamp(f, 0, 1);
        return "rgb(" + round(255 * r * f) + "," + round(255 * g * f) + "," + round(255 * b * f) + ")";
    }

    const spectrum_curves = [
        { name: "human eye", color: "#444", f: l => exp(-pow((l - 555) / 48, 2) / 2) },
        { name: "silicon camera", color: col.cam, f: l => smooth_step(350, 560, l) * (1 - smooth_step(780, 1110, l)) },
        { name: "InGaAs detector", color: col.range, f: l => 0.85 * smooth_step(870, 1020, l) * (1 - smooth_step(1610, 1720, l)) },
    ];

    SCENES.spectrum = {
        hover(d, x) {
            d.st.hx = x;
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let plot = new Plot(ctx, 24, 30, w - 48, h - 30 - fs * 4, {
                xmin: 350, xmax: 1750, ymin: 0, ymax: 1.12, fs: fs - 1, no_yticks: true,
                xticks: [400, 600, 800, 1000, 1200, 1400, 1600], xfmt: v => v + " nm",
            });
            plot.frame();
            // retinal hazard band
            ctx.fillStyle = "rgba(229,56,59,0.07)";
            ctx.fillRect(plot.X(400), plot.y, plot.X(1400) - plot.X(400), plot.h);
            text(ctx, "focused onto the retina", (plot.X(400) + plot.X(1400)) / 2, plot.y + fs * 0.9, "#C77", fs - 2);
            // visible strip
            for (let l = 380; l < 750; l += 2) {
                ctx.fillStyle = wavelength_rgb(l);
                ctx.fillRect(plot.X(l), plot.y + plot.h + 1, plot.X(l + 2) - plot.X(l) + 0.5, 6);
            }
            for (let c of spectrum_curves)
                plot.curve(c.f, c.color, 2.2, null, 300);
            for (let l of [905, 1550]) {
                plot.vline(l, col.laser, 2);
                halo_text(ctx, l + " nm", plot.X(l), plot.y - 12, col.laser, fs, "center", "middle", 500);
            }
            // legend
            let lx = plot.x + 8, ly = plot.y + plot.h + fs * 2.6;
            for (let c of spectrum_curves) {
                line(ctx, lx, ly, lx + 16, ly, c.color, 2.5);
                text(ctx, c.name, lx + 22, ly, c.color, fs - 1, "left");
                font(ctx, fs - 1);
                lx += 22 + ctx.measureText(c.name).width + 22;
            }
            if (d.st.hx !== null && d.st.hx !== undefined && d.st.hx >= plot.x && d.st.hx <= plot.x + plot.w) {
                let l = plot.invX(d.st.hx);
                plot.vline(l, col.axis, 1, [3, 3]);
                let y = plot.y + fs * 2.4;
                let tx = d.st.hx + (d.st.hx > w * 0.65 ? -8 : 8);
                let al = d.st.hx > w * 0.65 ? "right" : "left";
                halo_text(ctx, round(l) + " nm", tx, y, col.text, fs, al, "middle", 500, "rgba(255,255,255,0.95)");
                for (let c of spectrum_curves) {
                    y += fs * 1.3;
                    halo_text(ctx, c.name + ": " + round(100 * c.f(l)) + "%", tx, y, c.color, fs - 1, al, "middle", 400, "rgba(255,255,255,0.95)");
                }
            }
        },
    };

    /* --------------------------- atmosphere --------------------------- */

    SCENES.atmosphere = {
        sliders: [{ anim: { period: 15 }, fmt: v => "visibility " + (v < 10 ? v.toFixed(1) : round(v)) + " km", map: log_map(0.3, 60), def: 25 }],
        init(d) {
            let rng = make_rng(21);
            d.st.parts = [];
            for (let i = 0; i < 900; i++)
                d.st.parts.push([rng(), rng(), rng()]);
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let V = d.v[0];
            let alpha = M.extinction_per_km(spec.wavelength_nm, V);
            let top = h * 0.34;
            let x0 = 40, x1 = w - 30;
            let Rmax = 5;
            let y = top * 0.55;

            // haze band
            round_rect(ctx, 10, 10, w - 20, top - 10, 8, "#F1F4F7");
            let n = round(clamp(alpha * 120, 4, 900));
            for (let i = 0; i < n; i++) {
                let p = d.st.parts[i];
                circle(ctx, 12 + p[0] * (w - 24), 14 + p[1] * (top - 18), 0.8 + p[2] * 1.4, "rgba(120,144,156,0.45)");
            }
            // beam fading with distance
            let steps = 60;
            for (let i = 0; i < steps; i++) {
                let r0 = Rmax * i / steps, r1 = Rmax * (i + 1) / steps;
                let a = exp(-alpha * (r0 + r1) / 2);
                ctx.lineCap = "butt";
                line(ctx, x0 + (x1 - x0) * r0 / Rmax, y, x0 + (x1 - x0) * r1 / Rmax + 0.5, y, rgba(col.laser, 0.15 + 0.85 * a), 4);
                ctx.lineCap = "round";
            }
            draw_lrf_side(ctx, x0, y, 8);
            halo_text(ctx, "visibility " + (V < 10 ? V.toFixed(1) : round(V)) + " km", w - 24, 26, col.atm, fs, "right", "middle", 500, "rgba(241,244,247,0.9)");

            // transmission plot
            let plot = new Plot(ctx, 76, top + 20, w - 100, h - top - 20 - fs * 3.2, {
                xmin: 0, xmax: Rmax, ymin: 0, ymax: 1, fs: fs - 1,
                xfmt: v => v === 0 ? "0" : v + " km", yfmt: v => round(v * 100) + "%", xlabel: "distance", ylabel: "surviving light",
            });
            plot.frame();
            plot.curve(r => exp(-alpha * r), col.atm, 2.5);
            plot.curve(r => exp(-2 * alpha * r), col.laser, 2.5);
            let r2 = 2;
            plot.dot(r2, exp(-alpha * r2), col.atm, 4);
            plot.dot(r2, exp(-2 * alpha * r2), col.laser, 4);
            let lx = plot.x + plot.w - 10;
            halo_text(ctx, "one way", lx, plot.Y(exp(-alpha * Rmax)) - fs * 0.8, col.atm, fs - 1, "right", "middle", 500, "rgba(255,255,255,0.9)");
            halo_text(ctx, "round trip", lx, plot.Y(exp(-2 * alpha * Rmax)) + fs * 0.8, col.laser, fs - 1, "right", "middle", 500, "rgba(255,255,255,0.9)");
            halo_text(ctx, "round trip to 2 km: " + fmt_pct(exp(-2 * alpha * r2)) + " survives", plot.x + 10, plot.y + plot.h - fs, col.text, fs - 1, "left", "middle", 500, "rgba(255,255,255,0.9)");
        },
    };

    /* ------------------------ datasheet check ------------------------- */

    SCENES.datasheet_check = {
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let plot = new Plot(ctx, 74, 16, w - 96, h - 16 - fs * 3.2, {
                xmin: 100, xmax: 10000, xlog: true, ymin: 1e-11, ymax: 1e-5, ylog: true, fs: fs - 1,
                xfmt: log_fmt_m, yfmt: pow10_fmt, xlabel: "distance", ylabel: "echo strength (relative)",
            });
            let legend = [];
            plot.frame();
            let S_det = M.rated_signal(spec) / spec.gain;
            let ds = [
                { key: "small", name: "0.75 m", color: "#7A7A7A" },
                { key: "nato", name: "2.3 m", color: "#555" },
                { key: "extended", name: "beam filling", color: col.bg },
            ];
            // instrument range limit
            plot.clip();
            ctx.fillStyle = "rgba(0,0,0,0.04)";
            ctx.fillRect(plot.X(spec.max_range_m), plot.y, plot.x + plot.w - plot.X(spec.max_range_m), plot.h);
            plot.unclip();
            ctx.save();
            ctx.translate((plot.X(spec.max_range_m) + plot.x + plot.w) / 2, plot.y + plot.h * 0.75);
            ctx.rotate(-pi / 2);
            text(ctx, "beyond max range", 0, 0, col.light_text, fs - 2);
            ctx.restore();

            plot.hline(S_det, col.thr, 2, [6, 4]);
            halo_text(ctx, "sensitivity", plot.x + 8, plot.Y(S_det) - fs * 0.8, col.thr, fs - 1, "left", "middle", 500, "rgba(255,255,255,0.9)");

            for (let k of ds) {
                let t = M.RATED_TARGETS[k.key];
                plot.curve(r => M.signal(spec, t, r, t.visibility_km), k.color, 2);
                let Rr = spec.ratings[k.key];
                let S = M.signal(spec, t, Rr, t.visibility_km);
                plot.dot(Rr, S, k.color, 6);
                legend.push({ color: k.color, filled: true, label: k.name + " square, rated " + fmt_int(Rr) + " m" });
            }
            for (let it of [{ t: QUAD, color: col.quad, name: "10\" quad" }, { t: SHAHED, color: col.shahed, name: "Shahed" }]) {
                plot.curve(r => M.signal(spec, it.t, r, VIS), it.color, 2.5);
                let Rq = det_range(it.t, rated_time());
                let S = M.signal(spec, it.t, Rq, VIS);
                circle(ctx, plot.X(Rq), plot.Y(S), 6, "#fff", it.color, 2.5);
                legend.push({ color: it.color, filled: false, label: it.name + ", predicted ~" + fmt_range(Rq) });
            }
            legend[0].label = "0.75 m square, rated " + fmt_int(spec.ratings.small) + " m";
            legend[2].label = "beam filling target, rated " + fmt_int(spec.ratings.extended) + " m";
            let ly = plot.y + plot.h - fs * 0.9 - (legend.length - 1) * fs * 1.35;
            let lx = plot.x + 12;
            font(ctx, fs - 1);
            let lw = max(...legend.map(l => ctx.measureText(l.label).width)) + 34;
            round_rect(ctx, lx - 6, ly - fs, lw, legend.length * fs * 1.35 + fs * 0.4, 6, "rgba(255,255,255,0.92)", "#E4E4E4");
            for (let l of legend) {
                circle(ctx, lx + 8, ly, 5, l.filled ? l.color : "#fff", l.filled ? "#fff" : l.color, l.filled ? 1.5 : 2.5);
                text(ctx, l.label, lx + 20, ly, l.color, fs - 1, "left", "middle", 500);
                ly += fs * 1.35;
            }
        },
    };

    /* --------------------------- single shot -------------------------- */

    function echo_shape(x) {
        let s = M.echo_sigma(spec);
        return exp(-x * x / (2 * s * s));
    }

    SCENES.single_shot = {
        sliders: [
            { anim: { period: 18 }, fmt: v => "R = " + round(v) + " m", map: log_map(80, 1000), def: 400 },
            { fmt: v => "threshold " + v.toFixed(1) + "σ", map: lin_map(1, 8), def: 3 },
        ],
        init(d) {
            let rng = make_rng(77);
            d.st.noise = new Float32Array(1000);
            for (let i = 0; i < 1000; i++) d.st.noise[i] = rng.normal();
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0], thr = d.v[1];
            let snr1 = M.snr_per_pulse(spec, M.signal(spec, QUAD, R, VIS));
            let ymax = max(9, snr1 * 1.15);
            let plot = new Plot(ctx, 44, 20, w - 64, h - 20 - fs * 3.2, {
                xmin: 0, xmax: 1000, ymin: -4, ymax, fs: fs - 1, no_yticks: true,
                xfmt: v => v === 0 ? "0" : v + " m", xlabel: "distance (1 m bins)",
            });
            plot.frame();
            let pts = [];
            let fa = [];
            let det = false;
            // Neighboring bins above the threshold make one detection, as a
            // receiver reports one target per crossing. It's the echo if the
            // echo itself adds at least a noise sigma somewhere in it, since
            // a strong, 4.5 m long echo spills over several 1 m bins.
            let run = null;
            for (let b = 0; b <= 1000; b++) {
                let s = b < 1000 ? snr1 * echo_shape(b + 0.5 - R) : 0;
                let v = b < 1000 ? d.st.noise[b] + s : -Infinity;
                if (b < 1000)
                    pts.push([plot.X(b + 0.5), plot.Y(v)]);
                if (v > thr) {
                    if (!run) run = { peak: b, top: v, echo: false };
                    if (v > run.top) { run.peak = b; run.top = v; }
                    if (s >= 1) run.echo = true;
                } else if (run) {
                    if (run.echo) det = true;
                    else fa.push(run.peak);
                    run = null;
                }
            }
            plot.clip();
            poly(ctx, pts, col.hist, 1);
            plot.hline(thr, col.thr, 2);
            plot.unclip();
            for (let b of fa)
                line(ctx, plot.X(b + 0.5), plot.y + 2, plot.X(b + 0.5), plot.y + 12, col.thr, 2);
            // echo position marker
            let ex = plot.X(R);
            fill_poly(ctx, [[ex, plot.y + plot.h - 12], [ex - 6, plot.y + plot.h - 1], [ex + 6, plot.y + plot.h - 1]], col.quad);
            ctx.save();
            ctx.translate(26, plot.y + plot.h / 2);
            ctx.rotate(-pi / 2);
            text(ctx, "detector output", 0, 0, col.text, fs - 1);
            ctx.restore();
            let msg = (det ? "echo detected" : "echo missed") + ",  false alarms: " + fa.length + ",  echo SNR: " + snr1.toFixed(snr1 < 10 ? 1 : 0);
            halo_text(ctx, msg, plot.x + plot.w - 6, plot.y + fs * 1.6, col.text, fs - 1, "right", "middle", 500, "rgba(255,255,255,0.92)");
            halo_text(ctx, "quad", ex + 9, plot.y + plot.h - 8, col.quad, fs - 2, "left", "middle", 500, "rgba(255,255,255,0.92)");
        },
    };

    /* ------------------------ threshold stats ------------------------- */

    function gauss_pdf(x, m) {
        return exp(-(x - m) * (x - m) / 2) / sqrt(2 * pi);
    }

    SCENES.threshold_stats = {
        sliders: [
            { anim: { period: 15, lo: 0.15, hi: 0.75 }, fmt: v => "threshold " + v.toFixed(1) + "σ", map: lin_map(0, 10), def: 3 },
            { fmt: v => "SNR " + v.toFixed(1), map: lin_map(0, 10), def: 6 },
        ],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let thr = d.v[0], snr = d.v[1];
            let plot = new Plot(ctx, 30, 20, w - 50, h - 20 - fs * 5.6, {
                xmin: -4, xmax: 14, ymin: 0, ymax: 0.45, fs: fs - 1, no_yticks: true,
                xticks: [-4, -2, 0, 2, 4, 6, 8, 10, 12, 14], xfmt: v => v === 0 ? "0" : (v < 0 ? "−" + abs(v) : v) + "σ",
            });
            plot.frame();
            let shade = (m, color) => {
                let pts = [[plot.X(thr), plot.Y(0)]];
                for (let i = 0; i <= 80; i++) {
                    let x = thr + (14 - thr) * i / 80;
                    pts.push([plot.X(x), plot.Y(gauss_pdf(x, m))]);
                }
                pts.push([plot.X(14), plot.Y(0)]);
                plot.clip();
                fill_poly(ctx, pts, color);
                plot.unclip();
            };
            shade(snr, rgba(col.echo, 0.3));
            shade(0, rgba(col.thr, 0.35));
            plot.curve(x => gauss_pdf(x, 0), col.noise, 2.5);
            plot.curve(x => gauss_pdf(x, snr), col.echo, 2.5);
            plot.vline(thr, col.thr, 2);
            halo_text(ctx, "threshold", plot.X(thr) + 6, plot.y + fs, col.thr, fs - 1, "left", "middle", 500);

            let pfa = M.norm_sf(thr);
            let bins = (spec.max_range_m - spec.min_range_m) / spec.gate_m;
            let pd = M.norm_cdf(snr - thr);
            let y = plot.y + plot.h + fs * 2.6;
            let cxl = w * 0.27, cxr = w * 0.73;
            text(ctx, "false alarm, per bin: " + fmt_sci(pfa, 1), cxl, y, col.thr, fs - 1);
            text(ctx, "per measurement (" + fmt_int(bins) + " bins): " + fmt_sci(min(bins * pfa, 1e9), 1), cxl, y + fs * 1.4, col.thr, fs - 1);
            text(ctx, "echo detected: " + fmt_pct(pd), cxr, y, "#B07800", fs - 1);
            text(ctx, "echo SNR: " + snr.toFixed(1), cxr, y + fs * 1.4, "#B07800", fs - 1);
        },
    };

    /* --------------------------- accumulate --------------------------- */

    const ACC_BINS = 1000;
    const ACC_MAX = 1000;

    function acc_reset(d) {
        d.st.sum = new Float64Array(ACC_BINS);
        d.st.last = new Float32Array(ACC_BINS);
        d.st.N = 0;
        d.st.clock = 0;
        d.st.hold = 0;
        // fresh noise for every repeat
        d.st.rng = make_rng(4242 + round(d.v[0]) + 7919 * (d.st.loops || 0));
    }

    const ACC_HOLD = 3;     // seconds to show the finished result before starting over

    SCENES.accumulate = {
        animated: true,
        sliders: [{ fmt: v => "R = " + round(v) + " m", map: log_map(150, 1200), def: 390, on: (d) => { acc_reset(d); d.set_paused(false); } }],
        reset(d) { acc_reset(d); },
        finished(d) { return d.st.N >= ACC_MAX; },
        init(d) { acc_reset(d); },
        draw(ctx, d, w, h, dt) {
            let fs = base_font_size(w);
            let st = d.st;
            let R = d.v[0];
            let snr1 = M.snr_per_pulse(spec, M.signal(spec, QUAD, R, VIS));
            let sig = new Float32Array(ACC_BINS);
            for (let b = 0; b < ACC_BINS; b++) sig[b] = snr1 * echo_shape(b + 0.5 - R);

            // pulses added this frame: accelerating schedule
            st.clock += dt;
            let target_N = min(ACC_MAX, floor(pow(st.clock / 7, 2.2) * ACC_MAX));
            while (st.N < target_N) {
                for (let b = 0; b < ACC_BINS; b++) {
                    let v = st.rng.normal() + sig[b];
                    st.sum[b] += v;
                    st.last[b] = v;
                }
                st.N++;
            }
            if (st.N >= ACC_MAX && !d.paused) {
                if (d.touched) {
                    // the reader took over: keep showing the result
                    d.set_paused(true);
                } else if ((st.hold += dt) > ACC_HOLD) {
                    // nobody's touched it: start over, with new noise
                    st.loops = (st.loops || 0) + 1;
                    acc_reset(d);
                }
            }
            let N = max(1, st.N);

            let top_h = h * 0.6;
            let ymax = max(8, snr1 * sqrt(N) * 1.15);
            let plot = new Plot(ctx, 44, 30, w - 64, top_h - 30 - fs * 1.6, {
                xmin: 0, xmax: 1000, ymin: -4, ymax, fs: fs - 1, no_yticks: true,
                xfmt: v => v === 0 ? "0" : v + " m",
            });
            plot.frame();
            plot.clip();
            let pts = [];
            let peak = -1e9, peak_b = 0;
            for (let b = 0; b < ACC_BINS; b++) {
                let v = st.N ? st.sum[b] / sqrt(N) : 0;
                if (v > peak) { peak = v; peak_b = b; }
                pts.push([plot.X(b + 0.5), plot.Y(v)]);
            }
            poly(ctx, pts, col.hist, 1.2);
            plot.hline(spec.threshold_sigma, col.thr, 1.5, [5, 4]);
            plot.unclip();
            ctx.save();
            ctx.translate(26, plot.y + plot.h / 2);
            ctx.rotate(-pi / 2);
            text(ctx, "sum / √N", 0, 0, col.text, fs - 1);
            ctx.restore();
            let found = st.N > 0 && peak > spec.threshold_sigma && abs(peak_b + 0.5 - R) < 3;
            halo_text(ctx, "N = " + fmt_int(st.N) + " pulses", plot.x + 8, 14, col.hist, fs, "left", "middle", 500);
            halo_text(ctx, "echo SNR = √N × " + snr1.toFixed(2) + " = " + (snr1 * sqrt(N)).toFixed(1), plot.x + plot.w, 14, "#B07800", fs, "right", "middle", 500);
            if (found) {
                plot.dot(peak_b + 0.5, min(peak, ymax), col.quad, 5);
                let vals = Array.from(st.sum);
                let c = echo_center(vals, peak_b, i => i + 0.5, 2);
                halo_text(ctx, "measured: " + fmt_reported(c), plot.X(peak_b + 0.5) + (peak_b > 700 ? -8 : 8), max(plot.y + fs * 0.9, plot.Y(peak) - 2), col.quad, fs - 1, peak_b > 700 ? "right" : "left", "middle", 500);
            }

            // latest single pulse
            let p2 = new Plot(ctx, 44, top_h + 22, w - 64, h - top_h - 22 - 54, {
                xmin: 0, xmax: 1000, ymin: -4.5, ymax: 4.5 + snr1, fs: fs - 1, no_yticks: true, no_xticks: true,
            });
            p2.frame();
            p2.clip();
            let pts2 = [];
            for (let b = 0; b < ACC_BINS; b++)
                pts2.push([p2.X(b + 0.5), p2.Y(st.N ? st.last[b] : 0)]);
            poly(ctx, pts2, col.noise, 1);
            p2.unclip();
            text(ctx, "latest single pulse", p2.x + 6, p2.y - 8, col.light_text, fs - 2, "left");
        },
    };

    /* -------------------------- accum range --------------------------- */

    SCENES.accum_range = {
        sliders: [{ anim: { period: 15 }, fmt: v => "N = " + fmt_int(v), map: log_map(10, 1e6), def: 1000 }],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let N = d.v[0];
            let sp = Object.assign({}, spec, { max_range_m: 1e9 });
            let rng_for = (t, n) => M.detection_range(sp, t, n / sp.prf_hz, { visibility_km: VIS }).range_m;
            let plot = new Plot(ctx, 76, 16, w - 100, h - 16 - fs * 3.2, {
                xmin: 10, xmax: 1e6, xlog: true, ymin: 100, ymax: 30000, ylog: true, fs: fs - 1,
                xfmt: v => fmt_int(v), xlabel: "pulses accumulated", yfmt: log_fmt_m, ylabel: "maximum range",
                xticks: [10, 100, 1000, 1e4, 1e5, 1e6],
            });
            plot.frame();
            plot.clip();
            ctx.fillStyle = "rgba(0,0,0,0.04)";
            ctx.fillRect(plot.x, plot.y, plot.w, plot.Y(spec.max_range_m) - plot.y);
            plot.unclip();
            text(ctx, spec.name + " stops measuring at " + fmt_int(spec.max_range_m) + " m", plot.x + plot.w - 8, plot.y + fs, col.light_text, fs - 2, "right");
            plot.curve(n => rng_for(WALL, n), col.bg, 2.5, null, 60);
            plot.curve(n => rng_for(QUAD, n), col.quad, 2.5, null, 60);
            plot.vline(N, col.hist, 1.5);
            let rw = rng_for(WALL, N), rq = rng_for(QUAD, N);
            plot.dot(N, rw, col.bg, 5);
            plot.dot(N, rq, col.quad, 5);
            let rightside = N < 2e4;
            halo_text(ctx, "wall " + fmt_range(rw), plot.X(N) + (rightside ? 8 : -8), plot.Y(rw) + fs * 0.9, col.bg, fs - 1, rightside ? "left" : "right", "middle", 500);
            halo_text(ctx, "quad " + fmt_range(rq), plot.X(N) + (rightside ? 8 : -8), plot.Y(rq) + fs * 0.9, col.quad, fs - 1, rightside ? "left" : "right", "middle", 500);
            let tm = N / spec.prf_hz;
            halo_text(ctx, fmt_int(N) + " pulses = " + fmt_time(tm) + " at " + fmt_int(spec.prf_hz) + " pulses/s", plot.x + plot.w - 8, plot.y + plot.h - fs, col.hist, fs - 1, "right", "middle", 500);
        },
    };

    /* ----------------------------- sub-bin ----------------------------- */

    // Fraction of a Gaussian echo (centered at c, sigma s) falling into the bin [a, a + 1].
    function bin_share(a, c, s) {
        let k = 1 / (s * Math.SQRT2);
        return 0.5 * (M.erf((a + 1 - c) * k) - M.erf((a - c) * k));
    }

    SCENES.subbin = {
        animated: true,
        sliders: [
            { anim: { period: 24 }, fmt: v => "R = " + v.toFixed(2) + " m", map: lin_map(122.5, 124.5), def: 123.74 },
            { fmt: v => "SNR " + v.toFixed(v < 10 ? 1 : 0), map: log_map(4, 100), def: 25 },
        ],
        init(d) {
            d.st.k = -1;
            d.st.hist = [];
            d.st.rng = make_rng(31337);
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let st = d.st;
            let R = d.v[0], snr = d.v[1];
            let sp = spec.pulse_m / 2.3548;
            let a0 = 117, nb = 13;
            let peak_share = bin_share(floor(R), R, sp);
            // a fresh measurement twice per second
            let k = floor(d.t * 2);
            if (k !== st.k || !st.vals) {
                st.k = k;
                st.vals = [];
                for (let i = 0; i < nb; i++)
                    st.vals.push(snr * bin_share(a0 + i, R, sp) / peak_share + st.rng.normal());
                let pb = 0;
                for (let i = 1; i < nb; i++) if (st.vals[i] > st.vals[pb]) pb = i;
                st.est = echo_center(st.vals, pb, i => a0 + i + 0.5, 2);
                st.hist.push(st.est - R);
                if (st.hist.length > 40) st.hist.shift();
            }
            let plot = new Plot(ctx, 30, 22, w - 54, h - 22 - fs * 4.6, {
                xmin: a0, xmax: a0 + nb, ymin: -3, ymax: snr * 1.15 + 1, fs: fs - 1, no_yticks: true,
                xticks: [118, 120, 122, 124, 126, 128], xfmt: v => v + " m", xn: 13,
            });
            plot.frame();
            plot.clip();
            for (let i = 0; i < nb; i++) {
                let x0 = plot.X(a0 + i) + 2, x1 = plot.X(a0 + i + 1) - 2;
                let y0 = plot.Y(0), y1 = plot.Y(st.vals[i]);
                ctx.fillStyle = rgba(col.echo, 0.85);
                ctx.fillRect(x0, min(y0, y1), x1 - x0, abs(y1 - y0));
            }
            // the echo's true shape
            plot.curve(x => snr * exp(-(x - R) * (x - R) / (2 * sp * sp)) * (1 / (sp * sqrt(2 * pi))) / peak_share, rgba(col.quad, 0.6), 1.5, [4, 3], 200);
            plot.unclip();
            plot.vline(R, col.quad, 2);
            let ex = plot.X(st.est);
            fill_poly(ctx, [[ex, plot.y + plot.h + 2], [ex - 7, plot.y + plot.h + 13], [ex + 7, plot.y + plot.h + 13]], col.text);
            halo_text(ctx, "true " + R.toFixed(2) + " m", plot.X(R) + (R > 123.5 ? -8 : 8), plot.y + fs, col.quad, fs - 1, R > 123.5 ? "right" : "left", "middle", 500);
            let spread = sqrt(st.hist.reduce((a, e) => a + e * e, 0) / max(1, st.hist.length));
            text(ctx, "reported: " + fmt_reported(st.est), w / 2, plot.y + plot.h + fs * 2.6, col.text, fs + 1, "center", "middle", 500);
            text(ctx, "typical error of recent measurements: ±" + spread.toFixed(2) + " m", w / 2, plot.y + plot.h + fs * 4, col.light_text, fs - 1);
        },
    };

    /* ------------------------- rate timeline -------------------------- */

    SCENES.rate_timeline = {
        animated: true,
        sliders: [{ fmt: v => round(v) + " Hz", map: lin_map(1, 25), def: 10, on: d => { d.st.k = -1; d.st.marks = []; } }],
        init(d) {
            d.st.k = -1;
            d.st.marks = [];
            d.st.R = 520;
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let st = d.st;
            // the module offers whole rates from 1 to 25 Hz
            let f = clamp(round(d.v[0]), 1, 25);
            let tm = 1 / f;
            let R = st.R;
            let t = d.t % 1;
            let k = floor(t / tm);
            let p = clamp((t - k * tm) / tm, 0.02, 1);
            let snr = snr_at(QUAD, R, tm);
            if (k !== st.k) {
                if (st.noise && st.k >= 0) {
                    let peak = -1e9, pb = 0;
                    for (let b = 0; b < st.noise.length; b++) {
                        let v = st.noise[b] + st.sig[b];
                        if (v > peak) { peak = v; pb = b; }
                    }
                    st.marks[st.k] = peak > spec.threshold_sigma && pb === floor(R / 2);
                }
                if (k === 0) st.marks = [];
                st.k = k;
                let rng = make_rng(900 + floor(d.t) * 31 + k);
                let n = 600;
                st.noise = new Float32Array(n);
                st.sig = new Float32Array(n);
                for (let b = 0; b < n; b++)
                    st.noise[b] = rng.normal();
                st.sig[floor(R / 2)] = snr;
            }

            // timeline
            let x0 = 20, x1 = w - 20, ty = 34;
            let X = s => x0 + (x1 - x0) * s;
            let n = ceil(1 / tm - 1e-9);
            for (let i = 0; i < n; i++) {
                let a = X(i * tm), b = X(min(1, (i + 1) * tm));
                round_rect(ctx, a + 1, ty - 10, b - a - 2, 20, 4, i === k ? rgba(col.time, 0.35) : rgba(col.time, 0.12));
                if (i < k && st.marks[i] !== undefined)
                    circle(ctx, (a + b) / 2, ty + 20, 4, st.marks[i] ? col.quad : null, st.marks[i] ? null : col.miss, 1.5);
            }
            line(ctx, X(t), ty - 16, X(t), ty + 14, col.time, 2);
            text(ctx, "one second", x0, ty - 22, col.light_text, fs - 2, "left");
            text(ctx, fmt_int(spec.prf_hz * tm) + " pulses per measurement", x1, ty - 22, col.time, fs - 1, "right", "middle", 500);

            // histogram of the current measurement
            let ph = h * 0.42;
            let plot = new Plot(ctx, 44, ty + 40, w - 64, ph, {
                xmin: 0, xmax: 1200, ymin: -3, ymax: max(9, snr * 1.15), fs: fs - 1, no_yticks: true,
                xfmt: v => v === 0 ? "0" : v + " m",
            });
            plot.frame();
            plot.clip();
            let bw = plot.w / 600;
            for (let b = 0; b < 600; b++) {
                let v = p * st.sig[b] + sqrt(p) * st.noise[b];
                let y0 = plot.Y(0), y1 = plot.Y(v);
                ctx.fillStyle = st.sig[b] > 0 ? rgba(col.echo, 1) : rgba(col.hist, 0.7);
                ctx.fillRect(plot.x + b * bw, min(y0, y1), max(st.sig[b] > 0 ? 2 : 0.8, bw - 0.2), abs(y1 - y0));
            }
            plot.hline(spec.threshold_sigma * sqrt(p), col.thr, 1.2, [4, 3]);
            plot.unclip();
            halo_text(ctx, "quad at " + R + " m, SNR " + snr.toFixed(1) + ", found " + fmt_pct(M.detection_probability(spec, snr)) + " of the time", plot.x + plot.w - 4, plot.y + fs * 0.8, col.text, fs - 1, "right", "middle", 500, "rgba(255,255,255,0.9)");

            // maximum range bars
            let by = plot.y + plot.h + fs * 2.2;
            let items = [
                { t: QUAD, name: "10\" quad", color: col.quad },
                { t: SHAHED, name: "Shahed", color: col.shahed },
            ];
            let Rmax = 3000;
            let bx0 = 150, bx1 = w - 30;
            text(ctx, "maximum range at " + round(f) + " Hz", (bx0 + bx1) / 2, by - fs * 0.2, col.text, fs - 1, "center", "middle", 500);
            for (let i = 0; i < items.length; i++) {
                let it = items[i];
                let yy = by + fs * 1.3 + i * fs * 1.7;
                let r = det_range(it.t, tm);
                let r1 = det_range(it.t, 1);
                text(ctx, it.name, bx0 - 10, yy, it.color, fs - 1, "right", "middle", 500);
                round_rect(ctx, bx0, yy - 6, (bx1 - bx0) * r1 / Rmax, 12, 3, rgba(it.color, 0.15));
                round_rect(ctx, bx0, yy - 6, (bx1 - bx0) * r / Rmax, 12, 3, it.color);
                text(ctx, fmt_range(r), bx0 + (bx1 - bx0) * r / Rmax + 6, yy, it.color, fs - 2, "left");
            }
            text(ctx, "pale bars: at 1 Hz", bx1, by + fs * 1.3 + 2 * fs * 1.7, col.light_text, fs - 2, "right");
        },
    };

    /* ------------------------- prf ambiguity -------------------------- */

    SCENES.prf_ambiguity = {
        sliders: [{ anim: { period: 18 }, fmt: v => fmt_int(v) + " pulses/s", map: log_map(3000, 100000), def: 10000 }],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let prf = d.v[0];
            let R = 5000;
            let te = 2 * R / M.C;
            let span = 200e-6;
            let x0 = 30, x1 = w - 20;
            let X = t => x0 + (x1 - x0) * t / span;
            // the status line on top wraps on narrow screens; the timeline
            // moves down to make room
            let amb = te > 1 / prf;
            let apparent = (te % (1 / prf)) * M.C / 2;
            let msg = fmt_int(prf) + " pulses per second: " + (amb ?
                "each echo arrives after the next pulse; it looks like a target at " + fmt_dist(apparent) :
                "each echo arrives before the next pulse");
            let lines = wrap_lines(ctx, msg, w - 24, fs - 1, 500);
            let lh = fs * 1.25;
            let y_p = max(h * 0.3, 14 + (lines.length - 1) * lh + fs * 2.4);
            let y_e = y_p + min(h * 0.32, h - y_p - fs * 4.2);
            line(ctx, x0, y_p, x1, y_p, "#DDD", 1);
            line(ctx, x0, y_e, x1, y_e, "#DDD", 1);
            text(ctx, "pulses", x0, y_p - fs * 1.4, col.laser, fs - 1, "left", "middle", 500);
            text(ctx, "echoes from 5 km", x0, y_e + fs * 1.6, "#B07800", fs - 1, "left", "middle", 500);
            let period = 1 / prf;
            let n = floor(span / period) + 1;
            let shown = 0;
            for (let i = 0; i < n; i++) {
                let tp = i * period;
                line(ctx, X(tp), y_p - 9, X(tp), y_p + 9, col.laser, 2);
                let tE = tp + te;
                if (tE <= span) {
                    line(ctx, X(tE), y_e - 9, X(tE), y_e + 9, col.echo, 2);
                    if (shown < 6) {
                        ctx.strokeStyle = rgba(col.echo, 0.5);
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(X(tp), y_p + 10);
                        ctx.bezierCurveTo(X(tp), (y_p + y_e) / 2, X(tE), (y_p + y_e) / 2, X(tE), y_e - 10);
                        ctx.stroke();
                        shown++;
                    }
                }
            }
            for (let s = 0; s <= span + 1e-9; s += 50e-6)
                text(ctx, round(s * 1e6) + " µs", X(s), h - fs * 1.2, col.light_text, fs - 2);
            lines.forEach((ln, i) => halo_text(ctx, ln, w / 2, 14 + i * lh, amb ? col.thr : col.text, fs - 1, "center", "middle", 500));
        },
    };
