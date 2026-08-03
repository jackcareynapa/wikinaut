  // ─── FxLoop (single rAF owner) ────────────────────────────────────────────────
  // One requestAnimationFrame chain drives every per-frame consumer (the Trail canvas and
  // animate()'s tweens) instead of each running its own competing loop. Subscribers are
  // called with the frame timestamp and unsubscribe by returning false; the chain parks
  // itself when the last subscriber leaves, so idle pages schedule zero frames.
  const FxLoop = {
    _subs: new Set(),
    _rafId: null,
    _ticking: false,

    add(fn) {
      FxLoop._subs.add(fn);
      // No scheduling mid-tick: a subscriber added from inside a frame callback (the cruise
      // feeds Trail.addPoint every frame) is picked up by the end-of-tick reschedule —
      // scheduling here too would stack extra rAF chains, exactly what this loop exists to
      // prevent.
      if (!FxLoop._rafId && !FxLoop._ticking) {
        FxLoop._rafId = requestAnimationFrame(FxLoop._tick);
      }
    },

    remove(fn) {
      FxLoop._subs.delete(fn);
    },

    _tick(now) {
      FxLoop._rafId = null;
      FxLoop._ticking = true;
      for (const fn of [...FxLoop._subs]) {
        try {
          if (fn(now) === false) FxLoop._subs.delete(fn);
        } catch (error) {
          // A throwing subscriber is dropped rather than allowed to kill the shared loop.
          FxLoop._subs.delete(fn);
          console.warn('[Wikinaut] wn/fx-frame-failed', error);
        }
      }
      FxLoop._ticking = false;
      if (FxLoop._subs.size) FxLoop._rafId = requestAnimationFrame(FxLoop._tick);
    },
  };
