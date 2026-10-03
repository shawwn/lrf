
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
                // Clip the segment to the near plane, so a line pointing at
                // the viewer is drawn up to the eye instead of vanishing, then
                // cut it into pieces that are depth sorted on their own: a long
                // line passes both in front of and behind other geometry.
                let za = v3_dot(v3_sub(it.a, camera.eye), camera.fwd);
                let zb = v3_dot(v3_sub(it.b, camera.eye), camera.fwd);
                const NEAR = 0.02;
                if (za < NEAR && zb < NEAR)
                    continue;
                let pa = it.a, pb = it.b;
                if (za < NEAR)
                    pa = v3_add(it.a, v3_scale(v3_sub(it.b, it.a), (NEAR - za) / (zb - za)));
                if (zb < NEAR)
                    pb = v3_add(it.b, v3_scale(v3_sub(it.a, it.b), (NEAR - zb) / (za - zb)));
                const PIECES = 16;
                let prev = camera.project(pa);
                for (let i = 1; i <= PIECES; i++) {
                    let q = camera.project(v3_add(pa, v3_scale(v3_sub(pb, pa), i / PIECES)));
                    if (!prev || !q) { prev = q; continue; }
                    let a = prev, last = i === PIECES, first = i === 1;
                    list.push({ depth: (a[2] + q[2]) / 2 - 1e-3, draw: () => {
                        ctx.globalAlpha = it.alpha;
                        ctx.lineCap = first || last ? "round" : "butt";
                        line(ctx, a[0], a[1], q[0], q[1], it.color, it.width);
                        ctx.lineCap = "round";
                        ctx.globalAlpha = 1;
                    } });
                    prev = q;
                }
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
        sc.box(Tt, [-0.045, 0.0, 0.026], [0.05, 0.085, 0.05], "#4E4359");
        sc.cylinder(Tt, [-0.045, 0.0425, 0.026], 1, 0.021, 0.034, 18, "#2C2C2C", "#1E2A44");
        sc.disk(Tt, [-0.045, 0.077, 0.026], 1, 0.015, 18, "#3D5A80");
        // LRF module (50 x 22 x 34 mm), transmitter 72 mm right of the camera's axis
        sc.box(Tt, [0.033, 0.02, 0.019], [0.022, 0.05, 0.034], "#3A3F45");
        sc.disk(Tt, [0.027, 0.0452, 0.012], 1, 0.0045, 12, "#B71C1C");
        sc.disk(Tt, [0.036, 0.0452, 0.026], 1, 0.0065, 14, "#263238");

        let R = Tt;
        return {
            T: Tt,
            cam_origin: xf_point(Tt, [-0.045, 0.077, 0.026]),
            lrf_origin: xf_point(Tt, [0.027, 0.046, 0.012]),
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
