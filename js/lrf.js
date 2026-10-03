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
    // 4 cm to the right of the camera and 8 mm below it, and is tilted by a
    // small, "unknown" misalignment that calibration has to discover.
    const TRUE_MOUNT = { offset_m: [0.04, 0.008, 0], yaw_mrad: 1.3, pitch_mrad: -0.8 };

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

    // Offscreen image of a Gaussian spot. The 1/e^2 radius is a quarter of
    // the image's width, so the image covers +-2 w.
    let beam_image_cache = {};

    function beam_image(hex, peak_alpha) {
        let key = hex + peak_alpha;
        if (beam_image_cache[key])
            return beam_image_cache[key];
        let n = 160;
        let c = document.createElement("canvas");
        c.width = n;
        c.height = n;
        let g = c.getContext("2d");
        let img = g.createImageData(n, n);
        let rgb = hex_rgb(hex);
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                let x = (i + 0.5) / n * 4 - 2;
                let y = (j + 0.5) / n * 4 - 2;
                let I = exp(-2 * (x * x + y * y));
                let k = (j * n + i) * 4;
                img.data[k + 0] = rgb[0];
                img.data[k + 1] = rgb[1];
                img.data[k + 2] = rgb[2];
                img.data[k + 3] = round(255 * peak_alpha * I);
            }
        }
        g.putImageData(img, 0, 0);
        beam_image_cache[key] = c;
        return c;
    }

    // Draw a Gaussian spot with 1/e^2 radius w_px centered at (x, y).
    function draw_beam_spot(ctx, x, y, w_px, hex, alpha) {
        let img = beam_image(hex || col.laser, alpha === undefined ? 0.85 : alpha);
        ctx.drawImage(img, x - 2 * w_px, y - 2 * w_px, 4 * w_px, 4 * w_px);
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
    function draw_quad_sprite(ctx, cx, cy, size_px, color, t, tilt) {
        color = color || "#2D3439";
        if (size_px < 3) {
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
                ctx.ellipse(px, py, prop_r * d, prop_r * 0.12 * d + 0.4, 0, 0, 2 * pi);
                ctx.fill();
            }
        }

        // arms
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        ctx.lineWidth = max(1, s * 0.07);
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
    function draw_shahed_front(ctx, cx, cy, span_px, color) {
        color = color || "#6B6F73";
        if (span_px < 3) {
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
        let fw = max(0.8, 0.02 * k);
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

    /* ------------------------------------------------------------------ */
    /* Tiny 3D renderer (flat shaded polygons, painter's algorithm)        */
    /* World: meters, z up.                                               */
    /* ------------------------------------------------------------------ */

    function v3_add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
    function v3_sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function v3_scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
    function v3_dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function v3_cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function v3_len(a) { return sqrt(v3_dot(a, a)); }
    function v3_norm(a) { let l = v3_len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

    // 4x4 row major transforms (compatible with base.js mat4 helpers).
    function xf_point(T, p) {
        let r = mat4_mul_vec3(T, p);
        return [r[0], r[1], r[2]];
    }

    function xf_dir(T, d) {
        return [T[0] * d[0] + T[1] * d[1] + T[2] * d[2],
            T[4] * d[0] + T[5] * d[1] + T[6] * d[2],
            T[8] * d[0] + T[9] * d[1] + T[10] * d[2]];
    }

    function Scene3D() {
        this.items = [];
        this.ground = [];
    }

    Scene3D.prototype.face = function(pts, color, alpha, double_sided, unlit) {
        this.items.push({ kind: 0, pts, color: hex_rgb(color), alpha: alpha === undefined ? 1 : alpha, ds: !!double_sided, unlit: !!unlit });
    };

    Scene3D.prototype.line = function(a, b, color, width, alpha) {
        this.items.push({ kind: 1, a, b, color, width: width || 1.5, alpha: alpha === undefined ? 1 : alpha });
    };

    Scene3D.prototype.dot = function(p, color, r) {
        this.items.push({ kind: 2, p, color, r: r || 3 });
    };

    // Axis aligned (in the frame of T) box centered at c with size s.
    Scene3D.prototype.box = function(T, c, s, color, alpha) {
        let hx = s[0] / 2, hy = s[1] / 2, hz = s[2] / 2;
        let P = [];
        for (let i = 0; i < 8; i++) {
            P.push(xf_point(T, [c[0] + (i & 1 ? hx : -hx), c[1] + (i & 2 ? hy : -hy), c[2] + (i & 4 ? hz : -hz)]));
        }
        let F = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
        for (let f of F)
            this.face(f.map(i => P[i]), color, alpha);
    };

    // Cylinder in the frame of T, from point a along unit axis (0: x, 1: y, 2: z) with length h.
    Scene3D.prototype.cylinder = function(T, a, axis, r, h, n, color, cap_color, alpha) {
        n = n || 16;
        let ring = (off) => {
            let out = [];
            for (let i = 0; i < n; i++) {
                let t = 2 * pi * i / n;
                let p = a.slice();
                let u = cos(t) * r, v = sin(t) * r;
                if (axis === 0) { p[0] += off; p[1] += u; p[2] += v; }
                else if (axis === 1) { p[1] += off; p[0] += v; p[2] += u; }
                else { p[2] += off; p[0] += u; p[1] += v; }
                out.push(xf_point(T, p));
            }
            return out;
        };
        let r0 = ring(0), r1 = ring(h);
        for (let i = 0; i < n; i++) {
            let j = (i + 1) % n;
            this.face([r0[i], r0[j], r1[j], r1[i]], color, alpha, true);
        }
        this.face(r0.slice().reverse(), cap_color || color, alpha, true);
        this.face(r1, cap_color || color, alpha, true);
    };

    // Flat disk in the frame of T, centered at c, normal along axis.
    Scene3D.prototype.disk = function(T, c, axis, r, n, color, alpha) {
        let pts = [];
        for (let i = 0; i < n; i++) {
            let t = 2 * pi * i / n;
            let p = c.slice();
            let u = cos(t) * r, v = sin(t) * r;
            if (axis === 0) { p[1] += u; p[2] += v; }
            else if (axis === 1) { p[0] += v; p[2] += u; }
            else { p[0] += u; p[1] += v; }
            pts.push(xf_point(T, p));
        }
        this.face(pts, color, alpha, true);
    };

    function Camera3D(width, height, yaw, pitch, dist, target, fov) {
        this.w = width;
        this.h = height;
        let cp = cos(pitch);
        this.eye = [target[0] + dist * cp * cos(yaw), target[1] + dist * cp * sin(yaw), target[2] + dist * sin(pitch)];
        this.fwd = v3_norm(v3_sub(target, this.eye));
        this.right = v3_norm(v3_cross(this.fwd, [0, 0, 1]));
        this.up = v3_cross(this.right, this.fwd);
        this.f = (height / 2) / tan(fov / 2);
    }

    Camera3D.prototype.project = function(p) {
        let d = v3_sub(p, this.eye);
        let z = v3_dot(d, this.fwd);
        if (z < 0.01)
            return null;
        return [this.w / 2 + this.f * v3_dot(d, this.right) / z, this.h / 2 - this.f * v3_dot(d, this.up) / z, z];
    };

    const LIGHT = v3_norm([0.4, -0.5, 0.8]);

    Scene3D.prototype.render = function(ctx, camera) {
        let list = [];
        for (let it of this.items) {
            if (it.kind === 0) {
                let P = [];
                let ok = true;
                for (let p of it.pts) {
                    let q = camera.project(p);
                    if (!q) { ok = false; break; }
                    P.push(q);
                }
                if (!ok)
                    continue;
                let n = v3_norm(v3_cross(v3_sub(it.pts[1], it.pts[0]), v3_sub(it.pts[2], it.pts[0])));
                if (!isFinite(n[0]))
                    continue;
                let front = v3_dot(n, v3_sub(camera.eye, it.pts[0])) > 0;
                if (!front) {
                    if (!it.ds)
                        continue;
                    n = v3_scale(n, -1);
                }
                let shade = it.unlit ? 1 : 0.55 + 0.45 * max(0, v3_dot(n, LIGHT));
                let depth = 0;
                for (let q of P) depth += q[2];
                depth /= P.length;
                let c = it.color;
                list.push({ depth, draw: () => {
                    ctx.fillStyle = "rgba(" + round(c[0] * shade) + "," + round(c[1] * shade) + "," + round(c[2] * shade) + "," + it.alpha + ")";
                    ctx.beginPath();
                    ctx.moveTo(P[0][0], P[0][1]);
                    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
                    ctx.closePath();
                    ctx.fill();
                    if (it.alpha === 1) {
                        ctx.strokeStyle = ctx.fillStyle;
                        ctx.lineWidth = 0.6;
                        ctx.stroke();
                    }
                } });
            } else if (it.kind === 1) {
                let a = camera.project(it.a), b = camera.project(it.b);
                if (!a || !b)
                    continue;
                list.push({ depth: (a[2] + b[2]) / 2 - 1e-3, draw: () => {
                    ctx.globalAlpha = it.alpha;
                    line(ctx, a[0], a[1], b[0], b[1], it.color, it.width);
                    ctx.globalAlpha = 1;
                } });
            } else {
                let a = camera.project(it.p);
                if (!a)
                    continue;
                list.push({ depth: a[2] - 1e-3, draw: () => circle(ctx, a[0], a[1], it.r, it.color) });
            }
        }
        list.sort((a, b) => b.depth - a.depth);
        for (let it of list)
            it.draw();
    };

    // Ground plane with a fading grid, drawn before everything else.
    function draw_ground(ctx, camera, extent, step, base_color) {
        let corners = [[-extent, -extent, 0], [extent, -extent, 0], [extent, extent, 0], [-extent, extent, 0]];
        // horizon line: project a far point straight ahead
        let far = v3_add(camera.eye, v3_scale([camera.fwd[0], camera.fwd[1], 0], 1e4));
        let hz = camera.project(far);
        let horizon = hz ? hz[1] : -1e4;
        ctx.fillStyle = base_color || "#E3E8D8";
        ctx.fillRect(0, max(0, horizon), camera.w, camera.h);
        ctx.lineWidth = 1;
        for (let i = -extent; i <= extent + 1e-6; i += step) {
            for (let dir = 0; dir < 2; dir++) {
                let n = 24;
                let pts = [];
                for (let k = 0; k <= n; k++) {
                    let t = -extent + 2 * extent * k / n;
                    let p = dir ? [i, t, 0] : [t, i, 0];
                    let q = camera.project(p);
                    if (q) pts.push(q);
                    else pts.push(null);
                }
                for (let k = 0; k < n; k++) {
                    if (!pts[k] || !pts[k + 1])
                        continue;
                    let z = (pts[k][2] + pts[k + 1][2]) / 2;
                    let a = clamp(0.35 * (1 - z / (extent * 1.6)), 0, 0.35);
                    ctx.strokeStyle = "rgba(90,110,70," + a.toFixed(3) + ")";
                    ctx.beginPath();
                    ctx.moveTo(pts[k][0], pts[k][1]);
                    ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
                    ctx.stroke();
                }
            }
        }
        return horizon;
    }

    function draw_sky(ctx, w, h, horizon) {
        let g = ctx.createLinearGradient(0, 0, 0, max(1, horizon));
        g.addColorStop(0, col.sky_top);
        g.addColorStop(1, col.sky_bottom);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
    }

    /*
     * The pan/tilt turret. pan rotates about z (0 faces +y), tilt raises
     * the nose. Returns frames of the camera and the LRF in world space.
     */
    function build_turret(sc, pan, tilt, opts) {
        opts = opts || {};
        let base = opts.base || [0, 0, 0];
        let s = opts.scale || 1;
        let T0 = mat4_mul(translation_mat4(base), scale_mat4(s));
        let Tp = mat4_mul(T0, rot_z_mat4(pan));
        let Tt = mat4_mul(Tp, mat4_mul(translation_mat4([0, 0, 0.19]), rot_x_mat4(tilt)));

        // base and pan stage
        sc.cylinder(T0, [0, 0, 0], 2, 0.095, 0.05, 20, "#4B5157", "#5A6168");
        sc.cylinder(Tp, [0, 0, 0.05], 2, 0.078, 0.025, 20, "#6B737B", "#7A838C");
        // yoke
        sc.box(Tp, [-0.092, 0, 0.14], [0.018, 0.05, 0.13], "#6B737B");
        sc.box(Tp, [0.092, 0, 0.14], [0.018, 0.05, 0.13], "#6B737B");
        sc.box(Tp, [0, 0, 0.0825], [0.2, 0.05, 0.015], "#6B737B");
        // tilt shafts
        sc.cylinder(Tt, [-0.083, 0, 0], 0, 0.009, 0.012, 10, "#333");
        sc.cylinder(Tt, [0.071, 0, 0], 0, 0.009, 0.012, 10, "#333");
        // plate
        sc.box(Tt, [-0.006, 0.005, -0.008], [0.154, 0.13, 0.012], opts.plate_color || "#A1887F");
        // camera body and lens
        sc.box(Tt, [-0.03, 0.0, 0.026], [0.05, 0.085, 0.05], "#4E4359");
        sc.cylinder(Tt, [-0.03, 0.0425, 0.026], 1, 0.021, 0.034, 18, "#2C2C2C", "#1E2A44");
        sc.disk(Tt, [-0.03, 0.077, 0.026], 1, 0.015, 18, "#3D5A80");
        // LRF module (50 x 22 x 34 mm)
        sc.box(Tt, [0.016, 0.02, 0.019], [0.022, 0.05, 0.034], "#3A3F45");
        sc.disk(Tt, [0.010, 0.0452, 0.012], 1, 0.0045, 12, "#B71C1C");
        sc.disk(Tt, [0.019, 0.0452, 0.026], 1, 0.0065, 14, "#263238");

        let R = Tt;
        return {
            T: Tt,
            cam_origin: xf_point(Tt, [-0.03, 0.077, 0.026]),
            lrf_origin: xf_point(Tt, [0.010, 0.046, 0.012]),
            fwd: v3_norm(xf_dir(R, [0, 1, 0])),
            right: v3_norm(xf_dir(R, [1, 0, 0])),
            up: v3_norm(xf_dir(R, [0, 0, 1])),
        };
    }

    // 10 inch quad. pos: center, yaw: heading, s: scale factor, t: time (for props).
    function build_quad3d(sc, pos, yaw, s, t) {
        let T = mat4_mul(translation_mat4(pos), mat4_mul(rot_z_mat4(yaw), scale_mat4(s)));
        sc.box(T, [0, 0, 0], [0.06, 0.12, 0.03], "#30363B");
        sc.box(T, [0, -0.01, 0.035], [0.05, 0.15, 0.04], "#C9A227");
        sc.box(T, [0, 0.065, 0.004], [0.03, 0.02, 0.025], "#111");
        for (let k = 0; k < 4; k++) {
            let a = pi / 4 + k * pi / 2;
            let Ta = mat4_mul(T, rot_z_mat4(a));
            sc.box(Ta, [0.11, 0, 0], [0.2, 0.022, 0.008], "#2B2F33");
            let m = [0.215 * cos(0), 0, 0];
            sc.cylinder(Ta, [m[0], 0, 0.004], 2, 0.016, 0.022, 10, "#1F2326", "#3A3F44");
            sc.disk(Ta, [m[0], 0, 0.03], 2, 0.127, 20, "#8899A6", 0.18);
        }
        return T;
    }

    // Shahed-136: pos is the center, heading is the direction of flight (radians about z).
    function build_shahed3d(sc, pos, heading, s) {
        let T = mat4_mul(translation_mat4(pos), mat4_mul(rot_z_mat4(heading - pi / 2), scale_mat4(s)));
        // fuselage along +y (nose)
        let c = "#7A7F84";
        let n = 10;
        let ring = (y, r) => {
            let out = [];
            for (let i = 0; i < n; i++) {
                let t = 2 * pi * i / n;
                out.push(xf_point(T, [cos(t) * r, y, sin(t) * r]));
            }
            return out;
        };
        let stations = [[1.75, 0.02], [1.6, 0.14], [1.3, 0.21], [-1.5, 0.2], [-1.75, 0.12]];
        let rings = stations.map(st => ring(st[0], st[1]));
        for (let k = 0; k + 1 < rings.length; k++) {
            for (let i = 0; i < n; i++) {
                let j = (i + 1) % n;
                sc.face([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], c, 1, true);
            }
        }
        sc.face(rings[rings.length - 1], "#555", 1, true);
        // cropped delta wings
        let wing = side => [
            [side * 0.2, 0.9, 0], [side * 1.25, -1.0, 0], [side * 1.25, -1.6, 0], [side * 0.2, -1.6, 0]
        ].map(p => xf_point(T, p));
        sc.face(wing(1), "#868B90", 1, true);
        sc.face(wing(-1), "#868B90", 1, true);
        // wingtip fins
        for (let side of [-1, 1]) {
            sc.face([[side * 1.25, -0.95, -0.25], [side * 1.25, -1.6, -0.25], [side * 1.25, -1.6, 0.3], [side * 1.25, -1.15, 0.3]]
                .map(p => xf_point(T, p)), "#6E7378", 1, true);
        }
        // pusher prop
        sc.disk(T, [0, -1.8, 0], 1, 0.4, 16, "#444", 0.2);
        return T;
    }

    function build_tree(sc, pos, h, color) {
        let T = translation_mat4(pos);
        sc.cylinder(T, [0, 0, 0], 2, h * 0.05, h * 0.3, 6, "#6D5845");
        let n = 8, r = h * 0.28;
        let tip = [pos[0], pos[1], pos[2] + h];
        let pts = [];
        for (let i = 0; i < n; i++) {
            let t = 2 * pi * i / n;
            pts.push([pos[0] + cos(t) * r, pos[1] + sin(t) * r, pos[2] + h * 0.25]);
        }
        for (let i = 0; i < n; i++)
            sc.face([pts[i], pts[(i + 1) % n], tip], color || "#6E8B3D", 1, true);
    }

    /* ------------------------------------------------------------------ */
    /* Demo framework                                                     */
    /* ------------------------------------------------------------------ */

    /*
     * A scene is an object with:
     *   draw(ctx, d, w, h, dt)   required
     *   sliders: [{ map, def, fmt?, anim?, on? }]
 *                                  map from lin_map/log_map, def in physical units,
 *                                  fmt(v) -> text shown next to the slider,
 *                                  anim: { mode: "pingpong" | "loop", period, lo, hi, hold }
 *                                  moves the slider by itself (lo/hi in slider units,
 *                                  0 to 1) until the reader grabs it,
 *                                  visible(d) -> false hides the slider's row (e.g. when
 *                                  a segmented control makes it irrelevant)
     *   segs: [[labels...]]            segmented controls (id_seg0, id_seg1, ...)
     *   animated: bool                 runs every frame while visible, with play/pause
     *   reset(d)                       adds a restart button
     *   init(d)                        called once before controls are created
     *   drag: { begin(d,x,y)->bool, move(d,x,y), end(d), cursor(d,x,y)->css }
     *   orbit: bool                    dragging rotates d.st.yaw / d.st.pitch
     *   hover(d, x, y)                 x, y are null when the pointer leaves
     *   on_spec(d)                     the global spec changed
     *   on_seg(d, i, k), on_set(d), special(d, i, name) -> value
     *
     * d.v[i] holds slider i's physical value, d.seg[i] the selected segment,
     * d.st is free scene state, d.t the animation time in seconds.
     */
    const SCENES = {};
    let all_demos = [];

    // Slider position (0 to 1) of an automatic slider animation at time t.
    function anim_x(a, t) {
        let lo = a.lo === undefined ? 0 : a.lo, hi = a.hi === undefined ? 1 : a.hi;
        let P = a.period || 10;
        if (a.mode === "loop") {
            let hold = a.hold === undefined ? 1 : a.hold;
            let u = (t % (P + hold)) / P;
            return lo + (hi - lo) * min(1, u);
        }
        return lo + (hi - lo) * (0.5 - 0.5 * cos(2 * pi * t / P));
    }

    // Time at which the animation passes through slider position x (rising).
    function anim_phase(a, x) {
        let lo = a.lo === undefined ? 0 : a.lo, hi = a.hi === undefined ? 1 : a.hi;
        let P = a.period || 10;
        let u = clamp((x - lo) / (hi - lo), 0, 1);
        if (a.mode === "loop")
            return u * P;
        return Math.acos(1 - 2 * u) / (2 * pi) * P;
    }

    function Demo(id, scene) {
        let self = this;
        this.id = id;
        this.scene = scene;
        this.container = document.getElementById(id);
        this.v = [];
        this.seg = [];
        this.sliders = [];
        this.segs = [];
        this.st = {};
        this.t = 0;
        this.visible = false;
        this.drawn = false;
        this.width = 0;
        this.height = 0;
        this.paused = !scene.animated;
        this.requested = false;
        this.ticking = false;
        this.dragging = null;

        let wrapper = document.createElement("div");
        wrapper.classList.add("canvas_container");
        wrapper.classList.add("non_selectable");
        let canvas = document.createElement("canvas");
        canvas.classList.add("non_selectable");
        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        wrapper.appendChild(canvas);
        this.container.appendChild(wrapper);
        this.wrapper = wrapper;
        this.canvas = canvas;
        this.container.demo = this;

        (scene.sliders || []).forEach((sd, i) => { self.v[i] = sd.def; });
        (scene.segs || []).forEach((labels, i) => { self.seg[i] = scene.seg_def ? scene.seg_def[i] || 0 : 0; });

        if (scene.init)
            scene.init(this);

        if (scene.animated) {
            let play = document.createElement("div");
            play.classList.add("play_pause_button");
            play.onclick = () => self.set_paused(!self.paused);
            wrapper.appendChild(play);
            this.play = play;
            if (!this.paused)
                play.classList.add("playing");
        }

        if (scene.reset) {
            let r = document.createElement("div");
            r.classList.add("restart_button");
            r.style.left = scene.animated ? "50px" : "0px";
            r.onclick = () => {
                scene.reset(self);
                self.set_paused(false);
                self.request();
            };
            wrapper.appendChild(r);
        }

        // Each slider sits in a row: [play button slot] [track] [value].
        this.labels = [];
        this.sanim = [];
        this.anim_btns = [];
        this.slider_divs = [];
        this.slider_vis = [];
        (scene.sliders || []).forEach((sd, i) => {
            let div = document.getElementById(id + "_sl" + i);
            if (!div)
                return;
            div.classList.add("slider_row");
            self.slider_divs[i] = div;
            let btn = document.createElement("div");
            btn.className = "slider_play slider_play_spacer";
            let track = document.createElement("div");
            track.className = "slider_track";
            let label = document.createElement("div");
            label.className = "slider_value";
            div.appendChild(btn);
            div.appendChild(track);
            div.appendChild(label);
            self.labels[i] = label;
            let constructing = true;
            self.sliders[i] = new Slider(track, x => {
                self.v[i] = sd.map.to(x);
                // the reader took over: stop this slider's animation
                if (!constructing)
                    self.stop_slider_anim(i);
                if (sd.on)
                    sd.on(self, self.v[i]);
                self.update_label(i);
                self.request();
            }, undefined, clamp(sd.map.from(sd.def), 0, 1));
            constructing = false;
            if (sd.anim) {
                btn.classList.remove("slider_play_spacer");
                btn.classList.add("playing");
                btn.title = "Animate this slider";
                btn.onclick = () => {
                    if (self.sanim[i].on) self.stop_slider_anim(i);
                    else self.start_slider_anim(i);
                };
                self.anim_btns[i] = btn;
                self.sanim[i] = { on: true, t: anim_phase(sd.anim, clamp(sd.map.from(sd.def), 0, 1)) };
            }
            self.update_label(i);
        });

        (scene.segs || []).forEach((labels, i) => {
            let div = document.getElementById(id + "_seg" + i);
            if (!div)
                return;
            let first = true;
            self.segs[i] = new SegmentedControl(div, k => {
                if (first) {
                    // SegmentedControl reports option 0 on creation
                    first = false;
                    return;
                }
                self.seg[i] = k;
                if (scene.on_seg)
                    scene.on_seg(self, i, k);
                self.update_slider_visibility();
                self.request();
            }, labels);
            if (self.seg[i])
                self.segs[i].set_selection(self.seg[i]);
        });

        this.update_slider_visibility();

        function coords(e) {
            let r = canvas.getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        }

        if (scene.drag || scene.orbit) {
            new TouchHandler(canvas, function(e) {
                let p = coords(e);
                if (scene.drag && scene.drag.begin(self, p[0], p[1])) {
                    self.dragging = "drag";
                    self.request();
                    return true;
                }
                if (scene.orbit) {
                    self.dragging = "orbit";
                    self.last = p;
                    return true;
                }
                return false;
            }, function(e) {
                if (!self.dragging)
                    return false;
                let p = coords(e);
                if (self.dragging === "drag") {
                    scene.drag.move(self, p[0], p[1]);
                } else {
                    let dx = p[0] - self.last[0], dy = p[1] - self.last[1];
                    self.last = p;
                    self.st.yaw -= dx * 0.008;
                    self.st.pitch = clamp(self.st.pitch + dy * 0.006, self.st.pitch_min === undefined ? -0.05 : self.st.pitch_min, 1.45);
                }
                self.request();
                return true;
            }, function(e) {
                if (self.dragging === "drag" && scene.drag.end)
                    scene.drag.end(self);
                self.dragging = null;
                self.request();
                return true;
            });
        }

        if (scene.drag && scene.drag.cursor) {
            canvas.addEventListener("mousemove", e => {
                if (self.dragging)
                    return;
                let p = coords(e);
                canvas.style.cursor = scene.drag.cursor(self, p[0], p[1]) || "default";
            });
        }

        if (scene.hover) {
            canvas.addEventListener("mousemove", e => {
                let p = coords(e);
                scene.hover(self, p[0], p[1]);
                self.request();
            });
            canvas.addEventListener("mouseleave", () => {
                scene.hover(self, null, null);
                self.request();
            });
        }

        all_demos.push(this);
        lrf_demos[id] = this;
    }

    Demo.prototype.running = function() {
        return (this.scene.animated && !this.paused) ||
            this.sanim.some((a, i) => a && a.on && this.slider_vis[i] !== false);
    };

    // Show or hide slider rows whose spec has a visible(d) predicate.
    Demo.prototype.update_slider_visibility = function() {
        (this.scene.sliders || []).forEach((sd, i) => {
            if (!sd.visible || !this.slider_divs[i])
                return;
            let vis = !!sd.visible(this);
            this.slider_vis[i] = vis;
            if (vis) this.slider_divs[i].classList.remove("hidden");
            else this.slider_divs[i].classList.add("hidden");
        });
        this.kick();
    };

    Demo.prototype.stop_slider_anim = function(i) {
        let a = this.sanim[i];
        if (!a || !a.on)
            return;
        a.on = false;
        this.anim_btns[i].classList.remove("playing");
    };

    Demo.prototype.start_slider_anim = function(i) {
        let a = this.sanim[i];
        if (!a)
            return;
        let sd = this.scene.sliders[i];
        a.t = anim_phase(sd.anim, clamp(sd.map.from(this.v[i]), 0, 1));
        a.on = true;
        this.anim_btns[i].classList.add("playing");
        this.kick();
    };

    Demo.prototype.advance_sliders = function(dt) {
        let changed = false;
        this.sanim.forEach((a, i) => {
            if (!a || !a.on || this.slider_vis[i] === false)
                return;
            let sd = this.scene.sliders[i];
            a.t += dt;
            let x = anim_x(sd.anim, a.t);
            this.v[i] = sd.map.to(x);
            if (this.sliders[i])
                this.sliders[i].set_value(x);
            this.update_label(i);
            changed = true;
        });
        return changed;
    };

    Demo.prototype.update_label = function(i) {
        let sd = this.scene.sliders[i];
        if (this.labels[i] && sd.fmt)
            this.labels[i].textContent = sd.fmt(this.v[i]);
    };

    Demo.prototype.layout = function() {
        let w = this.wrapper.clientWidth, h = this.wrapper.clientHeight;
        if (w !== this.width || h !== this.height) {
            this.width = w;
            this.height = h;
            this.canvas.style.width = w + "px";
            this.canvas.style.height = h + "px";
            this.canvas.width = round(w * dpr);
            this.canvas.height = round(h * dpr);
            if (this.scene.on_resize)
                this.scene.on_resize(this);
        }
    };

    Demo.prototype.paint = function(dt) {
        this.requested = false;
        if (!this.visible) {
            this.dirty = true;
            return;
        }
        this.layout();
        if (this.width === 0 || this.height === 0)
            return;
        let ctx = this.canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, this.width, this.height);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        try {
            this.scene.draw(ctx, this, this.width, this.height, dt || 0);
        } catch (e) {
            // One bad frame shouldn't take down the demo or its animation
            // loop. Resetting the canvas also clears any save()d state the
            // scene didn't get to restore().
            console.error("lrf demo " + this.id + ":", e);
            this.canvas.width = this.canvas.width;
        }
        this.drawn = true;
        this.dirty = false;
    };

    Demo.prototype.request = function() {
        if (this.requested)
            return;
        if (this.ticking && this.visible && this.running())
            return;
        this.requested = true;
        requestAnimationFrame(() => this.paint(0));
    };

    Demo.prototype.set_paused = function(p) {
        this.paused = p;
        if (this.play) {
            if (p) this.play.classList.remove("playing");
            else this.play.classList.add("playing");
        }
        this.kick();
        this.request();
    };

    // Runs the animation loop while the demo is visible and either the scene
    // itself or one of its sliders is animating.
    Demo.prototype.kick = function() {
        if (!this.visible || this.ticking || !this.running())
            return;
        this.ticking = true;
        let self = this;
        let prev;
        function tick(ts) {
            if (!self.visible || !self.running()) {
                self.ticking = false;
                self.request();
                return;
            }
            let dt = prev === undefined ? 0 : min(0.05, (ts - prev) / 1000);
            prev = ts;
            let scene_running = self.scene.animated && !self.paused;
            if (scene_running)
                self.t += dt;
            self.advance_sliders(dt);
            requestAnimationFrame(tick);
            self.paint(scene_running ? dt : 0);
        }
        requestAnimationFrame(tick);
    };

    Demo.prototype.set_visible = function(v) {
        this.visible = v;
        if (v) {
            if (this.dirty || !this.drawn)
                this.request();
            this.kick();
        }
    };

    window.lrf_set = function(id, vals, segs) {
        let d = lrf_demos[id];
        if (!d)
            return;
        (segs || []).forEach((k, i) => {
            if (k === null || k === undefined)
                return;
            if (d.segs[i]) d.segs[i].set_selection(k);
            else d.seg[i] = k;
        });
        d.update_slider_visibility();
        (vals || []).forEach((v, i) => {
            if (v === null || v === undefined)
                return;
            if (typeof v === "string")
                v = d.scene.special(d, i, v);
            let sd = d.scene.sliders[i];
            d.stop_slider_anim(i);
            d.v[i] = v;
            if (d.sliders[i])
                d.sliders[i].set_value(clamp(sd.map.from(v), 0, 1));
            if (sd.on)
                sd.on(d, v);
            d.update_label(i);
        });
        if (d.scene.on_set)
            d.scene.on_set(d);
        d.request();
    };

    /* ------------------------------------------------------------------ */
    /* Spec changes: text values, table, every demo                       */
    /* ------------------------------------------------------------------ */

    function text_values() {
        let s = spec;
        let out = {};
        out.fp100 = fmt_len(M.beam_diameter(s, 100));
        out.fp1k = fmt_len(M.beam_diameter(s, 1000));
        out.quad_r1 = fmt_range(det_range(QUAD, 1));
        out.quad_r10 = fmt_range(det_range(QUAD, 0.1));
        out.quad_r25 = fmt_range(det_range(QUAD, 0.04));
        out.shahed_r10 = fmt_range(det_range(SHAHED, 0.1));
        out.shahed_black_rr = fmt_range(det_range(Object.assign({}, SHAHED, { albedo: 0.05 }), rated_time()));
        out.quad_rr = fmt_range(det_range(QUAD, rated_time()));
        out.shahed_rr = fmt_range(det_range(SHAHED, rated_time()));
        let o25 = M.optimal_measurement_time(s, 25), o50 = M.optimal_measurement_time(s, 50);
        out.opt25 = fmt_time(o25);
        out.opt25_hz = (1 / o25).toFixed(1);
        out.opt50 = fmt_time(o50);
        out.opt50_hz = (1 / o50).toFixed(1);
        let pr = M.predicted_ratings(s);
        out.rated_small = fmt_range(s.ratings.small);
        out.rated_nato = fmt_range(s.ratings.nato);
        out.pred_nato = fmt_range(pr.nato);
        out.beam_px = (s.divergence_mrad * 1e-3 * FPX).toFixed(1);
        out.quad_cross = fmt_range(M.crossover_range(s, QUAD.size_m));
        return out;
    }

    function update_text(flash) {
        let vals = text_values();
        document.querySelectorAll(".lrfv").forEach(el => {
            let k = el.getAttribute("data-k");
            if (vals[k] !== undefined && el.textContent !== vals[k]) {
                el.textContent = vals[k];
                if (flash) {
                    el.classList.add("flash");
                    setTimeout(() => el.classList.remove("flash"), 700);
                }
            }
        });
        document.querySelectorAll(".lrfv_name").forEach(el => { el.textContent = spec.name; });
    }

    function update_spec_table() {
        let s = spec;
        let set = (id, str) => {
            let el = document.getElementById(id);
            if (el) el.textContent = str;
        };
        let custom = preset_key === "custom";
        set("spec_divergence", s.divergence_mrad.toFixed(2).replace(/0$/, "") + " mrad" + (custom && s.divergence_mrad !== s.rating_divergence_mrad ? " (modified)" : ""));
        set("spec_range", fmt_int(s.min_range_m) + " to " + fmt_int(s.max_range_m) + " m");
        set("spec_accuracy", s.accuracy_m + " m");
        set("spec_targets", "up to 5, at least " + s.discrimination_m + " m apart");
        set("spec_small", fmt_int(s.ratings.small) + " m");
        set("spec_nato", fmt_int(s.ratings.nato) + " m");
        set("spec_ext", fmt_int(s.ratings.extended) + " m");
        const sizes = {
            "DLEM 20": "50 × 22 × 34 mm, 30 g",
            "DLEM 20LE": "50 × 22 × 34 mm, 30 g",
            "DLEM 30": "97 × 25 × 50 mm, 95 g",
            "DLEM 45": "110 × 46 × 60 mm, 160 g",
        };
        set("spec_size", sizes[s.name] || "n/a");
    }

    let calc_sync = null;

    function set_spec(new_spec, key, from_calc) {
        spec = new_spec;
        if (key)
            preset_key = key;
        for (let d of all_demos) {
            if (d.scene.on_spec)
                d.scene.on_spec(d);
            d.request();
        }
        update_text(true);
        update_spec_table();
        if (calc_sync && !from_calc)
            calc_sync();
    }

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
            circle(ctx, bx, by, 5, null, col.laser, 1.5);
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
                circle(ctx, cx, cy2, max(0.5, wr * ppm), null, rgba(col.laser, 0.9), 1);
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
        sliders: [{ anim: { period: 12, lo: 0.1, hi: 0.9 }, fmt: v => "r = " + v.toFixed(2) + " w", map: lin_map(0, 2), def: 1 }],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let rr = d.v[0];
            let sq = min(h - 20, w * 0.42);
            let cx = 10 + sq / 2, cy = h / 2;
            round_rect(ctx, cx - sq / 2, cy - sq / 2, sq, sq, 6, "#1E2228");
            let wpx = sq / 4.4;
            draw_beam_spot(ctx, cx, cy, wpx, "#FF5A4E", 1);
            circle(ctx, cx, cy, wpx, null, "rgba(255,255,255,0.45)", 1);
            ctx.setLineDash([3, 3]);
            circle(ctx, cx, cy, wpx, null, "rgba(255,255,255,0.45)", 1);
            ctx.setLineDash([]);
            circle(ctx, cx, cy, rr * wpx, null, col.range, 2.5);
            let frac = 1 - exp(-2 * rr * rr);
            halo_text(ctx, fmt_pct(frac) + " of the power", cx, cy + sq / 2 - fs, "#fff", fs, "center", "middle", 500, "rgba(30,34,40,0.8)");

            // profile plot
            let px = cx + sq / 2 + 58, pw = w - px - 12;
            let plot = new Plot(ctx, px, 14, pw, h - 14 - fs * 3, {
                xmin: -2, xmax: 2, ymin: 0, ymax: 1.08, fs: fs - 1,
                xticks: [-2, -1, 0, 1, 2], xfmt: v => v === 0 ? "0" : (v > 0 ? "" : "−") + abs(v) + "w",
                yticks: [0, 0.135, 0.5, 1], yfmt: v => v === 0.135 ? "13.5%" : round(v * 100) + "%",
                xlabel: "distance from the beam's axis",
            });
            plot.frame();
            plot.clip();
            // shaded area inside the circle
            let pts = [[plot.X(-rr), plot.Y(0)]];
            for (let i = 0; i <= 80; i++) {
                let x = -rr + 2 * rr * i / 80;
                pts.push([plot.X(x), plot.Y(exp(-2 * x * x))]);
            }
            pts.push([plot.X(rr), plot.Y(0)]);
            if (rr > 0)
                fill_poly(ctx, pts, rgba(col.range, 0.18));
            plot.hline(exp(-2), col.axis, 1, [4, 4]);
            plot.curve(x => exp(-2 * x * x), col.laser, 2.5);
            plot.vline(-rr, col.range, 1.5);
            plot.vline(rr, col.range, 1.5);
            plot.unclip();
            text(ctx, "1/e² edge", plot.X(1) + 4, plot.Y(exp(-2)) - fs * 0.7, col.light_text, fs - 2, "left");
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
            circle(ctx, cx, cy, max(0.6, wr * ppm), null, rgba(col.laser, 0.8), 1);
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
            let peak_b = round(R);
            for (let b = 0; b < 1000; b++) {
                let s = snr1 * echo_shape(b + 0.5 - R);
                let v = d.st.noise[b] + s;
                pts.push([plot.X(b + 0.5), plot.Y(v)]);
                if (v > thr) {
                    if (abs(b + 0.5 - R) < 2) det = true;
                    else fa.push(b);
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
        d.st.rng = make_rng(4242 + round(d.v[0]));
    }

    SCENES.accumulate = {
        animated: true,
        sliders: [{ fmt: v => "R = " + round(v) + " m", map: log_map(150, 1200), def: 390, on: (d) => { acc_reset(d); d.set_paused(false); } }],
        reset(d) { acc_reset(d); },
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
                // finished: keep showing, stop animating
                d.set_paused(true);
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
            let y_p = h * 0.3, y_e = h * 0.62;
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
            let amb = te > period;
            let apparent = (te % period) * M.C / 2;
            let msg = fmt_int(prf) + " pulses per second: " + (amb ?
                "each echo arrives after the next pulse; it looks like a target at " + fmt_dist(apparent) :
                "each echo arrives before the next pulse");
            halo_text(ctx, msg, w / 2, 14, amb ? col.thr : col.text, fs - 1, "center", "middle", 500);
        },
    };

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
            { fmt: v => "measuring " + fmt_time(v), map: log_map(0.01, 0.4), def: 0.1 },
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
            halo_text(ctx, "stationary SNR " + snr.toFixed(1) + ", smeared peak " + final_peak.toFixed(1), plot.x + plot.w - 4, plot.y + fs * 0.8, col.text, fs - 1, "right", "middle", 500, "rgba(255,255,255,0.9)");
            let lbl = "speed " + round(v) + " m/s,  measuring " + fmt_time(T) + (u > 0 ? ",  assuming " + round(u) + " m/s" : "");
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
                    halo_text(ctx, lab + ": best " + fmt_time(to), plot.X(to) + (below ? 0 : leftside ? -8 : 8), plot.Y(f(to)) + (below ? fs * 1.1 : -fs * 0.9), shades[i], fs - 1, below ? "center" : leftside ? "right" : "left", "middle", 500);
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
            { fmt: v => "measuring " + fmt_time(v), map: log_map(0.01, 0.4), def: 0.1 },
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
            circle(ctx, cx, cy, wr * ppm, null, rgba(col.laser, 0.8), 1);
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
                for (let i = 0; i < n; i++) {
                    let x = xs + (xe - xs) * pp * (i + 0.5) / n;
                    soFar += exp(-2 * x * x / (wr * wr));
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
            text(ctx, "measurement: " + fmt_time(T), bx, by + fs * 8.3, col.time, fs - 1, "left");
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
            draw_beam_spot(ctx, X(aim[0]), Y(aim[1]), max(1.5, wr), col.laser, 0.55);
            circle(ctx, X(aim[0]), Y(aim[1]), max(2, wr), null, col.laser, 1.5);
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
            { fmt: v => "aim off " + v.toFixed(2) + " mrad", map: lin_map(0, 0.6), def: 0.15 },
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
            let wq = M.beam_radius(spec, Rq);      // 1/e^2 beam radius at the quad
            let offm = off * Rq;                   // how far the beam's axis passes from the quad

            // side view: the beam is brightest along its axis and fades toward
            // its edges; the quad sits offm off the axis, to scale with the
            // beam's width (the distance along the beam is compressed)
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
            let Hend = (top - 12) / 2 / 2.3;
            let half = r => Hend * r / Rend;       // drawn 1/e^2 half width
            let endR = sky ? Rend : Rb;
            let cone = [[x0, cy], [X(endR), cy - 2.2 * half(endR)], [X(endR), cy + 2.2 * half(endR)]];
            if (ctx.createConicGradient) {
                // brightness depends only on the angle around the apex
                let g = ctx.createConicGradient(-pi, x0, cy);
                let dx = X(endR) - x0;
                for (let k = 0; k <= 44; k++) {
                    let u = -2.2 + 4.4 * k / 44;
                    let ang = atan2(u * half(endR), dx);
                    g.addColorStop((ang + pi) / (2 * pi), rgba(col.laser, 0.6 * exp(-2 * u * u)));
                }
                fill_poly(ctx, cone, g);
            } else {
                let n = 40;
                for (let k = 0; k < n; k++) {
                    let u0 = -2.2 + 4.4 * k / n, u1 = u0 + 4.4 / n, um = (u0 + u1) / 2;
                    fill_poly(ctx, [[x0, cy], [X(endR), cy + u0 * half(endR)], [X(endR), cy + u1 * half(endR) + 0.5]], rgba(col.laser, 0.6 * exp(-2 * um * um)));
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
            let off_label = offm < 0.005 ? (w < 500 ? "on axis" : "beam aimed at the quad") :
                round(offm * 100) + " cm off " + (w < 500 ? "axis" : "the beam's axis");
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
            let pc = isz / (4.4 * wq);
            let ccx = ix + isz / 2, ccy = iy + isz / 2;
            draw_beam_spot(ctx, ccx, ccy, wq * pc, "#FF5A4E", 0.55);
            ctx.setLineDash([3, 3]);
            circle(ctx, ccx, ccy, wq * pc, null, "rgba(255,255,255,0.35)", 1);
            ctx.setLineDash([]);
            let cell = 2.5 / pc;                   // ~2.5 px cells, in meters
            for (let r of QUAD.shapes) {
                let fill = r.fill === undefined ? 1 : r.fill;
                for (let mx = r.x0; mx < r.x1; mx += cell) {
                    for (let my = r.y0; my < r.y1; my += cell) {
                        let cx2 = min(mx + cell, r.x1), cy2 = min(my + cell, r.y1);
                        let ux = (mx + cx2) / 2, uy = (my + cy2) / 2 - offm;
                        let I = exp(-2 * (ux * ux + uy * uy) / (wq * wq));
                        ctx.globalAlpha = fill < 1 ? 0.35 : 1;
                        ctx.fillStyle = mix("#3A3F45", "#FFE08A", sqrt(I));
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
            let f_px = 1100;
            let sensor_w = min(w * 0.5, (h * 0.32) * 1920 / f_px);
            let k = sensor_w / 1920;          // drawing pixels per sensor pixel
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
            for (let u of [0, 480, 960, 1440, 1920]) {
                let x = px - sensor_w / 2 + u * k;
                line(ctx, x, by1 + 2, x, by1 + 7, col.cam, 1);
                text(ctx, String(u), x, by1 + 7 + fs * 0.7, col.cam, fs - 3);
            }
            // field of view wedge
            let fov_half = atan(960 / f_px);
            for (let s of [-1, 1]) {
                let L = py - 4;
                line(ctx, px, py, px + s * tan(fov_half) * L, py - L, rgba(col.cam, 0.35), 1, [4, 4]);
            }
            // drone and ray
            let dx = d.st.drone[0] * w, dy = d.st.drone[1] * h;
            let a = atan2(dx - px, py - dy);
            let u = 960 - f_px * tan(a);       // image is inverted on the sensor
            let hx = px - fdraw * tan(a);
            line(ctx, dx, dy, px, py, rgba(col.quad, 0.8), 1.5);
            let inside = abs(tan(a) * f_px) <= 960;
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
            let msg = inside ? "lands on pixel " + round(1920 - u) + " (image flipped back)" : "outside the field of view";
            halo_text(ctx, msg, w / 2, by1 + fs * 2.2, inside ? col.quad : col.light_text, fs - 1, "center", "middle", 500);
        },
    };

    /* -------------------------- camera sizes -------------------------- */

    SCENES.camera_sizes = {
        sliders: [{ anim: { period: 18 }, fmt: v => "R = " + fmt_dist(v), map: log_map(50, 4000), def: 400 }],
        segs: [["10\" quad", "Shahed-136"]],
        draw(ctx, d, w, h) {
            let fs = base_font_size(w);
            let R = d.v[0];
            let shahed = d.seg[0] === 1;
            let cw = 120, ch = round(cw * h / w);
            if (!d.st.off || d.st.off.width !== cw || d.st.off.height !== ch) {
                d.st.off = document.createElement("canvas");
                d.st.off.width = cw;
                d.st.off.height = ch;
            }
            let o = d.st.off.getContext("2d");
            o.setTransform(4, 0, 0, 4, 0, 0);
            let g = o.createLinearGradient(0, 0, 0, ch / 4);
            g.addColorStop(0, col.sky_top);
            g.addColorStop(1, col.sky_bottom);
            o.fillStyle = g;
            o.fillRect(0, 0, cw, ch);
            // draw at 4x supersampling then downsample into native pixels
            let size = (shahed ? 2.5 : 0.43) / R * FPX;
            o.save();
            if (size < 1) o.globalAlpha = clamp(size * (shahed ? 0.5 : 0.9), 0.06, 1);
            if (shahed) draw_shahed_front(o, cw / 8, ch / 8, max(size, 1.2), "#55595D");
            else draw_quad_sprite(o, cw / 8, ch / 8, max(size, 1.2), "#2D3439", 0, 0);
            o.restore();
            // downsample: copy the 4x region into a native resolution canvas
            if (!d.st.nat || d.st.nat.width !== cw / 4 | 0) {
                d.st.nat = document.createElement("canvas");
            }
            let nw = floor(cw / 4), nh = floor(ch / 4);
            d.st.nat.width = nw;
            d.st.nat.height = nh;
            let n = d.st.nat.getContext("2d");
            n.imageSmoothingEnabled = true;
            n.drawImage(d.st.off, 0, 0, nw * 4, nh * 4, 0, 0, nw, nh);

            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(d.st.nat, 0, 0, nw, nh, 0, 0, w, h);
            ctx.imageSmoothingEnabled = true;
            let k = w / nw;
            // pixel grid
            if (k > 6) {
                ctx.strokeStyle = "rgba(0,0,0,0.05)";
                ctx.lineWidth = 1;
                for (let i = 0; i <= nw; i++) { ctx.beginPath(); ctx.moveTo(i * k, 0); ctx.lineTo(i * k, h); ctx.stroke(); }
                for (let j = 0; j <= nh; j++) { ctx.beginPath(); ctx.moveTo(0, j * k); ctx.lineTo(w, j * k); ctx.stroke(); }
            }
            let cx = (nw / 2) * k, cy = (nh / 2) * k;
            let beam_px = M.beam_diameter(spec, R) / R * FPX;
            circle(ctx, cx, cy, beam_px / 2 * k, null, col.laser, 2);
            halo_text(ctx, (shahed ? "Shahed wingspan " : "quad ") + size.toFixed(1) + " px", 12, 18, shahed ? col.shahed : col.quad, fs, "left", "middle", 500, "rgba(255,255,255,0.85)");
            halo_text(ctx, "beam " + beam_px.toFixed(1) + " px", 12, 18 + fs * 1.4, col.laser, fs, "left", "middle", 500, "rgba(255,255,255,0.85)");
            halo_text(ctx, fmt_dist(R) + " away, one square = one camera pixel", w - 12, h - 14, col.text, fs - 2, "right", "middle", 400, "rgba(255,255,255,0.85)");
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
            let b = 0.04;
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
            text(ctx, "4 cm", lrfx + 12, y0 + 16, col.mount, fs - 2, "left", "middle", 500);
            text(ctx, "baseline exaggerated", left - 8, y1 - 10, col.light_text, fs - 3, "right");

            // camera image strip
            let ix = left + 10, iw = w - left - 20;
            let iy = h * 0.2, ih = h * 0.36;
            let range_px = 60;
            round_rect(ctx, ix, iy, iw, ih, 6, "#EEF3F8", "#D5DCE4");
            let X = u => ix + iw / 2 + u / range_px * (iw / 2 - 8);
            line(ctx, X(0), iy + 4, X(0), iy + ih - 4, rgba(col.cam, 0.6), 1, [4, 3]);
            let u = FPX * b / R;
            let beam_px = M.beam_diameter(spec, R) / R * FPX;
            let r_draw = beam_px / 2 * (iw / 2 - 8) / range_px;
            let ux = X(min(u, range_px * 1.2));
            draw_beam_spot(ctx, ux, iy + ih / 2, max(2, r_draw), col.laser, 0.9);
            for (let p of [-60, -30, 0, 30, 60]) {
                line(ctx, X(p), iy + ih, X(p), iy + ih + 5, col.axis, 1);
                text(ctx, (p > 0 ? "+" : p < 0 ? "−" : "") + abs(p), X(p), iy + ih + 5 + fs * 0.7, col.light_text, fs - 3);
            }
            text(ctx, "camera image, pixels from center", ix + iw / 2, iy - fs * 0.8, col.cam, fs - 1, "center", "middle", 500);
            text(ctx, "spot " + (u < 10 ? u.toFixed(1) : round(u)) + " px right of center", ix + iw / 2, iy + ih + fs * 2.6, col.laser, fs, "center", "middle", 500);
            text(ctx, "f × b / R = " + fmt_int(FPX) + " × 0.04 / " + (R < 10 ? R.toFixed(1) : round(R)), ix + iw / 2, iy + ih + fs * 4, col.text, fs - 1);
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
            let b = 0.04;
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
                xmin: 0, xmax: 0.2, ymin: -40, ymax: 120, fs: fs - 1,
                xticks: [0, 0.02, 0.05, 0.1, 0.2], xfmt: v => v === 0 ? "∞" : round(1 / v) + " m",
                yticks: [-40, 0, 40, 80, 120], yfmt: v => (v > 0 ? "+" : v < 0 ? "−" : "") + abs(v),
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
            let u0 = -40, u1 = 140;
            let k = w / (u1 - u0);
            let vh = h / k;
            let v0 = -vh / 2 + 10;
            let X = u => (u - u0) * k, Y = v => (v - v0) * k;
            let g = ctx.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, col.sky_top);
            g.addColorStop(1, col.sky_bottom);
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            // image center crosshair
            line(ctx, X(0) - 10, Y(0), X(0) + 10, Y(0), col.axis, 1);
            line(ctx, X(0), Y(0) - 10, X(0), Y(0) + 10, col.axis, 1);
            text(ctx, "image center", X(0), Y(0) + 18, col.light_text, fs - 3);
            // trace
            let pts = [];
            for (let i = 0; i <= 200; i++) {
                let r = 5 * pow(1e6, i / 200);
                let p = M.beam_pixel(cam, mount, r);
                pts.push([X(p[0] - cam.width_px / 2), Y(p[1] - cam.height_px / 2)]);
            }
            poly(ctx, pts, rgba(col.laser, 0.6), 1.5, [5, 4]);
            for (let r of [5, 10, 20, 50, 100]) {
                let p = M.beam_pixel(cam, mount, r);
                let x = X(p[0] - cam.width_px / 2), y = Y(p[1] - cam.height_px / 2);
                circle(ctx, x, y, 2.5, col.laser);
                text(ctx, r + " m", x, y - 10, col.laser, fs - 3);
            }
            let bs = M.boresight_pixel(cam, mount);
            let bx = X(bs[0] - cam.width_px / 2), by = Y(bs[1] - cam.height_px / 2);
            line(ctx, bx - 6, by - 6, bx + 6, by + 6, col.mis, 2);
            line(ctx, bx - 6, by + 6, bx + 6, by - 6, col.mis, 2);
            halo_text(ctx, "boresight (∞)", bx - 10, by + 16, col.mis, fs - 2, "right", "middle", 500, "rgba(230,238,246,0.85)");
            // quad aimed at the boresight, beam at its distance
            let size = 0.43 / R * FPX * k;
            ctx.globalAlpha = size > w * 0.3 ? 0.35 : 1;
            draw_quad_sprite(ctx, bx, by, size, "#2D3439", 0, 0);
            ctx.globalAlpha = 1;
            let p = M.beam_pixel(cam, mount, R);
            let px = X(p[0] - cam.width_px / 2), py = Y(p[1] - cam.height_px / 2);
            let rr = M.beam_radius(spec, R) / R * FPX * k;
            draw_beam_spot(ctx, px, py, rr, col.laser, 0.55);
            circle(ctx, px, py, rr, null, col.laser, 1.5);
            halo_text(ctx, "quad " + fmt_dist(R) + " away, aimed at the boresight", 12, 16, col.quad, fs - 1, "left", "middle", 500, "rgba(255,255,255,0.8)");
            let on = M.fraction_on_target(spec, QUAD, R, (p[0] - bs[0]) / FPX * R, -(p[1] - bs[1]) / FPX * R) / M.fraction_on_target(spec, QUAD, R);
            halo_text(ctx, "echo " + fmt_pct(clamp(on, 0, 1)) + " of a perfectly centered beam", 12, 16 + fs * 1.4, "#B07800", fs - 1, "left", "middle", 500, "rgba(255,255,255,0.8)");
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

            // camera image: the central 800 x 450 pixels
            let crop = 800;
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
            for (let c of corners)
                circle(ctx, c[0], c[1], 3, null, col.hit, 2);
            // pose axes from the tag's center
            let c0 = proj(center);
            let ax = (dv, color) => {
                let p = proj(v3_add(center, v3_scale(dv, 0.2)));
                line(ctx, c0[0], c0[1], p[0], p[1], color, 2);
            };
            ax(right, "#E53935");
            ax([0, -1, 0], "#43A047");
            ax([-sin(yaw), 0, -cos(yaw)], "#1E88E5");
            ctx.restore();
            let span = abs(corners[1][0] - corners[0][0]) / k;
            text(ctx, "camera image, central 800 × 450 pixels", ix + iw / 2, iy - 10, col.cam, fs - 2, "center", "middle", 500);
            text(ctx, "distance " + D.toFixed(2) + " m,  yaw " + round(d.v[1]) + "°,  tag spans " + round(span) + " px", ix + iw / 2, iy + ih + fs * 1.2, col.text, fs - 1, "center", "middle", 500);
        },
    };

    /* -------------------------- apriltag sweep ------------------------ */

    const SWEEP_R = 50;         // tag distance during the sweep, m
    const SWEEP_STEP = 4;       // pixels between stops (0.36 mrad of pan or tilt)
    const SWEEP_SPAN = 70;      // half range of tag center offsets around the spot, pixels
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
            if (shown >= n && !d.paused)
                d.set_paused(true);
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
            circle(ctx, X(b[0]), Y(b[1]), rr, rgba(col.laser, 0.2), col.laser, 1.5);
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
            circle(ctx, X(g[0]), Y(g[1]), rr, rgba(col.laser, 0.3), col.laser, 2);
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
                xmin: 0, xmax: 0.12, ymin: 0, ymax: 70, fs: fs - 1,
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
                halo_text(ctx, "baseline " + (b_est * 100).toFixed(1) + " cm (true 4.0)", plot.x + plot.w - 8, plot.y + fs, col.mount, fs - 1, "right", "middle", 500);
                halo_text(ctx, "misalignment " + (beta_est * 1e3).toFixed(2) + " mrad (true " + TRUE_MOUNT.yaw_mrad.toFixed(2) + ")", plot.x + plot.w - 8, plot.y + fs * 2.4, col.mis, fs - 1, "right", "middle", 500);
            }
            for (let p of pts) {
                plot.dot(p[0], p[1], col.hit, 6);
                text(ctx, round(1 / p[0]) + " m tag", plot.X(p[0]) + 9, plot.Y(p[1]) + 12, col.hit, fs - 2, "left");
            }
        },
    };

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
