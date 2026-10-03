
    /* ================================================================== */
    /* Scenes: measurement rate tradeoffs, moving targets, multiple echoes */
    /* ================================================================== */

    // Echo spread uniformly over [c - L, c], convolved with the echo shape,
    // normalized so that L = 0 gives a peak of 1.
    function smeared_echo(x, c, L) {
        let s = M.echo_sigma(spec);
        if (L < 1e-6)
            return exp(-(x - c) * (x - c) / (2 * s * s));
        let k = 1 / (s * Math.SQRT2);
        return s * sqrt(pi / 2) / L * (M.erf((x - c + L) * k) - M.erf((x - c) * k));
    }

    /* ------------------------------ smear ----------------------------- */

    const SMEAR_R = 500;

    SCENES.smear = {
        animated: true,
        sliders: [
            { fmt: v => "speed " + round(v) + " m/s", map: lin_map(0, 50), def: 25 },
            { fmt: v => "measuring " + fmt_time_rate(v), map: log_map(0.01, 0.4), def: 0.1 },
            { fmt: v => "assuming " + round(v) + " m/s", map: lin_map(0, 50), def: 0 },
        ],
        special(d, i, name) {
            return d.v[0];
        },
        init(d) {
            let rng = make_rng(515);
            d.st.noise = new Float32Array(40);
            for (let i = 0; i < 40; i++) d.st.noise[i] = rng.normal();
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let v = d.v[0], T = d.v[1], u = d.v[2];
            let period = 2.5;
            let p = clamp((d.t % period) / (period * 0.8), 0.02, 1);
            let L = v * T;
            let Leff = abs(v - u) * T;
            let snr = snr_at(QUAD, SMEAR_R, T);

            // top: the quad's motion during the measurement
            let top = h * 0.3;
            let x0 = 50, x1 = w - 30;
            let span = 30;
            let X = r => x1 - (x1 - x0) * (SMEAR_R + 6 - r) / span;
            round_rect(ctx, 10, 6, w - 20, top - 12, 8, "#EEF3F8");
            draw_lrf_side(ctx, 34, top / 2, 6);
            text(ctx, "← to the range finder", 50, top - 18, col.light_text, fs - 2, "left");
            let r_now = SMEAR_R - v * T * p;
            for (let i = 0; i <= 8; i++) {
                let rr = SMEAR_R - L * i / 8;
                if (rr < r_now - 0.01) break;
                ctx.globalAlpha = 0.18;
                draw_quad_sprite(ctx, X(rr), top / 2 - 4, 40, "#2D3439", 0, -0.15);
                ctx.globalAlpha = 1;
            }
            draw_quad_sprite(ctx, X(r_now), top / 2 - 4, 40, "#2D3439", 0, -0.15);
            if (L > 0.3)
                dimension(ctx, X(SMEAR_R), top / 2 + 22, X(SMEAR_R - L), top / 2 + 22, col.speed, "moves " + L.toFixed(1) + " m during the measurement", fs - 2, -1);

            // accumulated histogram, in units of the final noise
            let plot = new Plot(ctx, 44, top + 16, w - 64, h - top - 16 - 54, {
                xmin: SMEAR_R - 30, xmax: SMEAR_R + 10, ymin: -3, ymax: max(10, snr * 1.1), fs: fs - 1, no_yticks: true,
                xticks: [SMEAR_R - 20, SMEAR_R - 10, SMEAR_R, SMEAR_R + 10], xfmt: v => v + " m",
            });
            plot.frame();
            plot.clip();
            let bw = plot.w / 40;
            let peak = 0;
            for (let b = 0; b < 40; b++) {
                let x = SMEAR_R - 30 + b + 0.5;
                let s = snr * smeared_echo(x, SMEAR_R, Leff * p);
                // shift and add with the assumed speed keeps the echo near the start position
                let val = p * s + sqrt(p) * d.st.noise[b];
                peak = max(peak, p * s);
                let y0 = plot.Y(0), y1 = plot.Y(val);
                ctx.fillStyle = s > 0.4 ? rgba(col.echo, 0.95) : rgba(col.hist, 0.7);
                ctx.fillRect(plot.x + b * bw + 1, min(y0, y1), bw - 2, abs(y1 - y0));
            }
            plot.hline(spec.threshold_sigma * sqrt(p), col.thr, 1.5, [5, 4]);
            plot.unclip();
            let final_peak = snr * M.smear_factor(spec, Leff);
            let lbl = "speed " + round(v) + " m/s,  measuring " + fmt_time_rate(T) + (u > 0 ? ",  assuming " + round(u) + " m/s" : "");
            let snr_lbl = "stationary SNR " + snr.toFixed(1) + ", smeared peak " + final_peak.toFixed(1);
            // side by side when they fit, otherwise the SNR on a second line
            font(ctx, fs - 1, 500);
            let fits = ctx.measureText(lbl).width + ctx.measureText(snr_lbl).width + 24 < plot.w;
            halo_text(ctx, snr_lbl, plot.x + plot.w - 4, plot.y + fs * (fits ? 0.8 : 2.1), col.text, fs - 1, "right", "middle", 500, "rgba(255,255,255,0.9)");
            halo_text(ctx, lbl, plot.x + 4, plot.y + fs * 0.8, col.speed, fs - 1, "left", "middle", 500, "rgba(255,255,255,0.9)");
        },
    };

    /* -------------------------- smear optimum ------------------------- */

    SCENES.smear_optimum = {
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = 450;
            let plot = new Plot(ctx, 70, 16, w - 90, h - 16 - fs * 3.2, {
                xmin: 0.003, xmax: 1, xlog: true, ymin: 0.5, ymax: 40, ylog: true, fs: fs - 1,
                xticks: [0.003, 0.01, 0.03, 0.1, 0.3, 1], xfmt: v => fmt_time(v),
                yticks: [0.5, 1, 2, 5, 10, 20, 40], yfmt: v => String(v),
                xlabel: "measurement time", ylabel: "SNR of a quad at " + R + " m",
            });
            plot.frame();
            let need = spec.threshold_sigma + M.norm_inv(spec.rated_pd);
            plot.hline(need, col.thr, 1.5, [6, 4]);
            text(ctx, "needed to detect", plot.x + plot.w - 6, plot.Y(need) + fs * 0.8, col.thr, fs - 2, "right");
            let speeds = [0, 10, 25, 50];
            let shades = ["#9CCC65", "#66BB6A", "#43A047", "#2E7D32"];
            for (let i = 0; i < speeds.length; i++) {
                let v = speeds[i];
                let f = t => snr_at(QUAD, R, t) * M.radial_motion_factor(spec, v, t);
                plot.curve(f, shades[i], 2.5, null, 120);
                let lab = v === 0 ? "hovering" : v + " m/s";
                if (v > 0) {
                    let to = M.optimal_measurement_time(spec, v);
                    plot.dot(to, f(to), shades[i], 5);
                    let below = v === 50, leftside = plot.X(to) > plot.x + plot.w * 0.7;
                    halo_text(ctx, lab + ": best " + fmt_time_rate(to), plot.X(to) + (below ? 0 : leftside ? -8 : 8), plot.Y(f(to)) + (below ? fs * 1.1 : -fs * 0.9), shades[i], fs - 1, below ? "center" : leftside ? "right" : "left", "middle", 500);
                } else {
                    halo_text(ctx, lab, plot.X(0.7), plot.Y(f(0.7)) - fs, shades[i], fs - 1, "center", "middle", 500);
                }
            }
        },
    };

    /* ----------------------------- crossing --------------------------- */

    SCENES.crossing = {
        animated: true,
        sliders: [
            { fmt: v => "R = " + fmt_dist(v), map: log_map(100, 2000), def: 500 },
            { fmt: v => "sideways " + round(v) + " m/s", map: lin_map(0, 50), def: 20 },
            { fmt: v => "measuring " + fmt_time_rate(v), map: log_map(0.01, 0.4), def: 0.1 },
        ],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0], v = d.v[1], T = d.v[2];
            let wr = M.beam_radius(spec, R);
            let omega = v / R;
            let factor = v < 1e-6 ? 1 : M.crossing_factor(spec, R, -omega * T / 2, omega, T);

            let period = 2.4;
            let p = (d.t % period) / (period * 0.85);
            let left = w * 0.62;
            round_rect(ctx, 10, 6, left - 20, h - 12, 8, "#E8F0F8");
            ctx.save();
            ctx.beginPath();
            ctx.rect(10, 6, left - 20, h - 12);
            ctx.clip();
            let view = max(1.2, 5 * wr);
            let ppm = (left - 30) / view;
            let cx = left / 2, cy = h / 2;
            draw_beam_spot(ctx, cx, cy, wr * ppm, col.laser, 0.75);
            let xs = -v * T / 2, xe = v * T / 2;
            line(ctx, cx + xs * ppm, cy + 26, cx + xe * ppm, cy + 26, col.speed, 2, [4, 4]);
            let pp = clamp(p, 0, 1);
            let xd = xs + (xe - xs) * pp;
            draw_quad_sprite(ctx, cx + xd * ppm, cy, 0.43 * ppm, "#2D3439", d.t, 0.1);
            ctx.restore();
            halo_text(ctx, fmt_dist(R) + " away, footprint " + fmt_len(2 * wr), 20, 22, col.range, fs - 1, "left", "middle", 500, "rgba(232,240,248,0.9)");
            halo_text(ctx, "slow motion", left - 20, h - 18, col.light_text, fs - 2, "right", "middle", 400, "rgba(232,240,248,0.9)");

            // collected so far during the window
            let soFar = 0;
            if (pp > 0) {
                let n = 40;
                let peak = M.profile_density(spec, R, 0, 0);
                for (let i = 0; i < n; i++) {
                    let x = xs + (xe - xs) * pp * (i + 0.5) / n;
                    soFar += M.profile_density(spec, R, 0, x) / peak;
                }
                soFar = soFar / n * pp;
            }
            if (v < 1e-6) soFar = pp;
            let bx = left + 10, bw = w - left - 30;
            let by = h * 0.25;
            text(ctx, "echo collected", bx, by - fs * 1.6, col.text, fs, "left", "middle", 500);
            round_rect(ctx, bx, by, bw, 16, 4, "#EEE");
            round_rect(ctx, bx, by, bw * clamp(soFar, 0, 1), 16, 4, col.echo);
            line(ctx, bx + bw * factor, by - 4, bx + bw * factor, by + 20, "#B07800", 2);
            text(ctx, fmt_pct(factor) + (w < 500 ? " of hovering" : " of a hovering quad"), bx, by + fs * 2, "#B07800", fs - 1, "left", "middle", 500);
            let deg_s = omega * 180 / pi;
            text(ctx, "crosses at " + (omega * 1000).toFixed(1) + " mrad/s", bx, by + fs * 4, col.speed, fs - 1, "left");
            text(ctx, "= panning " + deg_s.toFixed(deg_s < 10 ? 2 : 1) + "°/s", bx, by + fs * 5.3, col.speed, fs - 1, "left");
            text(ctx, "in footprint: " + (v > 0 ? fmt_time(2 * wr / v) : "∞"), bx, by + fs * 7, col.text, fs - 1, "left");
            text(ctx, "measurement: " + fmt_time_rate(T), bx, by + fs * 8.3, col.time, fs - 1, "left");
        },
    };

    /* ------------------------- tracking latency ----------------------- */

    /*
     * A fixed view of the sky around a crossing quad, in meters across the
     * line of sight, shown in slow motion. The turret points the beam using
     * camera measurements that are `delay` seconds old: either straight at
     * the last seen position, or at that position extrapolated by the
     * velocity estimated from the last two sightings. The reader can drag
     * the quad around to feel the lag.
     */
    const TRACK_SLOWMO = 0.25;      // simulated seconds per displayed second
    const TRACK_SPEED = 10;         // m/s, peak sideways speed of the automatic path

    // A weave with 3 to 4 g turns: hard, but something a real FPV quad can fly.
    function track_auto(t) {
        let A = 3.2, w = TRACK_SPEED / A;
        return [A * sin(w * t), 1.0 * sin(1.5 * w * t + 1)];
    }

    function track_auto_vel(t) {
        let A = 3.2, w = TRACK_SPEED / A;
        return [A * w * cos(w * t), 1.5 * w * cos(1.5 * w * t + 1)];
    }

    function track_auto_acc(t) {
        let A = 3.2, w = TRACK_SPEED / A;
        return [-A * w * w * sin(w * t), -2.25 * w * w * sin(1.5 * w * t + 1)];
    }

    /*
     * After the reader throws the quad: it keeps its momentum, bounces off
     * the edges of the view, and steers back onto the automatic path with
     * a critically damped pull (plus the path's own acceleration, so it can
     * follow the weave exactly) limited to 6 g, like a pilot turning back.
     * Returns true once it has rejoined the path.
     */
    const TRACK_THROW_MAX = 45;     // m/s
    const TRACK_THROW_ACC = 60;     // m/s^2

    function track_fly(f, t0, dt, bounds) {
        let n = max(1, ceil(dt / (1 / 480)));
        let h = dt / n;
        let wn = 5;
        for (let i = 0; i < n; i++) {
            let t = t0 + (i + 1) * h;
            let target = track_auto(t), tv = track_auto_vel(t), ta = track_auto_acc(t);
            let ax = ta[0] + wn * wn * (target[0] - f.p[0]) + 2 * wn * (tv[0] - f.v[0]);
            let ay = ta[1] + wn * wn * (target[1] - f.p[1]) + 2 * wn * (tv[1] - f.v[1]);
            let a = hypot(ax, ay);
            if (a > TRACK_THROW_ACC) {
                ax *= TRACK_THROW_ACC / a;
                ay *= TRACK_THROW_ACC / a;
            }
            f.v[0] += ax * h;
            f.v[1] += ay * h;
            f.p[0] += f.v[0] * h;
            f.p[1] += f.v[1] * h;
            for (let k = 0; k < 2; k++) {
                if (f.p[k] < bounds[k][0]) { f.p[k] = bounds[k][0]; f.v[k] = abs(f.v[k]) * 0.6; }
                if (f.p[k] > bounds[k][1]) { f.p[k] = bounds[k][1]; f.v[k] = -abs(f.v[k]) * 0.6; }
            }
        }
        let target = track_auto(t0 + dt), tv = track_auto_vel(t0 + dt);
        return hypot(f.p[0] - target[0], f.p[1] - target[1]) < 0.05 && hypot(f.v[0] - tv[0], f.v[1] - tv[1]) < 0.5;
    }

    function track_hist_at(hist, t) {
        if (!hist.length)
            return [0, 0];
        if (t <= hist[0][0])
            return [hist[0][1], hist[0][2]];
        for (let i = hist.length - 1; i > 0; i--) {
            let a = hist[i - 1], b = hist[i];
            if (a[0] <= t) {
                let f = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1;
                f = clamp(f, 0, 1);
                return [lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
            }
        }
        let last = hist[hist.length - 1];
        return [last[1], last[2]];
    }

    SCENES.tracking_latency = {
        animated: true,
        sliders: [
            { fmt: v => "delay " + round(v * 1000) + " ms", map: lin_map(0, 0.2), def: 0.05 },
            { fmt: v => "R = " + fmt_dist(v), map: log_map(200, 2000), def: 500 },
        ],
        segs: [["Last seen position", "Predicted position"]],
        init(d) {
            d.st.ts = 0;
            d.st.hist = [];
            d.st.beam_trail = [];
            d.st.drag = null;
            d.st.fly = null;
        },
        drag: {
            begin(d, x, y) {
                let L = d.st.layout;
                if (!L) return false;
                d.st.drag = L.to_m(x, y);
                d.st.fly = null;
                return true;
            },
            move(d, x, y) {
                let L = d.st.layout;
                d.st.drag = L.to_m(x, y);
            },
            end(d) {
                // throw: keep the velocity the quad had while being dragged
                let st = d.st;
                let a = track_hist_at(st.hist, st.ts - 0.03);
                let p = st.drag || a;
                let v = [(p[0] - a[0]) / 0.03, (p[1] - a[1]) / 0.03];
                let sp = hypot(v[0], v[1]);
                if (sp > TRACK_THROW_MAX) v = [v[0] * TRACK_THROW_MAX / sp, v[1] * TRACK_THROW_MAX / sp];
                st.fly = { p: [p[0], p[1]], v };
                st.drag = null;
            },
            cursor() { return "move"; },
        },
        draw(ctx, d, w, h, dt) {
            let fs = base_font_size(w);
            let st = d.st;
            let L = d.v[0], R = d.v[1];
            let lead = d.seg[0] === 1;

            // simulated time and the quad's position
            let sdt = dt * TRACK_SLOWMO;
            st.ts += sdt;
            let p;
            if (st.drag) {
                p = st.drag;
            } else if (st.fly) {
                let hv = (h * 0.84) / ((w - 20) / 9) / 2 - 0.3;
                if (track_fly(st.fly, st.ts - sdt, sdt, [[-4.3, 4.3], [-hv, hv]]))
                    st.fly = null;
                p = st.fly ? st.fly.p.slice() : track_auto(st.ts);
            } else {
                p = track_auto(st.ts);
            }
            st.hist.push([st.ts, p[0], p[1]]);
            while (st.hist.length > 2 && st.hist[0][0] < st.ts - 1.5)
                st.hist.shift();

            // where the turret points
            let seen = track_hist_at(st.hist, st.ts - L);
            let aim = seen;
            if (lead) {
                let dtv = 0.02;
                let before = track_hist_at(st.hist, st.ts - L - dtv);
                aim = [seen[0] + (seen[0] - before[0]) / dtv * L, seen[1] + (seen[1] - before[1]) / dtv * L];
            }
            st.beam_trail.push(aim);
            if (st.beam_trail.length > 90) st.beam_trail.shift();

            // view: 9 m across the line of sight, centered on the middle of the path
            let view_h = h * 0.84;
            let ppm = (w - 20) / 9;
            let cx = w / 2, cy = 6 + view_h / 2;
            let X = m => cx + m * ppm, Y = m => cy - m * ppm;
            st.layout = { to_m: (x, y) => [clamp((x - cx) / ppm, -4.3, 4.3), clamp(-(y - cy) / ppm, -view_h / 2 / ppm + 0.3, view_h / 2 / ppm - 0.3)] };

            let g = ctx.createLinearGradient(0, 0, 0, view_h);
            g.addColorStop(0, col.sky_top);
            g.addColorStop(1, col.sky_bottom);
            round_rect(ctx, 10, 6, w - 20, view_h, 8, g);
            ctx.save();
            ctx.beginPath();
            ctx.rect(10, 6, w - 20, view_h);
            ctx.clip();

            // recent path of the quad, and of the beam
            let hp = st.hist.filter((q, i) => i % 2 === 0).map(q => [X(q[1]), Y(q[2])]);
            poly(ctx, hp, rgba(col.quad, 0.25), 2);
            poly(ctx, st.beam_trail.map(q => [X(q[0]), Y(q[1])]), rgba(col.laser, 0.25), 2);

            let size = 0.43 * ppm;
            // where the camera last saw the quad
            ctx.globalAlpha = 0.35;
            draw_quad_sprite(ctx, X(seen[0]), Y(seen[1]), size, "#2D3439", 0, 0);
            ctx.globalAlpha = 1;
            // the quad now
            draw_quad_sprite(ctx, X(p[0]), Y(p[1]), size, "#2D3439", 0, 0);
            if (hypot(p[0] - seen[0], p[1] - seen[1]) * ppm > 14)
                arrow(ctx, X(seen[0]), Y(seen[1]) + size * 0.35, X(p[0]), Y(p[1]) + size * 0.35, rgba(col.quad, 0.9), 1.5, 7);
            if (lead && hypot(aim[0] - seen[0], aim[1] - seen[1]) * ppm > 14) {
                ctx.setLineDash([4, 4]);
                line(ctx, X(seen[0]), Y(seen[1]), X(aim[0]), Y(aim[1]), rgba(col.laser, 0.8), 1.5);
                ctx.setLineDash([]);
            }

            // the beam's footprint
            let wr = M.beam_radius(spec, R) * ppm;
            draw_beam_spot(ctx, X(aim[0]), Y(aim[1]), max(1.5, wr), col.laser, 0.65);
            ctx.restore();

            // labels
            halo_text(ctx, "seen " + round(L * 1000) + " ms ago", X(seen[0]), Y(seen[1]) - size * 0.55 - 6, "#5B6670", fs - 2, "center", "middle", 500, "rgba(230,238,246,0.85)");
            halo_text(ctx, "now", X(p[0]), Y(p[1]) + size * 0.55 + 10, col.quad, fs - 2, "center", "middle", 500, "rgba(230,238,246,0.85)");
            let pv = track_hist_at(st.hist, st.ts - 0.05);
            let speed = hypot(p[0] - pv[0], p[1] - pv[1]) / 0.05;
            halo_text(ctx, "slow motion, " + fmt_dist(R) + " away, quad at " + round(speed) + " m/s" + (st.drag || st.fly ? "" : "; drag or throw it"), 20, 20, col.text, fs - 2, "left", "middle", 400, "rgba(230,238,246,0.85)");
            line(ctx, 22, view_h - 8, 22 + ppm, view_h - 8, "#555", 2);
            text(ctx, "1 m", 22 + ppm / 2, view_h - 18, "#555", fs - 3);

            let ex = p[0] - aim[0], ey = p[1] - aim[1];
            let err_mrad = hypot(ex, ey) / R * 1e3;
            let on = M.signal(spec, QUAD, R, VIS, ex, ey) / M.signal(spec, QUAD, R, VIS);
            let y = view_h + fs * 1.8;
            text(ctx, "pointing error " + err_mrad.toFixed(2) + " mrad", w * 0.32, y, col.text, fs, "center", "middle", 500);
            text(ctx, "echo " + fmt_pct(clamp(on, 0, 1)) + " of a centered quad", w * 0.72, y, on > 0.5 ? "#B07800" : col.thr, fs, "center", "middle", 500);
        },
    };

    /* -------------------------- rate tradeoff ------------------------- */

    function approach_range(t) {
        let v = 20, R0 = 1500, Rmin = 400;
        let t_turn = (R0 - Rmin) / v;
        if (t < t_turn) return R0 - v * t;
        return Rmin + v * (t - t_turn);
    }

    SCENES.rate_tradeoff = {
        sliders: [{ anim: { period: 21 }, fmt: v => round(v) + " Hz", map: lin_map(1, 25), def: 5 }],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let f = round(d.v[0]);
            let tm = 1 / f;
            let total = 110;
            let plot = new Plot(ctx, 76, 16, w - 96, h - 16 - fs * 3.2, {
                xmin: 0, xmax: total, ymin: 0, ymax: 1600, fs: fs - 1,
                xfmt: v => v + " s", yfmt: v => fmt_int(v) + " m", xlabel: "time", ylabel: "distance",
            });
            plot.frame();
            plot.curve(approach_range, "rgba(0,0,0,0.12)", 1.5, null, 220);
            let rng = make_rng(17 + f * 101);
            let first = null;
            let r = clamp(4.5 - f / 7, 1.8, 4.5);
            let hits = [], misses = [];
            for (let k = 0; k * tm <= total; k++) {
                let tt = (k + 0.5) * tm;
                if (tt > total) break;
                let R = approach_range(tt);
                let snr = snr_at(QUAD, R, tm) * M.radial_motion_factor(spec, 20, tm);
                let pd = M.detection_probability(spec, snr);
                if (rng() < pd) {
                    if (first === null) first = [tt, R];
                    hits.push([plot.X(tt), plot.Y(R)]);
                } else {
                    misses.push([plot.X(tt), plot.Y(R)]);
                }
            }
            // misses: thin, light rings (they merge into a pale band at high
            // rates); hits drawn on top in solid color so they stand out
            // one path per kind, so overlapping translucent rings don't darken
            ctx.beginPath();
            for (let q of misses) {
                ctx.moveTo(q[0] + r * 0.7, q[1]);
                ctx.arc(q[0], q[1], r * 0.7, 0, 2 * pi);
            }
            ctx.strokeStyle = "rgba(150,150,150,0.5)";
            ctx.lineWidth = 0.75;
            ctx.stroke();
            ctx.beginPath();
            for (let q of hits) {
                ctx.moveTo(q[0] + r, q[1]);
                ctx.arc(q[0], q[1], r, 0, 2 * pi);
            }
            ctx.fillStyle = col.quad;
            ctx.fill();
            let lx = plot.x + 14, ly = plot.y + plot.h - fs * 2.2;
            circle(ctx, lx, ly, 4, col.quad);
            text(ctx, "found the quad", lx + 10, ly, col.quad, fs - 1, "left", "middle", 500);
            circle(ctx, lx, ly + fs * 1.3, 3.2, null, "rgba(150,150,150,0.8)", 1);
            text(ctx, "found nothing", lx + 10, ly + fs * 1.3, col.light_text, fs - 1, "left", "middle", 500);
            let msg = f + " measurements per second";
            if (first)
                msg += ",  first detection at " + fmt_range(first[1]) + " (after " + first[0].toFixed(1) + " s)";
            halo_text(ctx, msg, plot.x + plot.w - 6, plot.y + fs, col.text, fs - 1, "right", "middle", 500, "rgba(255,255,255,0.9)");
        },
    };

    /* --------------------------- two echoes --------------------------- */

    const TWO_R = 450;

    SCENES.two_echoes = {
        sliders: [
            // the aim slider comes first so it doesn't move when the trees slider hides
            { fmt: v => "aim off " + v.toFixed(2) + " mrad", map: lin_map(0, 1), def: 0.15 },
            { anim: { period: 18 }, fmt: v => "trees " + round(v) + " m behind", visible: d => d.seg[0] === 0, map: lin_map(0, 150), def: 60 },
        ],
        segs: [["Trees behind", "Sky behind"]],
        init(d) {
            let rng = make_rng(808);
            d.st.noise = new Float32Array(240);
            for (let i = 0; i < 240; i++) d.st.noise[i] = rng.normal();
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let off = d.v[0] * 1e-3, gap = d.v[1];
            let sky = d.seg[0] === 1;
            let Rq = TWO_R, Rb = TWO_R + gap;
            let top = h * 0.44;
            let wq = M.beam_radius(spec, Rq);      // half width of the footprint at the quad
            let offm = off * Rq;                   // how far the beam's axis passes from the quad

            // side view: the beam is evenly lit across, with soft edges; the
            // quad sits offm off the axis, to scale with the beam's width (the
            // distance along the beam is compressed)
            let isz = min(top - 12, w * 0.36);
            let sx1 = w - 20 - isz;
            round_rect(ctx, 10, 6, sx1 - 20, top - 12, 8, "#EEF3F8");
            ctx.save();
            ctx.beginPath();
            ctx.rect(10, 6, sx1 - 20, top - 12);
            ctx.clip();
            let x0 = 34, x1 = sx1 - 22;
            let Rend = TWO_R + 170;
            let X = r => x0 + (x1 - x0) * r / Rend;
            let cy = 6 + (top - 12) / 2;
            let Hend = (top - 12) / 2 / 2.4;
            let half = r => Hend * r / Rend;       // drawn half width
            let endR = sky ? Rend : Rb;
            // brightness on a perceptual (gamma 0.45) scale, so the dim, blurred
            // edges, which still carry light, stay visible
            let BG = 0.45, U = 1 + 4 * beam_edge_ratio();
            let cone = [[x0, cy], [X(endR), cy - U * half(endR)], [X(endR), cy + U * half(endR)]];
            if (ctx.createConicGradient) {
                // brightness depends only on the angle around the apex
                let g = ctx.createConicGradient(-pi, x0, cy);
                let dx = X(endR) - x0;
                for (let k = 0; k <= 46; k++) {
                    let u = -U + 2 * U * k / 46;
                    let ang = atan2(u * half(endR), dx);
                    g.addColorStop((ang + pi) / (2 * pi), rgba(col.laser, 0.6 * pow(beam_profile_1d(u), BG)));
                }
                fill_poly(ctx, cone, g);
            } else {
                let n = 40;
                for (let k = 0; k < n; k++) {
                    let u0 = -U + 2 * U * k / n, u1 = u0 + 2 * U / n, um = (u0 + u1) / 2;
                    fill_poly(ctx, [[x0, cy], [X(endR), cy + u0 * half(endR)], [X(endR), cy + u1 * half(endR) + 0.5]], rgba(col.laser, 0.6 * pow(beam_profile_1d(um), BG)));
                }
            }
            draw_lrf_side(ctx, x0, cy, 6);
            if (!sky)
                draw_tree_line(ctx, X(Rb), x1 + 30, top - 6, (top - 12) * 0.8, 5);
            let pxm = half(Rq) / wq;               // pixels per meter across the beam at the quad
            let qy = cy + offm * pxm;
            // drawn smaller than to scale; the inset shows the true size
            let qsize = max(22, 0.43 * pxm * 0.42);
            draw_quad_sprite(ctx, X(Rq), qy, qsize, "#2D3439", 0, 0);
            ctx.restore();
            if (!sky)
                dimension(ctx, X(Rq), top - 14, X(Rb), top - 14, col.bg, gap.toFixed(0) + " m", fs - 2, -1);
            let Fnow = M.fraction_on_target(spec, QUAD, Rq, 0, offm);
            let rel = Fnow / M.fraction_on_target(spec, QUAD, Rq);
            let where = Fnow < 0.001 ? "outside the beam" : rel > 0.95 ? "inside the footprint" : "on the footprint's edge";
            let off_label = offm < 0.005 ? (w < 500 ? "on axis" : "beam aimed at the quad") :
                round(offm * 100) + " cm off axis, " + where;
            font(ctx, fs - 2, 500);
            let tw = ctx.measureText(off_label).width;
            halo_text(ctx, off_label, clamp(X(Rq), 14 + tw / 2, sx1 - 14 - tw / 2), max(18, qy - qsize * 0.6 - 10), col.text, fs - 2, "center", "middle", 500);
            text(ctx, "distance compressed", sx1 - 16, 16, col.light_text, fs - 3, "right");

            // looking down the beam at the quad's distance: the quad is lit by
            // the light that actually falls on each part of it
            let ix = sx1, iy = 6;
            round_rect(ctx, ix, iy, isz, isz, 8, "#1E2228");
            ctx.save();
            ctx.beginPath();
            ctx.rect(ix, iy, isz, isz);
            ctx.clip();
            let pc = isz / (3.6 * wq);
            let ccx = ix + isz / 2, ccy = iy + isz / 2;
            draw_beam_spot(ctx, ccx, ccy, wq * pc, "#FF5A4E", 0.55, 0.45);
            let cell = 2.5 / pc;                   // ~2.5 px cells, in meters
            for (let r of QUAD.shapes) {
                let fill = r.fill === undefined ? 1 : r.fill;
                for (let mx = r.x0; mx < r.x1; mx += cell) {
                    for (let my = r.y0; my < r.y1; my += cell) {
                        let cx2 = min(mx + cell, r.x1), cy2 = min(my + cell, r.y1);
                        let ux = (mx + cx2) / 2, uy = (my + cy2) / 2 - offm;
                        let I = beam_profile_1d(ux / wq) * beam_profile_1d(uy / wq);
                        ctx.globalAlpha = fill < 1 ? 0.35 : 1;
                        ctx.fillStyle = mix("#3A3F45", "#FFE08A", pow(I, 0.45));
                        ctx.fillRect(ccx + mx * pc, ccy + (offm - cy2) * pc, (cx2 - mx) * pc + 0.4, (cy2 - my) * pc + 0.4);
                    }
                }
            }
            ctx.globalAlpha = 1;
            ctx.restore();
            text(ctx, "looking down the beam", ix + isz / 2, iy + 14, "rgba(255,255,255,0.75)", fs - 3);

            // echoes, using a receiver response sized to the module's discrimination distance
            let s_disp = spec.discrimination_m / 3.5;
            let shape = x => exp(-x * x / (2 * s_disp * s_disp));
            let Fq = M.fraction_on_target(spec, QUAD, Rq, 0, offm);
            let snr_q = snr_at(QUAD, Rq, 0.1, VIS, 0, offm);
            let snr_b = 0;
            if (!sky) {
                let Tb = M.transmission(spec, Rb, VIS);
                let Sb = 0.25 * (1 - Fq) * Tb * Tb / (Rb * Rb);
                snr_b = M.snr(spec, Sb, 0.1);
            }
            let xmin = TWO_R - 40, xmax = TWO_R + 200;
            let vals = [];
            let ymax = 0;
            for (let b = 0; b < 240; b++) {
                let x = xmin + b + 0.5;
                let v = snr_q * shape(x - Rq) + snr_b * shape(x - Rb) + d.st.noise[b];
                vals.push(v);
                ymax = max(ymax, v);
            }
            let plot = new Plot(ctx, 44, top + 14, w - 60, h - top - 14 - fs * 4.6, {
                xmin, xmax, ymin: -3, ymax: max(10, ymax * 1.1), fs: fs - 1, no_yticks: true, xfmt: v => v + " m",
            });
            plot.frame();
            plot.clip();
            let bw = plot.w / 240;
            for (let b = 0; b < 240; b++) {
                let x = xmin + b + 0.5;
                let qpart = snr_q * shape(x - Rq), bpart = snr_b * shape(x - Rb);
                let c = qpart > bpart ? (qpart > 0.5 ? col.quad : col.hist) : (bpart > 0.5 ? col.bg : col.hist);
                let y0 = plot.Y(0), y1 = plot.Y(vals[b]);
                ctx.fillStyle = rgba(c, 0.85);
                ctx.fillRect(plot.x + b * bw, min(y0, y1), max(0.8, bw - 0.2), abs(y1 - y0));
            }
            plot.hline(spec.threshold_sigma, col.thr, 1.5, [5, 4]);
            plot.unclip();

            // what gets reported: local maxima above threshold, merged within the discrimination distance
            let peaks = [];
            for (let b = 1; b < 239; b++) {
                if (vals[b] > spec.threshold_sigma && vals[b] >= vals[b - 1] && vals[b] >= vals[b + 1])
                    peaks.push([echo_center(vals, b, i => xmin + i + 0.5, max(1, round(s_disp))), vals[b]]);
            }
            let merged = [];
            for (let p of peaks) {
                let last = merged[merged.length - 1];
                if (last && p[0] - last[0] < spec.discrimination_m) {
                    if (p[1] > last[1]) merged[merged.length - 1] = p;
                } else merged.push(p);
            }
            merged = merged.slice(0, 5);
            for (let p of merged)
                arrow(ctx, plot.X(p[0]), plot.Y(min(p[1], plot.o.ymax)) - 18, plot.X(p[0]), plot.Y(min(p[1], plot.o.ymax)) - 4, col.text, 1.5, 6);
            let rep = merged.length ? "reported: " + merged.map(p => fmt_reported(p[0])).join(", ") : "reported: nothing";
            text(ctx, rep, w / 2, plot.y + plot.h + fs * 2.6, col.text, fs, "center", "middle", 500);
            text(ctx, "quad catches " + fmt_pct(Fq) + " of the beam", w / 2, plot.y + plot.h + fs * 3.9, col.quad, fs - 1);
        },
    };
