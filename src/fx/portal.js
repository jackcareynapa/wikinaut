  // ─── Journey portal (ship + jump layer above panel during a launch) ───────────

  const JourneyPortal = {
    active: false,

    activate() {
      if (JourneyPortal.active || !dom.figure || !dom.ripLayer) return;
      document.body.append(dom.ripLayer);
      document.body.append(dom.figure);
      dom.figure.dataset.journeyPortal = 'true';
      dom.ripLayer.dataset.journeyPortal = 'true';
      JourneyPortal.active = true;
    },

    deactivate() {
      if (!JourneyPortal.active || !dom.root) return;
      dom.root.insertBefore(dom.ripLayer, dom.root.firstChild);
      dom.root.insertBefore(dom.figure, dom.panel);
      delete dom.figure.dataset.journeyPortal;
      delete dom.ripLayer.dataset.journeyPortal;
      JourneyPortal.active = false;
    },

    ensureAbovePanel() {
      if (!JourneyPortal.active) return;
      dom.figure.style.zIndex = String(CONFIG.journeyPortalZ);
    },
  };
