  // ─── FxLoop (single rAF owner) ────────────────────────────────────────────────
  // One requestAnimationFrame chain drives every per-frame consumer (the Trail canvas and
  // animate()'s tweens) instead of each running its own competing loop. Subscribers are
  // called with the frame timestamp and unsubscribe by returning false; the chain parks
  // itself when the last subscriber leaves, so idle pages schedule zero frames.
  //
  // TWO PHASES, and the split is load-bearing. Subscribers used to share one insertion-ordered
  // Set, which made their relative order depend on the route taken to get there: on a mid-route
  // page the cruise tween was added first and ran first, but on the LAUNCH page Trail._draw was
  // already resident from the liftoff climb, so the trail painted before the cruise had moved
  // the ship or scrolled the page — a plume one frame behind the nozzle, drawn against the
  // pre-scroll offset, shearing away from the ship whenever the camera moved fast. Movers run
  // in 'update', painters in 'draw', and the order stops being an accident of history.
  const FxLoop = {
    _update: new Set(),
    _draw: new Set(),
    _rafId: null,
    _ticking: false,

    add(fn, phase = 'update') {
      (phase === 'draw' ? FxLoop._draw : FxLoop._update).add(fn);
      // No scheduling mid-tick: a subscriber added from inside a frame callback (the cruise
      // feeds Trail.addPoint every frame) is picked up by the end-of-tick reschedule —
      // scheduling here too would stack extra rAF chains, exactly what this loop exists to
      // prevent.
      if (!FxLoop._rafId && !FxLoop._ticking) {
        FxLoop._rafId = requestAnimationFrame(FxLoop._tick);
      }
    },

    remove(fn) {
      FxLoop._update.delete(fn);
      FxLoop._draw.delete(fn);
    },

    _runPhase(subs, now) {
      for (const fn of [...subs]) {
        try {
          if (fn(now) === false) subs.delete(fn);
        } catch (error) {
          // A throwing subscriber is dropped rather than allowed to kill the shared loop.
          subs.delete(fn);
          console.warn('[Wikinaut] wn/fx-frame-failed', error);
        }
      }
    },

    _tick(now) {
      FxLoop._rafId = null;
      FxLoop._ticking = true;
      FxLoop._runPhase(FxLoop._update, now);
      FxLoop._runPhase(FxLoop._draw, now);
      FxLoop._ticking = false;
      if (FxLoop._update.size || FxLoop._draw.size) {
        FxLoop._rafId = requestAnimationFrame(FxLoop._tick);
      }
    },
  };
