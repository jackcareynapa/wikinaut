  // ─── Link-anchored FX ────────────────────────────────────────────────────────
  // Reticle lock + landing burst, spawned at the target link's on-screen rect inside
  // the jump layer (which JourneyPortal has reparented above the live page). The
  // hyperspace jump's replaceChildren() naturally clears any lingering reticle.
  const LinkFx = {
    reticleEl: null,

    spawnReticle(rect) {
      LinkFx.clearReticle();
      if (!dom.ripLayer) return;
      dom.ripLayer.dataset.open = 'true';
      const el = document.createElement('div');
      el.className = 'wikinaut-reticle';
      LinkFx.positionReticle(el, rect);
      dom.ripLayer.append(el);
      LinkFx.reticleEl = el;
    },

    positionReticle(el, rect) {
      el.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
      el.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
      el.style.width = `${Math.round(Math.max(rect.width + 22, 46))}px`;
      el.style.height = `${Math.round(Math.max(rect.height + 16, 28))}px`;
    },

    repositionReticle(rect) {
      if (LinkFx.reticleEl) LinkFx.positionReticle(LinkFx.reticleEl, rect);
    },

    clearReticle() {
      if (LinkFx.reticleEl) {
        LinkFx.reticleEl.remove();
        LinkFx.reticleEl = null;
      }
    },

    landingBurst(centerX, centerY) {
      if (!dom.ripLayer || prefersReducedMotion()) return;
      dom.ripLayer.dataset.open = 'true';
      for (const variant of ['', ' secondary']) {
        const burst = document.createElement('div');
        burst.className = `wikinaut-landing-burst${variant}`;
        burst.style.left = `${Math.round(centerX)}px`;
        burst.style.top = `${Math.round(centerY)}px`;
        dom.ripLayer.append(burst);
        window.setTimeout(() => burst.remove(), 900);
      }
    },
  };
