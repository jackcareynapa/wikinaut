  // ─── Ship (gunmetal fighter craft; keeps the Figure API the traversal logic expects) ──

  const Figure = {
    renderSvg() {
      // Swept-wing fighter drawn nose-right (heading 0°); the shell is rotated to the
      // craft's travel heading at runtime, and the hull is symmetric across its long
      // axis so every angle reads correctly and the engine plume trails behind. Hull
      // tones come from <defs> gradients; the player's color reaches the craft through
      // the flame plume, the flame-glow stops, and .wikinaut-ship-thruster.
      return `
        <svg viewBox="0 0 72 72" role="img" aria-label="Fighter spacecraft">
          <defs>
            <linearGradient id="wikinaut-hull-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${PALETTE.steelHi}"></stop>
              <stop offset="0.5" stop-color="${PALETTE.steel}"></stop>
              <stop offset="1" stop-color="${PALETTE.steelDark}"></stop>
            </linearGradient>
            <linearGradient id="wikinaut-wing-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${PALETTE.steelHi}"></stop>
              <stop offset="1" stop-color="${PALETTE.steelDark}"></stop>
            </linearGradient>
            <linearGradient id="wikinaut-canopy-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#2a3e58"></stop>
              <stop offset="1" stop-color="#0a1422"></stop>
            </linearGradient>
            <radialGradient id="wikinaut-flame-glow" cx="0.72" cy="0.5" r="0.85">
              <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"></stop>
              <stop class="wikinaut-flame-glow-tint" offset="0.4" stop-color="${PALETTE.accent}" stop-opacity="0.5"></stop>
              <stop class="wikinaut-flame-glow-tint" offset="1" stop-color="${PALETTE.accent}" stop-opacity="0"></stop>
            </radialGradient>
          </defs>
          <g class="wikinaut-ship-body">
            <!-- Engine flame at the bell (tail), drawn behind the hull. Because it lives
                 inside the rotated shell it always trails straight off the ship's tail. -->
            <g class="wikinaut-ship-flame">
              <g class="wikinaut-ship-flame-flicker">
                <ellipse class="wikinaut-ship-flame-glow" cx="-2" cy="36" rx="22" ry="9"></ellipse>
                <path class="wikinaut-ship-flame-plume" d="M12 31 Q -8 33 -26 36 Q -8 39 12 41 Z"></path>
                <path class="wikinaut-ship-flame-mid" d="M12 32.5 Q 0 34.5 -13 36 Q 0 37.5 12 39.5 Z"></path>
                <path class="wikinaut-ship-flame-core" d="M12 33.5 Q 5 35 -4 36 Q 5 37 12 38.5 Z"></path>
              </g>
            </g>
            <polygon class="wikinaut-ship-thruster" points="11,33 11,39 -4,36"></polygon>
            <polygon class="wikinaut-ship-wing" points="48,31 24,31 14,14"></polygon>
            <polygon class="wikinaut-ship-wing" points="48,41 24,41 14,58"></polygon>
            <polygon class="wikinaut-ship-wing" points="20,31 13,22 18,31"></polygon>
            <polygon class="wikinaut-ship-wing" points="20,41 13,50 18,41"></polygon>
            <path class="wikinaut-ship-hull" d="M66 36 L52 32 L38 30 L20 31 L11 33 L11 39 L20 41 L38 42 L52 40 Z"></path>
            <polygon class="wikinaut-ship-canopy" points="56,36 49,32 43,36 49,40"></polygon>
            <path class="wikinaut-ship-line" d="M20 36 H60"></path>
            <path class="wikinaut-ship-line" d="M38 31 V41 M28 31 V41"></path>
          </g>
        </svg>
      `;
    },

    show() {
      dom.figure.dataset.visible = 'true';
    },

    hide() {
      dom.figure.dataset.visible = 'false';
    },

    pose(pose) {
      dom.figure.dataset.pose = pose;
    },

    // The craft now rotates a full 0–360° to its heading (the old scaleX flip is
    // retired). The hull is symmetric across its long axis, so any angle reads right
    // and the engine plume always trails directly behind the direction of travel.
    setAngle(deg) {
      runtime.figureAngle = deg;
      Figure.moveTo(runtime.figurePosition.x, runtime.figurePosition.y);
    },

    headToward(fromX, fromY, toX, toY) {
      const dx = toX - fromX;
      const dy = toY - fromY;
      if (Math.hypot(dx, dy) < 0.5) return;
      Figure.setAngle((Math.atan2(dy, dx) * 180) / Math.PI);
    },

    faceToward(targetX) {
      Figure.headToward(runtime.figurePosition.x, runtime.figurePosition.y, targetX, runtime.figurePosition.y);
    },

    moveTo(x, y) {
      runtime.figurePosition = {x, y};
      dom.figure.style.transform =
        `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) rotate(${runtime.figureAngle.toFixed(1)}deg)`;
    },

    // Where the ship sets down for a given target rect, and the single point every anchored
    // FX layer (reticle, landing burst, jump slit) must share with it.
    //
    // Takes a RECT, not a link: the engine measures once with anchorRect() and hands the same
    // fragment to every consumer. Measuring here per-consumer produced up to nine independent
    // reads per touchdown, interleaved with layout mutations.
    //
    // slitX/slitY are derived from the CLAMPED ship position, never from the raw rect center.
    // They used to be the unclamped center, so any link within ~64px of a viewport edge parked
    // the ship at the clamp while the reticle, burst and hyperspace opened somewhere else —
    // and the jump then teleported the ship across that gap.
    targetAtRect(rect) {
      // No panel Y-clamp — the ship flies above the console (z-index) and is free to set
      // down anywhere on screen.
      const half = CONFIG.figureSize / 2;
      const x = clamp(rect.left + rect.width / 2 - half, 8, window.innerWidth - CONFIG.figureSize - 8);
      const y = clamp(rect.top + rect.height / 2 - half, 8, window.innerHeight - CONFIG.figureSize - 8);
      return {x, y, slitX: x + half, slitY: y + half};
    },
  };
