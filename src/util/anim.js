  // ─── Animation helpers ───────────────────────────────────────────────────────

  // Tween driver on the shared FxLoop: concurrent animations (a cruise + the trail canvas)
  // ride one rAF chain instead of racing separate ones. A throwing onFrame REJECTS the
  // promise — if it merely unsubscribed (FxLoop's default for a bad subscriber), the caller's
  // await would strand forever and the engine's error handling (stall + retry) never engage.
  function animate(duration, onFrame) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      FxLoop.add(function tick(now) {
        let progress;
        try {
          progress = clamp((now - start) / duration, 0, 1);
          onFrame(progress);
        } catch (error) {
          reject(error);
          return false;
        }
        if (progress < 1) return true;
        resolve();
        return false;
      });
    });
  }

  // Wall-clock beat, scaled by the flight-speed setting. EVERY fixed cinematic hold in a flight
  // goes through this, so the whole tempo follows the slider and not just the cruise: ~1.5s of
  // fixed holds run per page (warp-in, touchdown, departure), which swamped the cruise on short
  // hops and made the setting read as inert.
  function beat(ms) {
    return Math.round(ms * Settings.tempo());
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function easeInCubic(value) {
    return value * value * value;
  }

  // Cubic bézier on one axis: p0 → (controls) p1, p2 → p3.
  function cubicBezier(t, p0, p1, p2, p3) {
    const inv = 1 - t;
    return inv * inv * inv * p0 + 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t * p3;
  }

  // First derivative of the cubic — the flight uses it as the true tangent for the ship's
  // heading (no frame-delta approximation).
  function cubicBezierDerivative(t, p0, p1, p2, p3) {
    const inv = 1 - t;
    return 3 * inv * inv * (p1 - p0) + 6 * inv * t * (p2 - p1) + 3 * t * t * (p3 - p2);
  }

  // Shortest-arc interpolation between two headings in degrees (never swings the long way
  // around), for easing the nose onto a new curve without a snap.
  function lerpAngle(fromDeg, toDeg, t) {
    const diff = ((toDeg - fromDeg + 540) % 360) - 180;
    return fromDeg + diff * t;
  }

  // One graceful banking curve from `start` to `end` (document coords), departing along
  // `headingDeg`. Both control points are constrained to a single side of the chord, which
  // for a cubic guarantees the curvature never changes sign — exactly one banking turn,
  // never an S-curve. The bank side falls out of the geometry: whichever side of the chord
  // the ship's current heading already deviates toward.
  function buildFlightPath(start, end, headingDeg) {
    const chordX = end.x - start.x;
    const chordY = end.y - start.y;
    const span = Math.hypot(chordX, chordY);
    if (span < 1) {
      return {p0: {...start}, p1: {...start}, p2: {...end}, p3: {...end}};
    }
    const ux = chordX / span;
    const uy = chordY / span;
    const rad = (headingDeg * Math.PI) / 180;
    const hx = Math.cos(rad);
    const hy = Math.sin(rad);
    const cross = ux * hy - uy * hx;   // signed side of the chord the heading deviates toward
    const dot = ux * hx + uy * hy;
    const handle = Math.min(span * 0.35, 260);

    // Heading nearly parallel to the chord → essentially straight. Heading pointing sharply
    // backwards → honoring it would demand a loop a single bend can't express; fly straight
    // and let the caller's angle ease-in absorb the turn.
    if (Math.abs(Math.atan2(cross, dot)) < Math.PI / 22.5 || dot < -0.2) {
      return {
        p0: {...start},
        p1: {x: start.x + chordX / 3, y: start.y + chordY / 3},
        p2: {x: start.x + (2 * chordX) / 3, y: start.y + (2 * chordY) / 3},
        p3: {...end},
      };
    }

    const side = cross >= 0 ? 1 : -1;
    // Depart along the current heading (P1 lands on the bank side by construction)…
    const p1 = {x: start.x + hx * handle, y: start.y + hy * handle};
    // …and arrive along the chord tilted a few degrees, phased so P2 lands on the SAME side.
    const theta = (-side * 18 * Math.PI) / 180;
    const ax = ux * Math.cos(theta) - uy * Math.sin(theta);
    const ay = ux * Math.sin(theta) + uy * Math.cos(theta);
    const p2 = {x: end.x - ax * handle, y: end.y - ay * handle};

    // Belt-and-braces: if an extreme heading still left the pair straddling the chord,
    // reflect P2 across it (preserves the arrival distance, restores the single-side rule).
    const sideOf = (p) => chordX * (p.y - start.y) - chordY * (p.x - start.x);
    if (sideOf(p1) * sideOf(p2) < 0) {
      const t = ((p2.x - start.x) * chordX + (p2.y - start.y) * chordY) / (span * span);
      const footX = start.x + chordX * t;
      const footY = start.y + chordY * t;
      p2.x = 2 * footX - p2.x;
      p2.y = 2 * footY - p2.y;
    }
    return {p0: {...start}, p1, p2, p3: {...end}};
  }

  // Arc-length lookup for a cubic: maps distance-traveled → curve parameter t, so the ship
  // moves at constant speed no matter how unevenly t maps to distance along the curve.
  function buildArcLengthLut(p0, p1, p2, p3, samples = 96) {
    const ts = [0];
    const ds = [0];
    let total = 0;
    let prevX = p0.x;
    let prevY = p0.y;
    for (let i = 1; i <= samples; i += 1) {
      const t = i / samples;
      const x = cubicBezier(t, p0.x, p1.x, p2.x, p3.x);
      const y = cubicBezier(t, p0.y, p1.y, p2.y, p3.y);
      total += Math.hypot(x - prevX, y - prevY);
      ts.push(t);
      ds.push(total);
      prevX = x;
      prevY = y;
    }
    return {
      total,
      tForDistance(dist) {
        const d = clamp(dist, 0, total);
        let lo = 0;
        let hi = ds.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (ds[mid] < d) lo = mid + 1;
          else hi = mid;
        }
        if (lo === 0) return 0;
        const seg = ds[lo] - ds[lo - 1] || 1;
        return ts[lo - 1] + (ts[lo] - ts[lo - 1]) * ((d - ds[lo - 1]) / seg);
      },
    };
  }

  // Plan one hop's velocity profile: the ramps trapezoidDistance() wants, plus the duration
  // that makes them true. Peak velocity is EXACTLY `speed` px/s on any hop long enough to reach
  // it, and the acceleration is identical on hops that aren't — so two hops at one slider
  // setting cruise at the same speed, which is the entire point of the setting.
  //
  // Deriving the duration from the ramps (rather than the other way round) is what fixes it.
  // The old code computed duration = distance/speed and then passed wall-clock ramp FRACTIONS,
  // but trapezoidDistance normalizes distance over duration, so its peak is
  // 1/(1-(rampUp+rampDown)/2) x nominal: 1.6x on a short hop, 1.11x on a long one. Hops at the
  // same setting cruised up to 44% apart.
  function planCruise(distance, speed, rampUpMs = 900, rampDownMs = 700) {
    const v = Math.max(speed, 1) / 1000;                  // px per ms
    const rampDist = (v * (rampUpMs + rampDownMs)) / 2;   // area under both ramp triangles
    if (distance <= rampDist) {
      // Too short to reach cruise: shrink both ramps by one factor so the ship still
      // accelerates at the standard RATE and simply tops out lower (peak = s * speed).
      const s = Math.sqrt(Math.max(distance, 0) / Math.max(rampDist, 1e-6));
      const span = Math.max(rampUpMs * s + rampDownMs * s, 1);
      return {
        duration: Math.max(span, CONFIG.minCruiseDurationMs),
        rampUp: (rampUpMs * s) / span,
        rampDown: (rampDownMs * s) / span,
      };
    }
    const duration = rampUpMs + rampDownMs + (distance - rampDist) / v;
    return {duration, rampUp: rampUpMs / duration, rampDown: rampDownMs / duration};
  }

  // Trapezoid velocity profile: accel/decel ramps at each end, constant cruise between.
  // Maps normalized time → normalized distance, so speed reads as constant without a harsh
  // full-speed landing. Ramps may be asymmetric (a longer, more visible take-off build-up
  // than the touchdown ease) — the caller derives them from wall-clock time so the launch
  // surge lasts the same real duration on short and long hops alike.
  function trapezoidDistance(progress, rampUp = 0.12, rampDown = rampUp) {
    const p = clamp(progress, 0, 1);
    const vPeak = 1 / (1 - (rampUp + rampDown) / 2);
    if (p < rampUp) return (vPeak * p * p) / (2 * rampUp);
    if (p > 1 - rampDown) {
      const q = 1 - p;
      return 1 - (vPeak * q * q) / (2 * rampDown);
    }
    return vPeak * (p - rampUp / 2);
  }
