  // ─── Trail canvas (white-hot → ship color → derived-tail particle wake) ────────

  const Trail = {
    canvas: null,
    ctx: null,
    points: [],
    sparks: [],
    _lastPointTime: 0,
    _dpr: 1,
    // Draw-time caches, rebuilt only when the player's colors change (never per frame):
    // the 48-bucket wake color ramp and the prerendered nozzle-flare sprite.
    _paletteKey: '',
    _rampBuckets: null,
    _flareSprite: null,

    init() {
      const canvas = document.createElement('canvas');
      canvas.id = 'wikinaut-trail-canvas';
      Trail.canvas = canvas;
      Trail.ctx = canvas.getContext('2d');
      Trail._resize(canvas);
      dom.root.prepend(canvas);
      window.addEventListener('resize', () => Trail._resize(canvas), {passive: true});
    },

    // Back the canvas at device resolution so the plume stays crisp on HiDPI screens,
    // then draw in CSS pixels via a scaled transform.
    _resize(canvas) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      Trail._dpr = dpr;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      Trail._paletteKey = '';   // the flare sprite bakes in the dpr — rebuild on change
    },

    // Points and sparks live in DOCUMENT coordinates (callers pass viewport positions; scroll
    // is added on write and subtracted at draw time). The wake is part of the article world:
    // when the camera scrolls, it streams past with the page instead of sticking to the glass.
    addPoint(x, y) {
      const now = performance.now();
      if (now - Trail._lastPointTime < 16) return;
      Trail._lastPointTime = now;
      const cx = x + CONFIG.figureSize / 2 + window.scrollX;
      const cy = y + CONFIG.figureSize / 2 + window.scrollY;
      Trail.points.push({x: cx, y: cy, t: now});
      // Occasional ember flung off the engine wash, drifting and decaying on its own.
      if (Math.random() < 0.5) {
        Trail.sparks.push({
          x: cx,
          y: cy,
          vx: (Math.random() - 0.5) * 0.9,
          vy: (Math.random() - 0.5) * 0.9,
          t: now,
          life: 360 + Math.random() * 360,
        });
      }
      if (Trail.points.length > 140) Trail.points.shift();
      if (Trail.sparks.length > 70) Trail.sparks.shift();
      FxLoop.add(Trail._draw);
    },

    // Radial shower of embers from a point (viewport coords in, doc coords stored) — used for
    // ignition and touchdown.
    burst(x, y, count = 16) {
      const now = performance.now();
      const docX = x + window.scrollX;
      const docY = y + window.scrollY;
      for (let i = 0; i < count; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1.4 + Math.random() * 2.6;
        Trail.sparks.push({
          x: docX, y: docY,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp * 0.8,
          t: now,
          life: 360 + Math.random() * 460,
        });
      }
      if (Trail.sparks.length > 90) Trail.sparks.splice(0, Trail.sparks.length - 90);
      FxLoop.add(Trail._draw);
    },

    // Rebuilds the wake color ramp (48 pre-mixed {r,g,b} buckets: white-hot core → ship
    // color → derived tail) and the prerendered nozzle-flare sprite. All three stops come
    // from the ONE player color via Settings.colorway(). Cheap and idempotent — _draw calls
    // it every frame and it no-ops unless the player's color actually changed.
    _refreshPalette() {
      const cw = Settings.colorway();
      const key = cw.base;
      if (key === Trail._paletteKey && Trail._rampBuckets) return;
      Trail._paletteKey = key;

      const core = hexToRgb(cw.trailCore); // hottest, at the nozzle
      const mid = hexToRgb(cw.base);
      const tail = hexToRgb(cw.trailTail);
      const mix = (c1, c2, t) => ({
        r: Math.round(lerp(c1.r, c2.r, t)),
        g: Math.round(lerp(c1.g, c2.g, t)),
        b: Math.round(lerp(c1.b, c2.b, t)),
      });
      const buckets = [];
      for (let i = 0; i < 48; i += 1) {
        const age = i / 47;
        buckets.push(age < 0.5 ? mix(core, mid, age / 0.5) : mix(mid, tail, (age - 0.5) / 0.5));
      }
      Trail._rampBuckets = buckets;

      // Nozzle flare, drawn once into an offscreen sprite (36×36 CSS px at device resolution)
      // instead of a createRadialGradient per frame.
      const dpr = Trail._dpr || 1;
      const sprite = document.createElement('canvas');
      sprite.width = sprite.height = Math.round(36 * dpr);
      const sctx = sprite.getContext('2d');
      const r = 18 * dpr;
      const flare = sctx.createRadialGradient(r, r, 0, r, r, r);
      flare.addColorStop(0, 'rgba(255,255,255,0.95)');
      flare.addColorStop(0.35, `rgba(${core.r},${core.g},${core.b},0.7)`);
      flare.addColorStop(1, `rgba(${mid.r},${mid.g},${mid.b},0)`);
      sctx.fillStyle = flare;
      sctx.fillRect(0, 0, sprite.width, sprite.height);
      Trail._flareSprite = sprite;
    },

    // Runs on the shared FxLoop; returns false (unsubscribes) once the last point/spark has
    // faded, after painting one final clear frame.
    _draw(now) {
      const ctx = Trail.ctx;
      if (!ctx) return false;
      const fadeMs = CONFIG.trailFadeMs;

      ctx.setTransform(Trail._dpr, 0, 0, Trail._dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Expire in place (write-index compaction) — no per-frame array reallocation. Points
      // are append-ordered by time; sparks have per-spark lifetimes, so both get the same
      // in-place sweep.
      const pts = Trail.points;
      let w = 0;
      for (let r = 0; r < pts.length; r += 1) {
        if (now - pts[r].t < fadeMs) pts[w++] = pts[r];
      }
      pts.length = w;
      const sparks = Trail.sparks;
      w = 0;
      for (let r = 0; r < sparks.length; r += 1) {
        if (now - sparks[r].t < sparks[r].life) sparks[w++] = sparks[r];
      }
      sparks.length = w;

      Trail._refreshPalette();
      const buckets = Trail._rampBuckets;
      const core = buckets[0];

      const hasRibbon = pts.length > 1;
      if (hasRibbon || sparks.length) {
        // Points/sparks are stored in doc coords; render at doc − scroll so the wake stays
        // pinned to the article while the camera moves (the canvas itself stays fixed).
        const sx = window.scrollX;
        const sy = window.scrollY;
        // Additive blending fuses the overlapping segments into one continuous glow.
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (hasRibbon) {
          // 1) Connected, tapering ribbon — thick & white-hot at the ship, thinning and
          //    cooling toward the tail. Drawn twice (soft underlay + bright core); segments
          //    too faint to see (alpha < 0.02) are skipped entirely.
          for (let pass = 0; pass < 2; pass += 1) {
            const alphaScale = pass === 0 ? 0.16 : 0.5;
            const widthBoost = pass === 0 ? 2.4 : 1;
            for (let i = 1; i < pts.length; i += 1) {
              const b = pts[i];
              const age = (now - b.t) / fadeMs;
              const e = 1 - age;
              const alpha = e * e * alphaScale;
              if (alpha < 0.02) continue;
              const c = buckets[Math.min(47, Math.max(0, Math.round(age * 47)))];
              ctx.lineWidth = (1 + e * e * 8) * widthBoost;
              ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${alpha.toFixed(3)})`;
              ctx.beginPath();
              ctx.moveTo(pts[i - 1].x - sx, pts[i - 1].y - sy);
              ctx.lineTo(b.x - sx, b.y - sy);
              ctx.stroke();
            }
          }

          // 2) Bright nozzle flare at the freshest point (prerendered sprite).
          const head = pts[pts.length - 1];
          ctx.drawImage(Trail._flareSprite, head.x - sx - 18, head.y - sy - 18, 36, 36);
        }

        // 3) Embers (independent of the ribbon, so ignition/landing bursts show too).
        for (const s of sparks) {
          const sAge = (now - s.t) / s.life;
          const e = 1 - sAge;
          if (e * 0.9 < 0.02) continue;
          const px = s.x + s.vx * (now - s.t) * 0.06 - sx;
          const py = s.y + s.vy * (now - s.t) * 0.06 - sy;
          ctx.fillStyle = `rgba(${core.r},${core.g},${core.b},${(e * 0.9).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(px, py, 0.6 + e * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      return pts.length > 0 || sparks.length > 0;
    },

    // Drop the wake ribbon but keep any live embers (used at touchdown so the cruise
    // plume vanishes while the landing sparks still scatter).
    clearRibbon() {
      Trail.points = [];
    },

    clear() {
      Trail.points = [];
      Trail.sparks = [];
      if (Trail.ctx) {
        Trail.ctx.setTransform(Trail._dpr, 0, 0, Trail._dpr, 0, 0);
        Trail.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
      FxLoop.remove(Trail._draw);
    },
  };
