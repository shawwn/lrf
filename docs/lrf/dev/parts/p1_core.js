/// <reference path="./base.js" />
/// <reference path="./lrf_model.js" />
"use strict";

/*
 * Demonstrations for the "Laser Range Finders" article.
 *
 * Every physical number comes from LRFModel (js/lrf_model.js) with the
 * current spec, so switching the spec re-renders every demonstration.
 *
 * Layout of this file:
 *   core helpers (formatting, random numbers, colors, 2D drawing, plots, sprites)
 *   tiny 3D renderer (turret, drones, tag)
 *   demo framework (canvas, sliders, segmented controls, animation, dragging)
 *   scenes, in article order
 *   calculator, spec selector, initialization
 */

let lrf_demos = {};

(function() {

    const M = window.LRFModel;

    const pi = Math.PI;
    const sqrt = Math.sqrt;
    const sin = Math.sin;
    const cos = Math.cos;
    const tan = Math.tan;
    const atan = Math.atan;
    const atan2 = Math.atan2;
    const exp = Math.exp;
    const log = Math.log;
    const log10 = Math.log10;
    const pow = Math.pow;
    const abs = Math.abs;
    const min = Math.min;
    const max = Math.max;
    const floor = Math.floor;
    const ceil = Math.ceil;
    const round = Math.round;
    const hypot = Math.hypot;

    const dpr = min(2, max(1, window.devicePixelRatio || 1));

    /* ------------------------------------------------------------------ */
    /* Global model state                                                 */
    /* ------------------------------------------------------------------ */

    let spec = M.make_spec("dlem20");
    let preset_key = "dlem20";

    const VIS = 25;                       // default visibility, km
    const T = M.TARGETS;
    const QUAD = T.quad10_side;
    const SHAHED = T.shahed_front;
    const WALL = { kind: "extended", albedo: 0.5, label: "Wall" };
    const cam = M.DEFAULT_CAMERA;
    const FPX = M.camera_focal_px(cam);

    // The mount used in the camera and calibration sections: the LRF sits
    // 72 mm to the right of the camera (the user's turret), and is tilted by
    // a small, "unknown" misalignment that calibration has to discover.
    const TRUE_MOUNT = { offset_m: [0.072, 0, 0], yaw_mrad: 1.3, pitch_mrad: -0.8 };
    const BASELINE = TRUE_MOUNT.offset_m[0];

    function rated_time() {
        return spec.rated_time_s;
    }

    function det_range(target, t_s, vis) {
        return M.detection_range(spec, target, t_s === undefined ? rated_time() : t_s,
            { visibility_km: vis === undefined ? VIS : vis }).range_m;
    }

    // SNR of a target at range R after a measurement of t_s seconds.
    function snr_at(target, R, t_s, vis, off_x, off_y) {
        let S = M.signal(spec, target, R, vis === undefined ? VIS : vis, off_x || 0, off_y || 0);
        return M.snr(spec, S, t_s === undefined ? rated_time() : t_s);
    }

    /* ------------------------------------------------------------------ */
    /* Colors                                                             */
    /* ------------------------------------------------------------------ */

    const col = {
        laser: "#E5383B",
        echo: "#E9A100",
        range: "#2F7DD3",
        time: "#5C6BC0",
        quad: "#129B8E",
        shahed: "#8E5BC9",
        ds: "#555555",
        bg: "#7A8B3E",
        atm: "#78909C",
        noise: "#9AA0A6",
        hist: "#44546A",
        thr: "#C2185B",
        speed: "#43A047",
        cam: "#D1679F",
        mount: "#8D6E63",
        mis: "#F57C00",
        tag: "#222222",
        hit: "#43A047",
        miss: "#B5B5B5",
        text: "#444444",
        light_text: "#888888",
        grid: "#E6E6E6",
        axis: "#9A9A9A",
        sky_top: "#BFD9F2",
        sky_bottom: "#EEF4FA",
    };

    function hex_rgb(hex) {
        let v = parseInt(hex.slice(1), 16);
        return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }

    function rgba(hex, a) {
        let c = hex_rgb(hex);
        return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
    }

    function mix(hex_a, hex_b, f) {
        let a = hex_rgb(hex_a), b = hex_rgb(hex_b);
        let c = a.map((x, i) => round(x + (b[i] - x) * f));
        return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
    }

    /* ------------------------------------------------------------------ */
    /* Formatting                                                         */
    /* ------------------------------------------------------------------ */

    function fmt_int(n) {
        return round(n).toLocaleString("en-US");
    }

    // Detection ranges: rounded to 10 m.
    function fmt_range(m) {
        return fmt_int(round(m / 10) * 10) + " m";
    }

    function fmt_len(m) {
        let a = abs(m);
        if (a < 0.01) return (m * 1000).toFixed(1) + " mm";
        if (a < 0.995) return round(m * 100) + " cm";
        if (a < 9.95) return m.toFixed(1) + " m";
        if (a < 1000) return round(m) + " m";
        if (a < 9995) return (m / 1000).toFixed(2) + " km";
        return (m / 1000).toFixed(1) + " km";
    }

    function fmt_dist(m) {
        if (m < 1000) return round(m) + " m";
        return (m / 1000).toFixed(m < 9995 ? 2 : 1) + " km";
    }

    function fmt_time(s) {
        let a = abs(s);
        if (a < 1e-6) return (s * 1e9).toFixed(a < 1e-8 ? 1 : 0) + " ns";
        if (a < 1e-3) return (s * 1e6).toFixed(a < 1e-5 ? 2 : 1) + " µs";
        if (a < 1) return (s * 1e3).toFixed(a < 1e-2 ? 1 : 0) + " ms";
        return s.toFixed(2) + " s";
    }

    // A measurement time with the rate it allows: "25 ms (40 Hz)".
    function fmt_time_rate(s) {
        let hz = 1 / s;
        return fmt_time(s) + " (" + (hz >= 9.95 ? round(hz) : hz.toFixed(1)) + " Hz)";
    }

    const sup_digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";

    function sup(n) {
        let s = String(n);
        let out = "";
        for (let ch of s) {
            if (ch === "-") out += "⁻";
            else out += sup_digits[+ch];
        }
        return out;
    }

    function fmt_sci(x, digits = 1) {
        if (x === 0) return "0";
        let e = floor(log10(abs(x)));
        let m = x / pow(10, e);
        if (abs(m) >= 9.95 && digits === 1) { m /= 10; e += 1; }
        if (e >= -2 && e <= 3)
            return x.toPrecision(digits + 1).replace(/\.?0+$/, "");
        return m.toFixed(digits) + " × 10" + sup(e);
    }

    function fmt_pct(x) {
        if (x > 0 && x < 0.0001) return "<0.01%";
        if (x >= 0.995) return round(x * 100) + "%";
        if (x >= 0.1) return (x * 100).toFixed(0) + "%";
        if (x >= 0.01) return (x * 100).toFixed(1) + "%";
        return (x * 100).toFixed(2) + "%";
    }

    /* ------------------------------------------------------------------ */
    /* Random numbers                                                     */
    /* ------------------------------------------------------------------ */

    function make_rng(seed) {
        let a = seed >>> 0;
        let spare = null;
        let rng = function() {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        rng.normal = function() {
            if (spare !== null) {
                let s = spare;
                spare = null;
                return s;
            }
            let u, v, s;
            do {
                u = rng() * 2 - 1;
                v = rng() * 2 - 1;
                s = u * u + v * v;
            } while (s >= 1 || s === 0);
            let m = sqrt(-2 * log(s) / s);
            spare = v * m;
            return u * m;
        };
        return rng;
    }

    let global_rng = make_rng(12345);

    /* ------------------------------------------------------------------ */
    /* Slider mappings                                                    */
    /* ------------------------------------------------------------------ */

    function lin_map(a, b) {
        return { to: x => a + (b - a) * x, from: v => (v - a) / (b - a) };
    }

    function log_map(a, b) {
        let la = log(a), lb = log(b);
        return { to: x => exp(la + (lb - la) * x), from: v => (log(v) - la) / (lb - la) };
    }

    /* ------------------------------------------------------------------ */
    /* 2D drawing helpers                                                 */
    /* ------------------------------------------------------------------ */

    function font(ctx, size, weight) {
        ctx.font = (weight ? weight + " " : "") + size + "px IBM Plex Sans, Helvetica Neue, Arial, sans-serif";
    }

    function text(ctx, str, x, y, color, size, align, baseline, weight) {
        font(ctx, size || 14, weight);
        ctx.fillStyle = color || col.text;
        ctx.textAlign = align || "center";
        ctx.textBaseline = baseline || "middle";
        ctx.fillText(str, x, y);
    }

    // Text with a soft halo so it stays legible on top of drawings.
    function halo_text(ctx, str, x, y, color, size, align, baseline, weight, halo) {
        font(ctx, size || 14, weight);
        ctx.textAlign = align || "center";
        ctx.textBaseline = baseline || "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = 4;
        ctx.strokeStyle = halo || "rgba(248,248,248,0.9)";
        ctx.strokeText(str, x, y);
        ctx.fillStyle = color || col.text;
        ctx.fillText(str, x, y);
    }

    // Greedy word wrap of str into lines no wider than maxw.
    function wrap_lines(ctx, str, maxw, size, weight) {
        font(ctx, size || 14, weight);
        let lines = [], cur = "";
        for (let word of str.split(" ")) {
            let next = cur ? cur + " " + word : word;
            if (cur && ctx.measureText(next).width > maxw) {
                lines.push(cur);
                cur = word;
            } else {
                cur = next;
            }
        }
        if (cur)
            lines.push(cur);
        return lines;
    }

    function line(ctx, x0, y0, x1, y1, color, width, dash) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width || 1.5;
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function poly(ctx, pts, color, width, dash, closed) {
        if (pts.length < 2)
            return;
        ctx.strokeStyle = color;
        ctx.lineWidth = width || 1.5;
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++)
            ctx.lineTo(pts[i][0], pts[i][1]);
        if (closed)
            ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function fill_poly(ctx, pts, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++)
            ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fill();
    }

    function circle(ctx, x, y, r, fill, stroke, width) {
        ctx.beginPath();
        ctx.arc(x, y, max(0, r), 0, 2 * pi);
        if (fill) {
            ctx.fillStyle = fill;
            ctx.fill();
        }
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = width || 1.5;
            ctx.stroke();
        }
    }

    function arrow(ctx, x0, y0, x1, y1, color, w, head) {
        let l = hypot(x1 - x0, y1 - y0);
        if (l < 1e-3)
            return;
        head = min(head || w * 4, l * 0.6);
        ctx.fillStyle = color;
        ctx.arrow(x0, y0, x1, y1, w, head * 0.9, head);
        ctx.fill();
    }

    // Double headed dimension line with a label.
    function dimension(ctx, x0, y0, x1, y1, color, label, size, offset_side) {
        let dx = x1 - x0, dy = y1 - y0;
        let l = hypot(dx, dy);
        if (l < 4)
            return;
        let ux = dx / l, uy = dy / l;
        line(ctx, x0, y0, x1, y1, color, 1.2);
        let h = min(6, l / 3);
        for (let s of [-1, 1]) {
            let px = s < 0 ? x0 : x1, py = s < 0 ? y0 : y1;
            fill_poly(ctx, [
                [px, py],
                [px - s * ux * h - uy * h * 0.45, py - s * uy * h + ux * h * 0.45],
                [px - s * ux * h + uy * h * 0.45, py - s * uy * h - ux * h * 0.45]
            ], color);
        }
        if (label) {
            let o = offset_side === undefined ? 1 : offset_side;
            halo_text(ctx, label, (x0 + x1) / 2 - uy * 12 * o, (y0 + y1) / 2 + ux * 12 * o, color, size || 13);
        }
    }

    function round_rect(ctx, x, y, w, h, r, fill, stroke, width) {
        // arcTo throws on a negative radius, so skip degenerate rectangles
        if (!(w > 0) || !(h > 0))
            return;
        ctx.roundRect(x, y, w, h, max(0, r));
        if (fill) {
            ctx.fillStyle = fill;
            ctx.fill();
        }
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = width || 1;
            ctx.stroke();
        }
    }

    function base_font_size(w) {
        return clamp(round(w / 42), 12, 16);
    }

    /* ------------------------------------------------------------------ */
    /* Plots                                                              */
    /* ------------------------------------------------------------------ */

    function nice_ticks(a, b, n) {
        let span = b - a;
        let step = pow(10, floor(log10(span / n)));
        let err = span / n / step;
        if (err >= 7.5) step *= 10;
        else if (err >= 3.5) step *= 5;
        else if (err >= 1.5) step *= 2;
        let out = [];
        for (let v = ceil(a / step - 1e-9) * step; v <= b + step * 1e-9; v += step)
            out.push(abs(v) < step * 1e-9 ? 0 : v);
        return out;
    }

    /*
     * A plot area. opts: xmin, xmax, ymin, ymax, xlog, ylog, xlabel, ylabel,
     * xfmt, yfmt, xticks, yticks, fs (font size), no_yticks, no_xticks.
     */
    function Plot(ctx, x, y, w, h, opts) {
        this.ctx = ctx;
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.o = opts;
        let o = opts;
        let lx0 = o.xlog ? log(o.xmin) : o.xmin, lx1 = o.xlog ? log(o.xmax) : o.xmax;
        let ly0 = o.ylog ? log(o.ymin) : o.ymin, ly1 = o.ylog ? log(o.ymax) : o.ymax;
        this.X = v => x + w * ((o.xlog ? log(v) : v) - lx0) / (lx1 - lx0);
        this.Y = v => y + h - h * ((o.ylog ? log(v) : v) - ly0) / (ly1 - ly0);
        this.invX = px => {
            let t = (px - x) / w;
            let v = lx0 + (lx1 - lx0) * t;
            return o.xlog ? exp(v) : v;
        };
    }

    function log_ticks(a, b) {
        let major = [], minor = [];
        for (let e = floor(log10(a)); e <= ceil(log10(b)); e++) {
            for (let k = 1; k < 10; k++) {
                let v = k * pow(10, e);
                if (v < a * 0.9999 || v > b * 1.0001)
                    continue;
                if (k === 1) major.push(v);
                else minor.push(v);
            }
        }
        return { major, minor };
    }

    Plot.prototype.frame = function() {
        let ctx = this.ctx, o = this.o;
        let fs = o.fs || 13;
        let x = this.x, y = this.y, w = this.w, h = this.h;

        ctx.save();
        ctx.fillStyle = "#fff";
        ctx.fillRect(x, y, w, h);

        let xt, yt, xminor = [], yminor = [];
        if (o.xlog) {
            let t = log_ticks(o.xmin, o.xmax);
            xt = o.xticks || t.major;
            xminor = t.minor;
        } else {
            xt = o.xticks || nice_ticks(o.xmin, o.xmax, o.xn || 5);
        }
        if (o.ylog) {
            let t = log_ticks(o.ymin, o.ymax);
            yt = o.yticks || t.major;
            yminor = t.minor;
        } else {
            yt = o.yticks || nice_ticks(o.ymin, o.ymax, o.yn || 4);
        }

        ctx.lineWidth = 1;
        ctx.strokeStyle = "#F1F1F1";
        for (let v of xminor) {
            let px = round(this.X(v)) + 0.5;
            ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke();
        }
        for (let v of yminor) {
            let py = round(this.Y(v)) + 0.5;
            ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke();
        }
        ctx.strokeStyle = col.grid;
        for (let v of xt) {
            let px = round(this.X(v)) + 0.5;
            ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke();
        }
        for (let v of yt) {
            let py = round(this.Y(v)) + 0.5;
            ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke();
        }

        ctx.strokeStyle = col.axis;
        ctx.strokeRect(round(x) + 0.5, round(y) + 0.5, round(w), round(h));

        let xfmt = o.xfmt || (v => String(v));
        let yfmt = o.yfmt || (v => String(v));
        let cw = ctx.canvas.width / dpr;
        font(ctx, fs - 1);
        if (!o.no_xticks) {
            for (let v of xt) {
                let str = xfmt(v);
                let tw = ctx.measureText(str).width;
                let px = this.X(v);
                // keep the outermost labels inside the canvas
                if (px + tw / 2 > cw - 2) text(ctx, str, cw - 2, y + h + fs * 0.9, col.light_text, fs - 1, "right");
                else if (px - tw / 2 < 2) text(ctx, str, 2, y + h + fs * 0.9, col.light_text, fs - 1, "left");
                else text(ctx, str, px, y + h + fs * 0.9, col.light_text, fs - 1);
            }
        }
        let maxw = 0;
        if (!o.no_yticks) {
            for (let v of yt) {
                let str = yfmt(v);
                maxw = max(maxw, ctx.measureText(str).width);
                text(ctx, str, x - 6, this.Y(v), col.light_text, fs - 1, "right");
            }
        }

        if (o.xlabel)
            text(ctx, o.xlabel, x + w / 2, y + h + fs * 2.3, col.text, fs);
        if (o.ylabel) {
            ctx.save();
            ctx.translate(max(fs * 0.7, x - maxw - 8 - fs * 0.7), y + h / 2);
            ctx.rotate(-pi / 2);
            text(ctx, o.ylabel, 0, 0, col.text, fs);
            ctx.restore();
        }
        ctx.restore();
    };

    Plot.prototype.clip = function() {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(this.x, this.y, this.w, this.h);
        this.ctx.clip();
    };

    Plot.prototype.unclip = function() {
        this.ctx.restore();
    };

    // Plot a function sampled at n points across the x range.
    Plot.prototype.curve = function(f, color, width, dash, n) {
        n = n || 200;
        let o = this.o;
        let pts = [];
        for (let i = 0; i <= n; i++) {
            let t = i / n;
            let v = o.xlog ? exp(log(o.xmin) + (log(o.xmax) - log(o.xmin)) * t) : o.xmin + (o.xmax - o.xmin) * t;
            let fv = f(v);
            if (!isFinite(fv) || (o.ylog && fv <= 0))
                continue;
            pts.push([this.X(v), this.Y(fv)]);
        }
        this.clip();
        poly(this.ctx, pts, color, width || 2, dash);
        this.unclip();
        return pts;
    };

    Plot.prototype.vline = function(v, color, width, dash) {
        let px = this.X(v);
        line(this.ctx, px, this.y, px, this.y + this.h, color, width || 1.5, dash);
    };

    Plot.prototype.hline = function(v, color, width, dash) {
        let py = this.Y(v);
        line(this.ctx, this.x, py, this.x + this.w, py, color, width || 1.5, dash);
    };

    Plot.prototype.dot = function(vx, vy, color, r, stroke) {
        circle(this.ctx, this.X(vx), this.Y(vy), r || 4, color, stroke || "#fff", 1.5);
    };

    function log_fmt_m(v) {
        if (v >= 1000) return (v / 1000) + " km";
        return v + " m";
    }

    function pow10_fmt(v) {
        let e = round(log10(v));
        if (e === 0) return "1";
        if (e === 1) return "10";
        return "10" + sup(e);
    }

    /*
     * Center of an echo from binned values around a peak index. Fits a
     * Gaussian through the peak and the bins k to each side of it (exact for
     * a Gaussian echo), falling back to a centroid when noise makes a value
     * non-positive. x_of(i) is the range at the center of bin i. Range
     * finders interpolate like this to report distances more finely than
     * their bins.
     */
    function echo_center(vals, peak, x_of, k) {
        k = k || 1;
        if (peak - k >= 0 && peak + k < vals.length) {
            let a = vals[peak - k], b = vals[peak], c = vals[peak + k];
            if (a > 0 && b > 0 && c > 0) {
                let la = log(a), lb = log(b), lc = log(c);
                let den = la - 2 * lb + lc;
                if (den < -1e-9) {
                    let dlt = clamp(0.5 * (la - lc) / den, -1, 1) * k;
                    return x_of(peak) + dlt * (x_of(peak + 1) - x_of(peak));
                }
            }
        }
        let sw = 0, sx = 0;
        for (let i = max(0, peak - 2); i <= min(vals.length - 1, peak + 2); i++) {
            let wv = max(0, vals[i]);
            sw += wv;
            sx += wv * x_of(i);
        }
        return sw > 0 ? sx / sw : x_of(peak);
    }

    // Distances as the module reports them: 0.1 m steps.
    function fmt_reported(m) {
        return (round(m * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " m";
    }

    /* ------------------------------------------------------------------ */
    /* Beam footprint heat map                                            */
    /* ------------------------------------------------------------------ */

    // Offscreen image of the beam's footprint: a square (the DLEM 20's beam
    // is symmetrical) with edges blurred as in the model, relative to its
    // half width h. The image covers +-2 h.
    let beam_image_cache = {};

    function beam_edge_ratio() {
        return spec.edge_blur_mrad / (spec.divergence_mrad / 2);
    }

    // Brightness across one axis, 1 in the middle, u in units of the half width.
    function beam_profile_1d(u) {
        let b = beam_edge_ratio();
        return (M.norm_cdf((u + 1) / b) - M.norm_cdf((u - 1) / b)) / (2 * M.norm_cdf(1 / b) - 1);
    }

    // gamma < 1 brightens the dim edges, closer to how the eye sees a spot
    function beam_image(hex, peak_alpha, gamma) {
        gamma = gamma || 1;
        let key = hex + peak_alpha + "/" + gamma;
        if (beam_image_cache[key])
            return beam_image_cache[key];
        let n = 160;
        let c = document.createElement("canvas");
        c.width = n;
        c.height = n;
        let g = c.getContext("2d");
        let img = g.createImageData(n, n);
        let rgb = hex_rgb(hex);
        let prof = [];
        for (let i = 0; i < n; i++)
            prof.push(beam_profile_1d((i + 0.5) / n * 4 - 2));
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                let I = pow(prof[i] * prof[j], gamma);
                let k = (j * n + i) * 4;
                img.data[k + 0] = rgb[0];
                img.data[k + 1] = rgb[1];
                img.data[k + 2] = rgb[2];
                img.data[k + 3] = round(255 * peak_alpha * min(1, I));
            }
        }
        g.putImageData(img, 0, 0);
        beam_image_cache[key] = c;
        return c;
    }

    // Draw the footprint with half width h_px centered at (x, y).
    function draw_beam_spot(ctx, x, y, h_px, hex, alpha, gamma) {
        let img = beam_image(hex || col.laser, alpha === undefined ? 0.85 : alpha, gamma);
        ctx.drawImage(img, x - 2 * h_px, y - 2 * h_px, 4 * h_px, 4 * h_px);
    }

    // Outline of the footprint's nominal edge (half width h_px).
    function beam_outline(ctx, x, y, h_px, color, width, dash) {
        ctx.strokeStyle = color || col.laser;
        ctx.lineWidth = width || 1.5;
        ctx.setLineDash(dash || []);
        ctx.strokeRect(x - h_px, y - h_px, 2 * h_px, 2 * h_px);
        ctx.setLineDash([]);
    }

    /* ------------------------------------------------------------------ */
    /* Sprites                                                            */
    /* ------------------------------------------------------------------ */

    // A small range finder seen from the side, emitting toward +x.
    function draw_lrf_side(ctx, x, y, s) {
        round_rect(ctx, x - 2.2 * s, y - s * 0.8, 2.2 * s, s * 1.6, s * 0.25, "#3A3F45");
        round_rect(ctx, x - 0.2 * s, y - s * 0.55, 0.32 * s, s * 0.5, s * 0.08, "#222");
        circle(ctx, x + 0.05 * s, y - s * 0.3, s * 0.16, col.laser);
        round_rect(ctx, x - 0.2 * s, y + s * 0.05, 0.32 * s, s * 0.6, s * 0.08, "#222");
        circle(ctx, x + 0.05 * s, y + s * 0.35, s * 0.22, "#5B6B7F");
    }

    // A camera seen from above, looking toward -y (up the screen).
    function draw_camera_top(ctx, x, y, s, color) {
        round_rect(ctx, x - s, y - s * 0.2, 2 * s, s * 1.6, s * 0.2, color || "#5E5368");
        round_rect(ctx, x - s * 0.6, y - s * 0.9, s * 1.2, s * 0.75, s * 0.12, "#333");
    }

    function draw_lrf_top(ctx, x, y, s) {
        round_rect(ctx, x - s * 0.55, y - s * 0.4, s * 1.1, s * 2.0, s * 0.15, "#3A3F45");
        round_rect(ctx, x - s * 0.45, y - s * 0.55, s * 0.9, s * 0.2, s * 0.05, "#222");
    }

    /*
     * A quad seen roughly from the side and slightly above.
     * size_px is the motor to motor width in pixels.
     */
    // exact: draw every part at its true size, without the minimum sizes that
    // keep tiny sprites visible (for renders that compute pixel coverage)
    function draw_quad_sprite(ctx, cx, cy, size_px, color, t, tilt, exact) {
        color = color || "#2D3439";
        if (size_px < 3 && !exact) {
            circle(ctx, cx, cy, max(0.6, size_px * 0.3), color);
            return;
        }
        let s = size_px / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt || 0);

        // props: flat ellipses above each motor
        let prop_r = s * 0.62;
        for (let k of [-1, 1]) {
            for (let d of [0.55, 1]) {
                let px = k * s * d;
                let py = -s * 0.2 - (d < 1 ? s * 0.06 : 0);
                ctx.fillStyle = "rgba(60,70,80,0.18)";
                ctx.beginPath();
                ctx.ellipse(px, py, prop_r * d, prop_r * 0.12 * d + (exact ? 0 : 0.4), 0, 0, 2 * pi);
                ctx.fill();
            }
        }

        // arms
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        ctx.lineWidth = exact ? s * 0.07 : max(1, s * 0.07);
        ctx.beginPath();
        ctx.moveTo(-s, -s * 0.05);
        ctx.lineTo(s, -s * 0.05);
        ctx.moveTo(-s * 0.55, -s * 0.12);
        ctx.lineTo(s * 0.55, -s * 0.12);
        ctx.stroke();

        // body and battery
        round_rect(ctx, -s * 0.28, -s * 0.18, s * 0.56, s * 0.22, s * 0.05, color);
        round_rect(ctx, -s * 0.36, -s * 0.42, s * 0.72, s * 0.24, s * 0.06, "#C9A227");
        // camera
        round_rect(ctx, s * 0.22, -s * 0.12, s * 0.14, s * 0.12, s * 0.03, "#111");

        // motors
        for (let k of [-1, 1]) {
            for (let d of [0.55, 1]) {
                round_rect(ctx, k * s * d - s * 0.07, -s * 0.2, s * 0.14, s * 0.16, s * 0.03, d < 1 ? "#444" : "#222");
            }
        }
        ctx.restore();
    }

    // Quad seen from straight above or below (X frame). size_px: motor to motor diagonal.
    function draw_quad_top(ctx, cx, cy, size_px, color, rot) {
        color = color || "#2D3439";
        let s = size_px / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot || 0);
        for (let k = 0; k < 4; k++) {
            let a = pi / 4 + k * pi / 2;
            let mx = cos(a) * s, my = sin(a) * s;
            circle(ctx, mx, my, s * 0.6, "rgba(60,70,80,0.13)");
        }
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        ctx.lineWidth = max(1, s * 0.12);
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
            let a = pi / 4 + k * pi / 2;
            ctx.moveTo(0, 0);
            ctx.lineTo(cos(a) * s, sin(a) * s);
        }
        ctx.stroke();
        round_rect(ctx, -s * 0.22, -s * 0.38, s * 0.44, s * 0.76, s * 0.08, color);
        for (let k = 0; k < 4; k++) {
            let a = pi / 4 + k * pi / 2;
            circle(ctx, cos(a) * s, sin(a) * s, s * 0.11, "#222");
        }
        ctx.restore();
    }

    // Shahed-136 seen head on. span_px is the wingspan in pixels.
    function draw_shahed_front(ctx, cx, cy, span_px, color, exact) {
        color = color || "#6B6F73";
        if (span_px < 3 && !exact) {
            circle(ctx, cx, cy, 0.8, color);
            return;
        }
        let k = span_px / 2.5;
        ctx.save();
        ctx.translate(cx, cy);
        // wings
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(-1.25 * k, -0.02 * k);
        ctx.lineTo(-0.2 * k, -0.06 * k);
        ctx.lineTo(0.2 * k, -0.06 * k);
        ctx.lineTo(1.25 * k, -0.02 * k);
        ctx.lineTo(1.25 * k, 0.02 * k);
        ctx.lineTo(0.2 * k, 0.06 * k);
        ctx.lineTo(-0.2 * k, 0.06 * k);
        ctx.lineTo(-1.25 * k, 0.02 * k);
        ctx.closePath();
        ctx.fill();
        // fins
        let fw = exact ? 0.02 * k : max(0.8, 0.02 * k);
        ctx.fillRect(-1.25 * k - fw / 2, -0.3 * k, fw, 0.55 * k);
        ctx.fillRect(1.25 * k - fw / 2, -0.3 * k, fw, 0.55 * k);
        // fuselage
        circle(ctx, 0, 0, 0.225 * k, color);
        circle(ctx, 0, 0, 0.12 * k, "rgba(0,0,0,0.15)");
        ctx.restore();
    }

    // Shahed-136 from the side, flying toward +x. len_px is its length in pixels.
    function draw_shahed_side(ctx, cx, cy, len_px, color, dir) {
        color = color || "#6B6F73";
        let k = len_px / 3.5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(dir || 1, 1);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(1.75 * k, 0);
        ctx.quadraticCurveTo(1.7 * k, -0.2 * k, 1.3 * k, -0.21 * k);
        ctx.lineTo(-1.5 * k, -0.2 * k);
        ctx.lineTo(-1.15 * k, -0.62 * k);
        ctx.lineTo(-1.6 * k, -0.62 * k);
        ctx.lineTo(-1.75 * k, -0.15 * k);
        ctx.lineTo(-1.75 * k, 0.15 * k);
        ctx.lineTo(-1.5 * k, 0.2 * k);
        ctx.lineTo(1.3 * k, 0.21 * k);
        ctx.quadraticCurveTo(1.7 * k, 0.2 * k, 1.75 * k, 0);
        ctx.fill();
        // pusher prop blur
        ctx.fillStyle = "rgba(40,40,40,0.25)";
        ctx.fillRect(-1.85 * k, -0.4 * k, 0.06 * k, 0.8 * k);
        ctx.restore();
    }

    // Shahed-136 planform, nose toward -y (up the screen). len_px: length in pixels.
    function draw_shahed_top(ctx, cx, cy, len_px, color) {
        color = color || "#6B6F73";
        let k = len_px / 3.5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -1.75 * k);
        ctx.quadraticCurveTo(0.22 * k, -1.6 * k, 0.22 * k, -1.2 * k);
        ctx.lineTo(0.22 * k, -0.6 * k);
        ctx.lineTo(1.25 * k, 1.0 * k);
        ctx.lineTo(1.25 * k, 1.6 * k);
        ctx.lineTo(0.22 * k, 1.6 * k);
        ctx.lineTo(0.18 * k, 1.75 * k);
        ctx.lineTo(-0.18 * k, 1.75 * k);
        ctx.lineTo(-0.22 * k, 1.6 * k);
        ctx.lineTo(-1.25 * k, 1.6 * k);
        ctx.lineTo(-1.25 * k, 1.0 * k);
        ctx.lineTo(-0.22 * k, -0.6 * k);
        ctx.lineTo(-0.22 * k, -1.2 * k);
        ctx.quadraticCurveTo(-0.22 * k, -1.6 * k, 0, -1.75 * k);
        ctx.fill();
        ctx.restore();
    }

    // Draw a model silhouette (rectangles in meters) at (cx, cy), ppm pixels per meter.
    function draw_silhouette(ctx, target, cx, cy, ppm, color) {
        for (let s of target.shapes) {
            let f = s.fill === undefined ? 1 : s.fill;
            let x0 = cx + s.x0 * ppm, x1 = cx + s.x1 * ppm;
            let y0 = cy - s.y1 * ppm, y1 = cy - s.y0 * ppm;
            if (f < 0.5) {
                // a spinning prop: draw as a translucent disk of the same area
                let area = (x1 - x0) * (y1 - y0);
                let r = sqrt(area / pi);
                if (s.y1 - s.y0 < 0.03) {
                    ctx.fillStyle = rgba(color, 0.3);
                    ctx.fillRect(x0, y0, x1 - x0, max(1, y1 - y0));
                } else {
                    circle(ctx, (x0 + x1) / 2, (y0 + y1) / 2, r, rgba(color, 0.18), rgba(color, 0.35), 1);
                }
            } else {
                ctx.fillStyle = color;
                ctx.fillRect(x0, y0, max(0.75, x1 - x0), max(0.75, y1 - y0));
            }
        }
    }

    // A tree line for side views: bumpy olive band.
    function draw_tree_line(ctx, x0, x1, y_base, height, seed) {
        let rng = make_rng(seed || 7);
        ctx.fillStyle = col.bg;
        ctx.beginPath();
        ctx.moveTo(x0, y_base);
        let n = max(4, floor((x1 - x0) / (height * 0.5)));
        for (let i = 0; i <= n; i++) {
            let x = x0 + (x1 - x0) * i / n;
            let h = height * (0.75 + 0.35 * rng());
            ctx.lineTo(x, y_base - h);
        }
        ctx.lineTo(x1, y_base);
        ctx.closePath();
        ctx.fill();
    }

    // A generic AprilTag looking pattern (8x8 cells: white border, black border, 6x6 data).
    const TAG_BITS = [
        1, 0, 1, 1, 0, 1,
        0, 1, 0, 0, 1, 1,
        1, 1, 0, 1, 0, 0,
        0, 0, 1, 0, 1, 1,
        1, 0, 1, 1, 1, 0,
        0, 1, 0, 0, 1, 1,
    ];

    // Draw the tag through a mapping from tag coordinates (u, v in [-0.5, 0.5],
    // spanning the black border) to screen coordinates.
    function draw_tag(ctx, map, options) {
        options = options || {};
        let corners = (u0, v0, u1, v1) => [map(u0, v0), map(u1, v0), map(u1, v1), map(u0, v1)];
        // white margin
        let m = 0.125;
        fill_poly(ctx, corners(-0.5 - m, -0.5 - m, 0.5 + m, 0.5 + m), options.paper || "#fff");
        fill_poly(ctx, corners(-0.5, -0.5, 0.5, 0.5), col.tag);
        let cell = 1 / 8;
        for (let j = 0; j < 6; j++) {
            for (let i = 0; i < 6; i++) {
                if (!TAG_BITS[j * 6 + i])
                    continue;
                let u0 = -0.5 + cell * (i + 1), v0 = -0.5 + cell * (j + 1);
                fill_poly(ctx, corners(u0 - 0.002, v0 - 0.002, u0 + cell + 0.002, v0 + cell + 0.002), "#fff");
            }
        }
        if (options.outline)
            poly(ctx, corners(-0.5 - m, -0.5 - m, 0.5 + m, 0.5 + m), "rgba(0,0,0,0.25)", 1, null, true);
    }
