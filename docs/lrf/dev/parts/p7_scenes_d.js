
    /* ================================================================== */
    /* Scenes: camera, parallax, calibration                              */
    /* ================================================================== */

    /* ----------------------------- pinhole ---------------------------- */

    SCENES.pinhole = {
        init(d) {
            d.st.drone = [0.62, 0.22];   // fractions of width, height
        },
        drag: {
            begin(d, x, y) {
                let p = d.st.drone;
                if (hypot(x - p[0] * d.width, y - p[1] * d.height) < 30) {
                    d.st.grab = [x - p[0] * d.width, y - p[1] * d.height];
                    return true;
                }
                return false;
            },
            move(d, x, y) {
                d.st.drone = [clamp((x - d.st.grab[0]) / d.width, 0.05, 0.95), clamp((y - d.st.grab[1]) / d.height, 0.06, 0.42)];
            },
            cursor(d, x, y) {
                let p = d.st.drone;
                return hypot(x - p[0] * d.width, y - p[1] * d.height) < 30 ? "grab" : "default";
            },
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let f_px = 2200, SW = 3840;       // a wide angle camera with the article's sensor
            let sensor_w = min(w * 0.5, (h * 0.32) * SW / f_px);
            let k = sensor_w / SW;            // drawing pixels per sensor pixel
            let fdraw = f_px * k;
            let px = w / 2, py = h - fdraw - fs * 3.6;
            let sy = py + fdraw * 0.0;
            // box
            let bx0 = px - sensor_w / 2 - 10, bx1 = px + sensor_w / 2 + 10;
            let by1 = py + fdraw;
            round_rect(ctx, bx0, py, bx1 - bx0, fdraw + 8, 4, "#EDEDED", "#CFCFCF");
            line(ctx, bx0, py, px - 3, py, "#555", 3);
            line(ctx, px + 3, py, bx1, py, "#555", 3);
            // sensor
            line(ctx, px - sensor_w / 2, by1, px + sensor_w / 2, by1, col.cam, 4);
            for (let u of [0, 960, 1920, 2880, 3840]) {
                let x = px - sensor_w / 2 + u * k;
                line(ctx, x, by1 + 2, x, by1 + 7, col.cam, 1);
                text(ctx, String(u), x, by1 + 7 + fs * 0.7, col.cam, fs - 3);
            }
            // field of view wedge
            let fov_half = atan(SW / 2 / f_px);
            for (let s of [-1, 1]) {
                let L = py - 4;
                line(ctx, px, py, px + s * tan(fov_half) * L, py - L, rgba(col.cam, 0.35), 1, [4, 4]);
            }
            // drone and ray
            let dx = d.st.drone[0] * w, dy = d.st.drone[1] * h;
            let a = atan2(dx - px, py - dy);
            let u = SW / 2 - f_px * tan(a);    // image is inverted on the sensor
            let hx = px - fdraw * tan(a);
            line(ctx, dx, dy, px, py, rgba(col.quad, 0.8), 1.5);
            let inside = abs(tan(a) * f_px) <= SW / 2;
            line(ctx, px, py, hx, by1, inside ? col.quad : col.miss, 1.5, inside ? null : [3, 3]);
            if (inside)
                circle(ctx, hx, by1, 4, col.quad, "#fff", 1.5);
            line(ctx, px, py, px, py - (py - 10), "rgba(0,0,0,0.15)", 1, [2, 4]);
            draw_quad_top(ctx, dx, dy, 34, "#2D3439", 0.3);
            // angle arc
            let r = 46;
            ctx.strokeStyle = col.text;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            if (a > 0) ctx.arc(px, py, r, -pi / 2, -pi / 2 + a);
            else ctx.arc(px, py, r, -pi / 2 + a, -pi / 2);
            ctx.stroke();
            text(ctx, "α = " + (a * 180 / pi).toFixed(1) + "°", px + (a > 0 ? 1 : -1) * 54, py - 54, col.text, fs - 1, a > 0 ? "left" : "right");
            dimension(ctx, bx1 + 16, py, bx1 + 16, by1, col.cam, "", fs - 2);
            text(ctx, "f = " + fmt_int(f_px) + " px", bx1 + 24, (py + by1) / 2, col.cam, fs - 1, "left", "middle", 500);
            let msg = inside ? "lands on pixel " + round(SW - u) + " (image flipped back)" : "outside the field of view";
            halo_text(ctx, msg, w / 2, by1 + fs * 2.2, inside ? col.quad : col.light_text, fs - 1, "center", "middle", 500);
        },
    };

    /* -------------------------- camera sizes -------------------------- */

    /*
     * A zoomed in part of the camera's image, rendered the way a sensor sees
     * it: the target is drawn at its true size with 16 x 16 samples per
     * camera pixel, each pixel takes the average of its samples (so a part
     * covering 10% of a pixel tints it 10%), and a Gaussian blur of sigma
     * `blur` pixels stands in for the lens and the air. Around 0.6 to 1 px is
     * typical for the diffraction spot of a tele lens on small pixels;
     * turbulence and focus errors make it larger.
     */
    const CAM_SS = 16;

    function camera_render(st, nw, nh, draw_target, blur) {
        let SS = CAM_SS;
        if (!st.off || st.off.width !== nw * SS || st.off.height !== nh * SS) {
            st.off = document.createElement("canvas");
            st.off.width = nw * SS;
            st.off.height = nh * SS;
            st.nat = document.createElement("canvas");
            st.nat.width = nw;
            st.nat.height = nh;
        }
        let o = st.off.getContext("2d", { willReadFrequently: true });
        o.setTransform(SS, 0, 0, SS, 0, 0);
        let g = o.createLinearGradient(0, 0, 0, nh);
        g.addColorStop(0, col.sky_top);
        g.addColorStop(1, col.sky_bottom);
        o.fillStyle = g;
        o.fillRect(0, 0, nw, nh);
        draw_target(o);

        // average each pixel's samples
        let W = nw * SS;
        let src = o.getImageData(0, 0, W, nh * SS).data;
        let px = new Float32Array(nw * nh * 3);
        for (let y = 0; y < nh * SS; y++) {
            let row = ((y / SS) | 0) * nw;
            for (let x = 0; x < W; x++) {
                let i = (y * W + x) * 4, j = (row + ((x / SS) | 0)) * 3;
                px[j] += src[i];
                px[j + 1] += src[i + 1];
                px[j + 2] += src[i + 2];
            }
        }
        let inv = 1 / (SS * SS);
        for (let j = 0; j < px.length; j++) px[j] *= inv;

        // lens blur: separable Gaussian, edges clamped
        let sg = max(0.05, blur === undefined ? 0.8 : blur);
        let kr = max(1, ceil(3 * sg)), ker = [];
        let ks = 0;
        for (let k = -kr; k <= kr; k++) { let v = exp(-k * k / (2 * sg * sg)); ker.push(v); ks += v; }
        ker = ker.map(v => v / ks);
        let tmp = new Float32Array(px.length), out = new Float32Array(px.length);
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 3; c++) {
            let a = 0;
            for (let k = -kr; k <= kr; k++) a += ker[k + kr] * px[(y * nw + clamp(x + k, 0, nw - 1)) * 3 + c];
            tmp[(y * nw + x) * 3 + c] = a;
        }
        for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 3; c++) {
            let a = 0;
            for (let k = -kr; k <= kr; k++) a += ker[k + kr] * tmp[(clamp(y + k, 0, nh - 1) * nw + x) * 3 + c];
            out[(y * nw + x) * 3 + c] = a;
        }

        let n = st.nat.getContext("2d");
        let img = n.createImageData(nw, nh);
        for (let i = 0; i < nw * nh; i++) {
            img.data[i * 4] = out[i * 3];
            img.data[i * 4 + 1] = out[i * 3 + 1];
            img.data[i * 4 + 2] = out[i * 3 + 2];
            img.data[i * 4 + 3] = 255;
        }
        n.putImageData(img, 0, 0);
        return st.nat;
    }

    SCENES.camera_sizes = {
        sliders: [
            { anim: { period: 18 }, fmt: v => "R = " + fmt_dist(v), map: log_map(50, 4000), def: 400 },
            { fmt: v => "blur \u03c3 " + v.toFixed(1) + " px", map: lin_map(0, 3), def: 0.8 },
        ],
        segs: [["10\" quad", "Shahed-136"]],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0];
            let shahed = d.seg[0] === 1;
            let nw = 48, nh = max(8, round(nw * h / w));
            let size = (shahed ? 2.5 : 0.43) / R * FPX;
            let nat = camera_render(d.st, nw, nh, o => {
                if (shahed) draw_shahed_front(o, nw / 2, nh / 2, size, "#55595D", true);
                else draw_quad_sprite(o, nw / 2, nh / 2, size, "#2D3439", 0, 0, true);
            }, d.v[1]);

            let k = w / nw;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(nat, 0, 0, nw, nh, 0, 0, nw * k, nh * k);
            ctx.imageSmoothingEnabled = true;
            // pixel grid
            if (k > 6) {
                ctx.strokeStyle = "rgba(0,0,0,0.05)";
                ctx.lineWidth = 1;
                for (let i = 0; i <= nw; i++) { ctx.beginPath(); ctx.moveTo(i * k, 0); ctx.lineTo(i * k, h); ctx.stroke(); }
                for (let j = 0; j <= nh; j++) { ctx.beginPath(); ctx.moveTo(0, j * k); ctx.lineTo(w, j * k); ctx.stroke(); }
            }
            let cx = (nw / 2) * k, cy = (nh / 2) * k;
            let beam_px = M.beam_diameter(spec, R) / R * FPX;
            // the camera can't see the beam: a faint glow shows where it is
            draw_beam_spot(ctx, cx, cy, beam_px / 2 * k, col.laser, 0.3);
            halo_text(ctx, (shahed ? "Shahed wingspan " : "quad ") + size.toFixed(1) + " px", 12, 18, shahed ? col.shahed : col.quad, fs, "left", "middle", 500, "rgba(255,255,255,0.85)");
            halo_text(ctx, "beam " + beam_px.toFixed(1) + " px", 12, 18 + fs * 1.4, col.laser, fs, "left", "middle", 500, "rgba(255,255,255,0.85)");
            halo_text(ctx, fmt_dist(R) + " away; one square = one camera pixel", w - 12, h - 14, col.text, fs - 2, "right", "middle", 400, "rgba(255,255,255,0.85)");
        },
    };

    /* ---------------------------- parallax ---------------------------- */

    // Vertical position for distances in the top views: logarithmic.
    function dist_y(R, y0, y1, rmin, rmax) {
        return y0 - (y0 - y1) * log(R / rmin) / log(rmax / rmin);
    }

    SCENES.parallax_top = {
        sliders: [{ anim: { period: 15 }, fmt: v => "R = " + (v < 10 ? v.toFixed(1) + " m" : fmt_dist(v)), map: log_map(2, 1000), def: 10 }],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0];
            let b = BASELINE;
            let left = w * 0.56;
            let y0 = h - 30, y1 = 26;
            let cx = left / 2;
            let bpx = 46;
            let camx = cx - bpx / 2, lrfx = cx + bpx / 2;
            // distance ticks
            for (let r of [2, 5, 10, 20, 50, 100, 200, 500, 1000]) {
                let y = dist_y(r, y0 - 20, y1, 1, 1000);
                line(ctx, 8, y, 16, y, col.axis, 1);
                text(ctx, r >= 1000 ? "1 km" : r + " m", 20, y, col.light_text, fs - 3, "left");
            }
            let ty = dist_y(R, y0 - 20, y1, 1, 1000);
            line(ctx, camx, y0 - 14, camx, y1, rgba(col.cam, 0.7), 1.5, [5, 4]);
            line(ctx, lrfx, y0 - 14, lrfx, ty, col.laser, 2.5);
            line(ctx, cx - 60, ty, cx + 60, ty, col.bg, 4);
            circle(ctx, lrfx, ty, 4, col.laser);
            line(ctx, camx, y0 - 14, lrfx, ty, rgba(col.cam, 0.9), 1.5);
            draw_camera_top(ctx, camx, y0 - 4, 12, "#5E5368");
            draw_lrf_top(ctx, lrfx, y0 - 4, 9);
            dimension(ctx, camx, y0 + 16, lrfx, y0 + 16, col.mount, "", fs - 2);
            text(ctx, (b * 100).toFixed(1) + " cm", lrfx + 12, y0 + 16, col.mount, fs - 2, "left", "middle", 500);
            text(ctx, "baseline exaggerated", left - 8, y1 - 10, col.light_text, fs - 3, "right");

            // camera image strip
            let ix = left + 10, iw = w - left - 20;
            let iy = h * 0.2, ih = h * 0.36;
            let range_px = 200;
            round_rect(ctx, ix, iy, iw, ih, 6, "#EEF3F8", "#D5DCE4");
            let X = u => ix + iw / 2 + u / range_px * (iw / 2 - 8);
            line(ctx, X(0), iy + 4, X(0), iy + ih - 4, rgba(col.cam, 0.6), 1, [4, 3]);
            let u = FPX * b / R;
            let beam_px = M.beam_diameter(spec, R) / R * FPX;
            let r_draw = beam_px / 2 * (iw / 2 - 8) / range_px;
            let ux = X(min(u, range_px * 1.2));
            draw_beam_spot(ctx, ux, iy + ih / 2, max(2, r_draw), col.laser, 0.9);
            for (let p of [-200, -100, 0, 100, 200]) {
                line(ctx, X(p), iy + ih, X(p), iy + ih + 5, col.axis, 1);
                text(ctx, (p > 0 ? "+" : p < 0 ? "−" : "") + abs(p), X(p), iy + ih + 5 + fs * 0.7, col.light_text, fs - 3);
            }
            text(ctx, "camera image, pixels from center", ix + iw / 2, iy - fs * 0.8, col.cam, fs - 1, "center", "middle", 500);
            text(ctx, "spot " + (u < 10 ? u.toFixed(1) : round(u)) + " px right of center", ix + iw / 2, iy + ih + fs * 2.6, col.laser, fs, "center", "middle", 500);
            text(ctx, "f × b / R = " + fmt_int(FPX) + " × " + b + " / " + (R < 10 ? R.toFixed(1) : round(R)), ix + iw / 2, iy + ih + fs * 4, col.text, fs - 1);
        },
    };

    SCENES.parallax_misalign = {
        sliders: [
            { anim: { period: 15 }, fmt: v => "R = " + fmt_dist(v), map: log_map(5, 1000), def: 20 },
            { fmt: v => (v >= 0 ? "+" : "−") + abs(v).toFixed(2) + " mrad", map: lin_map(-3, 3), def: 1 },
        ],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0], beta = d.v[1] * 1e-3;
            let b = BASELINE;
            let left = w * 0.42;
            let y0 = h - 30, y1 = 26;
            let cx = left / 2;
            let bpx = 40;
            let camx = cx - bpx / 2, lrfx = cx + bpx / 2;
            let ty = dist_y(R, y0 - 20, y1, 3, 1000);
            // exaggerate the angle for the drawing
            let ex = 18;
            let beam_x = r => lrfx + ex * beta * (y0 - 14 - dist_y(r, y0 - 20, y1, 3, 1000));
            line(ctx, camx, y0 - 14, camx, y1, rgba(col.cam, 0.7), 1.5, [5, 4]);
            line(ctx, lrfx, y0 - 14, lrfx, y1, rgba(col.laser, 0.25), 1, [3, 4]);
            line(ctx, lrfx, y0 - 14, beam_x(R), ty, col.laser, 2.5);
            circle(ctx, beam_x(R), ty, 4, col.laser);
            line(ctx, camx, y0 - 14, beam_x(R), ty, rgba(col.cam, 0.9), 1.5);
            draw_camera_top(ctx, camx, y0 - 4, 11, "#5E5368");
            draw_lrf_top(ctx, lrfx, y0 - 4, 8);
            text(ctx, "angles exaggerated", 10, 12, col.light_text, fs - 3, "left");
            text(ctx, fmt_dist(R), beam_x(R) + 8, ty, col.range, fs - 1, "left", "middle", 500);

            // plot of pixel offset vs 1/R
            let plot = new Plot(ctx, left + 52, 18, w - left - 70, h - 18 - fs * 3.4, {
                xmin: 0, xmax: 0.2, ymin: -100, ymax: 400, fs: fs - 1,
                xticks: [0, 0.02, 0.05, 0.1, 0.2], xfmt: v => v === 0 ? "∞" : round(1 / v) + " m",
                yticks: [-100, 0, 100, 200, 300, 400], yfmt: v => (v > 0 ? "+" : v < 0 ? "−" : "") + abs(v),
                xlabel: "distance (spaced as 1/R)", ylabel: "pixels from center", ylabel_offset: fs * 3,
            });
            plot.frame();
            plot.hline(0, col.axis, 1);
            let u = ir => FPX * (beta + b * ir);
            plot.curve(u, col.laser, 2.5);
            plot.dot(1 / R, u(1 / R), col.laser, 5);
            plot.dot(0, u(0), col.mis, 6);
            halo_text(ctx, "boresight " + (u(0) > 0 ? "+" : "−") + abs(u(0)).toFixed(1) + " px", plot.X(0) + 8, plot.Y(u(0)) + (beta >= 0 ? -fs : fs), col.mis, fs - 1, "left", "middle", 500);
            halo_text(ctx, "slope: f × b", plot.X(0.15), plot.Y(u(0.15)) - fs, col.mount, fs - 1, "center", "middle", 500);
            if (beta < 0) {
                let rc = -b / beta;
                if (rc < 1000)
                    halo_text(ctx, "beam crosses the camera's axis at " + fmt_dist(rc), plot.x + plot.w - 6, plot.y + plot.h - fs, col.text, fs - 2, "right");
            }
        },
    };

    SCENES.parallax_image = {
        sliders: [{ anim: { period: 18 }, fmt: v => "R = " + fmt_dist(v), map: log_map(5, 2000), def: 150 }],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0];
            let mount = TRUE_MOUNT;
            let hi = round(h * 0.56);           // camera image on top, top view below

            // camera image: the beam's trace from 5 m to infinity
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, w, hi);
            ctx.clip();
            let u0 = -60, u1 = 400;
            let k = w / (u1 - u0);
            let vh = hi / k;
            let v0 = -vh / 2 + 6;
            let X = u => (u - u0) * k, Y = v => (v - v0) * k;
            let g = ctx.createLinearGradient(0, 0, 0, hi);
            g.addColorStop(0, col.sky_top);
            g.addColorStop(1, col.sky_bottom);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, hi);
            line(ctx, X(0) - 10, Y(0), X(0) + 10, Y(0), col.axis, 1);
            line(ctx, X(0), Y(0) - 10, X(0), Y(0) + 10, col.axis, 1);
            text(ctx, "image center", X(0), Y(0) + 18, col.light_text, fs - 3);
            let pts = [];
            for (let i = 0; i <= 200; i++) {
                let r = 5 * pow(1e6, i / 200);
                let p = M.beam_pixel(cam, mount, r);
                pts.push([X(p[0] - cam.width_px / 2), Y(p[1] - cam.height_px / 2)]);
            }
            poly(ctx, pts, rgba(col.laser, 0.6), 1.5, [5, 4]);
            for (let r of [5, 10, 20, 50]) {
                let p = M.beam_pixel(cam, mount, r);
                let x = X(p[0] - cam.width_px / 2), y = Y(p[1] - cam.height_px / 2);
                circle(ctx, x, y, 2.5, col.laser);
                text(ctx, r + " m", x, y - 10, col.laser, fs - 3);
            }
            let bs = M.boresight_pixel(cam, mount);
            let bx = X(bs[0] - cam.width_px / 2), by = Y(bs[1] - cam.height_px / 2);
            let size = 0.43 / R * FPX * k;
            ctx.globalAlpha = size > w * 0.3 ? 0.35 : 1;
            draw_quad_sprite(ctx, bx, by, size, "#2D3439", 0, 0);
            ctx.globalAlpha = 1;
            line(ctx, bx - 6, by - 6, bx + 6, by + 6, col.mis, 2);
            line(ctx, bx - 6, by + 6, bx + 6, by - 6, col.mis, 2);
            halo_text(ctx, "boresight (∞)", bx - 10, by + 16, col.mis, fs - 2, "right", "middle", 500, "rgba(230,238,246,0.85)");
            let p = M.beam_pixel(cam, mount, R);
            let px = X(p[0] - cam.width_px / 2), py = Y(p[1] - cam.height_px / 2);
            let rr = M.beam_radius(spec, R) / R * FPX * k;
            draw_beam_spot(ctx, px, py, rr, col.laser, 0.6);
            ctx.restore();
            let miss = BASELINE;   // meters between the drone's center and the beam's axis
            let on = M.fraction_on_target(spec, QUAD, R, miss, 0) / M.fraction_on_target(spec, QUAD, R);
            halo_text(ctx, "quad " + fmt_dist(R) + " away, aimed at the boresight", 12, 16, col.quad, fs - 1, "left", "middle", 500, "rgba(255,255,255,0.8)");
            halo_text(ctx, "echo " + fmt_pct(clamp(on, 0, 1)) + " of a perfectly centered beam", 12, 16 + fs * 1.4, "#B07800", fs - 1, "left", "middle", 500, "rgba(255,255,255,0.8)");

            // top view: sideways distances to scale, distance along the beam compressed.
            // The camera's line of sight to the drone and the beam are parallel,
            // BASELINE apart, all the way out.
            let ty0 = hi + 8, th = h - ty0 - 4;
            round_rect(ctx, 6, ty0, w - 12, th, 8, "#F1F4F7");
            ctx.save();
            ctx.beginPath();
            ctx.rect(6, ty0, w - 12, th);
            ctx.clip();
            let wr = M.beam_radius(spec, R);
            let span = max(0.75, 2 * (miss + 2.3 * wr));
            let km = (th - 2 * fs) / span;              // pixels per meter sideways
            let xa = 46, xd = w - 110;                   // camera end, drone end
            let cyc = ty0 + fs * 1.2 + (th - 2 * fs) / 2 - miss * km / 2;   // camera's line
            let cyb = cyc + miss * km;                   // beam's line (LRF on the camera's right = down)
            // the beam spreading toward the drone: evenly lit across, with
            // soft edges (distance along it compressed)
            let h0 = spec.exit_beam_mm * 5e-4 * km, soft = 1 + 2 * beam_edge_ratio();
            fill_poly(ctx, [[xa, cyb - h0], [xd, cyb - wr * km * soft], [xd, cyb + wr * km * soft], [xa, cyb + h0]], rgba(col.laser, 0.1));
            fill_poly(ctx, [[xa, cyb - h0], [xd, cyb - wr * km], [xd, cyb + wr * km], [xa, cyb + h0]], rgba(col.laser, 0.24));
            line(ctx, xa, cyb, xd + 40, cyb, col.laser, 1.5);
            line(ctx, xa, cyc, xd, cyc, rgba(col.cam, 0.9), 1.5, [5, 4]);
            draw_quad_top(ctx, xd, cyc, 0.43 * km, "#2D3439", pi / 2);
            // footprint where it reaches the drone, to scale sideways
            ctx.fillStyle = rgba(col.laser, 0.55);
            ctx.fillRect(xd - 2, cyb - wr * km, 4, 2 * wr * km);
            draw_camera_top(ctx, xa - 14, cyc, 6, "#5E5368");
            draw_lrf_top(ctx, xa - 14, cyb, 5);
            // the gap between the two lines, at both ends
            let lab = round(miss * 1000) + " mm";
            dimension(ctx, xa + 14, cyc, xa + 14, cyb, col.mount, "", fs - 2);
            halo_text(ctx, lab, xa + 22, (cyc + cyb) / 2, col.mount, fs - 2, "left", "middle", 500, "rgba(241,244,247,0.9)");
            let xq = xd - 0.215 * km - 14;
            dimension(ctx, xq, cyc, xq, cyb, col.mount, "", fs - 2);
            halo_text(ctx, lab, xq - 8, (cyc + cyb) / 2, col.mount, fs - 2, "right", "middle", 500, "rgba(241,244,247,0.9)");
            ctx.restore();
            text(ctx, "top view after calibration: sideways to scale, distance compressed", 14, ty0 + fs * 0.8, col.light_text, fs - 3, "left");
            halo_text(ctx, "camera's line of sight", (xa + xq) / 2, cyc - 9, col.cam, fs - 2, "center", "middle", 500, "rgba(241,244,247,0.9)");
            halo_text(ctx, "beam, footprint " + fmt_len(2 * wr), (xa + xq) / 2, cyb + max(10, wr * km * 0.5 + 9), col.laser, fs - 2, "center", "middle", 500, "rgba(241,244,247,0.9)");
        },
    };

    /* ----------------------------- mount 3D --------------------------- */

    SCENES.mount_3d = {
        orbit: true,
        sliders: [
            { anim: { period: 18 }, fmt: v => "pan " + round(v) + "°", map: lin_map(-80, 80), def: 25 },
            { anim: { period: 14, lo: 0.15, hi: 0.75 }, fmt: v => "tilt " + round(v) + "°", map: lin_map(-20, 60), def: 15 },
        ],
        init(d) {
            d.st.yaw = -0.6;
            d.st.pitch = 0.35;
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let pan = d.v[0] * pi / 180, tilt = d.v[1] * pi / 180;
            let camera = new Camera3D(w, h, d.st.yaw, d.st.pitch, 0.95, [0, 0.12, 0.16], 0.75);
            let hz = camera.project(v3_add(camera.eye, v3_scale([camera.fwd[0], camera.fwd[1], 0], 1e4)));
            draw_sky(ctx, w, h, hz ? hz[1] : h);
            draw_ground(ctx, camera, 3, 0.1, "#E6EADB");
            let sc = new Scene3D();
            let tur = build_turret(sc, pan, tilt);
            let L = 1.1;
            let ex = 40;
            let bdir = v3_norm(v3_add(tur.fwd, v3_add(v3_scale(tur.right, TRUE_MOUNT.yaw_mrad * 1e-3 * ex), v3_scale(tur.up, -TRUE_MOUNT.pitch_mrad * 1e-3 * ex))));
            sc.line(tur.cam_origin, v3_add(tur.cam_origin, v3_scale(tur.fwd, L)), col.cam, 2, 0.9);
            sc.line(tur.lrf_origin, v3_add(tur.lrf_origin, v3_scale(bdir, L)), col.laser, 2.5, 0.95);
            sc.render(ctx, camera);
            halo_text(ctx, "camera axis", 14, 18, col.cam, fs - 1, "left", "middle", 500);
            halo_text(ctx, "beam (misalignment exaggerated)", 14, 18 + fs * 1.4, col.laser, fs - 1, "left", "middle", 500);

            // the camera's own view: the beam's trace never moves
            let iw = round(w * 0.3), ih = round(iw * 9 / 16);
            let ix = w - iw - 10, iy = h - ih - 10;
            ctx.save();
            round_rect(ctx, ix - 2, iy - 2, iw + 4, ih + 4, 5, "rgba(255,255,255,0.9)");
            ctx.beginPath();
            ctx.rect(ix, iy, iw, ih);
            ctx.clip();
            let fin = iw / 2 / tan(25 * pi / 180);
            let hy = iy + ih / 2 + fin * tan(tilt);
            let g = ctx.createLinearGradient(0, iy, 0, max(iy + 1, hy));
            g.addColorStop(0, col.sky_top);
            g.addColorStop(1, col.sky_bottom);
            ctx.fillStyle = g;
            ctx.fillRect(ix, iy, iw, ih);
            ctx.fillStyle = "#D9DFC9";
            ctx.fillRect(ix, hy, iw, iy + ih - hy);
            for (let az = -180; az < 180; az += 15) {
                let rel = (az * pi / 180) - pan;
                rel = atan2(sin(rel), cos(rel));
                if (abs(rel) > 0.6) continue;
                let x = ix + iw / 2 - fin * tan(rel);
                line(ctx, x, hy, x, hy - fin * 0.08, "#6E8B3D", 3);
            }
            // fixed trace (schematic)
            line(ctx, ix + iw * 0.62, iy + ih * 0.45, ix + iw * 0.53, iy + ih * 0.52, col.laser, 2, [4, 3]);
            circle(ctx, ix + iw * 0.53, iy + ih * 0.52, 3, col.laser);
            ctx.restore();
            text(ctx, "camera image", ix + 6, iy + 10, col.cam, fs - 3, "left");
        },
    };

    /* -------------------------- apriltag pose ------------------------- */

    const TAG_SIZE = 0.3;

    SCENES.apriltag_pose = {
        sliders: [
            { fmt: v => "R = " + v.toFixed(1) + " m", map: log_map(5, 80), def: 20 },
            { anim: { period: 15, lo: 0.15, hi: 0.85 }, fmt: v => "yaw " + round(v) + "°", map: lin_map(-60, 60), def: 25 },
        ],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let D = d.v[0], yaw = d.v[1] * pi / 180;
            let left = w * 0.36;

            // top view
            let y0 = h - 30, y1 = 30;
            let cx = left / 2;
            for (let r of [5, 10, 20, 40, 80]) {
                let y = dist_y(r, y0 - 14, y1, 3, 80);
                line(ctx, 8, y, 14, y, col.axis, 1);
                text(ctx, r + " m", 18, y, col.light_text, fs - 3, "left");
            }
            let ty = dist_y(D, y0 - 14, y1, 3, 80);
            let half = 26;
            let tx0 = cx - half * cos(yaw), ty0 = ty - half * sin(yaw);
            let tx1 = cx + half * cos(yaw), ty1 = ty + half * sin(yaw);
            line(ctx, cx, y0 - 10, cx, ty, rgba(col.cam, 0.4), 1, [4, 4]);
            line(ctx, tx0, ty0, tx1, ty1, col.tag, 5);
            arrow(ctx, cx, ty, cx + 22 * sin(yaw), ty - 22 * cos(yaw) * -1, col.range, 1.5, 6);
            draw_camera_top(ctx, cx, y0, 11, "#5E5368");
            text(ctx, "top view", 10, 12, col.light_text, fs - 3, "left");

            // camera image: the full frame
            let crop = cam.width_px;
            let ix = left + 10, iw = w - left - 20;
            let ih = iw * 9 / 16;
            if (ih > h - 50) { ih = h - 50; iw = ih * 16 / 9; ix = left + 10 + (w - left - 20 - iw) / 2; }
            let iy = (h - ih) / 2 - 6;
            let k = iw / crop;
            ctx.save();
            round_rect(ctx, ix, iy, iw, ih, 4, "#DCE5EE");
            ctx.beginPath();
            ctx.rect(ix, iy, iw, ih);
            ctx.clip();
            let center = [0, 0, D];
            let right = [cos(yaw), 0, -sin(yaw)];
            let down = [0, 1, 0];
            let proj = p => [ix + iw / 2 + FPX * k * p[0] / p[2], iy + ih / 2 + FPX * k * p[1] / p[2]];
            let map = (u, v) => proj(v3_add(center, v3_add(v3_scale(right, u * TAG_SIZE), v3_scale(down, v * TAG_SIZE))));
            draw_tag(ctx, map, { outline: true });
            let corners = [map(-0.5, -0.5), map(0.5, -0.5), map(0.5, 0.5), map(-0.5, 0.5)];
            // markers shrink with a distant tag so they don't hide it
            let tw = FPX * k * TAG_SIZE / D;
            let mr = clamp(tw / 12, 1, 3), mw = clamp(tw / 30, 0.75, 2);
            for (let c of corners)
                circle(ctx, c[0], c[1], mr, null, col.hit, mw);
            // pose axes from the tag's center
            let c0 = proj(center);
            let ax = (dv, color) => {
                let p = proj(v3_add(center, v3_scale(dv, 0.2)));
                line(ctx, c0[0], c0[1], p[0], p[1], color, mw);
            };
            ax(right, "#E53935");
            ax([0, -1, 0], "#43A047");
            ax([-sin(yaw), 0, -cos(yaw)], "#1E88E5");
            ctx.restore();
            let span = abs(corners[1][0] - corners[0][0]) / k;
            text(ctx, "camera image, " + cam.width_px + " × " + cam.height_px, ix + iw / 2, iy - 10, col.cam, fs - 2, "center", "middle", 500);
            text(ctx, "distance " + D.toFixed(2) + " m,  yaw " + round(d.v[1]) + "°,  tag spans " + round(span) + " px", ix + iw / 2, iy + ih + fs * 1.2, col.text, fs - 1, "center", "middle", 500);
        },
    };

    /* -------------------------- apriltag sweep ------------------------ */

    const SWEEP_R = 50;         // tag distance during the sweep, m
    const SWEEP_STEP = 8;       // pixels between stops (0.36 mrad of pan or tilt)
    const SWEEP_SPAN = 140;     // half range of tag center offsets around the spot, pixels
    const PAPER = TAG_SIZE * 1.25;  // the black square plus its white border

    function sweep_truth() {
        let p = M.beam_pixel(cam, TRUE_MOUNT, SWEEP_R);
        return [p[0] - cam.width_px / 2, p[1] - cam.height_px / 2];
    }

    // Is a stop with the tag's center at pixel offset (tx, ty) a hit, for a
    // beam whose spot is at pixel offset beam (default: the true spot)?
    // strength scales the echo of the tag's white paper (albedo 0.8).
    function sweep_hit(tx, ty, strength, beam) {
        let b = beam || sweep_truth();
        let dx = (b[0] - tx) / FPX * SWEEP_R, dy = (b[1] - ty) / FPX * SWEEP_R;
        let F = M.fraction_square(spec, SWEEP_R, PAPER, dx, dy);
        let S = 0.8 * F / (SWEEP_R * SWEEP_R);
        return M.snr(spec, S, 0.04) * strength > spec.threshold_sigma;
    }

    function sweep_stops() {
        let out = [];
        let n = round(SWEEP_SPAN * 2 / SWEEP_STEP);
        let b = sweep_truth();
        // the raster isn't centered on the (unknown) spot
        let ox = b[0] - SWEEP_SPAN + 1.3, oy = b[1] - SWEEP_SPAN - 0.9;
        for (let j = 0; j <= n; j++) {
            for (let ii = 0; ii <= n; ii++) {
                let i = j % 2 ? n - ii : ii;
                out.push([ox + i * SWEEP_STEP, oy + j * SWEEP_STEP]);
            }
        }
        return out;
    }

    function tag_half_px() {
        return TAG_SIZE / SWEEP_R * FPX / 2;
    }

    SCENES.apriltag_sweep = {
        animated: true,
        sliders: [{ fmt: v => "echo ×" + (v / 3e-3 < 1 ? (v / 3e-3).toFixed(2) : (v / 3e-3).toFixed(0)), map: log_map(1.5e-4, 3), def: 3e-3 }],
        reset(d) { d.st.clock = 0; },
        finished(d) { return floor(d.st.clock * 260) >= d.st.stops.length; },
        init(d) {
            d.st.clock = 0;
            d.st.stops = sweep_stops();
        },
        draw(ctx, d, w, h, dt) {
            let fs = base_font_size(w);
            let st = d.st;
            st.clock += dt;
            let strength = d.v[0];
            let n = st.stops.length;
            let shown = min(n, floor(st.clock * 260));
            if (shown >= n && !d.paused) {
                // repeat after a pause to show the result, until the reader
                // touches the demo; then stop at the end
                if (d.touched)
                    d.set_paused(true);
                else if (st.clock > n / 260 + 3)
                    st.clock = 0;
            }
            let b = sweep_truth();
            let span = SWEEP_SPAN + 10;
            let k = min(w, h - 30) / (2 * span);
            let cx0 = w / 2, cy0 = (h - 30) / 2 + 4;
            let X = u => cx0 + (u - b[0]) * k, Y = v => cy0 + (v - b[1]) * k;
            round_rect(ctx, cx0 - span * k, cy0 - span * k, 2 * span * k, 2 * span * k, 6, "#F1F4F7");
            ctx.save();
            ctx.beginPath();
            ctx.rect(cx0 - span * k, cy0 - span * k, 2 * span * k, 2 * span * k);
            ctx.clip();
            // the tag at the current stop
            let cur = st.stops[max(0, min(n - 1, shown - 1))];
            let hp = tag_half_px();
            ctx.globalAlpha = 0.3;
            draw_tag(ctx, (u, v) => [X(cur[0] + u * 2 * hp), Y(cur[1] + v * 2 * hp)]);
            ctx.globalAlpha = 1;
            poly(ctx, [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(q => [X(cur[0] + q[0] * 1.25 * hp), Y(cur[1] + q[1] * 1.25 * hp)]), "rgba(0,0,0,0.35)", 1, [3, 3], true);
            line(ctx, X(cur[0]) - 5, Y(cur[1]), X(cur[0]) + 5, Y(cur[1]), col.tag, 1.5);
            line(ctx, X(cur[0]), Y(cur[1]) - 5, X(cur[0]), Y(cur[1]) + 5, col.tag, 1.5);
            // stops so far
            let sx = 0, sy = 0, hn = 0;
            let ux0 = 1e9, ux1 = -1e9;
            let rdot = max(1, SWEEP_STEP * k * 0.28);
            for (let i = 0; i < shown; i++) {
                let s = st.stops[i];
                let hit = sweep_hit(s[0], s[1], strength);
                if (hit) {
                    sx += s[0]; sy += s[1]; hn++;
                    ux0 = min(ux0, s[0]); ux1 = max(ux1, s[0]);
                    circle(ctx, X(s[0]), Y(s[1]), rdot, col.hit);
                } else {
                    circle(ctx, X(s[0]), Y(s[1]), rdot * 0.6, col.miss);
                }
            }
            // truth: the beam's spot, which the calibration doesn't know
            let rr = M.beam_radius(spec, SWEEP_R) / SWEEP_R * FPX * k;
            draw_beam_spot(ctx, X(b[0]), Y(b[1]), rr, col.laser, 0.55);
            if (shown >= n && hn > 0) {
                let ex = sx / hn, ey = sy / hn;
                line(ctx, X(ex) - 14, Y(ey), X(ex) + 14, Y(ey), col.text, 2);
                line(ctx, X(ex), Y(ey) - 14, X(ex), Y(ey) + 14, col.text, 2);
            }
            ctx.restore();
            let msg = shown < n ? "tag " + SWEEP_R + " m away, stop " + shown + " of " + n :
                hn ? "hits span " + round(ux1 - ux0 + SWEEP_STEP) + " px; their center is " + hypot(sx / hn - b[0], sy / hn - b[1]).toFixed(1) + " px from the true spot" : "no hits";
            text(ctx, msg, w / 2, h - 12, col.text, fs - 1, "center", "middle", 500);
            halo_text(ctx, "true spot", X(b[0]) + rr + 4, Y(b[1]) - rr - 4, col.laser, fs - 2, "left", "middle", 500, "rgba(241,244,247,0.9)");
        },
    };

    /* ------------------------- calib hypothesis ----------------------- */

    SCENES.calib_hypothesis = {
        init(d) {
            d.st.guess = [0, 0];
            d.st.stops = sweep_stops();
        },
        drag: {
            begin(d, x, y) {
                let L = d.st.layout;
                return L && x < L.right_edge;
            },
            move(d, x, y) {
                let L = d.st.layout;
                d.st.guess = [clamp(L.invX(x), L.u0, L.u1), clamp(L.invY(y), L.v0, L.v1)];
            },
            cursor(d, x) {
                let L = d.st.layout;
                return L && x < L.right_edge ? "crosshair" : "default";
            },
        },
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let st = d.st;
            let strength = 3e-3;
            let b = sweep_truth();
            let stops = st.stops;
            if (!st.hits || st.hits_spec !== spec) {
                st.hits = stops.map(s => sweep_hit(s[0], s[1], strength));
                st.hits_spec = spec;
            }
            let hits = st.hits;

            // left: camera image around the image center, covering the raster
            let pw = w / 2 - 10, ph = h - 34;
            let u0 = min(-12, b[0] - SWEEP_SPAN - 8), u1 = b[0] + SWEEP_SPAN + 8;
            let v0 = b[1] - SWEEP_SPAN - 8, v1 = b[1] + SWEEP_SPAN + 8;
            let k = min(pw / (u1 - u0), ph / (v1 - v0));
            let ox = 4 + (pw - (u1 - u0) * k) / 2, oy = 4 + (ph - (v1 - v0) * k) / 2;
            let X = u => ox + (u - u0) * k, Y = v => oy + (v - v0) * k;
            st.layout = { invX: x => (x - ox) / k + u0, invY: y => (y - oy) / k + v0, u0, u1, v0, v1, right_edge: w / 2 };
            round_rect(ctx, ox, oy, (u1 - u0) * k, (v1 - v0) * k, 6, "#F1F4F7");
            line(ctx, X(0) - 8, Y(0), X(0) + 8, Y(0), col.axis, 1);
            line(ctx, X(0), Y(0) - 8, X(0), Y(0) + 8, col.axis, 1);
            let rdot = max(0.9, SWEEP_STEP * k * 0.3);
            for (let i = 0; i < stops.length; i++) {
                let s = stops[i];
                if (hits[i]) circle(ctx, X(s[0]), Y(s[1]), rdot, col.hit);
                else circle(ctx, X(s[0]), Y(s[1]), rdot * 0.6, col.miss);
            }
            let g = st.guess;
            let rr = max(5, M.beam_radius(spec, SWEEP_R) / SWEEP_R * FPX * k);
            draw_beam_spot(ctx, X(g[0]), Y(g[1]), rr, col.laser, 0.7);
            text(ctx, "camera image: drag the guess", ox + (u1 - u0) * k / 2, h - 12, col.light_text, fs - 2);

            // right: each stop placed on the tag, assuming the guess
            let rx0 = w / 2 + 6, rw = w / 2 - 10;
            let view = PAPER * 1.9;
            let km = min(rw, ph) / view;
            let tcx = rx0 + rw / 2, tcy = 4 + ph / 2;
            round_rect(ctx, tcx - view * km / 2, tcy - view * km / 2, view * km, view * km, 6, "#F1F4F7");
            ctx.save();
            ctx.beginPath();
            ctx.rect(tcx - view * km / 2, tcy - view * km / 2, view * km, view * km);
            ctx.clip();
            ctx.globalAlpha = 0.45;
            draw_tag(ctx, (u, v) => [tcx + u * TAG_SIZE * km, tcy + v * TAG_SIZE * km]);
            ctx.globalAlpha = 1;
            let hpm = PAPER / 2 * km;
            poly(ctx, [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(q => [tcx + q[0] * hpm, tcy + q[1] * hpm]), "rgba(0,0,0,0.35)", 1, [3, 3], true);
            let bad = 0;
            let mpx = SWEEP_STEP / FPX * SWEEP_R * km * 0.3;
            for (let i = 0; i < stops.length; i++) {
                let s = stops[i];
                let qx = (g[0] - s[0]) / FPX * SWEEP_R, qy = (g[1] - s[1]) / FPX * SWEEP_R;
                // would this stop have been a hit if the spot were where we guessed?
                let predicted = sweep_hit(s[0], s[1], strength, g);
                let wrong = predicted !== hits[i];
                if (wrong) bad++;
                let x = tcx + qx * km, y = tcy + qy * km;
                if (hits[i]) circle(ctx, x, y, max(0.9, mpx), wrong ? col.thr : col.hit);
                else circle(ctx, x, y, max(0.6, mpx * 0.6), wrong ? col.thr : col.miss);
            }
            ctx.restore();
            text(ctx, "the same stops, on the tag", tcx, h - 12, col.light_text, fs - 2);
            halo_text(ctx, bad ? "misplaced: " + bad : "all consistent", tcx, tcy - view * km / 2 + 14, bad ? col.thr : col.hit, fs, "center", "middle", 500, "rgba(241,244,247,0.9)");
            halo_text(ctx, "guess is " + hypot(g[0] - b[0], g[1] - b[1]).toFixed(1) + " px off", ox + (u1 - u0) * k / 2, oy + 14, col.text, fs - 1, "center", "middle", 500, "rgba(241,244,247,0.9)");
        },
    };

    /* ------------------------- calib two ranges ----------------------- */

    SCENES.calib_two_ranges = {
        segs: [["1 distance", "2 distances", "3 distances"]],
        seg_def: [1],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let mode = d.seg[0];
            let plot = new Plot(ctx, 60, 16, w - 80, h - 16 - fs * 3.4, {
                xmin: 0, xmax: 0.12, ymin: 0, ymax: 240, fs: fs - 1,
                xticks: [0, 0.02, 0.05, 0.1], xfmt: v => v === 0 ? "∞" : round(1 / v) + " m",
                xlabel: "tag distance (spaced as 1/R)", ylabel: "spot, pixels right of center", ylabel_offset: fs * 3.2,
            });
            plot.frame();
            let beta = TRUE_MOUNT.yaw_mrad * 1e-3, b = TRUE_MOUNT.offset_m[0];
            let truth = ir => FPX * (beta + b * ir);
            plot.curve(truth, rgba(col.laser, 0.3), 6);
            let rng = make_rng(99);
            let dists = mode === 0 ? [25] : mode === 1 ? [10, 60] : [10, 25, 60];
            let pts = dists.map(r => [1 / r, truth(1 / r) + rng.normal() * 0.7]);
            if (mode === 0) {
                for (let s = -2; s <= 2; s++) {
                    let slope = FPX * b * (1 + s * 0.35);
                    let c = pts[0][1] - slope * pts[0][0];
                    plot.curve(ir => c + slope * ir, col.miss, 1.2, [4, 4]);
                }
                halo_text(ctx, "many lines fit a single point", plot.x + plot.w - 8, plot.y + fs, col.text, fs - 1, "right", "middle", 500);
            } else {
                let n = pts.length;
                let mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
                let sxx = pts.reduce((a, p) => a + (p[0] - mx) * (p[0] - mx), 0);
                let sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
                let slope = sxy / sxx, icpt = my - slope * mx;
                plot.curve(ir => icpt + slope * ir, col.laser, 2.5);
                plot.dot(0, icpt, col.mis, 6);
                let b_est = slope / FPX, beta_est = icpt / FPX;
                halo_text(ctx, "baseline " + (b_est * 100).toFixed(1) + " cm (true " + (b * 100).toFixed(1) + ")", plot.x + plot.w - 8, plot.y + fs, col.mount, fs - 1, "right", "middle", 500);
                halo_text(ctx, "misalignment " + (beta_est * 1e3).toFixed(2) + " mrad (true " + TRUE_MOUNT.yaw_mrad.toFixed(2) + ")", plot.x + plot.w - 8, plot.y + fs * 2.4, col.mis, fs - 1, "right", "middle", 500);
            }
            for (let p of pts) {
                plot.dot(p[0], p[1], col.hit, 6);
                text(ctx, round(1 / p[0]) + " m tag", plot.X(p[0]) + 9, plot.Y(p[1]) + 12, col.hit, fs - 2, "left");
            }
        },
    };
