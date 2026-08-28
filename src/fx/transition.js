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

      const anchor = Transition.anchorFromLink(link);
      Figure.faceToward(anchor.slitX);
      Figure.pose('tug');
      await sleep(prefersReducedMotion() ? 0 : beat(140));

      Object.assign(anchor, Transition.anchorFromLink(link));
      if (onJumpStart) onJumpStart();
      LinkFx.clearReticle();

      if (!prefersReducedMotion()) {
        // Lightspeed: streaks rip outward from the link, the ship snaps onto the jump
        // point, stretches along its heading and vanishes to a point.
        Transition.renderHyperspace(anchor, 'depart');
        Figure.moveTo(anchor.slitX - CONFIG.figureSize / 2, anchor.slitY - CONFIG.figureSize / 2);
        Figure.pose('warp');
        // Ship stretches to a point; must outlast the CSS warp-stretch, which is scaled by
        // the same --wn-tempo factor beat() applies here.
        await sleep(beat(320));
        Figure.hide();
        await sleep(beat(60));
      }

      return anchor;
    },

    // Fade/disable the console (so it can never block the target) and re-lock the reticle.
    //
    // The cruise normally parks the link at the comfort line, so there is usually no scroll to
    // do — an UNCONDITIONAL adjustment here was the old pre-jump jank. But "usually" isn't
    // "always": expanding a collapsed navbox at touchdown pushes the link (and everything
    // below it) down, and a doc-edge-clamped camera can't reach a target near the very top or
    // bottom. Those cases used to open the slit off-screen. So: scroll only when the anchor has
    // genuinely left the safe band, and then only as far as the band.
    async ensureInView(link) {
      if (dom.panel) dom.panel.dataset.jumping = 'true';
      await Transition.scrollAnchorIntoBand(link);
      LinkFx.repositionReticle(anchorRect(link));
    },

    // The vertical band a jump target must sit in: clear of the masthead, clear of the console.
    // Returns the scroll delta needed to bring `centerY` inside it (0 when it already is).
    bandCorrection(centerY) {
      const top = 80;
      const bottom = Math.min(window.innerHeight - 90, panelObstacleRect().top - 24);
      if (bottom <= top) return 0;
      if (centerY < top) return centerY - top;
      if (centerY > bottom) return centerY - bottom;
      return 0;
    },

    // Ease the page (not the ship) until the link's anchor is back inside the band, keeping the
    // ship glued to the anchor throughout so the correction reads as the camera settling rather
    // than the ship drifting. No-op when the anchor is already in band.
    async scrollAnchorIntoBand(link) {
      const startScroll = window.scrollY;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const target = clamp(startScroll + Transition.bandCorrection(anchorCenter(link).y), 0, maxScroll);
      const delta = target - startScroll;
      if (Math.abs(delta) < 2) return;
      if (prefersReducedMotion()) {
        window.scrollTo(window.scrollX, target);
      } else {
        await animate(beat(220), (progress) => {
          const eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - ((1 - progress) * (1 - progress) * 2);
          window.scrollTo(window.scrollX, startScroll + delta * eased);
          // ONE measurement per frame, shared by the ship and the reticle. The reticle used
          // to be repositioned only after the loop, so for the whole correction it hung at a
          // stale viewport spot while the link slid out from under it, then snapped.
          const rect = anchorRect(link);
          const settled = Figure.targetAtRect(rect);
          Figure.moveTo(settled.x, settled.y);
          LinkFx.repositionReticle(rect);
        });
      }
      const rect = anchorRect(link);
      const settled = Figure.targetAtRect(rect);
      Figure.moveTo(settled.x, settled.y);
      LinkFx.repositionReticle(rect);
    },

    // Drop the ship out of warp at the saved entry point on a freshly loaded page, so the
    // jump reads as continuous across the navigation.
    async arrive(entry) {
      JourneyPortal.activate();
      runtime.figureAngle = entry.angle || 0;
      // Clamp into THIS page's viewport: the entry point was recorded on the previous page,
      // which may have been a different window size (or the jump may have happened near the
      // bottom edge). Unclamped, the ship dropped out of warp partly or wholly off-screen.
      const x = clamp(entry.x, 8, Math.max(8, window.innerWidth - CONFIG.figureSize - 8));
      const y = clamp(entry.y, 8, Math.max(8, window.innerHeight - CONFIG.figureSize - 8));
      Figure.moveTo(x, y);
      const anchor = {slitX: x + CONFIG.figureSize / 2, slitY: y + CONFIG.figureSize / 2};

      if (prefersReducedMotion()) {
        Figure.show();
        Figure.pose('look');
        return;
      }
      Transition.renderHyperspace(anchor, 'arrive');
      Figure.show();
      Figure.pose('warp-in');
      // The ship drops out of warp first (its own stretch is calc(300ms * tempo)), but the
      // field must play its FULL calc(jumpDurationMs * tempo) — clearing the layer at 0.7 of
      // that killed every arrival animation 30% in and the whole field popped out.
      await sleep(beat(CONFIG.jumpDurationMs * 0.7));
      Figure.pose('look');
      await sleep(beat(CONFIG.jumpDurationMs * 0.3));
      dom.ripLayer.dataset.open = 'false';
      dom.ripLayer.replaceChildren();
    },

    // The jump slit sits exactly where the ship sits — Figure.targetAtRect owns that identity,
    // so a viewport-edge clamp can never split the ship from its own hyperspace.
    anchorFromLink(link) {
      const {slitX, slitY} = Figure.targetAtRect(anchorRect(link));
      return {slitX, slitY};
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
        // The angle is a custom property, not a `transform` write: the streak keyframe
        // animates transform (scaleX — see styles.js) and would clobber an inline one.
        streak.style.setProperty('--wn-streak-angle', `${angle.toFixed(2)}deg`);
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
    },

    // The boost flourish: the ship's own drive punching up the flight path on a hop too long
    // to fly whole (Traversal.boostIfDistant). Deliberately the RING + CORE only — no streaks,
    // no flash — so it reads as an in-system burn, clearly not the between-articles hyperspace
    // jump and clearly not the amber emergency warp.
    renderBoost(anchor) {
      if (prefersReducedMotion()) return;
      dom.ripLayer.replaceChildren();
      dom.ripLayer.dataset.open = 'true';
      dom.ripLayer.style.setProperty('--wn-slit-x', `${Math.round(anchor.slitX)}px`);
      dom.ripLayer.style.setProperty('--wn-slit-y', `${Math.round(anchor.slitY)}px`);

      const ring = document.createElement('div');
      ring.className = 'wikinaut-warp-ring wikinaut-warp-ring-boost';
      ring.dataset.mode = 'depart';
      const core = document.createElement('div');
      core.className = 'wikinaut-warp-core wikinaut-warp-core-boost';
      core.dataset.mode = 'depart';
      dom.ripLayer.append(ring, core);
      window.setTimeout(() => {
        if (dom.ripLayer?.firstChild === ring) {
          dom.ripLayer.dataset.open = 'false';
          dom.ripLayer.replaceChildren();
        }
      }, beat(CONFIG.jumpDurationMs * 0.6));   // matches the boost ring/core CSS duration
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
