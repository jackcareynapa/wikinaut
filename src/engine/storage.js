  // ─── Storage (route state) ───────────────────────────────────────────────────

  const Storage = {
    load() {
      try {
        const raw = sessionStorage.getItem(CONFIG.routeStorageKey);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        console.warn('[Wikinaut] wn/route-state-corrupt', error);
        return null;
      }
    },

    // Never throws: quota-exceeded / private-mode storage denial degrades to "the flight still
    // navigates, it just won't auto-resume across the page reload" rather than surfacing as a
    // generic turbulence error.
    save(state) {
      try {
        sessionStorage.setItem(CONFIG.routeStorageKey, JSON.stringify(state));
        return true;
      } catch (error) {
        console.warn('[Wikinaut] wn/storage-write-failed', error);
        return false;
      }
    },

    // The one serializer for route state: every call site describes only what differs
    // (active/currentIndex/routes/routeIndex/entry) and targetTitle is always derived from
    // the route, so the shape can't drift between writers.
    //
    // The charted alternates ride along by DEFAULT, for the whole journey. The star chart's
    // geometry is computed from the full route set (see StarMap.layout), so a mid-flight write
    // that dropped them would silently re-lay every waypoint the moment the ship launched.
    // Explicit extras still win, so chartCourse/cycleRoute can set them outright.
    saveRoute(route, extras = {}) {
      return Storage.save({
        active: false,
        currentIndex: 0,
        route,
        targetTitle: route[route.length - 1] ?? '',
        routes: runtime.routes ?? undefined,
        routeIndex: runtime.routeIndex ?? 0,
        ...extras,
      });
    },

    clear() {
      try {
        sessionStorage.removeItem(CONFIG.routeStorageKey);
      } catch (error) {
        console.warn('[Wikinaut] wn/storage-write-failed', error);
      }
    },
  };
