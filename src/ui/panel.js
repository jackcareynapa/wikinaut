  // ─── DOM setup ──────────────────────────────────────────────────────────────

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'wikinaut-styles';
    style.textContent = CSS;
    document.head.append(style);
  }

  function createRoot() {
    const root = document.createElement('div');
    root.id = 'wikinaut-root';
    root.innerHTML = `
      <div id="wikinaut-jump-layer" aria-hidden="true"></div>
      <div id="wikinaut-ship-shell" data-visible="false" data-pose="idle" aria-hidden="true">
        ${Figure.renderSvg()}
      </div>
      <section id="wikinaut-panel" aria-label="Wikinaut navigation console">
        <div id="wikinaut-launchpad" aria-hidden="true">
          <svg class="wikinaut-gantry-svg" viewBox="0 0 104 84" aria-hidden="true">
            <g class="wikinaut-gantry">
              <g class="wikinaut-gantry-back">
                <line x1="20" y1="82" x2="20" y2="14" />
                <line x1="84" y1="82" x2="84" y2="14" />
                <line x1="20" y1="14" x2="40" y2="6" />
                <line x1="84" y1="14" x2="64" y2="6" />
                <line x1="20" y1="40" x2="84" y2="40" />
                <line x1="20" y1="62" x2="84" y2="62" />
              </g>
              <line x1="20" y1="82" x2="20" y2="14" />
              <line x1="84" y1="82" x2="84" y2="14" />
              <line x1="20" y1="14" x2="40" y2="6" />
              <line x1="84" y1="14" x2="64" y2="6" />
              <line x1="20" y1="40" x2="84" y2="40" />
              <line x1="20" y1="62" x2="84" y2="62" />
            </g>
          </svg>
          <div class="wikinaut-smoke">
            <span class="wikinaut-smoke-puff" style="left:8%; --wn-smoke-dx:-30px; animation-delay:0ms;"></span>
            <span class="wikinaut-smoke-puff" style="left:26%; --wn-smoke-dx:-14px; animation-delay:80ms;"></span>
            <span class="wikinaut-smoke-puff" style="left:44%; --wn-smoke-dx:4px; animation-delay:40ms;"></span>
            <span class="wikinaut-smoke-puff" style="left:60%; --wn-smoke-dx:18px; animation-delay:120ms;"></span>
            <span class="wikinaut-smoke-puff" style="left:76%; --wn-smoke-dx:32px; animation-delay:60ms;"></span>
          </div>
          <div class="wikinaut-baydoor left"></div>
          <div class="wikinaut-baydoor right"></div>
        </div>
        <div class="wikinaut-field">
          <label class="wikinaut-label" for="wikinaut-target-input">Set coordinates</label>
          <input id="wikinaut-target-input" type="text" autocomplete="off" placeholder="Destination article — Philosophy, Cat, Moon…" />
          <div id="wikinaut-suggestions" role="listbox" aria-label="Wikipedia article suggestions"></div>
          <div id="wikinaut-input-hint" data-state="idle" aria-live="polite"></div>
        </div>
        <button id="wikinaut-chart-button" class="wikinaut-button" type="button" disabled>Chart Course</button>
        <button id="wikinaut-begin-button" class="wikinaut-button secondary" type="button" disabled>Launch</button>
        <button id="wikinaut-settings-button" class="wikinaut-button secondary icon" type="button" title="Console settings" aria-expanded="false"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="2.4"></circle><path d="M8 1.4v2M8 12.6v2M1.4 8h2M12.6 8h2M3.3 3.3l1.5 1.5M11.2 11.2l1.5 1.5M12.7 3.3l-1.5 1.5M4.8 11.2l-1.5 1.5"></path></svg></button>
        <div id="wikinaut-route-card" aria-live="polite">
          <div id="wikinaut-status">Set a destination and chart a course through Wikipedia.</div>
          <div id="wikinaut-route-pager" hidden>
            <button id="wikinaut-route-prev" class="wikinaut-button secondary icon" type="button"
              title="Previous route" aria-label="Previous route"><svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 1.5 3 5l3.5 3.5"></path></svg></button>
            <span id="wikinaut-route-label" aria-live="polite"></span>
            <button id="wikinaut-route-next" class="wikinaut-button secondary icon" type="button"
              title="Next route" aria-label="Next route"><svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 1.5 7 5 3.5 8.5"></path></svg></button>
          </div>
          <div id="wikinaut-starmap"></div>
          <div id="wikinaut-freshness"></div>
          <div id="wikinaut-countdown" data-on="false" aria-live="assertive"></div>
        </div>
        <div id="wikinaut-settings-section" hidden aria-label="Console settings">
          <div class="wikinaut-settings-row">
            <label class="wikinaut-settings-label" for="wikinaut-backend-input">Backend URL</label>
            <input type="text" id="wikinaut-backend-input" autocomplete="off" spellcheck="false" />
          </div>
          <div class="wikinaut-settings-row">
            <label class="wikinaut-settings-label" for="wikinaut-speed-slider">Flight speed</label>
            <input type="range" id="wikinaut-speed-slider" class="wikinaut-range" min="100" max="1200" step="50" />
            <span id="wikinaut-speed-value" class="wikinaut-settings-value"></span>
          </div>
          <div class="wikinaut-settings-row">
            <label class="wikinaut-settings-label" for="wikinaut-ship-color">Color</label>
            <input type="color" id="wikinaut-ship-color" class="wikinaut-color-input" />
          </div>
          <button id="wikinaut-settings-reset" class="wikinaut-button secondary" type="button">Reset</button>
        </div>
      </section>
    `;
    document.documentElement.append(root);

    Object.assign(dom, {
      root,
      panel: root.querySelector('#wikinaut-panel'),
      figure: root.querySelector('#wikinaut-ship-shell'),
      ripLayer: root.querySelector('#wikinaut-jump-layer'),
      input: root.querySelector('#wikinaut-target-input'),
      suggestions: root.querySelector('#wikinaut-suggestions'),
      inputHint: root.querySelector('#wikinaut-input-hint'),
      chartButton: root.querySelector('#wikinaut-chart-button'),
      beginButton: root.querySelector('#wikinaut-begin-button'),
      settingsButton: root.querySelector('#wikinaut-settings-button'),
      settingsSection: root.querySelector('#wikinaut-settings-section'),
      status: root.querySelector('#wikinaut-status'),
      routePager: root.querySelector('#wikinaut-route-pager'),
      routePrev: root.querySelector('#wikinaut-route-prev'),
      routeNext: root.querySelector('#wikinaut-route-next'),
      routeLabel: root.querySelector('#wikinaut-route-label'),
      routeStrip: root.querySelector('#wikinaut-starmap'),
      freshness: root.querySelector('#wikinaut-freshness'),
      launchpad: root.querySelector('#wikinaut-launchpad'),
      countdown: root.querySelector('#wikinaut-countdown'),
      backendInput: root.querySelector('#wikinaut-backend-input'),
      speedSlider: root.querySelector('#wikinaut-speed-slider'),
      speedValue: root.querySelector('#wikinaut-speed-value'),
      travelerColorInput: root.querySelector('#wikinaut-ship-color'),
      settingsReset: root.querySelector('#wikinaut-settings-reset'),
    });
  }

  function closeSettings() {
    runtime.settingsOpen = false;
    dom.settingsSection.hidden = true;
    dom.settingsButton.setAttribute('aria-expanded', 'false');
  }

  function bindEvents() {
    dom.input.addEventListener('input', onDestinationInput);
    // Warm the backend the moment the player shows intent: a Fly machine that idled to sleep
    // otherwise pays its wake-up inside the charting wait. Fire-and-forget, once per page.
    dom.input.addEventListener('focus', () => {
      requestText(`${Backend.url}/ok`).catch(() => {});
    }, {once: true});
    dom.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        chartCourse();
      }
      if (event.key === 'Escape') closeSuggestions();
    });

    dom.chartButton.addEventListener('click', chartCourse);
    dom.beginButton.addEventListener('click', beginWalk);
    dom.routePrev.addEventListener('click', () => cycleRoute(-1));
    dom.routeNext.addEventListener('click', () => cycleRoute(1));

    document.addEventListener('click', (event) => {
      if (!dom.suggestions.contains(event.target) && event.target !== dom.input) {
        closeSuggestions();
      }
      if (
        runtime.settingsOpen &&
        !dom.settingsSection.contains(event.target) &&
        event.target !== dom.settingsButton
      ) {
        closeSettings();
      }
    });

    dom.settingsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      runtime.settingsOpen = !runtime.settingsOpen;
      dom.settingsSection.hidden = !runtime.settingsOpen;
      dom.settingsButton.setAttribute('aria-expanded', String(runtime.settingsOpen));
    });

    dom.backendInput.addEventListener('change', () => {
      if (!Backend.set(dom.backendInput.value)) {
        // Put the still-active backend back in the field so the box never shows a value
        // that isn't in effect.
        dom.backendInput.value = Backend.override;
        setStatus('Backend URL must be an https:// address (or http:// on localhost).',
          {isError: true});
        return;
      }
      const where = Backend.override ? Backend.url : `default (${CONFIG.apiBaseUrl})`;
      setStatus(`Backend set to ${where}.`);
    });

    dom.speedSlider.addEventListener('input', () => {
      const val = Number(dom.speedSlider.value);
      dom.speedValue.textContent = `${val} px/s`;
      Settings.save({walkingPixelsPerSecond: val});
      // Speed also drives the beat tempo (--wn-tempo), so the warp CSS has to be re-published.
      Settings.applyToDom();
    });

    dom.travelerColorInput.addEventListener('input', () => {
      Settings.save({travelerColor: dom.travelerColorInput.value});
      Settings.applyToDom();
    });

    dom.settingsReset.addEventListener('click', () => {
      Settings.reset();
      Settings.applyToDom();
      syncSettingsUI();
    });

  }

  function syncSettingsUI() {
    const speed = Settings.get('walkingPixelsPerSecond');
    dom.speedSlider.value = speed;
    dom.speedValue.textContent = `${speed} px/s`;
    dom.travelerColorInput.value = Settings.get('travelerColor');
    dom.backendInput.placeholder = CONFIG.apiBaseUrl;
    dom.backendInput.value = Backend.override;
  }
