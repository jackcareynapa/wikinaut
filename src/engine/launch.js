  // ─── Launch (engine, not FX) ──────────────────────────────────────────────────
  // Everything below this marker is engine code. It lives here only because launching
  // reads the charted route the atlas above just drew; keep the section header so the
  // FX/engine boundary grep in CLAUDE.md does not mistake it for part of StarMap.

  async function beginWalk() {
    const route = runtime.route || Storage.load()?.route;
    if (!route || route.length < 2) {
      showToast('Chart a course before launching.');
      return;
    }

    const currentTitle = Titles.currentPageTitle();
    const currentIndex = Titles.indexInRoute(route, currentTitle);
    if (currentIndex === -1) {
      showToast("This page isn't on the plotted course. Chart a fresh course from here.");
      Storage.clear();
      return;
    }

    Storage.saveRoute(route, {active: true, currentIndex});
    dom.beginButton.disabled = true;

    // Warm the alias cache for the first hop through the countdown, so th
    // e origin page's
    // own link scan never waits on the network even when the title needs a redirect alias.
    const firstHop = route[currentIndex + 1];
    if (firstHop) Routing.fetchRedirectAliases(firstHop).catch(() => {});

    // The launch sequence (countdown + gantry + lift-off) plays only here, on the origin
    // page. resume() then continues the flight; the first hop skips the dock-exit because
    // the ship is already airborne off the panel top. LaunchSequence is pure FX — this
    // function (the engine side) owns the phase transitions and status narration.
    const reduce = prefersReducedMotion();
    Phase.set(PHASES.COUNTDOWN);
    await LaunchSequence.arm(reduce);
    await LaunchSequence.countdown(reduce, (n) => setStatus(`Launch in ${n}…`));
    await LaunchSequence.spoolUp(reduce);
    Phase.set(PHASES.LAUNCHING);
    setStatus('Launch!');
    await LaunchSequence.liftoff(reduce);

    await Traversal.resume();
  }
