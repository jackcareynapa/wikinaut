  // ─── Core flow ──────────────────────────────────────────────────────────────

  async function chartCourse() {
    if (inFlight()) return;
    const targetTitle = dom.input.value.trim();
    const sourceTitle = Titles.currentPageTitle();

    if (!chartGateValid()) {
      updateChartGate();
      showToast('Pick a destination from the suggestions first.');
      dom.input.focus();
      return;
    }

    if (Titles.same(sourceTitle, targetTitle)) {
      renderRoute([sourceTitle], 0);
      setStatus('You are already at your destination. Holding orbit.');
      Phase.set(PHASES.ARRIVED);
      dom.beginButton.disabled = true;
      return;
    }

    Phase.set(PHASES.PLOTTING);
    setBusy(true, `Plotting a course: ${sourceTitle} → ${targetTitle}…`);
    closeSuggestions();
    // Collapse the previous chart rather than emptying it in place, which left a blank
    // well open for the whole plotting wait.
    renderRoute([]);
    dom.beginButton.disabled = true;

    try {
      const routes = await Routing.fetchRoutes(sourceTitle, targetTitle);
      const route = routes[0];
      runtime.routes = routes;
      runtime.routeIndex = 0;
      runtime.route = route;
      Storage.saveRoute(route, {routes, routeIndex: 0});
      renderRoute(route, 0, 1, alternateRoutes(), runtime.routeIndex);
      updateRouteCycle();
      const hops = route.length - 1;
      const routeNote =
        routes.length > 1 ? ` ${routes.length} equally short routes charted.` : '';
      setStatus(
        `Course locked — ${hops} ${hops === 1 ? 'jump' : 'jumps'}.${routeNote} Ready to launch.`);
      dom.beginButton.disabled = route.length < 2;
      Phase.set(route.length < 2 ? PHASES.IDLE : PHASES.COURSE_READY);
    } catch (error) {
      runtime.route = null;
      runtime.routes = null;
      runtime.routeIndex = 0;
      Storage.clear();
      dom.beginButton.disabled = true;
      renderRoute([]);
      updateRouteCycle();
      console.error('[Wikinaut]', error.code || 'wn/route-none', error);
      setStatus(error.message || 'No course found. Try a different destination.', {isError: true});
      Phase.set(PHASES.IDLE);
    } finally {
      setBusy(false);
    }
  }

  // Phase.set calls this on every transition. In flight the destination input is read-only,
  // Chart is off, and the Launch key is the Abort key; leaving flight restores Launch and
  // DISABLES it by default. Every exit path that should leave it usable (a stall's retry, an
  // abort's resume) re-enables it right after its own Phase.set, so none can inherit a live
  // key by accident.
  function syncFlightControls(prevPhase) {
    if (!dom.beginButton) return;
    const flying = inFlight();
    const wasFlying = [PHASES.COUNTDOWN, PHASES.LAUNCHING, PHASES.FLYING].includes(prevPhase);
    if (flying === wasFlying) return;
    dom.input.readOnly = flying;
    dom.chartButton.disabled = flying || !chartGateValid();
    dom.beginButton.textContent = flying ? 'Abort' : 'Launch';
    dom.beginButton.dataset.mode = flying ? 'abort' : 'launch';
    if (flying) {
      closeSuggestions();
      dom.beginButton.setAttribute('aria-label', 'Abort flight');
    } else {
      dom.beginButton.removeAttribute('aria-label');
    }
    dom.beginButton.disabled = !flying;
  }

  // The Launch key's one handler: it is Abort for as long as a flight owns the page.
  function onBeginButton() {
    if (inFlight()) Traversal.abort();
    else beginWalk();
  }

  // The non-selected routes, each tagged with its STABLE lane (= index in runtime.routes) so
  // the star chart draws every route on the same lane no matter which one is selected.
  function alternateRoutes() {
    if (!runtime.routes || runtime.routes.length < 2) return [];
    return runtime.routes
      .map((route, laneIdx) => ({route, lane: laneIdx}))
      .filter((r) => r.lane !== runtime.routeIndex);
  }

  // Route pager: visible only when the last chart produced several equally-short routes
  // (CSS additionally gates it to the course-ready phase). Label reads "Route k/N".
  function updateRouteCycle() {
    if (!dom.routePager) return;
    const n = runtime.routes?.length || 0;
    // Only from the course's origin page: after a stall or an abort partway along, the
    // console is course-ready again, but the other routes needn't pass through this page.
    const midCourse = Titles.indexInRoute(runtime.route || [], Titles.currentPageTitle()) > 0;
    dom.routePager.hidden = n < 2 || midCourse;
    if (n >= 2) dom.routeLabel.textContent = `Route ${runtime.routeIndex + 1}/${n}`;
  }

  // Step to the previous/next equally-short route (wraps around): swaps the selection,
  // re-plots the star map, and re-saves the (not yet launched) course. Everything else —
  // status, Launch, destination — is deliberately left untouched.
  function cycleRoute(delta = 1) {
    if (!runtime.routes || runtime.routes.length < 2) return;
    if (!Phase.is(PHASES.COURSE_READY)) return;
    const n = runtime.routes.length;
    runtime.routeIndex = (runtime.routeIndex + delta + n) % n;
    runtime.route = runtime.routes[runtime.routeIndex];
    Storage.saveRoute(runtime.route, {routes: runtime.routes, routeIndex: runtime.routeIndex});
    renderRoute(runtime.route, 0, 1, alternateRoutes(), runtime.routeIndex);
    updateRouteCycle();
  }

  // Thin delegate kept so every call site keeps its historical name; the chart itself
  // lives in the StarMap module below.
  function renderRoute(route, currentIndex = -1, nextIndex = currentIndex + 1, alternates = [], lane = 0) {
    StarMap.render(route, currentIndex, nextIndex, alternates, lane);
  }
