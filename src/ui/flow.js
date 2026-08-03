  // ─── Core flow ──────────────────────────────────────────────────────────────

  async function chartCourse() {
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
    dom.routeStrip.replaceChildren();
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

  // The non-selected charted routes, for the star map's dim underlay fan.
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
    dom.routePager.hidden = n < 2;
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
