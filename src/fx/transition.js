  // ─── Transition (hyperspace jump) ──────────────────────────────────────────────

  const Transition = {
    // Pure FX: plays the pre-jump orientation + hyperspace departure and returns the jump
    // anchor (viewport coords of the slit). Does NOT navigate or persist state — the engine
    // (Traversal.resume) does that once this resolves (or its watchdog times it out), so a
    // stalled/rejected animation can never block the actual jump. onJumpStart fires right as
    // the jump visually begins (streaks/flash), so the caller can narrate it at the right beat.
    async tearThrough({link, onJumpStart}) {
      // Make the link unmistakably visible (scroll it into the clear band + fade the panel
      // so it can never block it), then charge and jump to lightspeed.
      await Transition.ensureInView(link);

      let rect = link.getBoundingClientRect();
      const anchor = Transition.anchorFromLink(link, rect);
      Figure.faceToward(anchor.slitX);
      Figure.pose('tug');
      await sleep(prefersReducedMotion() ? 0 : 140);

      rect = link.getBoundingClientRect();
      Object.assign(anchor, Transition.anchorFromLink(link, rect));
      if (onJumpStart) onJumpStart();
      LinkFx.clearReticle();

      if (!prefersReducedMotion()) {
        // Lightspeed: streaks rip outward from the link, the ship snaps onto the jump
        // point, stretches along its heading and vanishes to a point.
        Transition.renderHyperspace(anchor, 'depart');
        Figure.moveTo(anchor.slitX - CONFIG.figureSize / 2, anchor.slitY - CONFIG.figureSize / 2);
        Figure.pose('warp');
        await sleep(320); // ship stretches to a point (must outlast the 300ms warp-stretch)
        Figure.hide();
        await sleep(60);
      }

      return anchor;
    },

    // The cruise already parks the link at the comfort line, so there's no scroll to do
    // here — that second adjustment was the pre-jump jank. Just fade/disable the console
    // (so it can never block the target) and re-lock the reticle for the jump.
    async ensureInView(link) {
      if (dom.panel) dom.panel.dataset.jumping = 'true';
      LinkFx.repositionReticle(link.getBoundingClientRect());
    },

    // Drop the ship out of warp at the saved entry point on a freshly loaded page, so the
    // jump reads as continuous across the navigation.
    async arrive(entry) {
      JourneyPortal.activate();
      runtime.figureAngle = entry.angle || 0;
      Figure.moveTo(entry.x, entry.y);
      const anchor = {slitX: entry.x + CONFIG.figureSize / 2, slitY: entry.y + CONFIG.figureSize / 2};

      if (prefersReducedMotion()) {
        Figure.show();
        Figure.pose('look');
        return;
      }
      Transition.renderHyperspace(anchor, 'arrive');
      Figure.show();
      Figure.pose('warp-in');
      await sleep(CONFIG.jumpDurationMs * 0.7);
      Figure.pose('look');
      dom.ripLayer.dataset.open = 'false';
      dom.ripLayer.replaceChildren();
    },

    anchorFromLink(link, rect) {
      const slitX = rect.left + rect.width / 2;
      const slitY = rect.top + rect.height / 2;
      return {slitX, slitY, entryX: slitX, entryY: slitY};
    },

    // Lightspeed field at the slit. mode 'depart' streaks fly outward; 'arrive' streaks
    // collapse inward. Streaks radiate in every direction from the jump point.
    renderHyperspace(anchor, mode = 'depart') {
      dom.ripLayer.replaceChildren();
      dom.ripLayer.dataset.open = 'true';
      dom.ripLayer.style.setProperty('--wn-slit-x', `${Math.round(anchor.slitX)}px`);
      dom.ripLayer.style.setProperty('--wn-slit-y', `${Math.round(anchor.slitY)}px`);

      // Starfield tunnel rushing forward behind the streaks.
      const tunnel = document.createElement('div');
      tunnel.className = 'wikinaut-warp-tunnel';
      tunnel.dataset.mode = mode;

      // Radial star-streaks. Their white→cyan→magenta gradient gives each one its own
      // chromatic separation; a denser field reads as a faster lightspeed rush.
      const warp = document.createElement('div');
      warp.className = 'wikinaut-warp';
      warp.dataset.mode = mode;
      const streakCount = 56;
      for (let i = 0; i < streakCount; i += 1) {
        const streak = document.createElement('div');
        streak.className = 'wikinaut-warp-streak';
        const angle = (360 / streakCount) * i + (Math.random() * 8 - 4);
        streak.style.transform = `rotate(${angle}deg)`;
        streak.style.animationDelay = `${Math.random() * 70}ms`;
        warp.append(streak);
      }

      // Expanding motion-blur shock ring, the big flash (with a cyan/magenta chromatic
      // fringe from its ::before/::after), and a white-hot core bloom on top.
      const ring = document.createElement('div');
      ring.className = 'wikinaut-warp-ring';
      ring.dataset.mode = mode;
      const flash = document.createElement('div');
      flash.className = 'wikinaut-flash';
      flash.dataset.mode = mode;
      const core = document.createElement('div');
      core.className = 'wikinaut-warp-core';
      core.dataset.mode = mode;

      dom.ripLayer.append(tunnel, warp, ring, flash, core);

      // A brief camera shudder as the drive punches through (departure only).
      if (mode === 'depart' && dom.root && !prefersReducedMotion()) {
        dom.root.dataset.warpShake = 'true';
        window.setTimeout(() => { if (dom.root) delete dom.root.dataset.warpShake; }, 240);
      }
    },

    // A shorter, amber-tinted warp for the degraded "couldn't find the link, jumping by
    // coordinates" fallback (Traversal.jumpByUrl) — reuses the hyperspace shapes but visually
    // distinct (amber, no chromatic split) so the player can tell a degraded jump from a
    // normal one. Anchored at the ship's current position since there's no link to anchor to.
    renderEmergencyWarp(anchor) {
      dom.ripLayer.replaceChildren();
      dom.ripLayer.dataset.open = 'true';
      dom.ripLayer.style.setProperty('--wn-slit-x', `${Math.round(anchor.slitX)}px`);
      dom.ripLayer.style.setProperty('--wn-slit-y', `${Math.round(anchor.slitY)}px`);

      const ring = document.createElement('div');
      ring.className = 'wikinaut-warp-ring wikinaut-warp-ring-emergency';
      ring.dataset.mode = 'depart';
      const flash = document.createElement('div');
      flash.className = 'wikinaut-flash wikinaut-flash-emergency';
      flash.dataset.mode = 'depart';
      dom.ripLayer.append(ring, flash);
    },
  };
