
    /* ================================================================== */
    /* Scenes: introduction, time of flight, beam                         */
    /* ================================================================== */

    /* ---------------------------- hero -------------------------------- */

    // Distances in the hero scene are compressed: one scene meter stands for 55 m.
    const HERO_SCALE = 55;

    function hero_drone_pos(t) {
        let d = 8.5 + 3.2 * sin(0.21 * t);
        let a = 0.42 * sin(0.13 * t + 0.6);
        let z = 2.4 + 0.8 * sin(0.37 * t);
        return [-sin(a) * d, cos(a) * d, z];
    }

    SCENES.hero = {
        animated: true,
        orbit: true,
        init(d) {
            d.st.yaw = -1.12;
            d.st.pitch = 0.2;
            d.st.pan = 0;
            d.st.tilt = 0.2;
            d.st.meas_t = 0;
            d.st.meas_k = 0;
            d.st.last = undefined;
            d.st.noise = null;
            d.st.trees = [];
            let rng = make_rng(3);
            for (let i = 0; i < 26; i++) {
                let a = -1.5 + 3.0 * rng();
                let r = 22 + 10 * rng();
                d.st.trees.push([-sin(a) * r, cos(a) * r, 0, 2.5 + 2 * rng()]);
            }
        },
        draw(ctx, d, w, h, dt) {
            let st = d.st;
            let t = d.t + 4;
            let fs = base_font_size(w);
            let h3 = round(h * 0.72);

            let drone = hero_drone_pos(t);
            let S = 6;

            // turret tracking with a little lag
            let pivot = [0, 0, 0.19 * S];
            let dv = v3_sub(drone, pivot);
            let want_pan = atan2(-dv[0], dv[1]);
            let want_tilt = atan2(dv[2], hypot(dv[0], dv[1]));
            let k = 1 - exp(-dt * 6);
            if (dt === 0) k = 1;
            st.pan += (want_pan - st.pan) * k;
            st.tilt += (want_tilt - st.tilt) * k;

            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, w, h3);
            ctx.clip();
            let camera = new Camera3D(w, h3, st.yaw, st.pitch, 8.8, [0.6, 3.2, 1.25], 0.8);
            let horizon = camera.project(v3_add(camera.eye, v3_scale([camera.fwd[0], camera.fwd[1], 0], 1e4)));
            draw_sky(ctx, w, h3, horizon ? horizon[1] : h3);
            draw_ground(ctx, camera, 34, 2);

            let sc = new Scene3D();
            for (let tr of st.trees)
                build_tree(sc, [tr[0], tr[1], 0], tr[3]);
            let tur = build_turret(sc, st.pan, st.tilt, { scale: S });
            build_quad3d(sc, drone, 0.7 * t, 3.5, t);

            // beam: thin wedge facing the viewer, divergence exaggerated
            let o = tur.lrf_origin;
            let dist = v3_len(v3_sub(drone, o));
            let end = v3_add(o, v3_scale(tur.fwd, dist * 1.05));
            let side = v3_norm(v3_cross(tur.fwd, v3_sub(camera.eye, o)));
            let w0 = 0.02, w1 = 0.1 + dist * 0.012;
            sc.face([v3_add(o, v3_scale(side, w0)), v3_add(end, v3_scale(side, w1)), v3_add(end, v3_scale(side, -w1)), v3_add(o, v3_scale(side, -w0))],
                col.laser, 0.2, true, true);
            sc.line(o, end, col.laser, 1.2, 0.8);
            sc.render(ctx, camera);
            ctx.restore();
            halo_text(ctx, "not to scale", 12, h3 - 12, col.light_text, fs - 3, "left", "middle", 400, "rgba(230,235,220,0.8)");

            // camera inset
            let iw = round(w * 0.34), ih = round(iw * 9 / 16);
            let ix = w - iw - 10, iy = 10;
            ctx.save();
            round_rect(ctx, ix - 2, iy - 2, iw + 4, ih + 4, 6, "rgba(255,255,255,0.9)");
            ctx.beginPath();
            ctx.rect(ix, iy, iw, ih);
            ctx.clip();
            let f_in = iw / 2 / tan(12 * pi / 180);
            let rel = v3_sub(drone, tur.cam_origin);
            let cz = v3_dot(rel, tur.fwd);
            let cx = ix + iw / 2 + f_in * v3_dot(rel, tur.right) / cz;
            let cy = iy + ih / 2 - f_in * v3_dot(rel, tur.up) / cz;
            let hz_y = iy + ih / 2 + f_in * tan(st.tilt);
            let g = ctx.createLinearGradient(0, iy, 0, max(iy + 1, hz_y));
            g.addColorStop(0, col.sky_top);
            g.addColorStop(1, col.sky_bottom);
            ctx.fillStyle = g;
            ctx.fillRect(ix, iy, iw, ih);
            if (hz_y < iy + ih) {
                draw_tree_line(ctx, ix - 10, ix + iw + 10, hz_y + 2, max(3, f_in * 0.06), 11);
                ctx.fillStyle = "#D9DFC9";
                ctx.fillRect(ix, hz_y + 1, iw, iy + ih - hz_y);
            }
            let size_px = f_in * 0.43 * 3.5 / cz;
            draw_quad_sprite(ctx, cx, cy, size_px, "#2D3439", t, 0.08 * sin(t));
            let bs = max(10, size_px * 0.7);
            ctx.strokeStyle = col.cam;
            ctx.lineWidth = 1.5;
            for (let sx of [-1, 1]) for (let sy of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(cx + sx * bs, cy + sy * bs * 0.7 - sy * 6);
                ctx.lineTo(cx + sx * bs, cy + sy * bs * 0.7);
                ctx.lineTo(cx + sx * bs - sx * 6, cy + sy * bs * 0.7);
                ctx.stroke();
            }
            let bx = ix + iw / 2 + 3, by = iy + ih / 2 + 1;
            draw_beam_spot(ctx, bx, by, 4.5, col.laser, 0.9);
            line(ctx, bx - 11, by, bx - 7, by, col.laser, 1.5);
            line(ctx, bx + 7, by, bx + 11, by, col.laser, 1.5);
            ctx.restore();
            halo_text(ctx, "camera", ix + 8, iy + ih - 10, col.cam, fs - 2, "left");

            // echo histogram of the current measurement (10 Hz, 5 m display bins)
            let real_R = dist * HERO_SCALE;
            let tm = 0.1;
            let nb = 300, bin = 5;
            st.meas_t += dt;
            if (st.meas_t >= tm || !st.noise) {
                if (st.noise) {
                    let peak = -1e9, pb = 0;
                    let vals = [];
                    for (let b = 0; b < nb; b++) {
                        let v = st.noise[b] + st.sig[b];
                        vals.push(v);
                        if (v > peak) { peak = v; pb = b; }
                    }
                    // the module refines the peak position far below the bin size
                    st.last = peak > spec.threshold_sigma ? st.true_R + st.jitter : null;
                }
                st.meas_t = st.noise ? st.meas_t % tm : 0;
                st.meas_k++;
                let rng = make_rng(1000 + st.meas_k);
                st.noise = new Float32Array(nb);
                st.sig = new Float32Array(nb);
                for (let b = 0; b < nb; b++)
                    st.noise[b] = rng.normal();
                let snr = snr_at(QUAD, real_R, tm);
                let rb = floor(real_R / bin);
                if (rb >= 0 && rb < nb) st.sig[rb] = snr;
                st.snr = snr;
                st.true_R = real_R;
                st.jitter = rng.normal() * M.echo_sigma(spec) / max(1, snr);
            }
            let p = clamp(st.meas_t / tm, 0.02, 1);

            let px0 = 8, pw = w - 16, py0 = h3 + 6, ph = h - h3 - 12;
            let left = 100;
            let plot = new Plot(ctx, left, py0 + 8, pw - left, ph - fs * 1.9, {
                xmin: 0, xmax: 1500, ymin: -3, ymax: max(10, st.snr * 1.15), no_yticks: true, fs: fs - 2,
                xticks: [0, 250, 500, 750, 1000, 1250, 1500], xfmt: v => v === 0 ? "0" : v + " m",
            });
            plot.frame();
            plot.clip();
            let bw = plot.w / nb;
            for (let b = 0; b < nb; b++) {
                let v = p * st.sig[b] + sqrt(p) * st.noise[b];
                let y0 = plot.Y(0), y1 = plot.Y(v);
                ctx.fillStyle = st.sig[b] > 0 ? rgba(col.echo, 1) : rgba(col.hist, 0.75);
                ctx.fillRect(plot.x + b * bw, min(y0, y1), max(1.5, bw - 0.3), abs(y1 - y0));
            }
            plot.hline(spec.threshold_sigma * sqrt(p), col.thr, 1.2, [4, 3]);
            plot.unclip();
            if (w > 500) {
                text(ctx, "echoes,", left - 10, plot.y + fs * 0.6, col.text, fs - 2, "right");
                text(ctx, "this", left - 10, plot.y + fs * 1.7, col.text, fs - 2, "right");
                text(ctx, "measurement", left - 10, plot.y + fs * 2.8, col.text, fs - 2, "right");
            } else {
                text(ctx, "echoes", left - 10, plot.y + fs * 0.6, col.text, fs - 2, "right");
            }

            let msg = st.last === null ? "no echo above the threshold" : st.last === undefined ? "" : "measured: " + fmt_reported(st.last);
            halo_text(ctx, msg, plot.x + plot.w - 6, plot.y + fs * 0.7, st.last === null ? col.light_text : col.text, fs - 1, "right", "middle", 500, "rgba(255,255,255,0.95)");
            halo_text(ctx, "drone at " + fmt_int(real_R) + " m", plot.x + 6, plot.y + fs * 0.7, col.quad, fs - 1, "left", "middle", 500, "rgba(255,255,255,0.95)");
        },
    };

    /* ------------------------- time of flight ------------------------- */

    SCENES.tof_basic = {
        sliders: [
            { anim: { mode: "loop", period: 6, hold: 1.2 }, fmt: v => "t = " + fmt_time(v), map: lin_map(0, 2.2e-6), def: 0.75e-6 },
            { fmt: v => "R = " + round(v) + " m", map: lin_map(20, 300), def: 180 },
        ],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let t = d.v[0], R = d.v[1];
            let C = M.C;
            let sx0 = 70, sx1 = w - 30;
            let X = r => sx0 + (sx1 - sx0) * r / 300;
            let gy = h * 0.5;
            let by = gy - h * 0.16;

            // ground
            ctx.fillStyle = "#E9ECE3";
            ctx.fillRect(0, gy, w, h * 0.02);
            line(ctx, 0, gy, w, gy, "#C9CFBE", 1);

            // distance scale
            for (let r = 0; r <= 300; r += 50) {
                let x = X(r);
                line(ctx, x, gy + 2, x, gy + 7, col.axis, 1);
                text(ctx, r + " m", x, gy + 7 + fs * 0.7, col.light_text, fs - 3);
            }

            // wall
            let wx = X(R);
            ctx.fillStyle = col.bg;
            ctx.fillRect(wx, by - h * 0.22, 10, gy - (by - h * 0.22));
            dimension(ctx, X(0), by - h * 0.27, wx, by - h * 0.27, col.range, "R = " + round(R) + " m", fs - 1);

            draw_lrf_side(ctx, sx0, by, 10);

            // pulse
            let x_light = C * t;
            let te = 2 * R / C;
            let plen = 18;
            if (x_light < R) {
                let px = X(x_light);
                line(ctx, X(0), by, px, by, rgba(col.laser, 0.18), 2);
                let g = ctx.createLinearGradient(px - plen, 0, px, 0);
                g.addColorStop(0, rgba(col.laser, 0));
                g.addColorStop(1, rgba(col.laser, 1));
                ctx.fillStyle = g;
                ctx.fillRect(px - plen, by - 3, plen, 6);
            } else if (t < te) {
                let px = X(2 * R - x_light);
                line(ctx, X(0), by, wx, by, rgba(col.laser, 0.18), 2);
                let g = ctx.createLinearGradient(px, 0, px + plen, 0);
                g.addColorStop(0, rgba(col.echo, 1));
                g.addColorStop(1, rgba(col.echo, 0));
                ctx.fillStyle = g;
                ctx.fillRect(px, by - 3, plen, 6);
            } else {
                line(ctx, X(0), by, wx, by, rgba(col.laser, 0.18), 2);
            }

            // detector plot
            let plot = new Plot(ctx, 60, gy + h * 0.13, w - 90, h * 0.27, {
                xmin: 0, xmax: 2.2e-6, ymin: -0.1, ymax: 1.2, fs: fs - 1, no_yticks: true,
                xticks: [0, 0.5e-6, 1e-6, 1.5e-6, 2e-6], xfmt: v => v === 0 ? "0" : (v * 1e6).toFixed(1) + " µs",
            });
            plot.frame();
            let sigma = 12e-9;
            let wave = tt => {
                let a = 0.35 * exp(-tt * tt / (2 * (8e-9) ** 2));
                let e = 0.85 * exp(-(tt - te) * (tt - te) / (2 * sigma * sigma));
                return a + e;
            };
            plot.clip();
            let pts = [];
            let n = 600;
            for (let i = 0; i <= n; i++) {
                let tt = 2.2e-6 * i / n;
                if (tt > t) break;
                pts.push([plot.X(tt), plot.Y(wave(tt))]);
            }
            poly(ctx, pts, col.echo, 2);
            plot.vline(t, col.time, 1.5);
            plot.unclip();
            ctx.save();
            ctx.translate(30, plot.y + plot.h / 2);
            ctx.rotate(-pi / 2);
            text(ctx, "detector", 0, 0, col.text, fs - 1);
            ctx.restore();

            let label = "t = " + fmt_time(t);
            halo_text(ctx, label, clamp(plot.X(t), plot.x + 40, plot.x + plot.w - 40), plot.y - fs * 0.8, col.time, fs, "center", "middle", 500);
            if (t >= te) {
                plot.dot(te, wave(te), col.echo, 4);
                halo_text(ctx, "echo after " + fmt_time(te), plot.X(te), plot.Y(wave(te)) - fs, col.echo, fs - 1, "center", "middle", 500);
            }
        },
    };

    /* --------------------------- beam cone ---------------------------- */

    function quad_target_draw(ctx, cx, cy, ppm) {
        draw_quad_sprite(ctx, cx, cy, 0.43 * ppm, "#2D3439", 0, 0);
    }

    SCENES.beam_cone = {
        sliders: [{ anim: { period: 15 }, fmt: v => "R = " + fmt_dist(v), map: log_map(10, 5000), def: 500 }],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0];
            let top = h * 0.36;

            // side view, exaggerated vertically: 0 to 5 km horizontally
            let x0 = 46, x1 = w - 20;
            let cy = top * 0.5 + 4;
            let X = r => x0 + (x1 - x0) * r / 5000;
            let ex = 22;   // vertical exaggeration in pixels per meter of footprint
            let half = r => 0.5 * M.beam_diameter(spec, r) * ex * (top * 0.42) / (0.5 * M.beam_diameter(spec, 5000) * ex);
            let pts_top = [], pts_bot = [];
            for (let i = 0; i <= 40; i++) {
                let r = 5000 * i / 40;
                pts_top.push([X(r), cy - half(r)]);
                pts_bot.push([X(r), cy + half(r)]);
            }
            let g = ctx.createLinearGradient(x0, 0, x1, 0);
            g.addColorStop(0, rgba(col.laser, 0.55));
            g.addColorStop(1, rgba(col.laser, 0.12));
            fill_poly(ctx, pts_top.concat(pts_bot.slice().reverse()), g);
            draw_lrf_side(ctx, x0, cy, 7);
            let xr = X(R);
            line(ctx, xr, cy - half(R) - 6, xr, cy + half(R) + 6, col.range, 2);
            let D0 = M.beam_diameter(spec, R);
            // fixed position: next to the marker it would collide with the panels at long range
            halo_text(ctx, "footprint " + fmt_len(D0) + " at " + fmt_dist(R), 10, 10, col.range, fs, "left", "middle", 500);
            for (let r = 1000; r <= 5000; r += 1000)
                text(ctx, (r / 1000) + " km", X(r), top - 4, col.light_text, fs - 3);
            text(ctx, "vertical scale exaggerated", x1, 10, col.light_text, fs - 3, "right");

            // footprint over each target, to scale
            let D = M.beam_diameter(spec, R);
            let wr = M.beam_radius(spec, R);
            let view = max(2.9, D * 1.25);
            let panels = [
                { name: "10\" quad", color: col.quad, draw: (cx, cy2, ppm) => quad_target_draw(ctx, cx, cy2, ppm) },
                { name: "Shahed-136", color: col.shahed, draw: (cx, cy2, ppm) => draw_shahed_front(ctx, cx, cy2, 2.5 * ppm, "#6B6F73") },
                { name: "0.75 m square", color: col.ds, draw: (cx, cy2, ppm) => { ctx.fillStyle = "#9A9A9A"; ctx.fillRect(cx - 0.375 * ppm, cy2 - 0.375 * ppm, 0.75 * ppm, 0.75 * ppm); } },
                { name: "2.3 m square", color: col.ds, draw: (cx, cy2, ppm) => { ctx.fillStyle = "#9A9A9A"; ctx.fillRect(cx - 1.15 * ppm, cy2 - 1.15 * ppm, 2.3 * ppm, 2.3 * ppm); } },
            ];
            let n = panels.length;
            let gap = 8;
            let pw = (w - 20 - gap * (n - 1)) / n;
            let ph = h - top - fs * 3.2;
            let ppm = min(pw, ph) / view;
            for (let i = 0; i < n; i++) {
                let px = 10 + i * (pw + gap), py = top + fs * 0.6;
                round_rect(ctx, px, py, pw, ph, 6, "#EEF3F8");
                ctx.save();
                ctx.beginPath();
                ctx.rect(px, py, pw, ph);
                ctx.clip();
                let cx = px + pw / 2, cy2 = py + ph / 2;
                panels[i].draw(cx, cy2, ppm);
                draw_beam_spot(ctx, cx, cy2, max(0.6, wr * ppm), col.laser, 0.8);
                ctx.restore();
                text(ctx, panels[i].name, px + pw / 2, py + ph + fs * 0.9, panels[i].color, fs - 1, "center", "middle", 500);
            }
            // scale bar
            let bar = view > 6 ? 2 : 1;
            let bx = 14, byy = top + fs * 0.6 + ph - 10;
            line(ctx, bx, byy, bx + bar * ppm, byy, "#555", 2);
            text(ctx, bar + " m", bx + bar * ppm / 2, byy - 8, "#555", fs - 3);
        },
    };

    /* -------------------------- beam profile -------------------------- */

    SCENES.beam_profile = {
        sliders: [{ anim: { period: 12, lo: 0.1, hi: 0.9 }, fmt: v => "square " + v.toFixed(2) + "×", map: lin_map(0, 2), def: 1 }],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let rr = d.v[0];
            let sq = min(h - 20, w * 0.42);
            let cx = 10 + sq / 2, cy = h / 2;
            round_rect(ctx, cx - sq / 2, cy - sq / 2, sq, sq, 6, "#1E2228");
            let hpx = sq / 4.4;
            draw_beam_spot(ctx, cx, cy, hpx, "#FF5A4E", 1);
            if (rr > 0)
                beam_outline(ctx, cx, cy, rr * hpx, col.range, 2.5);
            // a kilometer out, where the footprint's size is all divergence
            let R = 1000, hw = M.beam_radius(spec, R);
            let frac = M.fraction_square(spec, R, 2 * rr * hw);
            halo_text(ctx, fmt_pct(frac) + " of the power", cx, cy + sq / 2 - fs, "#fff", fs, "center", "middle", 500, "rgba(30,34,40,0.8)");

            // profile plot
            let px = cx + sq / 2 + 58, pw = w - px - 12;
            let plot = new Plot(ctx, px, 14, pw, h - 14 - fs * 3, {
                xmin: -2, xmax: 2, ymin: 0, ymax: 1.08, fs: fs - 1,
                xticks: [-1, 0, 1], xfmt: v => v === 0 ? "center" : "edge",
                yticks: [0, 0.5, 1], yfmt: v => round(v * 100) + "%",
                xlabel: "distance from the beam's axis",
            });
            plot.frame();
            plot.clip();
            // shaded area inside the square
            let pts = [[plot.X(-rr), plot.Y(0)]];
            for (let i = 0; i <= 80; i++) {
                let x = -rr + 2 * rr * i / 80;
                pts.push([plot.X(x), plot.Y(beam_profile_1d(x))]);
            }
            pts.push([plot.X(rr), plot.Y(0)]);
            if (rr > 0)
                fill_poly(ctx, pts, rgba(col.range, 0.18));
            plot.hline(0.5, col.axis, 1, [4, 4]);
            plot.curve(beam_profile_1d, col.laser, 2.5, null, 200);
            plot.vline(-rr, col.range, 1.5);
            plot.vline(rr, col.range, 1.5);
            plot.unclip();
            halo_text(ctx, "edge: half as bright", plot.X(-2) + 6, plot.Y(0.5) - fs * 0.7, col.light_text, fs - 2, "left", "middle", 400);
        },
    };

    /* --------------------------- beam fill ---------------------------- */

    const FILL_TARGETS = [T.quad10_side, T.quad10_below, T.shahed_front, T.shahed_below];

    SCENES.beam_fill = {
        sliders: [{ anim: { period: 21 }, fmt: v => "R = " + fmt_dist(v), map: log_map(10, 10000), def: 300 }],
        segs: [["Quad, side", "Quad, below", "Shahed, head on", "Shahed, below"]],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0];
            let target = FILL_TARGETS[d.seg[0]];
            let color = d.seg[0] < 2 ? col.quad : col.shahed;
            let top = h * 0.5;

            // view along the beam
            let wr = M.beam_radius(spec, R);
            let view = max(target.size_m * 1.35, 4.6 * wr);
            let ppm = min(w - 20, top - 10) / view;
            let cx = w / 2, cy = top / 2 + 2;
            round_rect(ctx, 10, 2, w - 20, top - 4, 8, "#E8F0F8");
            ctx.save();
            ctx.beginPath();
            ctx.rect(10, 2, w - 20, top - 4);
            ctx.clip();
            if (target === T.shahed_below) {
                // planform: model rectangles plus the outline for reference
                draw_silhouette(ctx, target, cx, cy, ppm, "#7A7F84");
            } else {
                draw_silhouette(ctx, target, cx, cy, ppm, d.seg[0] < 2 ? "#2F363B" : "#7A7F84");
            }
            draw_beam_spot(ctx, cx, cy, max(0.8, wr * ppm), col.laser, 0.75);
            ctx.restore();

            let F = M.fraction_on_target(spec, target, R);
            halo_text(ctx, "on target: " + fmt_pct(F), w - 22, 22, color, fs + 1, "right", "middle", 500, "rgba(232,240,248,0.9)");
            halo_text(ctx, "footprint " + fmt_len(2 * wr), w - 22, 22 + fs * 1.4, col.laser, fs - 1, "right", "middle", 400, "rgba(232,240,248,0.9)");
            halo_text(ctx, fmt_dist(R) + " away", 22, 22, col.range, fs, "left", "middle", 500, "rgba(232,240,248,0.9)");
            // scale bar
            let bars = [0.05, 0.1, 0.2, 0.5, 1, 2];
            let bar = bars[0];
            for (let b of bars) if (b * ppm < (w - 20) * 0.22) bar = b;
            line(ctx, 22, top - 16, 22 + bar * ppm, top - 16, "#555", 2);
            text(ctx, fmt_len(bar), 22 + bar * ppm / 2, top - 26, "#555", fs - 2);

            // fraction vs range
            let plot = new Plot(ctx, 84, top + 18, w - 104, h - top - 18 - fs * 3.2, {
                xmin: 10, xmax: 10000, xlog: true, ymin: 1e-4, ymax: 1.5, ylog: true, fs: fs - 1,
                xfmt: log_fmt_m, yfmt: v => v >= 0.01 ? round(v * 100) + "%" : (v * 100) + "%",
                xlabel: "distance", ylabel: "on target",
            });
            plot.frame();
            plot.curve(r => M.fraction_on_target(spec, target, r), color, 2.5);
            plot.dot(R, F, color, 5);
            // slope guides
            // dashed guides parallel to the curve, below it, with labels
            let guide = (r0, r1, slope, label) => {
                let f0 = M.fraction_on_target(spec, target, r0) / 3.5;
                let f1 = f0 * pow(r1 / r0, slope);
                plot.clip();
                line(ctx, plot.X(r0), plot.Y(f0), plot.X(r1), plot.Y(f1), col.axis, 1.2, [4, 4]);
                plot.unclip();
                text(ctx, label, plot.X(sqrt(r0 * r1)) - 4, plot.Y(sqrt(f0 * f1)) + fs * 0.9, col.light_text, fs - 2, "right");
            };
            if (d.seg[0] < 2) guide(1200, 6000, -2, "slope −2");
            else if (d.seg[0] === 2) { guide(700, 2500, -1, "slope −1"); guide(5500, 10000, -2, "−2"); }
            else guide(5000, 10000, -2, "slope −2");
        },
    };

    /* ------------------------- scatter back --------------------------- */

    SCENES.scatter_back = {
        sliders: [
            { anim: { period: 18 }, fmt: v => "R = " + fmt_dist(v), map: log_map(10, 5000), def: 1000 },
            { fmt: v => "tilt " + round(v) + "°", map: lin_map(-60, 60), def: 20 },
        ],
        segs: [["Matte", "Mirror", "Retroreflector"]],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0], tilt = d.v[1] * pi / 180;
            let mode = d.seg[0];
            let ly = h * 0.47;
            let rx = 40;
            let ax0 = rx + 46, ax1 = w - 64;
            let X = r => ax0 + (ax1 - ax0) * log(r / 10) / log(500);
            let px = X(R), py = ly;
            let axis_y = h - fs * 2.4;

            // distance axis (log scale), so the drone's surface visibly moves away
            line(ctx, rx, axis_y, ax1 + 12, axis_y, col.axis, 1);
            for (let r of [10, 30, 100, 300, 1000, 3000]) {
                line(ctx, X(r), axis_y, X(r), axis_y + 5, col.axis, 1);
                text(ctx, r >= 1000 ? (r / 1000) + " km" : r + " m", X(r), axis_y + fs * 0.9, col.light_text, fs - 3);
            }
            line(ctx, px, axis_y - 6, px, axis_y + 6, col.range, 2.5);
            text(ctx, "distance (log scale)", rx, axis_y - fs * 0.8, col.light_text, fs - 3, "left");
            halo_text(ctx, "R = " + fmt_dist(R), clamp(px, ax0 + 30, ax1 - 10), axis_y - fs * 0.9, col.range, fs, "center", "middle", 500);

            // the hemisphere the scattered light spreads over, passing through the receiver
            let nrm = pi + tilt;
            if (mode === 0) {
                let rad = px - rx;
                ctx.save();
                ctx.beginPath();
                ctx.rect(0, 0, w, axis_y - 8);
                ctx.clip();
                ctx.setLineDash([5, 5]);
                ctx.strokeStyle = rgba(col.echo, 0.75);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(px, py, rad, nrm - pi / 2, nrm + pi / 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
                let top_y = py - rad;
                let lab_y = max(fs, top_y + fs * 0.9);
                halo_text(ctx, "scattered light spreads over a hemisphere of area 2πR²", clamp(px - rad * 0.55, w * 0.32, w * 0.68), lab_y, "#B07800", fs - 2, "center", "middle", 500);
            }

            // receiver, with its lens highlighted
            draw_lrf_side(ctx, rx, ly, 10);
            line(ctx, rx + 2, ly - 1, rx + 2, ly + 9, col.echo, 3);
            text(ctx, "receiver", rx - 14, ly + 26, col.text, fs - 2, "left");

            // incoming beam
            arrow(ctx, rx + 14, ly - 3, px - 8, py - 3, rgba(col.laser, 0.9), 2.5, 10);

            // surface patch; its normal points left, rotated by the tilt
            let nx = -cos(tilt), ny = -sin(tilt);
            let tx = -ny, ty = nx;
            let L = min(h * 0.3, 90);
            ctx.save();
            ctx.translate(px, py);
            ctx.lineWidth = 6;
            ctx.strokeStyle = "#5C6670";
            ctx.beginPath();
            ctx.moveTo(-tx * L * 0.5, -ty * L * 0.5);
            ctx.lineTo(tx * L * 0.5, ty * L * 0.5);
            ctx.stroke();
            for (let i = -4; i <= 4; i++) {
                let ox = tx * L * 0.12 * i, oy = ty * L * 0.12 * i;
                line(ctx, ox - nx * 2, oy - ny * 2, ox - nx * 10 + tx * 6, oy - ny * 10 + ty * 6, "#9AA3AB", 1);
            }
            ctx.restore();
            text(ctx, "drone's surface", px + 12, py + L * 0.62, "#5C6670", fs - 2, "left");

            let lobe = min(h * 0.3, (px - rx) * 0.8);
            let frac_text;
            if (mode === 0) {
                for (let i = -8; i <= 8; i++) {
                    let a = i / 8 * (pi / 2 - 0.08);
                    let c = cos(a);
                    let dx = nx * cos(a) - ny * sin(a), dy = nx * sin(a) + ny * cos(a);
                    arrow(ctx, px + dx * 4, py + dy * 4, px + dx * (4 + lobe * c), py + dy * (4 + lobe * c), rgba(col.echo, 0.75), 1.8, 7);
                }
                // the sliver that reaches the receiver's lens
                fill_poly(ctx, [[px - 6, py], [rx + 3, ly - 1], [rx + 3, ly + 9]], rgba(col.echo, 0.35));
                let f = 3.14e-4 * max(0, cos(tilt)) / (pi * R * R);
                frac_text = "fraction reaching the receiver: 1 in " + fmt_sci(1 / f);
            } else if (mode === 1) {
                let dot = nx;
                let rxv = 1 - 2 * dot * nx, ryv = -2 * dot * ny;
                arrow(ctx, px + rxv * 4, py + ryv * 4, px + rxv * lobe * 1.4, py + ryv * lobe * 1.4, rgba(col.echo, 0.95), 3, 12);
                let back = abs(tilt) < 0.4 * pi / 180;
                frac_text = back ? "the reflection points straight back: a strong glint" : "the reflection misses the receiver entirely";
            } else {
                arrow(ctx, px - 6, py + 4, rx + 16, ly + 4, rgba(col.echo, 0.95), 3, 12);
                frac_text = "light returns toward the source in a narrow cone";
            }
            halo_text(ctx, frac_text, w / 2, fs * 0.9 + (mode === 0 ? fs * 1.4 : 0), col.text, fs, "center", "middle", 500);
        },
    };

    /* ------------------------ power vs range -------------------------- */

    SCENES.power_vs_range = {
        sliders: [{ anim: { period: 18 }, fmt: v => "R = " + fmt_dist(v), map: log_map(10, 10000), def: 1000 }],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0];
            let right = min(170, w * 0.3);
            let plot = new Plot(ctx, 74, 16, w - 74 - right - 10, h - 16 - fs * 3.2, {
                xmin: 10, xmax: 10000, xlog: true, ymin: 1e-14, ymax: 1e-2, ylog: true, fs: fs - 1,
                xfmt: log_fmt_m, yfmt: pow10_fmt, xlabel: "distance", ylabel: "echo strength (relative)",
                yticks: [1e-14, 1e-12, 1e-10, 1e-8, 1e-6, 1e-4, 1e-2],
            });
            plot.frame();
            let items = [
                { t: WALL, color: col.bg, name: "wall" },
                { t: SHAHED, color: col.shahed, name: "Shahed, head on" },
                { t: QUAD, color: col.quad, name: "10\" quad" },
            ];
            for (let it of items)
                plot.curve(r => M.signal(spec, it.t, r, VIS), it.color, 2.5);
            plot.vline(R, col.range, 1.5);
            let y = 24;
            text(ctx, "at " + fmt_dist(R) + ":", plot.x + plot.w + 14, y, col.range, fs, "left", "middle", 500);
            y += fs * 1.6;
            for (let it of items.slice().reverse()) {
                let S = M.signal(spec, it.t, R, VIS);
                plot.dot(R, S, it.color, 5);
                let slope = M.signal_slope(spec, it.t, R, VIS);
                text(ctx, it.name, plot.x + plot.w + 14, y, it.color, fs, "left", "middle", 500);
                y += fs * 1.25;
                text(ctx, "slope " + (slope < 0 ? "−" : "") + abs(slope).toFixed(1), plot.x + plot.w + 14, y, col.text, fs - 1, "left");
                y += fs * 1.2;
                let k = pow(2, -slope);
                let kk = k.toFixed(k < 10 ? 1 : 0) + "× weaker";
                text(ctx, (right < 160 ? "2× far: " : "2× farther: ") + kk, plot.x + plot.w + 14, y, col.light_text, right < 160 ? fs - 2 : fs - 1, "left");
                y += fs * 1.9;
            }
        },
    };
