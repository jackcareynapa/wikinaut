  // ─── Autocomplete ───────────────────────────────────────────────────────────

  // Query → suggestion list for this page's lifetime. Retyping/backspacing replays earlier
  // queries constantly; a hit renders instantly and skips both the debounce and the API call.
  const autocompleteCache = new Map();
  const AUTOCOMPLETE_CACHE_MAX = 80;

  function onDestinationInput() {
    // Editing abandons any locked destination and charted course (strict gating).
    runtime.selectedPage = null;
    runtime.route = null;
    runtime.routes = null;
    runtime.routeIndex = 0;
    dom.beginButton.disabled = true;
    updateRouteCycle();
    updateChartGate();
    clearTimeout(runtime.autocompleteTimer);

    const query = dom.input.value.trim();
    if (query.length < 2) {
      closeSuggestions();
      return;
    }

    const cached = autocompleteCache.get(query);
    if (cached) {
      // Invalidate any in-flight fetch for an older query so its late response can't
      // overwrite these fresher (cached) suggestions.
      runtime.autocompleteAbortId += 1;
      renderSuggestions(cached);
      return;
    }

    runtime.autocompleteTimer = window.setTimeout(() => {
      fetchSuggestions(query);
    }, CONFIG.autocompleteDebounceMs);
  }

  // Chart Course is enabled only when the destination came from OpenSearch — i.e. the
  // current input text exactly matches a suggestion the user actually picked.
  function chartGateValid() {
    const text = dom.input.value.trim();
    return Boolean(runtime.selectedPage) && text.length > 0 && Titles.same(runtime.selectedPage, text);
  }

  function updateChartGate() {
    const valid = chartGateValid();
    const text = dom.input.value.trim();
    if (dom.chartButton) dom.chartButton.disabled = !valid;
    if (dom.inputHint) {
      dom.inputHint.textContent = valid || !text
        ? ''
        : 'Pick a destination from the suggestions to lock coordinates.';
      dom.inputHint.dataset.state = valid ? 'ok' : text ? 'warn' : 'idle';
    }
    // Editing away a valid pick drops a pending destination/course back to IDLE;
    // locking a pick from rest advances to DESTINATION_SET. In-flight and
    // already-charted (COURSE_READY) states are left untouched while still valid.
    if (!valid && Phase.is(PHASES.DESTINATION_SET, PHASES.COURSE_READY)) {
      Phase.set(PHASES.IDLE);
    } else if (valid && Phase.is(PHASES.IDLE)) {
      Phase.set(PHASES.DESTINATION_SET);
    }
  }

  async function fetchSuggestions(query) {
    const requestId = ++runtime.autocompleteAbortId;
    try {
      const results = await Routing.autocomplete(query);
      autocompleteCache.set(query, results);
      if (autocompleteCache.size > AUTOCOMPLETE_CACHE_MAX) {
        autocompleteCache.delete(autocompleteCache.keys().next().value);
      }
      if (requestId !== runtime.autocompleteAbortId) return;
      renderSuggestions(results);
    } catch (err) {
      if (requestId === runtime.autocompleteAbortId) {
        console.warn('[Wikinaut] autocomplete failed', err);
        closeSuggestions();
      }
    }
  }

  function renderSuggestions(results) {
    dom.suggestions.replaceChildren();
    if (!results.length) {
      closeSuggestions();
      return;
    }

    for (const title of results) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wikinaut-suggestion';
      button.textContent = title;
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();          // commit before the input blurs; no focus/blur race
        dom.input.value = title;
        runtime.selectedPage = title;    // a real OpenSearch pick — unlocks Chart Course
        // A fresh destination invalidates any previously charted route.
        runtime.route = null;
        runtime.routes = null;
        runtime.routeIndex = 0;
        updateRouteCycle();
        dom.beginButton.disabled = true;
        if (Phase.is(PHASES.COURSE_READY)) Phase.set(PHASES.DESTINATION_SET);
        closeSuggestions();
        updateChartGate();
        dom.input.focus();
      });
      dom.suggestions.append(button);
    }
    dom.suggestions.dataset.open = 'true';
  }

  function closeSuggestions() {
    dom.suggestions.dataset.open = 'false';
  }
