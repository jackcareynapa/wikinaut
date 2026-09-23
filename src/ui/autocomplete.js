  // ─── Autocomplete ───────────────────────────────────────────────────────────
  // The destination input is an ARIA combobox: the suggestions are non-focusable options and
  // the keyboard drives them from the input (ArrowUp/Down highlights via
  // aria-activedescendant, Enter picks). They used to be buttons that committed on mousedown
  // only, so a keyboard user who Tabbed to one and pressed Enter fired a click nothing
  // listened for — and since Chart Course is gated on a pick, the game was unplayable
  // without a mouse.

  // Query → suggestion list for this page's lifetime. Retyping/backspacing replays earlier
  // queries constantly; a hit renders instantly and skips both the debounce and the API call.
  const autocompleteCache = new Map();
  const AUTOCOMPLETE_CACHE_MAX = 80;

  function onDestinationInput() {
    if (inFlight()) return;
    // Editing abandons any locked destination and charted course (strict gating).
    runtime.selectedPage = null;
    invalidateCourse();
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
      renderSuggestions(cached, query);
      return;
    }

    runtime.autocompleteTimer = window.setTimeout(() => {
      fetchSuggestions(query);
    }, CONFIG.autocompleteDebounceMs);
  }

  // Drop the charted course when the destination changes. The chart, status, and saved state
  // are cleared together: the console used to keep saying "Course locked… Ready to launch"
  // beside a disabled Launch key, and a reload resurrected the abandoned course. A no-op once
  // nothing is charted, so it is cheap on every keystroke.
  function invalidateCourse() {
    const hadCourse =
      Boolean(runtime.route) || Phase.is(PHASES.COURSE_READY, PHASES.STALLED, PHASES.ARRIVED);
    runtime.route = null;
    runtime.routes = null;
    runtime.routeIndex = 0;
    dom.beginButton.disabled = true;
    updateRouteCycle();
    if (!hadCourse) return;
    Storage.clear();
    renderRoute([]);
    setStatus(IDLE_STATUS);
    Phase.set(PHASES.IDLE);
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
    if (dom.chartButton) dom.chartButton.disabled = !valid || inFlight();
    if (valid || !text) setInputHint('', valid ? 'ok' : 'idle');
    else setInputHint('Pick a destination from the suggestions to lock coordinates.', 'warn');
    // Editing away a valid pick drops a pending destination/course back to IDLE;
    // locking a pick from rest advances to DESTINATION_SET. In-flight and
    // already-charted (COURSE_READY) states are left untouched while still valid.
    if (!valid && Phase.is(PHASES.DESTINATION_SET, PHASES.COURSE_READY)) {
      Phase.set(PHASES.IDLE);
    } else if (valid && Phase.is(PHASES.IDLE)) {
      Phase.set(PHASES.DESTINATION_SET);
    }
  }

  // The line under the destination input. 'warn' shows it in the signal color; 'idle'/'ok'
  // hide it.
  function setInputHint(text, state) {
    if (!dom.inputHint) return;
    dom.inputHint.textContent = text;
    dom.inputHint.dataset.state = state;
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
      renderSuggestions(results, query);
    } catch (err) {
      if (requestId === runtime.autocompleteAbortId) {
        console.warn('[Wikinaut] autocomplete failed', err);
        closeSuggestions();
        setInputHint("Couldn't load suggestions. Check your connection.", 'warn');
      }
    }
  }

  function renderSuggestions(results, query = '') {
    dom.suggestions.replaceChildren();
    runtime.suggestions = results;
    if (!results.length) {
      closeSuggestions();
      // Otherwise the hint keeps asking for a pick from a list that isn't there.
      setInputHint(`No Wikipedia article matches “${query}”.`, 'warn');
      return;
    }

    results.forEach((title, i) => {
      const option = document.createElement('div');
      option.id = `wikinaut-suggestion-${i}`;
      option.className = 'wikinaut-suggestion';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.textContent = title;
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();          // commit before the input blurs; no focus/blur race
        pickSuggestion(title);
      });
      dom.suggestions.append(option);
    });
    runtime.suggestionIndex = -1;
    dom.suggestions.dataset.open = 'true';
    dom.input.setAttribute('aria-expanded', 'true');
    dom.input.removeAttribute('aria-activedescendant');
  }

  // Lock a real OpenSearch title as the destination — this is what unlocks Chart Course.
  function pickSuggestion(title) {
    dom.input.value = title;
    invalidateCourse();                  // a fresh destination invalidates any charted route
    runtime.selectedPage = title;
    closeSuggestions();
    updateChartGate();
    dom.input.focus();
  }

  function suggestionsOpen() {
    return dom.suggestions.dataset.open === 'true';
  }

  // ArrowDown/ArrowUp through the open list, wrapping; the highlight is announced through
  // aria-activedescendant while focus stays in the input.
  function moveSuggestion(delta) {
    const options = [...dom.suggestions.children];
    if (!options.length) return;
    const n = options.length;
    const from = runtime.suggestionIndex;
    runtime.suggestionIndex = from === -1 ? (delta > 0 ? 0 : n - 1) : (from + delta + n) % n;
    options.forEach((el, i) => {
      el.setAttribute('aria-selected', String(i === runtime.suggestionIndex));
    });
    dom.input.setAttribute('aria-activedescendant', options[runtime.suggestionIndex].id);
  }

  // Enter in the input. A highlighted suggestion is picked (and nothing else happens, so the
  // player sees the lock before charting). Typing an exact listed title is as good as picking
  // it. Returns true when the key was consumed by a pick without a chart.
  function commitSuggestionFromKeyboard() {
    if (suggestionsOpen() && runtime.suggestionIndex >= 0) {
      const title = runtime.suggestions[runtime.suggestionIndex];
      if (title) {
        pickSuggestion(title);
        return true;
      }
    }
    if (!chartGateValid()) {
      const text = dom.input.value.trim();
      const exact = runtime.suggestions.find((title) => Titles.same(title, text));
      if (exact) pickSuggestion(exact);
    }
    return false;
  }

  function closeSuggestions() {
    dom.suggestions.dataset.open = 'false';
    runtime.suggestionIndex = -1;
    dom.input.setAttribute('aria-expanded', 'false');
    dom.input.removeAttribute('aria-activedescendant');
  }
