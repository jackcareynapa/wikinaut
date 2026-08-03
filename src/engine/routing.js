  // ─── Routing ─────────────────────────────────────────────────────────────────

  const Routing = {
    // The backend returns ALL equally-short paths for a query (that's what powers the
    // route-selection feature — no extra backend work). Map every one to a title route,
    // de-dupe, and cap at CONFIG.maxRoutes for star-map legibility.
    // Successful charts are cached in sessionStorage (short TTL) so re-charting the same
    // pair — retries, backtracking, route-pager exploration across reloads — is instant.
    async fetchRoutes(sourceTitle, targetTitle) {
      const cacheId =
        `${Titles.canonical(sourceTitle)}${Titles.canonical(targetTitle)}`;
      const cached =
        SessionCache.get(CONFIG.routesCacheKey, cacheId, CONFIG.routesCacheTtlMs);
      if (cached) return cached.map((route) => [...route]);

      let data;
      try {
        data = await requestJson(`${Backend.url}/paths`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({source: sourceTitle, target: targetTitle}),
        });
      } catch (err) {
        throw Routing.wrapBackendError(err);
      }

      if (!data.paths || !data.paths.length) {
        throw Object.assign(
          new Error(
            `No course found between "${sourceTitle}" and "${targetTitle}". ` +
              `One of these articles may not be in the graph yet, ` +
              `or there's simply no Wikipedia link path between them.`),
          {code: 'wn/route-none'});
      }

      const seen = new Set();
      const routes = [];
      for (const path of data.paths) {
        const route = path.map((pageId) => {
          const page = data.pages?.[String(pageId)];
          if (!page?.title) {
            throw Object.assign(
              new Error('The course response was missing a page title. Please try again.'),
              {code: 'wn/backend-bad-response'});
          }
          return page.title;
        });
        if (route.length < 2) continue;
        const key = route.join('\u0001');   // titles contain spaces; join on a non-title char
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push(route);
        if (routes.length >= CONFIG.maxRoutes) break;
      }

      if (!routes.length) {
        throw Object.assign(
          new Error('That course is too short to fly — try a more distant destination.'),
          {code: 'wn/route-none'});
      }

      SessionCache.put(CONFIG.routesCacheKey, cacheId, routes, CONFIG.routesCacheMax);
      return routes;
    },

    // Backend-supplied messages (page-not-found, bad-request, MediaWiki-style errors — anything
    // requestJson already tagged with a `code`) are already player-facing; pass them through
    // unchanged. Only the raw transport-layer failures (unreachable/timeout/malformed body) need
    // a friendlier wrapper here.
    wrapBackendError(err) {
      if (err.code && err.code.startsWith('backend/')) return err;

      let code = err.code;
      let friendly;
      if (err.message === 'Request timed out.') {
        code = code || 'wn/backend-timeout';
        friendly =
          'The navigation backend took too long to respond. It may be waking up from idle — try again in a moment.';
      } else if (err.message === 'Network request failed.') {
        code = code || 'wn/backend-unreachable';
        friendly = "Couldn't reach the navigation backend. Check your connection, or set a Backend URL in settings.";
      } else if (code === 'wn/backend-bad-response') {
        friendly = err.message;
      } else {
        code = code || 'wn/backend-unreachable';
        friendly =
          `Couldn't reach the navigation backend (${err.message}). ` +
            `Check your connection, or set a Backend URL in settings.`;
      }
      return Object.assign(new Error(friendly), {code});
    },

    async fetchGraphMeta() {
      const data = await requestJson(`${Backend.url}/ok`);
      const ts = data?.timestamp ?? data?.built_at ?? data?.date ?? data?.updated;
      if (!ts) return null;
      const date = new Date(ts);
      return isNaN(date.getTime()) ? null : date;
    },

    // Titles that redirect TO `title` — so Links.matchesTitle can also recognize a live page
    // linking via a redirect alias (e.g. route step "New York City" but the on-page anchor is
    // literally "NYC"). Best-effort: any failure just means Links falls back to exact-title
    // matching (and ultimately the URL-jump fallback) — this never blocks the flight.
    // Alias sets are session-cached; only successful lookups are stored, so a transient API
    // failure is retried on the next hop that needs it.
    async fetchRedirectAliases(title) {
      const cacheId = Titles.canonical(title);
      const cached = SessionCache.get(CONFIG.aliasCacheKey, cacheId);
      if (cached !== undefined) return cached;
      try {
        const params = new URLSearchParams({
          action: 'query',
          list: 'backlinks',
          bltitle: title,
          blfilterredir: 'redirects',
          bllimit: 'max',   // popular targets can have hundreds of redirect aliases
          format: 'json',
        });
        const data = await requestJson(`${CONFIG.wikipediaApiUrl}?${params.toString()}`);
        const pages = data?.query?.backlinks;
        const aliases = Array.isArray(pages) ? pages.map((p) => p.title).filter(Boolean) : [];
        SessionCache.put(CONFIG.aliasCacheKey, cacheId, aliases, CONFIG.aliasCacheMax);
        return aliases;
      } catch (err) {
        console.warn('[Wikinaut] wn/redirect-lookup-failed', title, err);
        return [];
      }
    },

    async autocomplete(query) {
      // No `origin` param: the script runs on en.wikipedia.org and reaches the API via
      // GM_xmlhttpRequest (CORS-exempt). Passing origin=* forces an anonymous-CORS request,
      // which MediaWiki rejects when the browser's Wikipedia session cookies ride along —
      // silently breaking autocomplete for logged-in users.
      const params = new URLSearchParams({
        action: 'opensearch',
        search: query,
        limit: String(CONFIG.autocompleteLimit),
        namespace: '0',
        format: 'json',
      });
      const data = await requestJson(`${CONFIG.wikipediaApiUrl}?${params.toString()}`);
      return Array.isArray(data?.[1]) ? data[1] : [];
    },
  };
