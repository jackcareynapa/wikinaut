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
      JourneyPortal.ensureAbovePanel();
    },

    deactivate() {
      if (!JourneyPortal.active || !dom.root) return;
      dom.root.insertBefore(dom.ripLayer, dom.root.firstChild);
      dom.root.insertBefore(dom.figure, dom.panel);
      delete dom.figure.dataset.journeyPortal;
      delete dom.ripLayer.dataset.journeyPortal;
      // The inline z-index has to go with them: it used to survive every flight, leaving the
      // (invisible) ship shell pinned above all page chrome for the rest of the page's life.
      dom.figure.style.removeProperty('z-index');
      JourneyPortal.active = false;
    },

    // Set once, on activate. This ran every frame of every cruise, writing an unchanging value
    // and invalidating the ship's style for nothing.
    ensureAbovePanel() {
      if (!JourneyPortal.active) return;
      dom.figure.style.zIndex = String(CONFIG.journeyPortalZ);
    },
  };
