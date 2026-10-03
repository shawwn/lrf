
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
     *   finished(d) -> bool            the animation has run to its end; play rewinds first
     * d.touched becomes true once the reader uses any of the demo's controls
     * (sliders, buttons, segments, dragging, links in the text); demos that
     * would otherwise repeat their animation forever stop at the end then.
     *   init(d)                        called once before controls are created
     *   drag: { begin(d,x,y)->bool, move(d,x,y), end(d), cursor(d,x,y)->css }
     *   orbit: bool                    dragging rotates d.st.yaw / d.st.pitch
     *   hover(d, x, y)                 x, y are null when the pointer leaves; on touch
     *                                  screens a tap or sideways drag stands in for it
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
            play.onclick = () => {
                self.touched = true;
                if (self.paused && scene.reset && scene.finished && scene.finished(self))
                    scene.reset(self);
                self.set_paused(!self.paused);
            };
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
                self.touched = true;
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
                if (!constructing) {
                    self.stop_slider_anim(i);
                    self.touched = true;
                }
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
                self.touched = true;
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
                self.touched = true;
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
            // Touch screens don't hover: a tap, or a sideways drag (vertical
            // swipes still scroll the page), moves the reading, and it stays
            // after the finger lifts.
            let touch_hover = e => {
                if (e.pointerType === "mouse")
                    return;
                let p = coords(e);
                scene.hover(self, p[0], p[1]);
                self.request();
            };
            canvas.addEventListener("pointerdown", touch_hover);
            canvas.addEventListener("pointermove", touch_hover);
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
        // a one way animation sitting at its end starts over
        if (sd.anim.mode === "loop" && a.t >= (sd.anim.period || 10) - 1e-3)
            a.t = 0;
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

    // Links in the text: set a demo up, then bring it into view (with its
    // segmented controls and sliders) unless it's already fully visible.
    window.lrf_link = function(id, vals, segs) {
        window.lrf_set(id, vals, segs);
        let parts = [document.getElementById(id)];
        for (let e of document.querySelectorAll("[id^='" + id + "_seg'], [id^='" + id + "_sl']"))
            parts.push(e);
        let top = Infinity, bottom = -Infinity;
        for (let e of parts) {
            if (!e)
                continue;
            let r = e.getBoundingClientRect();
            if (r.height === 0)
                continue;
            top = min(top, r.top);
            bottom = max(bottom, r.bottom);
        }
        if (!isFinite(top))
            return;
        let margin = 16, vh = window.innerHeight;
        if (top >= margin && bottom <= vh - margin)
            return;
        let height = bottom - top;
        let target = height + 2 * margin <= vh ? top - (vh - height) / 2 : top - margin;
        let reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: window.scrollY + target, behavior: reduce ? "auto" : "smooth" });
    };

    window.lrf_set = function(id, vals, segs, st) {
        let d = lrf_demos[id];
        if (!d)
            return;
        d.touched = true;
        Object.assign(d.st, st || {});
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
