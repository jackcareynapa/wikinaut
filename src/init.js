  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    Settings.load();
    injectStyles();
    createRoot();
    Phase.set(PHASES.IDLE);
    bindEvents();
    Trail.init();
    Settings.applyToDom();
    syncSettingsUI();

    // The ship stays hidden until a launch (or a warp-arrival on a resumed page).
    Figure.hide();

    JourneyPortal.deactivate();
    dom.ripLayer.dataset.open = 'false';
    dom.ripLayer.replaceChildren();

    // Fetch graph freshness non-blocking; the backend /ok may not return a build date.
    Routing.fetchGraphMeta().then(setFreshness).catch(() => {});

    const state = Storage.load();
    if (state?.route?.length) {
      runtime.route = state.route;
      // Restore the full route set (pre-launch only) so the cycler survives a reload.
      if (Array.isArray(state.routes) && state.routes.length > 1 && !state.active) {
        runtime.routes = state.routes;
        runtime.routeIndex = Number.isInteger(state.routeIndex) ? state.routeIndex : 0;
      }
      dom.input.value = state.targetTitle || state.route[state.route.length - 1] || '';
      // A saved course counts as a locked destination so Chart stays usable on reload.
      runtime.selectedPage = dom.input.value || null;
      renderRoute(
        state.route, state.currentIndex || 0, (state.currentIndex || 0) + 1, alternateRoutes(),
        runtime.routeIndex);
      updateRouteCycle();
      if (state.active) {
        setStatus('Resuming course — picking up where the ship left off…');
        // Brief settle for first paint only — the navbox-collapse race is handled by the
        // ensureVisible guards at flight start and touchdown, not by this delay.
        window.setTimeout(() => Traversal.resume(), 150);
      } else {
        setStatus('Saved course ready. Press Launch when ready.');
        dom.beginButton.disabled = state.route.length < 2;
        if (state.route.length >= 2) Phase.set(PHASES.COURSE_READY);
      }
    }

    updateChartGate();
  }

  init();
