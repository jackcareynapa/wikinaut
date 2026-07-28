// ==UserScript==
// @name         Wikinaut
// @namespace    https://github.com/jackcareynapa/wikinaut
// @version      1.0.0
// @description  Chart a course through Wikipedia. Wikinaut finds the shortest link-path to any article and flies you there through hyperspace.
// @author       jackcareynapa
// @match        https://en.wikipedia.org/wiki/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      wikinaut-api.fly.dev
// @connect      en.wikipedia.org
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function wikinautUserscript() {
  'use strict';

  if (window.__wikinautLoaded) return;
  window.__wikinautLoaded = true;

  // Hosts allowed to serve the backend over plain http. Everything else must be https,
  // because a backend URL receives the article titles the player is routing between.
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

  /**
   * Tuning:
   * - walkingPixelsPerSecond: default flight pace (overridable via settings drawer).
   * - jumpDurationMs: how long the hyperspace jump plays before navigation.
   * - shipSize: procedural SVG craft scale.
   * - trailFadeMs: how long each trail particle lives before fading.
   *
   * To swap the wireframe craft for a sprite, keep #wikinaut-ship-shell and replace
   * Figure.renderSvg()/pose data-attributes for your asset.
   *
   * The backend defaults to the hosted Fly.io API (CONFIG.apiBaseUrl) so the script works with no
   * setup. Players can point it at a self-hosted backend via Settings → Backend URL (persisted with
   * GM storage). See docs/web-server-setup.md.
   */
  const CONFIG = {
    apiBaseUrl: 'https://wikinaut-api.fly.dev',
    wikipediaApiUrl: 'https://en.wikipedia.org/w/api.php',
    backendUrlKey: 'wikinaut:backendUrl',
    routeStorageKey: 'wikinautState:v1',
    settingsStorageKey: 'wikinautSettings:v1',
    routesCacheKey: 'wikinaut:routes:v1',
    aliasCacheKey: 'wikinaut:aliases:v1',
    routesCacheTtlMs: 15 * 60 * 1000,  // charted routes go stale gracefully — the graph is a
                                       // monthly dump, but a short TTL keeps re-charts honest
    routesCacheMax: 20,
    aliasCacheMax: 40,
    figureSize: 56,
    minWalkDurationMs: 620,
    maxCruiseDurationMs: 12000, // safety net for pathological hops only, NOT a pacing knob —
                                // the flight-speed setting is always honored below this cap
                                // (capping compresses the flight and overrides the slider)
    jumpDurationMs: 700,  // every warp CSS animation interpolates this, so all FX rescale together
    autocompleteLimit: 6,
    autocompleteDebounceMs: 180,
    maxRoutes: 6,           // backend returns ALL equally-short paths; cap what the star map
                            // renders/cycles so the chart stays legible
    routeSketchMs: 900,
    trailFadeMs: 1100,
    panelReservePx: 120,
    journeyPortalZ: 2147483646,
  };

  // Palette — "celestial atlas in an Apollo fascia". One saturated accent (ember gold, the
  // plotted course and every primary action), parchment for engraved labels and chart
  // lettering, muted chart blues/violets for alternate lanes, and a signal red-orange
  // reserved exclusively for faults. THE single source of truth for every branded color:
  // each entry is emitted as a --wn-<kebab-name> CSS custom property plus a
  // --wn-<kebab-name>-rgb channel triplet (for rgba(var(--wn-x-rgb), α) alpha variants) on
  // all three style hosts — see the CSS var block. Restyle by editing values here, never by
  // scattering literals.
  const PALETTE = {
    bg: '#131828',          // instrument-fascia indigo charcoal
    spaceInk: '#070B15',    // deepest space: the chart plate field and inset wells
    accent: '#F3AE45',      // ember gold — course line, primary action, ship flame default
    accentHot: '#FFE9C2',   // white-hot center of the accent (flare cores, key text)
    accentGlow: '#FFCE87',  // warm phosphor — telemetry readout, focus rings
    accentDeep: '#D9932F',  // shadow stop of the accent (launch-key gradient bottom)
    blue: '#5E86B8',        // muted chart blue — graticule, alternate lane
    blueGlow: '#9FBBD9',
    dimWhite: '#9FA8BC',    // cool secondary text on the fascia
    parchment: '#E7DCC5',   // engraved label ivory + atlas chart lettering
    ink: '#171A26',         // engraved dark text ON an accent-filled cap (the LAUNCH key)
    purple: '#9B8CC9',      // slate violet — alternate lane, warp-tunnel contrast ring
    streakA: '#FFD98A',     // hyperspace streaks: pale gold…
    streakB: '#E07A3F',     // …and deep ember
    signal: '#FF7052',      // faults only: errors, stalled state, warnings
    // Gunmetal hull tones for the fighter craft.
    steelHi: '#C7D2E0',
    steel: '#8A97A8',
    steelDark: '#3A4453',
    steelShadow: '#1B2230',
  };

  // Type roles (system faces only — no webfont request from a userscript):
  // label = engraved instrument lettering; mono = telemetry readouts and coordinate entry;
  // chart = the celestial atlas's serif star names (italicized at the use site).
  const TYPE = {
    label: `'Avenir Next', Futura, 'Century Gothic', 'Trebuchet MS', sans-serif`,
    mono: `ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`,
    chart: `Georgia, 'Iowan Old Style', 'Times New Roman', serif`,
  };

  // '#00F3FF' → '0,243,255' for the --wn-*-rgb channel triplets and paletteRgba below.
  function paletteChannels(hex) {
    const {r, g, b} = hexToRgb(hex);
    return `${r},${g},${b}`;
  }

  // rgba() string from a PALETTE entry — for the few places (SVG presentation attributes)
  // where CSS var() isn't allowed and a literal color string must be built in JS.
  function paletteRgba(name, alpha) {
    return `rgba(${paletteChannels(PALETTE[name])},${alpha})`;
  }

  // Every PALETTE entry as CSS custom-property declarations: --wn-accent-hot / --wn-accent-hot-rgb.
  const PALETTE_CSS_VARS = Object.entries(PALETTE)
    .map(([name, hex]) => {
      const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return `--wn-${kebab}: ${hex}; --wn-${kebab}-rgb: ${paletteChannels(hex)};`;
    })
    .join('\n      ');

  const SETTINGS_DEFAULTS = {
    walkingPixelsPerSecond: 550,  // must sit on the speed slider's step grid (step=50), or
                                  // the thumb snaps and disagrees with the stored value
    // The ONE player color. Ship, engine flame, trail ramp, hyperspace streaks, and the
    // console accent family are all derived from it (deriveColorway) — never add a second
    // color setting; the whole point is that everything glows in agreement.
    travelerColor: PALETTE.accent,
  };

  const SELECTORS = {
    contentRoot: '#mw-content-text',
    articleBody: '#mw-content-text .mw-parser-output',
    pageTitle: '#firstHeading',
    // Wikipedia serves two article renderers with DIFFERENT internal-link href forms: the
    // legacy parser emits relative hrefs (/wiki/Foo) while Parsoid read views (progressively
    // rolled out across articles) emit protocol-relative absolute ones
    // (//en.wikipedia.org/wiki/Foo). Matching only the legacy form finds ZERO links on a
    // Parsoid page — every hop there would falsely report "link not on page". Select every
    // form here; Titles.rawFromHref then validates host + /wiki/ path properly.
    articleLink:
      'a[href^="/wiki/"], a[href^="./"], a[href^="//en.wikipedia.org/wiki/"], ' +
      'a[href^="https://en.wikipedia.org/wiki/"]',
  };

  // ─── CSS ────────────────────────────────────────────────────────────────────
  // No web-font @import here: a CSS @import inside injected styles blocks rendering of the
  // whole page on the font CDN. Typography is the TYPE role system above, built entirely on
  // system faces; if a display font ever becomes part of the design, load it via a
  // non-blocking <link rel="stylesheet"> with font-display: swap — never @import.
  //
  // Color policy: every branded color comes from PALETTE via var(--wn-*) / rgba(var(--wn-*-rgb), α).
  // Deliberately literal: neutral white/black highlights, the launch-flame orange ramp and
  // steel glints (single-use FX shading), and .wikinaut-reveal-pulse (animates article
  // containers outside the var hosts). SVG presentation attributes can't resolve var() —
  // renderSvg and renderRoute interpolate from PALETTE directly instead.
  const CSS = `
    #wikinaut-root,
    #wikinaut-root * {
      box-sizing: border-box;
    }

    /* The ship shell and jump layer are MOVED to document.body while a journey is active
       (JourneyPortal), so they must carry the palette variables themselves — a var() consumed
       there with #wikinaut-root as the only declaration site resolves to nothing, and an
       invalid custom property turns an SVG fill BLACK (this was the "gray flame" bug). */
    #wikinaut-root,
    #wikinaut-ship-shell,
    #wikinaut-jump-layer {
      ${PALETTE_CSS_VARS}
      --wn-ship-color: ${PALETTE.accent};
      color: var(--wn-parchment);
      font-family: ${TYPE.label};
    }

    /* ── Panel — machined instrument fascia ─────────────────────────────────
       A flat indigo-charcoal plate with a machined top highlight, real elevation
       (shadow, not glow), and four countersunk corner screws. Engraved lettering,
       inset wells, instrument keys. The neon-HUD scanlines/brackets are gone. */

    #wikinaut-panel {
      position: fixed;
      left: 50%;
      bottom: 16px;
      transform: translateX(-50%);
      z-index: 2147483000;
      width: min(960px, calc(100vw - 28px));
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      align-items: center;
      gap: 10px 12px;
      padding: 13px 18px;
      background: linear-gradient(180deg, #181E31 0%, var(--wn-bg) 55%, #10141F 100%);
      border: 1px solid rgba(0,0,0,0.65);
      border-radius: 6px;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.08),
        inset 0 0 0 1px rgba(var(--wn-parchment-rgb),0.05),
        0 14px 38px rgba(0,0,0,0.5),
        0 3px 10px rgba(0,0,0,0.4);
    }

    #wikinaut-panel::after {
      /* Countersunk corner screws — the fascia is bolted onto the page. */
      content: '';
      position: absolute;
      inset: 7px;
      pointer-events: none;
      background-image:
        radial-gradient(circle 2.5px, rgba(var(--wn-parchment-rgb),0.30) 40%, rgba(0,0,0,0.55) 58%, transparent 70%),
        radial-gradient(circle 2.5px, rgba(var(--wn-parchment-rgb),0.30) 40%, rgba(0,0,0,0.55) 58%, transparent 70%),
        radial-gradient(circle 2.5px, rgba(var(--wn-parchment-rgb),0.30) 40%, rgba(0,0,0,0.55) 58%, transparent 70%),
        radial-gradient(circle 2.5px, rgba(var(--wn-parchment-rgb),0.30) 40%, rgba(0,0,0,0.55) 58%, transparent 70%);
      background-repeat: no-repeat;
      background-size: 6px 6px;
      background-position: left top, right top, left bottom, right bottom;
    }

    #wikinaut-panel > * { position: relative; }

    .wikinaut-field { position: relative; display: flex; flex-direction: column; gap: 4px; }

    .wikinaut-label {
      font-family: ${TYPE.label};
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: rgba(var(--wn-parchment-rgb),0.72);
      text-shadow: 0 1px 0 rgba(0,0,0,0.7);
    }

    #wikinaut-target-input {
      width: 100%;
      padding: 9px 12px;
      background: var(--wn-space-ink);
      border: 1px solid rgba(0,0,0,0.7);
      border-radius: 3px;
      color: var(--wn-parchment);
      font-family: ${TYPE.mono};
      font-size: 13.5px;
      letter-spacing: 0.3px;
      outline: none;
      box-shadow: inset 0 2px 5px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(var(--wn-parchment-rgb),0.06);
      transition: box-shadow 120ms;
    }
    #wikinaut-target-input::placeholder { color: rgba(var(--wn-dim-white-rgb),0.55); }
    #wikinaut-target-input:focus {
      box-shadow:
        inset 0 2px 5px rgba(0,0,0,0.55),
        inset 0 0 0 1px rgba(var(--wn-accent-rgb),0.65),
        0 0 0 1px rgba(var(--wn-accent-rgb),0.3);
    }

    .wikinaut-button {
      padding: 9px 16px;
      border: 1px solid rgba(0,0,0,0.7);
      border-radius: 3px;
      background: linear-gradient(180deg, #222A42 0%, #171D2F 100%);
      color: rgba(var(--wn-parchment-rgb),0.88);
      font-family: ${TYPE.label};
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.09), 0 2px 4px rgba(0,0,0,0.45);
      transition: box-shadow 120ms, background 120ms, color 120ms, transform 80ms;
    }
    .wikinaut-button:hover:not(:disabled) {
      color: var(--wn-accent-glow);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.09),
        inset 0 0 0 1px rgba(var(--wn-accent-rgb),0.4),
        0 2px 4px rgba(0,0,0,0.45);
    }
    .wikinaut-button:active:not(:disabled) {
      transform: translateY(1px);
      box-shadow: inset 0 2px 5px rgba(0,0,0,0.5);
    }
    .wikinaut-button:disabled { opacity: 0.4; cursor: not-allowed; }
    .wikinaut-button.secondary {
      background: linear-gradient(180deg, #1B2136 0%, #141927 100%);
      color: rgba(var(--wn-dim-white-rgb),0.9);
    }
    .wikinaut-button.icon {
      padding: 8px 10px;
      line-height: 0;
    }
    .wikinaut-button.icon svg { display: block; }
    .wikinaut-button.icon[aria-expanded="true"] {
      color: var(--wn-accent);
      box-shadow: inset 0 2px 5px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(var(--wn-accent-rgb),0.5);
    }

    /* ── Autocomplete ──────────────────────────────────────────────────── */

    #wikinaut-suggestions {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 0;
      right: 0;
      display: none;
      flex-direction: column;
      background: #0C111E;
      border: 1px solid rgba(0,0,0,0.7);
      border-radius: 4px;
      box-shadow: inset 0 0 0 1px rgba(var(--wn-parchment-rgb),0.07), 0 10px 26px rgba(0,0,0,0.55);
      overflow: hidden;
      z-index: 5;
    }
    #wikinaut-suggestions[data-open="true"] { display: flex; }

    /* Destinations are encyclopedia entries — set them in the atlas serif. */
    .wikinaut-suggestion {
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: rgba(var(--wn-parchment-rgb),0.85);
      font-family: ${TYPE.chart};
      font-size: 13.5px;
      text-align: left;
      cursor: pointer;
      border-bottom: 1px solid rgba(var(--wn-parchment-rgb),0.08);
    }
    .wikinaut-suggestion:last-child { border-bottom: none; }
    .wikinaut-suggestion:hover,
    .wikinaut-suggestion:focus {
      background: rgba(var(--wn-accent-rgb),0.14);
      color: var(--wn-accent-hot);
      outline: none;
    }

    #wikinaut-input-hint {
      min-height: 12px;
      font-family: ${TYPE.label};
      font-size: 9.5px;
      letter-spacing: 0.08em;
      line-height: 1.1;
      color: var(--wn-signal);
      opacity: 0;
      transition: opacity 140ms ease;
    }
    #wikinaut-input-hint[data-state="warn"] { opacity: 0.95; }

    /* ── Route card — the atlas plate ────────────────────────────────────
       The signature surface: a celestial-chart plate inset into the fascia. Double
       hairline frame like an engraved atlas border, a static warm star field, gold
       voyage line, serif star names. Paper doesn't drift: the plate is static. */

    #wikinaut-route-card {
      grid-column: 1 / -1;
      position: relative;
      padding: 10px 12px 8px;
      border: 1px solid rgba(0,0,0,0.75);
      border-radius: 4px;
      background:
        radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.5), transparent),
        radial-gradient(1px 1px at 70% 60%, rgba(var(--wn-accent-glow-rgb),0.55), transparent),
        radial-gradient(1px 1px at 45% 80%, rgba(var(--wn-blue-glow-rgb),0.45), transparent),
        radial-gradient(1px 1px at 88% 25%, rgba(255,255,255,0.4), transparent),
        var(--wn-space-ink);
      background-size: 200px 100px, 240px 120px, 180px 90px, 220px 110px, 100% 100%;
      box-shadow:
        inset 0 2px 8px rgba(0,0,0,0.6),
        inset 0 0 0 1px rgba(var(--wn-parchment-rgb),0.10),
        inset 0 0 0 4px var(--wn-space-ink),
        inset 0 0 0 5px rgba(var(--wn-parchment-rgb),0.06);
      overflow: hidden;
    }

    /* Telemetry readout: amber phosphor over the plate's top edge. */
    #wikinaut-status {
      font-family: ${TYPE.mono};
      font-size: 11.5px;
      letter-spacing: 0.02em;
      color: var(--wn-accent-glow);
      margin-bottom: 6px;
    }
    /* Faults switch the readout to the signal color — nothing else on the console is red. */
    #wikinaut-status[data-error="true"] { color: var(--wn-signal); }
    #wikinaut-status[data-error="true"]::before { content: '⚠ '; }

    /* Coarse phase accents on the panel frame (data-phase is the single source of truth for
       "where are we in the flight loop"; data-launch/data-jumping/data-flying below are the
       finer per-beat FX timing set alongside phase transitions by their owning callers). */
    #wikinaut-panel[data-phase="plotting"] #wikinaut-status {
      animation: wikinaut-plotting-scan 1.1s ease-in-out infinite;
    }
    @keyframes wikinaut-plotting-scan {
      0%,100% { opacity: 1; }
      50%     { opacity: 0.45; }
    }
    #wikinaut-panel[data-phase="stalled"] {
      border-color: rgba(var(--wn-signal-rgb),0.6);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.08),
        inset 0 0 0 1px rgba(var(--wn-signal-rgb),0.35),
        0 14px 38px rgba(0,0,0,0.5),
        0 3px 10px rgba(0,0,0,0.4);
    }

    /* Launch key emphasis: once a course is charted, LAUNCH becomes a solid gold commit
       key — dark engraved text on an ember-gold cap, the one saturated element on the
       fascia — while CHART COURSE drops back to the quiet secondary look. Driven purely
       by the phase machine (data-phase); no class swapping in JS. The static styling keeps
       the emphasis when the pulse is silenced under reduced motion. */
    #wikinaut-panel[data-phase="course-ready"] #wikinaut-begin-button:not(:disabled) {
      background: linear-gradient(180deg, var(--wn-accent-glow) 0%, var(--wn-accent) 60%, var(--wn-accent-deep) 100%);
      color: var(--wn-ink);
      font-weight: 700;
      text-shadow: 0 1px 0 rgba(255,255,255,0.25);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.5),
        0 2px 6px rgba(0,0,0,0.5),
        0 0 14px rgba(var(--wn-accent-rgb),0.35);
      animation: wikinaut-launch-ready 1.8s ease-in-out infinite;
    }
    @keyframes wikinaut-launch-ready {
      0%,100% { box-shadow: inset 0 1px 0 rgba(255,255,255,0.5), 0 2px 6px rgba(0,0,0,0.5), 0 0 10px rgba(var(--wn-accent-rgb),0.25); }
      50%     { box-shadow: inset 0 1px 0 rgba(255,255,255,0.5), 0 2px 6px rgba(0,0,0,0.5), 0 0 22px rgba(var(--wn-accent-rgb),0.55); }
    }
    #wikinaut-panel[data-phase="course-ready"] #wikinaut-chart-button {
      background: linear-gradient(180deg, #1B2136 0%, #141927 100%);
      color: rgba(var(--wn-dim-white-rgb),0.9);
    }

    /* Route pager: floats top-right of the route card whenever several equally-short routes
       were charted — ◀ Route k/N ▶. Only meaningful before launch — CSS gates it to the
       course-ready phase (the JS keeps it hidden entirely when there's just one route). */
    #wikinaut-route-pager {
      position: absolute;
      top: 6px;
      right: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
      z-index: 2;
    }
    #wikinaut-route-pager[hidden] { display: none; }
    #wikinaut-route-prev, #wikinaut-route-next {
      padding: 3px 6px;
      line-height: 0;
    }
    #wikinaut-route-prev svg, #wikinaut-route-next svg { display: block; }
    #wikinaut-route-label {
      font-family: ${TYPE.label};
      font-size: 8.5px;
      font-weight: 600;
      letter-spacing: 0.14em;
      color: rgba(var(--wn-parchment-rgb),0.75);
      text-transform: uppercase;
      white-space: nowrap;
    }
    #wikinaut-panel:not([data-phase="course-ready"]) #wikinaut-route-pager { display: none; }
    /* Keep long status lines clear of the floating pager while it's shown. */
    #wikinaut-panel[data-phase="course-ready"]
      #wikinaut-route-card:has(#wikinaut-route-pager:not([hidden])) #wikinaut-status {
      padding-right: 128px;
    }

    /* Alternate equally-short routes: dim, thin underlay fan beneath the selected path. */
    .wikinaut-route-alt path {
      fill: none;
      stroke-width: 1;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 3 3;
      opacity: 0.75;
    }

    /* Star-chart screen — grows in place when a course is charted (data-expanded). */
    #wikinaut-starmap {
      max-height: 0;
      opacity: 0;
      overflow: hidden;
      transition: max-height 300ms ease, opacity 260ms ease, margin 260ms ease;
    }
    #wikinaut-panel[data-expanded="true"] #wikinaut-starmap {
      max-height: 188px;
      opacity: 1;
      margin: 4px 0 2px;
    }
    #wikinaut-starchart { display: block; width: 100%; height: 176px; }

    /* Graticule: hairline chart-blue rings and meridians, like an atlas plate's grid. */
    .wikinaut-chart-grid line { stroke: rgba(var(--wn-blue-rgb),0.22); stroke-width: 0.4; }
    .wikinaut-chart-ring { fill: none; stroke: rgba(var(--wn-blue-rgb),0.26); stroke-width: 0.5; }
    .wikinaut-chart-tick { stroke: rgba(var(--wn-blue-rgb),0.35); stroke-width: 0.6; }
    .wikinaut-chart-star { fill: var(--wn-parchment); }

    /* The voyage line: a dotted survey track with the plotted course inked in gold on top. */
    #wikinaut-route-track {
      fill: none;
      stroke: rgba(var(--wn-accent-rgb),0.30);
      stroke-width: 1.2;
      stroke-linecap: round;
      stroke-dasharray: 0.5 5;
    }
    #wikinaut-route-path {
      fill: none;
      stroke: var(--wn-accent);
      stroke-width: 1.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      filter: drop-shadow(0 0 3px rgba(var(--wn-accent-rgb),0.45));
    }

    .wikinaut-wp {
      opacity: 0;
      transform: scale(0.3);
      transform-box: fill-box;
      transform-origin: center;
      animation: wikinaut-wp-pop 380ms cubic-bezier(.2,.8,.2,1) forwards;
      animation-delay: var(--d, 0ms);
    }
    .wikinaut-wp-node { fill: var(--wn-space-ink); stroke: rgba(var(--wn-parchment-rgb),0.55); stroke-width: 1; }
    .wikinaut-wp-core { fill: rgba(var(--wn-parchment-rgb),0.85); }
    /* Star names in the atlas serif, italicized — the chart's signature lettering. */
    .wikinaut-wp-label {
      fill: rgba(var(--wn-parchment-rgb),0.78);
      font-family: ${TYPE.chart};
      font-style: italic;
      font-size: 8.5px;
      letter-spacing: 0.2px;
    }
    .wikinaut-wp.current .wikinaut-wp-node { stroke: var(--wn-accent); }
    #wikinaut-panel:is([data-phase="plotting"], [data-phase="course-ready"],
        [data-phase="countdown"], [data-phase="launching"], [data-phase="flying"],
        [data-phase="arrived"]) .wikinaut-wp.current .wikinaut-wp-node {
      animation: wikinaut-wp-pulse 1.8s ease-in-out infinite;
    }
    .wikinaut-wp.current .wikinaut-wp-core { fill: var(--wn-accent); }
    @keyframes wikinaut-wp-pulse {
      0%,100% { filter: drop-shadow(0 0 3px rgba(var(--wn-accent-rgb),0.4)); }
      50%     { filter: drop-shadow(0 0 8px rgba(var(--wn-accent-rgb),0.9)); }
    }
    .wikinaut-wp.current .wikinaut-wp-label { fill: var(--wn-accent-glow); }
    .wikinaut-wp.next .wikinaut-wp-node { stroke: var(--wn-blue-glow); }
    .wikinaut-wp.next .wikinaut-wp-core { fill: var(--wn-blue-glow); }
    .wikinaut-wp.next .wikinaut-wp-label { fill: var(--wn-blue-glow); }
    /* The destination is the brightest star on the plate. */
    .wikinaut-wp.dest .wikinaut-wp-node { stroke: var(--wn-accent); stroke-width: 1.4; }
    .wikinaut-wp.dest .wikinaut-wp-core { fill: var(--wn-accent-hot); }

    @keyframes wikinaut-wp-pop {
      from { opacity: 0; transform: scale(0.3); }
      to   { opacity: 1; transform: scale(1); }
    }

    /* Atlas imprint line — the plate's publication cartouche. */
    #wikinaut-freshness {
      margin-top: 5px;
      font-family: ${TYPE.label};
      font-size: 8px;
      font-weight: 600;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: rgba(var(--wn-parchment-rgb),0.42);
    }

    /* ── Launch sequence (spaceport gantry + bay doors + smoke + shake) ── */

    #wikinaut-launchpad {
      position: absolute;
      left: 50%;
      bottom: calc(100% - 8px);
      width: 150px;
      height: 132px;
      transform: translateX(-50%);
      pointer-events: none;
      opacity: 0;
      transition: opacity 220ms ease;
      z-index: 1;
    }
    #wikinaut-panel[data-launch="arming"] #wikinaut-launchpad,
    #wikinaut-panel[data-launch="launch"] #wikinaut-launchpad { opacity: 1; }

    /* Hangar-bay mouth the craft rises out of: a dark recess set into the fascia top,
       revealed when the bay doors part. Masked so it dissolves upward over the article
       instead of ending in a hard edge; a faint accent glow rises from the bay floor. */
    #wikinaut-launchpad::before {
      content: '';
      position: absolute;
      left: 50%;
      bottom: 0;
      width: 96px;
      height: 64px;
      transform: translateX(-50%);
      border-radius: 12px 12px 0 0;
      background:
        radial-gradient(80% 55% at 50% 100%, rgba(var(--wn-accent-rgb),0.20), transparent 72%),
        linear-gradient(180deg, rgba(var(--wn-space-ink-rgb),0.55), rgba(var(--wn-space-ink-rgb),0.96) 70%);
      box-shadow:
        inset 0 0 0 1px rgba(var(--wn-steel-dark-rgb),0.9),
        inset 0 6px 14px rgba(0,0,0,0.7);
      -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 36%);
      mask-image: linear-gradient(180deg, transparent 0%, #000 36%);
    }

    .wikinaut-gantry-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .wikinaut-gantry {
      transform: scaleY(0);
      transform-origin: 50% 100%;
      transition: transform 460ms cubic-bezier(.2,.8,.2,1);
    }
    /* Steel service tower, not a neon hologram. Each member is drawn twice — a dark
       under-stroke below the lit steel — so the rig reads over the white article page
       as well as against dark imagery (light-only strokes vanished on white). */
    .wikinaut-gantry line {
      stroke: rgba(var(--wn-steel-hi-rgb),0.85);
      stroke-width: 1.8;
      stroke-linecap: round;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));
    }
    .wikinaut-gantry-back line {
      stroke: rgba(var(--wn-steel-shadow-rgb),0.85);
      stroke-width: 4;
      filter: none;
    }
    #wikinaut-panel[data-launch="arming"] .wikinaut-gantry,
    #wikinaut-panel[data-launch="launch"] .wikinaut-gantry { transform: scaleY(1); }
    /* On ignition the gantry falls away as the ship clears it. */
    #wikinaut-panel[data-launch="launch"] .wikinaut-gantry {
      animation: wikinaut-gantry-drop 700ms 360ms ease-in forwards;
    }
    @keyframes wikinaut-gantry-drop {
      to { transform: scaleY(1) translateY(26px); opacity: 0; }
    }

    /* Two hatch leaves that exactly seal the bay mouth (96px, 18%–82% of the pad) when
       closed, and slide flush to its flanks when parted — doors OF something, not
       free-floating pills. */
    .wikinaut-baydoor {
      position: absolute;
      bottom: 0;
      width: 32%;
      height: 9px;
      background: linear-gradient(180deg, var(--wn-steel), var(--wn-steel-dark));
      border: 1px solid rgba(var(--wn-accent-rgb),0.5);
      border-radius: 2px;
      transition: transform 380ms ease;
    }
    .wikinaut-baydoor.left { left: 18%; }
    .wikinaut-baydoor.right { right: 18%; }
    #wikinaut-panel[data-launch="arming"] .wikinaut-baydoor.left,
    #wikinaut-panel[data-launch="launch"] .wikinaut-baydoor.left { transform: translateX(-100%); }
    #wikinaut-panel[data-launch="arming"] .wikinaut-baydoor.right,
    #wikinaut-panel[data-launch="launch"] .wikinaut-baydoor.right { transform: translateX(100%); }

    /* (The old pad-level exhaust bloom is gone — the ship's own launch torch plus the
       ignition flash below carry the blast; the pad keeps its smoke.) */

    /* Billowing smoke clouds at the pad. */
    .wikinaut-smoke { position: absolute; left: 0; right: 0; bottom: 0; height: 40px; }
    .wikinaut-smoke-puff {
      position: absolute;
      bottom: 0;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(196,210,230,0.6), rgba(120,135,162,0.28) 58%, transparent 76%);
      opacity: 0;
    }
    #wikinaut-panel[data-launch="launch"] .wikinaut-smoke-puff {
      animation: wikinaut-smoke-billow 1200ms ease-out forwards;
    }
    @keyframes wikinaut-smoke-billow {
      0%   { transform: translate(0, 6px) scale(0.3); opacity: 0; }
      25%  { opacity: 0.85; }
      100% { transform: translate(var(--wn-smoke-dx, 0), -26px) scale(1.7); opacity: 0; }
    }

    #wikinaut-countdown {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      font-family: ${TYPE.mono};
      font-size: 60px;
      font-weight: 700;
      color: var(--wn-accent-hot);
      text-shadow: 0 0 18px rgba(var(--wn-accent-rgb),0.8);
      pointer-events: none;
      z-index: 3;
    }
    #wikinaut-countdown[data-on="true"] { display: flex; }

    /* Sustained, escalating launch shake — amplitude ramps over the burn, then settles. */
    #wikinaut-root[data-shake="true"] #wikinaut-panel { animation: wikinaut-shake 1400ms ease-in-out; }
    @keyframes wikinaut-shake {
      0%   { transform: translate(-50%, 0); }
      8%   { transform: translate(calc(-50% - 1px), 0.5px); }
      18%  { transform: translate(calc(-50% + 2px), -1px); }
      30%  { transform: translate(calc(-50% - 3px), 1.5px); }
      42%  { transform: translate(calc(-50% + 4px), -2px); }
      54%  { transform: translate(calc(-50% - 6px), 2.5px); }
      66%  { transform: translate(calc(-50% + 7px), -3px); }
      76%  { transform: translate(calc(-50% - 5px), 2px); }
      86%  { transform: translate(calc(-50% + 3px), -1px); }
      94%  { transform: translate(calc(-50% - 1px), 0.5px); }
      100% { transform: translate(-50%, 0); }
    }

    /* Ignition: a white-hot flash and an expanding shock-ring at the engine bell. */
    .wikinaut-ignition {
      position: fixed;
      width: 96px; height: 96px;
      margin: -48px 0 0 -48px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,0.96), rgba(255,214,130,0.72) 28%, rgba(255,140,46,0.36) 54%, transparent 72%);
      pointer-events: none;
      z-index: 2147483005;
      animation: wikinaut-ignition 540ms ease-out forwards;
    }
    @keyframes wikinaut-ignition {
      0%   { transform: scale(0.2); opacity: 0; }
      16%  { opacity: 1; }
      100% { transform: scale(1.7); opacity: 0; }
    }
    .wikinaut-shockwave {
      position: fixed;
      width: 176px; height: 176px;
      margin: -88px 0 0 -88px;
      border-radius: 50%;
      border: 2px solid rgba(255,210,140,0.9);
      box-shadow: 0 0 18px rgba(255,170,70,0.7);
      pointer-events: none;
      z-index: 2147483005;
      /* Same expanding-ring curve as a touchdown burst — element size sets the reach. */
      animation: wikinaut-landing-burst 640ms cubic-bezier(.2,.7,.3,1) forwards;
    }

    /* ── Settings drawer ───────────────────────────────────────────────── */

    #wikinaut-settings-section {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 10px 14px;
      padding: 10px 12px;
      border: 1px solid rgba(0,0,0,0.7);
      border-radius: 4px;
      background: var(--wn-space-ink);
      box-shadow: inset 0 2px 6px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(var(--wn-parchment-rgb),0.06);
    }
    #wikinaut-settings-section[hidden] { display: none; }

    .wikinaut-settings-row { display: contents; }
    .wikinaut-settings-label {
      font-family: ${TYPE.label};
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: rgba(var(--wn-parchment-rgb),0.72);
    }
    .wikinaut-settings-value { font-family: ${TYPE.mono}; font-size: 11px; color: var(--wn-accent-glow); }
    .wikinaut-range { width: 100%; accent-color: var(--wn-accent); }
    .wikinaut-color-input {
      width: 40px; height: 24px; padding: 0;
      background: transparent; border: 1px solid rgba(var(--wn-parchment-rgb),0.3); border-radius: 3px;
      cursor: pointer;
    }
    #wikinaut-backend-input {
      grid-column: 2 / -1;
      padding: 7px 10px;
      background: rgba(0,0,0,0.4);
      border: 1px solid rgba(var(--wn-parchment-rgb),0.14);
      border-radius: 3px;
      color: var(--wn-parchment);
      font-family: ${TYPE.mono};
      font-size: 12px;
      outline: none;
    }
    #wikinaut-backend-input:focus { border-color: rgba(var(--wn-accent-rgb),0.65); box-shadow: 0 0 0 1px rgba(var(--wn-accent-rgb),0.3); }
    #wikinaut-settings-reset { grid-column: 1 / -1; justify-self: start; }

    /* ── Ship ──────────────────────────────────────────────────────────── */

    #wikinaut-ship-shell {
      position: fixed;
      left: 0;
      top: 0;
      width: ${CONFIG.figureSize}px;
      height: ${CONFIG.figureSize}px;
      z-index: 2147483004;
      pointer-events: none;
      opacity: 0;
      transition: opacity 200ms ease;
      will-change: transform;
    }
    #wikinaut-ship-shell[data-visible="true"] { opacity: 1; }
    /* The hidden ship is opacity:0 (kept in layout for position continuity), so without this
       its pose keyframes (hover, core pulse, flame flicker) run invisibly on every article
       forever. An idle page must schedule zero animation work. */
    #wikinaut-ship-shell[data-visible="false"] * { animation: none !important; }
    /* Soft engine aura so the craft reads against dense article text. */
    #wikinaut-ship-shell::before {
      content: '';
      position: absolute;
      inset: -45%;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(var(--wn-accent-rgb),0.30), rgba(var(--wn-accent-rgb),0.10) 46%, transparent 70%);
      pointer-events: none;
      z-index: -1;
    }
    /* Cyan rim-glow on the whole hull (doesn't fight the animated core/body filters). */
    #wikinaut-ship-shell svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 0 5px rgba(var(--wn-accent-rgb),0.55)); }

    /* Gunmetal fighter: metallic hull, tinted canopy, glowing blue engine. */
    .wikinaut-ship-hull {
      fill: url(#wikinaut-hull-grad);
      stroke: var(--wn-steel-shadow);
      stroke-width: 1;
      stroke-linejoin: round;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55));
    }
    .wikinaut-ship-wing {
      fill: url(#wikinaut-wing-grad);
      stroke: var(--wn-steel-shadow);
      stroke-width: 0.9;
      stroke-linejoin: round;
    }
    .wikinaut-ship-canopy {
      fill: url(#wikinaut-canopy-grad);
      stroke: rgba(199,210,224,0.5);
      stroke-width: 0.6;
    }
    .wikinaut-ship-line {
      fill: none;
      stroke: var(--wn-steel-shadow);
      stroke-width: 0.7;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.5;
    }
    .wikinaut-ship-thruster {
      fill: var(--wn-ship-color, ${PALETTE.blue});
      opacity: 0;
      filter: drop-shadow(0 0 6px var(--wn-ship-color, ${PALETTE.blue}));
    }

    /* Engine flame — anchored at the bell inside the rotated shell, so it always trails
       straight off the ship's tail at any heading (and points down on nose-up launch).
       Blended look: white-hot core → cyan plume in cruise; a longer white+orange torch at
       launch. Outer group scales for length per state; inner group carries the flicker. */
    .wikinaut-ship-flame { opacity: 0; transform-origin: 12px 36px; transition: opacity 160ms ease; }
    .wikinaut-ship-flame-flicker { transform-origin: 12px 36px; }
    .wikinaut-ship-flame-glow  { fill: url(#wikinaut-flame-glow); }
    /* Plume + glow tint follow the Ship color setting (white-hot core and launch-orange
       mid stay fixed); fallbacks guard against the shell ever losing its var host again. */
    .wikinaut-ship-flame-plume {
      fill: var(--wn-ship-color, ${PALETTE.accent});
      filter: drop-shadow(0 0 5px var(--wn-ship-color, ${PALETTE.accent}));
    }
    .wikinaut-flame-glow-tint { stop-color: var(--wn-ship-color, ${PALETTE.accent}); }
    .wikinaut-ship-flame-mid   { fill: #FF9A3C; opacity: 0; }
    .wikinaut-ship-flame-core  { fill: #FFFFFF; }
    /* Cruise thrust: cyan flame, fast flicker (no orange). */
    #wikinaut-ship-shell[data-pose="walking"] .wikinaut-ship-flame,
    #wikinaut-ship-shell[data-pose="push"] .wikinaut-ship-flame { opacity: 1; }
    #wikinaut-ship-shell[data-pose="walking"] .wikinaut-ship-flame-flicker,
    #wikinaut-ship-shell[data-pose="push"] .wikinaut-ship-flame-flicker { animation: wikinaut-flame-flicker2 110ms steps(2) infinite; }
    /* Launch torch: longer, with a white-hot core + orange base (wins over cruise). */
    #wikinaut-ship-shell[data-thrust="launch"] .wikinaut-ship-flame { opacity: 1; transform: scaleX(1.55); }
    #wikinaut-ship-shell[data-thrust="launch"] .wikinaut-ship-flame-flicker { animation: wikinaut-flame-flicker2 80ms steps(2) infinite; }
    #wikinaut-ship-shell[data-thrust="launch"] .wikinaut-ship-flame-mid { opacity: 0.95; }
    @keyframes wikinaut-flame-flicker2 {
      0%   { transform: scaleX(0.9) scaleY(1.06); opacity: 0.82; }
      100% { transform: scaleX(1.1) scaleY(0.94); opacity: 1; }
    }

    .wikinaut-ship-body { transform-origin: 50% 50%; }
    #wikinaut-ship-shell[data-pose="victory"] .wikinaut-ship-body { animation: wikinaut-orbit 2.4s linear infinite; }

    @keyframes wikinaut-orbit { from { transform: rotate(0); } to { transform: rotate(360deg); } }

    /* ── Trail canvas ──────────────────────────────────────────────────── */
    #wikinaut-trail-canvas { position: fixed; inset: 0; pointer-events: none; z-index: 2147483001; }

    /* ── Hyperspace jump layer ─────────────────────────────────────────── */

    #wikinaut-jump-layer {
      position: fixed;
      inset: 0;
      z-index: 2147483003;
      pointer-events: none;
      display: none;
      overflow: hidden;
      isolation: isolate;   /* contain the warp layers' mix-blend-mode to this overlay */
    }
    #wikinaut-jump-layer[data-open="true"] { display: block; }
    #wikinaut-jump-layer[data-journey-portal="true"] { z-index: ${CONFIG.journeyPortalZ}; }

    /* Lightspeed jump: star-streaks stretch radially out of the jump point, a white-out
       core blooms, and the whole field zooms forward. (Reused in reverse for arrival.) */
    .wikinaut-warp {
      position: absolute;
      left: var(--wn-slit-x, 50%);
      top: var(--wn-slit-y, 50%);
      width: 4px;
      height: 4px;
      transform: translate(-50%, -50%);
      animation: wikinaut-warp-zoom ${CONFIG.jumpDurationMs}ms cubic-bezier(.55,0,.85,.5) forwards;
    }
    /* Arrivals replay the departure keyframes in reverse (animation-direction) — one
       keyframe per effect instead of a hand-tuned "-in" twin for each. */
    .wikinaut-warp[data-mode="arrive"] {
      animation: wikinaut-warp-zoom ${CONFIG.jumpDurationMs}ms cubic-bezier(.2,.7,.3,1) reverse forwards;
    }
    @keyframes wikinaut-warp-zoom { 0% { transform: translate(-50%,-50%) scale(0.6); } 100% { transform: translate(-50%,-50%) scale(1.5); } }

    .wikinaut-warp-streak {
      position: absolute;
      left: 0;
      top: 0;
      height: 2px;
      width: 2px;
      transform-origin: 0 50%;
      border-radius: 2px;
      background: linear-gradient(90deg, #ffffff, var(--wn-accent-glow) 22%, var(--wn-accent) 44%, var(--wn-streak-a) 72%, transparent);
      box-shadow: 0 0 12px var(--wn-streak-b), 0 0 4px #ffffff;
      animation: wikinaut-streak ${CONFIG.jumpDurationMs}ms cubic-bezier(.5,0,.85,.5) forwards;
    }
    .wikinaut-warp[data-mode="arrive"] .wikinaut-warp-streak {
      animation: wikinaut-streak ${CONFIG.jumpDurationMs}ms cubic-bezier(.2,.7,.3,1) reverse forwards;
    }
    @keyframes wikinaut-streak {
      0%   { width: 4px; opacity: 0; }
      12%  { opacity: 1; }
      100% { width: 150vmax; opacity: 0; }
    }

    .wikinaut-flash {
      position: absolute;
      left: var(--wn-slit-x, 50%);
      top: var(--wn-slit-y, 50%);
      width: 40vmax;
      height: 40vmax;
      transform: translate(-50%, -50%) scale(0);
      border-radius: 50%;
      background: radial-gradient(circle, #ffffff 0%, #ffffff 14%, var(--wn-accent-glow) 34%, rgba(var(--wn-accent-rgb),0.5) 54%, transparent 76%);
      opacity: 0;
      animation: wikinaut-flash ${CONFIG.jumpDurationMs}ms ease-in forwards;
    }
    .wikinaut-flash[data-mode="arrive"] { animation: wikinaut-flash ${CONFIG.jumpDurationMs}ms ease-out reverse forwards; }
    @keyframes wikinaut-flash {
      0%   { opacity: 0; transform: translate(-50%,-50%) scale(0); }
      70%  { opacity: 0.6; }
      100% { opacity: 1; transform: translate(-50%,-50%) scale(1.1); }
    }
    /* Chromatic aberration: cyan + magenta fringes offset a few px, screened over the flash. */
    .wikinaut-flash::before, .wikinaut-flash::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      mix-blend-mode: screen;
      opacity: 0.55;
    }
    .wikinaut-flash::before { background: radial-gradient(circle, rgba(var(--wn-accent-rgb),0.5) 0%, transparent 62%); transform: translate(-7px, -4px); }
    .wikinaut-flash::after  { background: radial-gradient(circle, rgba(var(--wn-streak-a-rgb),0.45) 0%, transparent 62%); transform: translate(7px, 4px); }

    /* Starfield tunnel: concentric cyan/purple rings rushing forward behind the streaks. */
    .wikinaut-warp-tunnel {
      position: absolute;
      left: var(--wn-slit-x, 50%);
      top: var(--wn-slit-y, 50%);
      width: 62vmax;
      height: 62vmax;
      transform: translate(-50%, -50%) scale(0.2);
      border-radius: 50%;
      background: repeating-radial-gradient(circle at 50% 50%,
        rgba(255,255,255,0) 0,
        rgba(var(--wn-accent-rgb),0.18) 5px,
        rgba(var(--wn-purple-rgb),0.16) 11px,
        rgba(255,255,255,0) 20px);
      mix-blend-mode: screen;
      filter: blur(1px);
      opacity: 0;
      animation: wikinaut-warp-tunnel ${CONFIG.jumpDurationMs}ms cubic-bezier(.55,0,.85,.5) forwards;
    }
    .wikinaut-warp-tunnel[data-mode="arrive"] { animation: wikinaut-warp-tunnel ${CONFIG.jumpDurationMs}ms cubic-bezier(.2,.7,.3,1) reverse forwards; }
    @keyframes wikinaut-warp-tunnel {
      0%   { opacity: 0; transform: translate(-50%,-50%) scale(0.2) rotate(0deg); }
      25%  { opacity: 0.9; }
      100% { opacity: 0; transform: translate(-50%,-50%) scale(2.6) rotate(42deg); }
    }

    /* Expanding motion-blur shock ring from the jump point. */
    .wikinaut-warp-ring {
      position: absolute;
      left: var(--wn-slit-x, 50%);
      top: var(--wn-slit-y, 50%);
      width: 24px;
      height: 24px;
      transform: translate(-50%, -50%) scale(0);
      border-radius: 50%;
      border: 3px solid rgba(var(--wn-accent-glow-rgb),0.9);
      box-shadow: 0 0 26px 6px rgba(var(--wn-accent-rgb),0.6), inset 0 0 18px rgba(255,255,255,0.7);
      filter: blur(1.5px);
      opacity: 0;
      animation: wikinaut-warp-ring ${CONFIG.jumpDurationMs}ms cubic-bezier(.3,.7,.3,1) forwards;
    }
    .wikinaut-warp-ring[data-mode="arrive"] { animation-direction: reverse; }
    @keyframes wikinaut-warp-ring {
      0%   { opacity: 0; transform: translate(-50%,-50%) scale(0); }
      12%  { opacity: 1; }
      100% { opacity: 0; transform: translate(-50%,-50%) scale(26); }
    }

    /* White-hot core bloom at the center of the jump. */
    .wikinaut-warp-core {
      position: absolute;
      left: var(--wn-slit-x, 50%);
      top: var(--wn-slit-y, 50%);
      width: 13vmax;
      height: 13vmax;
      transform: translate(-50%, -50%) scale(0);
      border-radius: 50%;
      background: radial-gradient(circle, #ffffff 0%, #ffffff 24%, var(--wn-accent-glow) 46%, rgba(var(--wn-accent-rgb),0) 72%);
      opacity: 0;
      /* Reuses the flash bloom curve — same shape family, no dedicated keyframe. */
      animation: wikinaut-flash ${CONFIG.jumpDurationMs}ms ease-in forwards;
    }
    .wikinaut-warp-core[data-mode="arrive"] { animation: wikinaut-flash ${CONFIG.jumpDurationMs}ms ease-out reverse forwards; }

    /* Degraded jump: the link couldn't be found on the live page, so the ship blinks out from
       its current position and the flight continues via a direct URL navigation. Reuses the
       flash/ring shapes but amber, with no chromatic split — visually distinct from a real
       jump so the player can tell a degraded hop from a normal one. */
    .wikinaut-flash-emergency {
      background: radial-gradient(circle, #ffffff 0%, #ffffff 10%, var(--wn-signal) 34%, rgba(var(--wn-signal-rgb),0.4) 54%, transparent 76%);
    }
    .wikinaut-flash-emergency::before,
    .wikinaut-flash-emergency::after { display: none; }
    .wikinaut-warp-ring-emergency {
      border-color: rgba(255,209,140,0.9);
      box-shadow: 0 0 22px 5px rgba(var(--wn-signal-rgb),0.55), inset 0 0 14px rgba(255,255,255,0.6);
    }

    /* Ship stretches along its heading then snaps to a point as it jumps to lightspeed;
       dropping out of warp replays the same stretch in reverse. (The old separate camera
       shudder is gone — the flash/streaks/stretch carry the punch-through.) */
    #wikinaut-ship-shell[data-pose="warp"] .wikinaut-ship-body {
      animation: wikinaut-warp-stretch 300ms cubic-bezier(.6,0,.9,.4) forwards;
    }
    #wikinaut-ship-shell[data-pose="warp-in"] .wikinaut-ship-body {
      animation: wikinaut-warp-stretch 300ms cubic-bezier(.2,.7,.3,1) reverse both;
    }
    @keyframes wikinaut-warp-stretch {
      0%   { transform: scaleX(1) scaleY(1); opacity: 1; }
      55%  { transform: scaleX(2.8) scaleY(0.62); opacity: 1; }
      100% { transform: scaleX(0.04) scaleY(0.32); opacity: 0; }
    }

    /* The console can never obstruct the ship or its target link while flying: it dims for
       the whole flight, and during a jump it fades right out and goes click-through. */
    #wikinaut-panel { transition: opacity 220ms ease; }
    #wikinaut-panel[data-flying="true"] { opacity: 0.78; }
    #wikinaut-panel[data-jumping="true"] { opacity: 0.08; pointer-events: none; }

    /* ── Link-anchored FX (reticle lock + landing burst) ──────────────────
       Spawned at the target link's rect inside the (reparented, above-page)
       jump layer, so the animation reads as originating from the link itself. */
    /* Targeting reticle: snaps in from oversize with a quarter-turn (scan→lock), then
       holds a steady pulse over the link the ship is locked onto. */
    .wikinaut-reticle {
      position: absolute;
      transform: translate(-50%, -50%);
      border: 1.5px solid var(--wn-accent);
      border-radius: 4px;
      box-shadow: 0 0 12px rgba(var(--wn-accent-rgb),0.55), inset 0 0 10px rgba(var(--wn-accent-rgb),0.18);
      pointer-events: none;
      animation: wikinaut-reticle-lock 320ms cubic-bezier(.2,.8,.2,1) both,
                 wikinaut-reticle-pulse 1.1s ease-in-out 320ms infinite;
    }
    /* L-shaped corner brackets, the classic locked-on look. */
    .wikinaut-reticle::before,
    .wikinaut-reticle::after {
      content: '';
      position: absolute;
      left: -3px; right: -3px; top: -3px; bottom: -3px;
      border: 2px solid var(--wn-accent-glow);
      pointer-events: none;
    }
    .wikinaut-reticle::before { border-right: none; border-bottom: none; width: 9px; height: 9px; right: auto; bottom: auto; }
    .wikinaut-reticle::after  { border-left: none; border-top: none; width: 9px; height: 9px; left: auto; top: auto; }
    @keyframes wikinaut-reticle-lock {
      0%   { transform: translate(-50%,-50%) scale(1.9) rotate(-14deg); opacity: 0; }
      60%  { opacity: 1; }
      100% { transform: translate(-50%,-50%) scale(1) rotate(0deg); opacity: 1; }
    }
    @keyframes wikinaut-reticle-pulse {
      0%,100% { box-shadow: 0 0 8px rgba(var(--wn-accent-rgb),0.4), inset 0 0 8px rgba(var(--wn-accent-rgb),0.15); }
      50%     { box-shadow: 0 0 18px rgba(var(--wn-accent-rgb),0.75), inset 0 0 12px rgba(var(--wn-accent-rgb),0.35); }
    }

    .wikinaut-landing-burst {
      position: absolute;
      width: 64px;
      height: 64px;
      margin: -32px 0 0 -32px;
      border-radius: 50%;
      border: 2px solid var(--wn-accent-glow);
      box-shadow: 0 0 18px rgba(var(--wn-accent-rgb),0.7), inset 0 0 12px rgba(var(--wn-accent-rgb),0.4);
      pointer-events: none;
      animation: wikinaut-landing-burst 620ms ease-out forwards;
    }
    /* Trailing second ring for a touchdown shock-wave. */
    .wikinaut-landing-burst.secondary { border-color: var(--wn-accent); animation-delay: 120ms; opacity: 0.75; }
    @keyframes wikinaut-landing-burst {
      0%   { transform: scale(0.12); opacity: 0.95; }
      100% { transform: scale(1);    opacity: 0; }
    }

    /* Brief highlight pulse on a container Links.reveal just expanded, so uncovering a link
       inside a collapsed navbox/details reads as an intentional action, not the page silently
       shifting under the player. */
    .wikinaut-reveal-pulse { animation: wikinaut-reveal-pulse 900ms ease-out; }
    /* LITERAL accent gold on purpose: this class animates ARTICLE containers (navboxes the
       reveal just expanded) — outside all three --wn-* var hosts, where var() would be
       invalid and the pulse would vanish. Keep in sync with PALETTE.accent; it deliberately
       stays stock gold even when the player recolors the console (rare 900ms flash — not
       worth injecting inline vars onto arbitrary article elements). */
    @keyframes wikinaut-reveal-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(243,174,69,0.65); }
      40%  { box-shadow: 0 0 0 6px rgba(243,174,69,0.28); }
      100% { box-shadow: 0 0 0 0 rgba(243,174,69,0); }
    }

    /* ── Toast ─────────────────────────────────────────────────────────── */

    .wikinaut-toast {
      position: fixed;
      right: 20px;
      bottom: 120px;
      z-index: 2147483005;
      max-width: min(380px, calc(100vw - 40px));
      padding: 10px 14px;
      border: 1px solid rgba(var(--wn-signal-rgb),0.7);
      border-radius: 4px;
      background: #0C111E;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 26px rgba(0,0,0,0.55);
      color: var(--wn-signal);
      font-family: ${TYPE.mono};
      font-size: 11.5px;
      line-height: 1.5;
      animation: wikinaut-toast-in 200ms cubic-bezier(.2,.8,.2,1) forwards;
    }
    @keyframes wikinaut-toast-in {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Responsive ────────────────────────────────────────────────────── */

    @media (max-width: 640px) {
      #wikinaut-panel { grid-template-columns: 1fr auto auto; gap: 8px; padding: 10px 12px; }
      .wikinaut-field { grid-column: 1 / -1; }
      .wikinaut-button:not(.icon) { padding-left: 9px; padding-right: 9px; }
      #wikinaut-settings-section { grid-template-columns: auto 1fr; }
    }

    /* ── Reduced motion ────────────────────────────────────────────────────
       The JS flight path already collapses its timings and skips the warp/ignition
       visuals when reduce is set; here we silence every surviving decorative CSS
       keyframe (engine pulse/orbit/flame flicker, launch gantry/smoke/shake/ignition/
       shockwave, hyperspace zoom/streaks/flash/tunnel/ring/stretch, reticle, bursts,
       plotting blink, launch-ready pulse, waypoint pop/pulse, toast slide) so nothing
       loops or jitters. */
    @media (prefers-reduced-motion: reduce) {
      #wikinaut-ship-shell .wikinaut-ship-body,
      #wikinaut-ship-shell .wikinaut-ship-flame-flicker,
      #wikinaut-root[data-shake="true"] #wikinaut-panel,
      .wikinaut-gantry, .wikinaut-smoke-puff,
      .wikinaut-warp, .wikinaut-warp-streak, .wikinaut-flash,
      .wikinaut-warp-tunnel, .wikinaut-warp-ring, .wikinaut-warp-core,
      .wikinaut-reticle, .wikinaut-landing-burst,
      .wikinaut-ignition, .wikinaut-shockwave,
      .wikinaut-reveal-pulse,
      .wikinaut-toast,
      #wikinaut-panel[data-phase="plotting"] #wikinaut-status,
      #wikinaut-panel[data-phase="course-ready"] #wikinaut-begin-button,
      .wikinaut-wp,
      .wikinaut-wp-node {
        animation: none !important;
      }
      /* wp-pop starts waypoints at opacity 0 — without the animation they must land visible. */
      .wikinaut-wp { opacity: 1; transform: none; }
      #wikinaut-route-card { background-position: 0 0; }
    }
  `;

  // ─── State ──────────────────────────────────────────────────────────────────

  const dom = {};
  const runtime = {
    phase: 'idle',
    route: null,        // the SELECTED route — every flight consumer reads only this
    routes: null,       // all equally-short routes from the last chart (≤ CONFIG.maxRoutes)
    routeIndex: 0,      // which of `routes` is selected
    selectedPage: null,
    figureAngle: 0,
    isWalking: false,
    figurePosition: {x: 0, y: 0},
    autocompleteTimer: 0,
    autocompleteAbortId: 0,
    settingsOpen: false,
  };

  // ─── Phase machine (drives both nav-computer UI and ship) ─────────────────────
  // Single source of truth for "where are we in the flight loop". `data-phase` on the panel is
  // the coarse truth CSS keys off directly (plotting/stalled accents); the finer per-beat FX
  // (data-launch, data-jumping, data-flying) are set alongside phase transitions by the callers
  // that own them (beginWalk, Traversal) — not by the FX modules themselves.
  const PHASES = {
    IDLE: 'idle',
    DESTINATION_SET: 'destination-set',
    PLOTTING: 'plotting',
    COURSE_READY: 'course-ready',
    COUNTDOWN: 'countdown',
    LAUNCHING: 'launching',
    FLYING: 'flying',
    STALLED: 'stalled',
    ARRIVED: 'arrived',
  };

  const Phase = {
    set(next) {
      runtime.phase = next;
      if (dom.panel) {
        dom.panel.dataset.phase = next;
        // Single writer for data-flying: derived from phase rather than set/cleared by hand
        // at each call site (that duplicated the phase machine's own signal).
        dom.panel.dataset.flying = next === PHASES.FLYING ? 'true' : 'false';
      }
    },
    is(...names) {
      return names.includes(runtime.phase);
    },
  };

  // ─── Backend URL (default + self-host override via GM storage) ────────────────

  const Backend = {
    // The stored override, trimmed ('' when unset or storage is unreadable) — the single
    // reader both getters share.
    _stored() {
      try {
        const value =
          typeof GM_getValue === 'function'
            ? GM_getValue(CONFIG.backendUrlKey, '')
            : localStorage.getItem(CONFIG.backendUrlKey) || '';
        return String(value || '').trim();
      } catch {
        return '';
      }
    },

    get url() {
      return Backend._stored().replace(/\/+$/, '') || CONFIG.apiBaseUrl;
    },

    get override() {
      return Backend._stored();
    },

    // Every charted course sends the player's current and destination article titles to this
    // URL, so only http(s) origins are accepted: without a scheme check a typo (or a pasted
    // "javascript:"/"data:" string) would be stored and handed to GM_xmlhttpRequest. Plain
    // http is allowed for local development but not for a remote host, where it would put
    // the titles on the wire in the clear.
    isValidUrl(url) {
      let parsed;
      try {
        parsed = new URL(String(url || '').trim());
      } catch {
        return false;
      }
      if (parsed.protocol === 'https:') return true;
      return parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname);
    },

    // Returns true when the value was accepted (an empty value clears the override).
    set(url) {
      const value = String(url || '').trim().replace(/\/+$/, '');
      if (value && !Backend.isValidUrl(value)) return false;
      try {
        if (typeof GM_setValue === 'function') GM_setValue(CONFIG.backendUrlKey, value);
        else if (value) localStorage.setItem(CONFIG.backendUrlKey, value);
        else localStorage.removeItem(CONFIG.backendUrlKey);
      } catch {}
      return true;
    },
  };

  // ─── Settings ─────────────────────────────────────────────────────────────

  const Settings = {
    _cache: null,

    // Settings persist permanently via GM storage (like the Backend URL), so they survive
    // across tabs and browser sessions. sessionStorage is only a fallback for environments
    // without the GM APIs, plus a one-time migration source from the pre-GM era.
    _read() {
      try {
        if (typeof GM_getValue === 'function') {
          const raw = GM_getValue(CONFIG.settingsStorageKey, '');
          if (raw) return JSON.parse(raw);
          const legacy = sessionStorage.getItem(CONFIG.settingsStorageKey);
          if (legacy) {
            GM_setValue(CONFIG.settingsStorageKey, legacy);
            return JSON.parse(legacy);
          }
          return null;
        }
        const raw = sessionStorage.getItem(CONFIG.settingsStorageKey);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },

    _persist() {
      try {
        const raw = JSON.stringify(Settings._cache);
        if (typeof GM_setValue === 'function') GM_setValue(CONFIG.settingsStorageKey, raw);
        else sessionStorage.setItem(CONFIG.settingsStorageKey, raw);
      } catch {}
    },

    load() {
      // Filter to known keys so retired settings (e.g. the old trailColor, now derived
      // from travelerColor) fall out of the cache and out of the next persisted blob.
      const stored = Settings._read() || {};
      Settings._cache = Object.fromEntries(
        Object.keys(SETTINGS_DEFAULTS).map((k) => [k, stored[k] ?? SETTINGS_DEFAULTS[k]]));
      return Settings._cache;
    },

    save(patch) {
      Settings._cache = {...(Settings._cache ?? SETTINGS_DEFAULTS), ...patch};
      Settings._persist();
    },

    reset() {
      Settings._cache = {...SETTINGS_DEFAULTS};
      try {
        // No GM_deleteValue in the @grant list — an empty string reads as "unset" in _read.
        if (typeof GM_setValue === 'function') GM_setValue(CONFIG.settingsStorageKey, '');
        sessionStorage.removeItem(CONFIG.settingsStorageKey);
      } catch {}
    },

    get(key) {
      return (Settings._cache ?? SETTINGS_DEFAULTS)[key] ?? SETTINGS_DEFAULTS[key];
    },

    // The derived colorway for the player's color (memoized per raw value). The raw pick
    // stays stored and shown in the color input; only the EMITTED colors are contrast-
    // lifted, so re-opening settings never mutates what the player chose.
    _colorway: null,
    _colorwayFor: '',
    colorway() {
      const raw = Settings.get('travelerColor');
      if (raw !== Settings._colorwayFor || !Settings._colorway) {
        Settings._colorway = deriveColorway(raw);
        Settings._colorwayFor = raw;
      }
      return Settings._colorway;
    },

    applyToDom() {
      if (!dom.root) return;
      const cw = Settings.colorway();
      // The whole accent family follows the player's color — ship, streaks, and every
      // console accent. The -rgb triplets must be overridden in lockstep: dozens of rules
      // read rgba(var(--wn-accent-rgb), α) and would otherwise keep the stock gold.
      // --wn-parchment/--wn-dim-white carry the console's body text, so they are tinted
      // too; without them most of the panel's lettering stays stock ivory/blue-grey no
      // matter what color the player picks.
      // Deliberately NOT overridden: --wn-signal (reserved fault red), --wn-blue/--wn-blue-glow
      // (graticule + next-waypoint distinction), --wn-purple (contrast lane/ring).
      const vars = {
        '--wn-ship-color': cw.base,
        '--wn-accent': cw.base,
        '--wn-accent-hot': cw.hot,
        '--wn-accent-glow': cw.glow,
        '--wn-accent-deep': cw.deep,
        '--wn-streak-a': cw.streakA,
        '--wn-streak-b': cw.streakB,
        '--wn-parchment': cw.parchment,
        '--wn-dim-white': cw.dimWhite,
        '--wn-ink': cw.ink,
      };
      // The ship shell and jump layer leave #wikinaut-root while a journey is active
      // (JourneyPortal mounts them on document.body), so every var must be set on each
      // host directly — a var set only on the root can't reach them there.
      for (const el of [dom.root, dom.figure, dom.ripLayer]) {
        if (!el) continue;
        for (const [name, hex] of Object.entries(vars)) {
          el.style.setProperty(name, hex);
          if (name !== '--wn-ship-color') {
            el.style.setProperty(`${name}-rgb`, paletteChannels(hex));
          }
        }
      }
    },
  };

  // ─── Trail canvas (white-hot → ship color → derived-tail particle wake) ────────

  // ─── FxLoop (single rAF owner) ────────────────────────────────────────────────
  // One requestAnimationFrame chain drives every per-frame consumer (the Trail canvas and
  // animate()'s tweens) instead of each running its own competing loop. Subscribers are
  // called with the frame timestamp and unsubscribe by returning false; the chain parks
  // itself when the last subscriber leaves, so idle pages schedule zero frames.
  const FxLoop = {
    _subs: new Set(),
    _rafId: null,
    _ticking: false,

    add(fn) {
      FxLoop._subs.add(fn);
      // No scheduling mid-tick: a subscriber added from inside a frame callback (the cruise
      // feeds Trail.addPoint every frame) is picked up by the end-of-tick reschedule —
      // scheduling here too would stack extra rAF chains, exactly what this loop exists to
      // prevent.
      if (!FxLoop._rafId && !FxLoop._ticking) {
        FxLoop._rafId = requestAnimationFrame(FxLoop._tick);
      }
    },

    remove(fn) {
      FxLoop._subs.delete(fn);
    },

    _tick(now) {
      FxLoop._rafId = null;
      FxLoop._ticking = true;
      for (const fn of [...FxLoop._subs]) {
        try {
          if (fn(now) === false) FxLoop._subs.delete(fn);
        } catch (error) {
          // A throwing subscriber is dropped rather than allowed to kill the shared loop.
          FxLoop._subs.delete(fn);
          console.warn('[Wikinaut] wn/fx-frame-failed', error);
        }
      }
      FxLoop._ticking = false;
      if (FxLoop._subs.size) FxLoop._rafId = requestAnimationFrame(FxLoop._tick);
    },
  };

  const Trail = {
    canvas: null,
    ctx: null,
    points: [],
    sparks: [],
    _lastPointTime: 0,
    _dpr: 1,
    // Draw-time caches, rebuilt only when the player's colors change (never per frame):
    // the 48-bucket wake color ramp and the prerendered nozzle-flare sprite.
    _paletteKey: '',
    _rampBuckets: null,
    _flareSprite: null,

    init() {
      const canvas = document.createElement('canvas');
      canvas.id = 'wikinaut-trail-canvas';
      Trail.canvas = canvas;
      Trail.ctx = canvas.getContext('2d');
      Trail._resize(canvas);
      dom.root.prepend(canvas);
      window.addEventListener('resize', () => Trail._resize(canvas), {passive: true});
    },

    // Back the canvas at device resolution so the plume stays crisp on HiDPI screens,
    // then draw in CSS pixels via a scaled transform.
    _resize(canvas) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      Trail._dpr = dpr;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      Trail._paletteKey = '';   // the flare sprite bakes in the dpr — rebuild on change
    },

    // Points and sparks live in DOCUMENT coordinates (callers pass viewport positions; scroll
    // is added on write and subtracted at draw time). The wake is part of the article world:
    // when the camera scrolls, it streams past with the page instead of sticking to the glass.
    addPoint(x, y) {
      const now = performance.now();
      if (now - Trail._lastPointTime < 16) return;
      Trail._lastPointTime = now;
      const cx = x + CONFIG.figureSize / 2 + window.scrollX;
      const cy = y + CONFIG.figureSize / 2 + window.scrollY;
      Trail.points.push({x: cx, y: cy, t: now});
      // Occasional ember flung off the engine wash, drifting and decaying on its own.
      if (Math.random() < 0.5) {
        Trail.sparks.push({
          x: cx,
          y: cy,
          vx: (Math.random() - 0.5) * 0.9,
          vy: (Math.random() - 0.5) * 0.9,
          t: now,
          life: 360 + Math.random() * 360,
        });
      }
      if (Trail.points.length > 140) Trail.points.shift();
      if (Trail.sparks.length > 70) Trail.sparks.shift();
      FxLoop.add(Trail._draw);
    },

    // Radial shower of embers from a point (viewport coords in, doc coords stored) — used for
    // ignition and touchdown.
    burst(x, y, count = 16) {
      const now = performance.now();
      const docX = x + window.scrollX;
      const docY = y + window.scrollY;
      for (let i = 0; i < count; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1.4 + Math.random() * 2.6;
        Trail.sparks.push({
          x: docX, y: docY,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp * 0.8,
          t: now,
          life: 360 + Math.random() * 460,
        });
      }
      if (Trail.sparks.length > 90) Trail.sparks.splice(0, Trail.sparks.length - 90);
      FxLoop.add(Trail._draw);
    },

    // Rebuilds the wake color ramp (48 pre-mixed {r,g,b} buckets: white-hot core → ship
    // color → derived tail) and the prerendered nozzle-flare sprite. All three stops come
    // from the ONE player color via Settings.colorway(). Cheap and idempotent — _draw calls
    // it every frame and it no-ops unless the player's color actually changed.
    _refreshPalette() {
      const cw = Settings.colorway();
      const key = cw.base;
      if (key === Trail._paletteKey && Trail._rampBuckets) return;
      Trail._paletteKey = key;

      const core = hexToRgb(cw.trailCore); // hottest, at the nozzle
      const mid = hexToRgb(cw.base);
      const tail = hexToRgb(cw.trailTail);
      const mix = (c1, c2, t) => ({
        r: Math.round(lerp(c1.r, c2.r, t)),
        g: Math.round(lerp(c1.g, c2.g, t)),
        b: Math.round(lerp(c1.b, c2.b, t)),
      });
      const buckets = [];
      for (let i = 0; i < 48; i += 1) {
        const age = i / 47;
        buckets.push(age < 0.5 ? mix(core, mid, age / 0.5) : mix(mid, tail, (age - 0.5) / 0.5));
      }
      Trail._rampBuckets = buckets;

      // Nozzle flare, drawn once into an offscreen sprite (36×36 CSS px at device resolution)
      // instead of a createRadialGradient per frame.
      const dpr = Trail._dpr || 1;
      const sprite = document.createElement('canvas');
      sprite.width = sprite.height = Math.round(36 * dpr);
      const sctx = sprite.getContext('2d');
      const r = 18 * dpr;
      const flare = sctx.createRadialGradient(r, r, 0, r, r, r);
      flare.addColorStop(0, 'rgba(255,255,255,0.95)');
      flare.addColorStop(0.35, `rgba(${core.r},${core.g},${core.b},0.7)`);
      flare.addColorStop(1, `rgba(${mid.r},${mid.g},${mid.b},0)`);
      sctx.fillStyle = flare;
      sctx.fillRect(0, 0, sprite.width, sprite.height);
      Trail._flareSprite = sprite;
    },

    // Runs on the shared FxLoop; returns false (unsubscribes) once the last point/spark has
    // faded, after painting one final clear frame.
    _draw(now) {
      const ctx = Trail.ctx;
      if (!ctx) return false;
      const fadeMs = CONFIG.trailFadeMs;

      ctx.setTransform(Trail._dpr, 0, 0, Trail._dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Expire in place (write-index compaction) — no per-frame array reallocation. Points
      // are append-ordered by time; sparks have per-spark lifetimes, so both get the same
      // in-place sweep.
      const pts = Trail.points;
      let w = 0;
      for (let r = 0; r < pts.length; r += 1) {
        if (now - pts[r].t < fadeMs) pts[w++] = pts[r];
      }
      pts.length = w;
      const sparks = Trail.sparks;
      w = 0;
      for (let r = 0; r < sparks.length; r += 1) {
        if (now - sparks[r].t < sparks[r].life) sparks[w++] = sparks[r];
      }
      sparks.length = w;

      Trail._refreshPalette();
      const buckets = Trail._rampBuckets;
      const core = buckets[0];

      const hasRibbon = pts.length > 1;
      if (hasRibbon || sparks.length) {
        // Points/sparks are stored in doc coords; render at doc − scroll so the wake stays
        // pinned to the article while the camera moves (the canvas itself stays fixed).
        const sx = window.scrollX;
        const sy = window.scrollY;
        // Additive blending fuses the overlapping segments into one continuous glow.
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (hasRibbon) {
          // 1) Connected, tapering ribbon — thick & white-hot at the ship, thinning and
          //    cooling toward the tail. Drawn twice (soft underlay + bright core); segments
          //    too faint to see (alpha < 0.02) are skipped entirely.
          for (let pass = 0; pass < 2; pass += 1) {
            const alphaScale = pass === 0 ? 0.16 : 0.5;
            const widthBoost = pass === 0 ? 2.4 : 1;
            for (let i = 1; i < pts.length; i += 1) {
              const b = pts[i];
              const age = (now - b.t) / fadeMs;
              const e = 1 - age;
              const alpha = e * e * alphaScale;
              if (alpha < 0.02) continue;
              const c = buckets[Math.min(47, Math.max(0, Math.round(age * 47)))];
              ctx.lineWidth = (1 + e * e * 8) * widthBoost;
              ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${alpha.toFixed(3)})`;
              ctx.beginPath();
              ctx.moveTo(pts[i - 1].x - sx, pts[i - 1].y - sy);
              ctx.lineTo(b.x - sx, b.y - sy);
              ctx.stroke();
            }
          }

          // 2) Bright nozzle flare at the freshest point (prerendered sprite).
          const head = pts[pts.length - 1];
          ctx.drawImage(Trail._flareSprite, head.x - sx - 18, head.y - sy - 18, 36, 36);
        }

        // 3) Embers (independent of the ribbon, so ignition/landing bursts show too).
        for (const s of sparks) {
          const sAge = (now - s.t) / s.life;
          const e = 1 - sAge;
          if (e * 0.9 < 0.02) continue;
          const px = s.x + s.vx * (now - s.t) * 0.06 - sx;
          const py = s.y + s.vy * (now - s.t) * 0.06 - sy;
          ctx.fillStyle = `rgba(${core.r},${core.g},${core.b},${(e * 0.9).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(px, py, 0.6 + e * 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      return pts.length > 0 || sparks.length > 0;
    },

    // Drop the wake ribbon but keep any live embers (used at touchdown so the cruise
    // plume vanishes while the landing sparks still scatter).
    clearRibbon() {
      Trail.points = [];
    },

    clear() {
      Trail.points = [];
      Trail.sparks = [];
      if (Trail.ctx) {
        Trail.ctx.setTransform(Trail._dpr, 0, 0, Trail._dpr, 0, 0);
        Trail.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
      FxLoop.remove(Trail._draw);
    },
  };

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

  // ─── UI helpers ─────────────────────────────────────────────────────────────

  function setBusy(isBusy, message) {
    dom.input.disabled = isBusy;
    dom.chartButton.disabled = isBusy;
    if (message) setStatus(message);
  }

  function setStatus(message, {isError = false} = {}) {
    dom.status.textContent = message;
    dom.status.dataset.error = isError ? 'true' : 'false';
  }

  function setFreshness(date) {
    if (!dom.freshness) return;
    if (!date) {
      dom.freshness.textContent = '';
      return;
    }
    const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
    const label = date.toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
    dom.freshness.textContent =
      days < 10 ? `Star chart: ${label}` : `Star chart: ${label} (~${Math.ceil(days / 30)}mo old)`;
  }

  function showToast(message, ms = 4600) {
    const toast = document.createElement('div');
    toast.className = 'wikinaut-toast';
    toast.textContent = message;
    dom.root.append(toast);
    window.setTimeout(() => toast.remove(), ms);
  }

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

  // ─── StarMap — the celestial atlas plate ─────────────────────────────────────
  // Renders the plotted course as an atlas chart: a hairline graticule with meridian
  // ticks, a scatter of fixed stars, the voyage line inked in gold (drawn on with
  // stroke-dashoffset so charting reads as plotting, not a static reveal), and serif
  // star-name labels. `alternates` are the other equally-short routes: drawn UNDER the
  // selected path as dimmer polylines sharing the selected route's endpoints, with their
  // intermediate waypoints fanned vertically so the paths visibly diverge.
  const StarMap = {
    W: 320,
    H: 176,
    PAD_X: 28,
    PAD_V: 34,

    render(route, currentIndex = -1, nextIndex = currentIndex + 1, alternates = [], lane = 0) {
      const host = dom.routeStrip;
      host.replaceChildren();
      if (!route || !route.length) {
        if (dom.panel) dom.panel.dataset.expanded = 'false';
        return;
      }
      if (dom.panel) dom.panel.dataset.expanded = 'true';

      const {W, H} = StarMap;
      const n = route.length;
      const midY = H / 2;

      const pts = route.map((title, i) => ({
        i,
        title,
        x: n === 1 ? W / 2 : StarMap.PAD_X + (W - StarMap.PAD_X * 2) * (i / (n - 1)),
        y: StarMap.laneY(i, n, lane),
      }));

      const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

      const waypoints = pts
        .map((p) => {
          const cls = ['wikinaut-wp'];
          if (p.i === currentIndex) cls.push('current');
          if (p.i === nextIndex) cls.push('next');
          if (p.i === n - 1) cls.push('dest');
          const delay = Math.round((n <= 1 ? 0 : p.i / (n - 1)) * CONFIG.routeSketchMs) + 120;
          const label = p.title.length > 16 ? `${p.title.slice(0, 15)}…` : p.title;
          const ly = p.i % 2 === 0 ? p.y - 9 : p.y + 15;
          return `<g class="${cls.join(' ')}" style="--d:${delay}ms">` +
            `<circle class="wikinaut-wp-node" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.4"></circle>` +
            `<circle class="wikinaut-wp-core" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="1.8"></circle>` +
            `<text class="wikinaut-wp-label" x="${p.x.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${escapeXml(label)}</text>` +
            `<title>${escapeXml(p.title)}</title></g>`;
        })
        .join('');

      host.innerHTML =
        `<svg id="wikinaut-starchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-label="Plotted course star chart">` +
        `${StarMap.graticule()}${StarMap.stars()}${StarMap.alternatesMarkup(alternates)}` +
        `<path id="wikinaut-route-track" d="${d}"></path>` +
        `<path id="wikinaut-route-path" d="${d}"></path>${waypoints}</svg>`;

      // "Plot" the voyage line by drawing it on with stroke-dashoffset.
      const pathEl = host.querySelector('#wikinaut-route-path');
      if (pathEl && typeof pathEl.getTotalLength === 'function' && n > 1 && !prefersReducedMotion()) {
        try {
          const len = pathEl.getTotalLength();
          pathEl.style.strokeDasharray = String(len);
          pathEl.style.strokeDashoffset = String(len);
          pathEl.animate(
            [{strokeDashoffset: len}, {strokeDashoffset: 0}],
            {duration: CONFIG.routeSketchMs, easing: 'ease-in-out', fill: 'forwards'},
          );
        } catch {
          /* getTotalLength can throw on detached/zero-size paths; the static line is fine. */
        }
      }
    },

    // Every route keeps a STABLE lane — its index in runtime.routes — so cycling the pager
    // visibly moves the bright selected path onto a different lane while the previously
    // selected lane dims underneath. Endpoints (shared source/target) are pinned to the
    // base-lane positions for all routes; lane 0 is the classic center lane.
    laneY(i, m, j) {
      const amp = (StarMap.H - StarMap.PAD_V * 2) / 2;
      const midY = StarMap.H / 2;
      return i === 0 || i === m - 1 || !j
        ? midY + Math.sin(i * 0.9 + 0.6) * amp
        : midY + Math.sin(i * 0.9 + 0.6 + j * 2.1) * amp * 0.9;
    },

    // Atlas graticule: two declination rings, the central meridians, and fine tick marks
    // along the horizontal meridian like a plate's degree scale.
    graticule() {
      const {W, H} = StarMap;
      const midY = H / 2;
      let ticks = '';
      for (let x = 16; x < W; x += 16) {
        const len = x % 64 === 0 ? 3.5 : 2;
        ticks += `<line class="wikinaut-chart-tick" x1="${x}" y1="${midY - len}" x2="${x}" y2="${midY + len}"></line>`;
      }
      return `<g class="wikinaut-chart-grid">` +
        `<circle class="wikinaut-chart-ring" cx="${W / 2}" cy="${midY}" r="${midY - 6}"></circle>` +
        `<circle class="wikinaut-chart-ring" cx="${W / 2}" cy="${midY}" r="${midY - 28}"></circle>` +
        `<line x1="0" y1="${midY}" x2="${W}" y2="${midY}"></line>` +
        `<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}"></line>` +
        `${ticks}</g>`;
    },

    // Deterministic scatter of fixed stars (hash noise, stable across renders).
    stars() {
      const {W, H} = StarMap;
      const frac = (v) => v - Math.floor(v);
      let stars = '';
      for (let i = 0; i < 28; i += 1) {
        const sx = frac(Math.sin(i * 12.9898) * 43758.5453) * W;
        const sy = frac(Math.cos(i * 4.1414) * 24634.633) * H;
        const r = i % 6 === 0 ? 1.1 : 0.6;
        stars += `<circle class="wikinaut-chart-star" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r}" opacity="${(0.25 + (i % 4) * 0.16).toFixed(2)}"></circle>`;
      }
      return stars;
    },

    // Alternate-route underlay: same x spacing per hop; each alternate rides its own stable
    // lane (`{route, lane}` pairs) with a lane-keyed color, so identity survives cycling.
    // Built via paletteRgba (not CSS var()): these land in SVG presentation attributes,
    // which don't resolve custom properties.
    alternatesMarkup(alternates) {
      const {W} = StarMap;
      const innerW = W - StarMap.PAD_X * 2;
      // The accent lane follows the player's color (rebuilt per render, so live color
      // changes track); the rest stay stock PALETTE — they're the contrast lanes, and
      // streakB here is a lane identity color, not the hyperspace streak.
      const altColors = [paletteRgba('blue', 0.55), paletteRgba('purple', 0.55),
        rgbaFromHex(Settings.colorway().base, 0.4), paletteRgba('blueGlow', 0.5),
        paletteRgba('streakB', 0.45)];
      let altMarkup = '';
      alternates.forEach((alt) => {
        const altRoute = alt.route;
        const m = altRoute.length;
        if (m < 2) return;
        const altPts = altRoute.map((title, i) => {
          const x = StarMap.PAD_X + innerW * (i / (m - 1));
          return {x, y: StarMap.laneY(i, m, alt.lane), title};
        });
        const color = altColors[alt.lane % altColors.length];
        const altD = altPts
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        const nodes = altPts.slice(1, -1)
          .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" ` +
            `fill="${color}"><title>${escapeXml(p.title)}</title></circle>`)
          .join('');
        altMarkup += `<g class="wikinaut-route-alt" style="stroke:${color}">` +
          `<path d="${altD}"></path>${nodes}</g>`;
      });
      return altMarkup;
    },
  };

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

    // Warm the alias cache for the first hop through the countdown, so the origin page's
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

  // ─── Titles ──────────────────────────────────────────────────────────────────

  const Titles = {
    currentPageTitle() {
      const fromHeading = document.querySelector(SELECTORS.pageTitle)?.textContent?.trim();
      if (fromHeading) return fromHeading;
      const raw = location.pathname.replace(/^\/wiki\//, '');
      return safeDecode(raw).replace(/_/g, ' ');
    },

    // Title → the /wiki/<title> path segment. Percent-encoding is required: real article
    // titles contain '?' and '#' (e.g. "What's the Worst That Could Happen?"), and without
    // encoding everything after those characters is parsed as a query string or fragment,
    // so the direct-navigation fallback lands on the wrong page. ':' and '/' are put back
    // because MediaWiki article paths carry them literally (namespaces and subpages).
    toUrlTitle(title) {
      return encodeURIComponent(String(title ?? '').trim().replace(/\s+/g, '_'))
        .replace(/%3A/gi, ':')
        .replace(/%2F/gi, '/');
    },

    canonical(title) {
      return safeDecode(String(title || ''))
        .normalize('NFC')   // fold composed/decomposed accents so "Café" always equals "Café"
        .replace(/^https?:\/\/en\.wikipedia\.org\/wiki\//i, '')
        .replace(/^\/wiki\//i, '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase();
    },

    same(left, right) {
      return Titles.canonical(left) === Titles.canonical(right);
    },

    indexInRoute(route, title) {
      return route.findIndex((routeTitle) => Titles.same(routeTitle, title));
    },

    // Raw (URL-form: underscores, still percent-encoded) article title from an href, or ''
    // when it isn't a same-wiki article link. Resolves EVERY href form the two renderers
    // emit — relative /wiki/Foo (legacy parser), ./Foo (Parsoid DOM), protocol-relative
    // //en.wikipedia.org/wiki/Foo (Parsoid read views), and fully-qualified — and rejects
    // other hosts (Commons/Wiktionary links also contain "/wiki/").
    rawFromHref(href) {
      if (!href) return '';
      let url;
      try {
        url = new URL(href, location.href);
      } catch {
        return '';
      }
      if (url.hostname !== location.hostname) return '';
      if (!url.pathname.startsWith('/wiki/')) return '';
      return url.pathname.slice('/wiki/'.length);
    },

    fromLink(link) {
      const raw = Titles.rawFromHref(link.getAttribute('href') || '');
      return raw ? safeDecode(raw).replace(/_/g, ' ') : '';
    },
  };

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
    saveRoute(route, extras = {}) {
      return Storage.save({
        active: false,
        currentIndex: 0,
        route,
        targetTitle: route[route.length - 1] ?? '',
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

  // ─── Session caches (latency only) ─────────────────────────────────────────────
  // Tiny sessionStorage-backed caches with insertion-order eviction, shared by the /paths
  // route cache and the redirect-alias cache. Pure latency optimizations: any storage failure
  // or miss just means a refetch, never an error. Session-scoped on purpose — route answers
  // and alias sets don't need to outlive the tab.
  const SessionCache = {
    _read(key) {
      try {
        const raw = sessionStorage.getItem(key);
        const entries = raw ? JSON.parse(raw) : [];
        return Array.isArray(entries) ? entries : [];
      } catch {
        return [];
      }
    },

    _write(key, entries) {
      try {
        sessionStorage.setItem(key, JSON.stringify(entries));
      } catch {}
    },

    get(key, id, maxAgeMs = 0) {
      const hit = SessionCache._read(key).find((entry) => entry.id === id);
      if (!hit) return undefined;
      if (maxAgeMs && Date.now() - hit.t > maxAgeMs) return undefined;
      return hit.v;
    },

    put(key, id, value, cap) {
      const entries = SessionCache._read(key).filter((entry) => entry.id !== id);
      entries.push({id, t: Date.now(), v: value});
      while (entries.length > cap) entries.shift();
      SessionCache._write(key, entries);
    },
  };

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
    },

    deactivate() {
      if (!JourneyPortal.active || !dom.root) return;
      dom.root.insertBefore(dom.ripLayer, dom.root.firstChild);
      dom.root.insertBefore(dom.figure, dom.panel);
      delete dom.figure.dataset.journeyPortal;
      delete dom.ripLayer.dataset.journeyPortal;
      JourneyPortal.active = false;
    },

    ensureAbovePanel() {
      if (!JourneyPortal.active) return;
      dom.figure.style.zIndex = String(CONFIG.journeyPortalZ);
    },
  };

  // ─── Dock (idle ship home, near the console) ──────────────────────────────────

  function panelChromeTop() {
    if (dom.beginButton) {
      return dom.beginButton.getBoundingClientRect().top;
    }
    if (dom.panel) {
      const rect = dom.panel.getBoundingClientRect();
      return rect.bottom - 72;
    }
    return window.innerHeight - CONFIG.panelReservePx;
  }

  function panelObstacleRect() {
    const top = panelChromeTop();
    const panelBottom = dom.panel?.getBoundingClientRect().bottom ?? window.innerHeight;
    return {top, bottom: panelBottom, height: panelBottom - top};
  }

  // ─── Ship (gunmetal fighter craft; keeps the Figure API the traversal logic expects) ──

  const Figure = {
    renderSvg() {
      // Swept-wing fighter drawn nose-right (heading 0°); the shell is rotated to the
      // craft's travel heading at runtime, and the hull is symmetric across its long
      // axis so every angle reads correctly and the engine plume trails behind. Hull
      // tones come from <defs> gradients; the player's color reaches the craft through
      // the flame plume, the flame-glow stops, and .wikinaut-ship-thruster.
      return `
        <svg viewBox="0 0 72 72" role="img" aria-label="Fighter spacecraft">
          <defs>
            <linearGradient id="wikinaut-hull-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${PALETTE.steelHi}"></stop>
              <stop offset="0.5" stop-color="${PALETTE.steel}"></stop>
              <stop offset="1" stop-color="${PALETTE.steelDark}"></stop>
            </linearGradient>
            <linearGradient id="wikinaut-wing-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="${PALETTE.steelHi}"></stop>
              <stop offset="1" stop-color="${PALETTE.steelDark}"></stop>
            </linearGradient>
            <linearGradient id="wikinaut-canopy-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#2a3e58"></stop>
              <stop offset="1" stop-color="#0a1422"></stop>
            </linearGradient>
            <radialGradient id="wikinaut-flame-glow" cx="0.72" cy="0.5" r="0.85">
              <stop offset="0" stop-color="#ffffff" stop-opacity="0.9"></stop>
              <stop class="wikinaut-flame-glow-tint" offset="0.4" stop-color="${PALETTE.accent}" stop-opacity="0.5"></stop>
              <stop class="wikinaut-flame-glow-tint" offset="1" stop-color="${PALETTE.accent}" stop-opacity="0"></stop>
            </radialGradient>
          </defs>
          <g class="wikinaut-ship-body">
            <!-- Engine flame at the bell (tail), drawn behind the hull. Because it lives
                 inside the rotated shell it always trails straight off the ship's tail. -->
            <g class="wikinaut-ship-flame">
              <g class="wikinaut-ship-flame-flicker">
                <ellipse class="wikinaut-ship-flame-glow" cx="-2" cy="36" rx="22" ry="9"></ellipse>
                <path class="wikinaut-ship-flame-plume" d="M12 31 Q -8 33 -26 36 Q -8 39 12 41 Z"></path>
                <path class="wikinaut-ship-flame-mid" d="M12 32.5 Q 0 34.5 -13 36 Q 0 37.5 12 39.5 Z"></path>
                <path class="wikinaut-ship-flame-core" d="M12 33.5 Q 5 35 -4 36 Q 5 37 12 38.5 Z"></path>
              </g>
            </g>
            <polygon class="wikinaut-ship-thruster" points="11,33 11,39 -4,36"></polygon>
            <polygon class="wikinaut-ship-wing" points="48,31 24,31 14,14"></polygon>
            <polygon class="wikinaut-ship-wing" points="48,41 24,41 14,58"></polygon>
            <polygon class="wikinaut-ship-wing" points="20,31 13,22 18,31"></polygon>
            <polygon class="wikinaut-ship-wing" points="20,41 13,50 18,41"></polygon>
            <path class="wikinaut-ship-hull" d="M66 36 L52 32 L38 30 L20 31 L11 33 L11 39 L20 41 L38 42 L52 40 Z"></path>
            <polygon class="wikinaut-ship-canopy" points="56,36 49,32 43,36 49,40"></polygon>
            <path class="wikinaut-ship-line" d="M20 36 H60"></path>
            <path class="wikinaut-ship-line" d="M38 31 V41 M28 31 V41"></path>
          </g>
        </svg>
      `;
    },

    show() {
      dom.figure.dataset.visible = 'true';
    },

    hide() {
      dom.figure.dataset.visible = 'false';
    },

    pose(pose) {
      dom.figure.dataset.pose = pose;
    },

    // The craft now rotates a full 0–360° to its heading (the old scaleX flip is
    // retired). The hull is symmetric across its long axis, so any angle reads right
    // and the engine plume always trails directly behind the direction of travel.
    setAngle(deg) {
      runtime.figureAngle = deg;
      Figure.moveTo(runtime.figurePosition.x, runtime.figurePosition.y);
    },

    headToward(fromX, fromY, toX, toY) {
      const dx = toX - fromX;
      const dy = toY - fromY;
      if (Math.hypot(dx, dy) < 0.5) return;
      Figure.setAngle((Math.atan2(dy, dx) * 180) / Math.PI);
    },

    faceToward(targetX) {
      Figure.headToward(runtime.figurePosition.x, runtime.figurePosition.y, targetX, runtime.figurePosition.y);
    },

    moveTo(x, y) {
      runtime.figurePosition = {x, y};
      dom.figure.style.transform =
        `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) rotate(${runtime.figureAngle.toFixed(1)}deg)`;
    },

    targetAtLink(link) {
      // Land the ship centered on the link itself. No panel Y-clamp — the ship flies
      // above the console (z-index) and is free to set down anywhere on screen.
      const rect = link.getBoundingClientRect();
      const linkCenterX = rect.left + rect.width / 2;
      const linkCenterY = rect.top + rect.height / 2;
      return {
        x: clamp(linkCenterX - CONFIG.figureSize / 2, 8, window.innerWidth - CONFIG.figureSize - 8),
        y: clamp(linkCenterY - CONFIG.figureSize / 2, 8, window.innerHeight - CONFIG.figureSize - 8),
        slitX: linkCenterX,
        slitY: linkCenterY,
      };
    },
  };

  // ─── Launch sequence (3-2-1 countdown → gantry → shake → ship off the panel top) ──
  // Plays ONCE, on the origin page inside beginWalk, before the first navigation. The
  // per-hop resume() after each link.click() enters directly at FLYING, so the countdown
  // never replays — only-once falls out of where this lives, not a stored flag.
  //
  // Pure FX layer: no Phase.set/setStatus calls here (those are the caller's job — see
  // beginWalk) so this module stays reusable/testable independent of the phase machine.
  const LaunchSequence = {
    // Render the ship above everything in the panel's launch bay (top-center), nose up, and
    // rise the gantry rails / part the bay doors. The ship is otherwise hidden — it only
    // exists from launch until arrival.
    async arm(reduce) {
      JourneyPortal.activate();
      Trail.clear();

      runtime.figureAngle = -90;          // nose up
      dom.panel.dataset.launch = 'arming';

      if (reduce) {
        const pad = LaunchSequence.padPosition();
        Figure.moveTo(pad.x, pad.y);
        Figure.show();
        Figure.pose('idle');
        return;
      }

      // Let the bay doors part and the hangar mouth appear before the craft rises.
      await sleep(260);
      const from = LaunchSequence.padPosition();
      Figure.moveTo(from.x, from.y + 26);
      Figure.show();
      Figure.pose('idle');
      // Rise out of the bay onto the pad. The pad is re-measured every frame: if the
      // panel is still settling (the route card's expansion can overlap a quick Launch
      // press), the ship tracks the live rect instead of arming against a stale one.
      await animate(430, (p) => {
        const pad = LaunchSequence.padPosition();
        const eased = 1 - easeInCubic(1 - p);
        Figure.moveTo(pad.x, pad.y + 26 * (1 - eased));
      });
      await sleep(140);
    },

    // 3 … 2 … 1 … . Calls onTick(n) before each digit so the caller can narrate it.
    async countdown(reduce, onTick) {
      for (const n of [3, 2, 1]) {
        if (onTick) onTick(n);
        LaunchSequence.showDigit(String(n), reduce);
        await sleep(reduce ? 140 : 760);
      }
      LaunchSequence.hideDigit();
    },

    // Spool-up: the drive charges (core pulses) and the craft hunkers against the hold-downs —
    // a short crouch storing energy before the bolts blow.
    async spoolUp(reduce) {
      const pad = LaunchSequence.padPosition();
      Figure.pose('grab');
      if (!reduce) {
        await animate(300, (p) => {
          Figure.moveTo(pad.x, pad.y + Math.sin(p * Math.PI) * 6);
        });
      }
    },

    // Ignition + climb clear of the pad.
    async liftoff(reduce) {
      dom.panel.dataset.launch = 'launch';
      Figure.pose('push');
      dom.figure.dataset.thrust = 'launch';   // full white+orange torch off the pad

      const start = {...runtime.figurePosition};
      // Engine bell sits at the tail; the craft is nose-up, so the bell is below centre.
      LaunchSequence.ignite(start.x + CONFIG.figureSize / 2, start.y + CONFIG.figureSize * 0.9);

      if (!reduce) {
        dom.root.dataset.shake = 'true';
        window.setTimeout(() => {
          if (dom.root) delete dom.root.dataset.shake;
        }, 1400);
      }

      // Hold a beat while thrust builds (flame + smoke ignite, embers fly), then climb
      // hard off the pad — ease-IN so it accelerates like a rocket, rising well clear of
      // the console while the engine trail blooms into a plume behind it.
      const riseY = clamp(start.y - 360, 8, start.y);
      if (reduce) {
        Figure.moveTo(start.x, riseY);
      } else {
        await sleep(170);
        await animate(1000, (progress) => {
          const eased = easeInCubic(progress);
          Figure.moveTo(start.x, lerp(start.y, riseY, eased));
          Trail.addPoint(runtime.figurePosition.x, runtime.figurePosition.y);
          JourneyPortal.ensureAbovePanel();
        });
      }

      // Retract the launch rig; the ship is airborne and the flight loop takes over. Drop the
      // launch torch back to the cyan cruise flame.
      delete dom.panel.dataset.launch;
      delete dom.figure.dataset.thrust;
      Figure.pose('look');
    },

    // Ignition flourish at the engine bell: white-hot flash, a shock-ring, and embers.
    ignite(x, y) {
      Trail.burst(x, y, 22);
      if (!dom.root || prefersReducedMotion()) return;
      for (const cls of ['wikinaut-ignition', 'wikinaut-shockwave']) {
        const el = document.createElement('div');
        el.className = cls;
        el.style.left = `${Math.round(x)}px`;
        el.style.top = `${Math.round(y)}px`;
        dom.root.append(el);
        window.setTimeout(() => el.remove(), 820);
      }
    },

    // Panel top-center, where the ship sits in the launch bay before ignition.
    padPosition() {
      const rect = dom.panel.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2 - CONFIG.figureSize / 2,
        y: rect.top - CONFIG.figureSize / 2,
      };
    },

    showDigit(text, reduce) {
      if (!dom.countdown) return;
      dom.countdown.dataset.on = 'true';
      dom.countdown.textContent = text;
      if (reduce || typeof dom.countdown.animate !== 'function') return;
      dom.countdown.animate(
        [
          {transform: 'scale(0.6)', opacity: 0},
          {transform: 'scale(1.15)', opacity: 1, offset: 0.4},
          {transform: 'scale(1)', opacity: 1},
        ],
        {duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)'},
      );
    },

    hideDigit() {
      if (!dom.countdown) return;
      dom.countdown.dataset.on = 'false';
      dom.countdown.textContent = '';
    },
  };

  // ─── Traversal ───────────────────────────────────────────────────────────────

  const Traversal = {
    async resume() {
      if (runtime.isWalking) return;

      const state = Storage.load();
      if (!state) return;         // nothing saved — the common case on a normal page load
      if (!state.active) return;  // a course is saved but not launched yet — also normal
      if (!Array.isArray(state.route)) {
        console.warn('[Wikinaut] wn/route-state-corrupt: active flight with non-array route', state);
        Storage.clear();
        return;
      }

      runtime.isWalking = true;
      Phase.set(PHASES.FLYING);
      JourneyPortal.activate();
      try {
        const currentTitle = Titles.currentPageTitle();
        let currentIndex = Number.isInteger(state.currentIndex) ? state.currentIndex : 0;

        if (!Titles.same(state.route[currentIndex], currentTitle)) {
          const actualIndex = Titles.indexInRoute(state.route, currentTitle);
          if (actualIndex === -1) {
            Traversal.offerRecompute(state, currentTitle);
            return;
          }
          currentIndex = actualIndex;
          Storage.save({...state, currentIndex});
        }

        renderRoute(state.route, currentIndex, currentIndex + 1);

        const isFinal = currentIndex >= state.route.length - 1;
        const nextTitle = isFinal ? null : state.route[currentIndex + 1];

        // Drop out of warp where the previous jump entered, so the ship/portal reappear in
        // the same screen spot they left from — and run the link scan UNDER the arrival
        // hold instead of after it: the warp-in starts first (so the FX hits the screen
        // before the heavy synchronous querySelectorAll pass), then the scan (plus any
        // redirect-alias fetch on a miss) overlaps it. arrive() never scrolls or touches
        // the article DOM, so the two can't fight; the catch wrapper keeps a scan failure
        // from surfacing as an unhandled rejection if resume() throws before the await.
        const arrivePromise = state.entry ? Transition.arrive(state.entry) : null;
        if (nextTitle) setStatus(`Scanning for ${nextTitle}…`);
        const scanPromise = nextTitle
          ? Traversal._locateNextLink(nextTitle).catch((error) => {
              console.warn('[Wikinaut] wn/scan-failed', error);
              return {link: null, aliases: [], candidateCount: 0};
            })
          : null;

        // Warm the NEXT page's redirect-alias cache while this hop plays out (fire-and-
        // forget; fetchRedirectAliases writes through the sessionStorage cache, which
        // survives the navigation). It must be +2: the next page scans for the hop AFTER
        // this jump. Fired before the scan resolves so every departure path — cruise+jump
        // AND the URL-jump fallback — leaves with the cache warming; by the next page's
        // scan the aliases are already local instead of costing a network round trip.
        if (nextTitle) {
          const upcoming = state.route[currentIndex + 2];
          if (upcoming) Routing.fetchRedirectAliases(upcoming).catch(() => {});
        }

        if (arrivePromise) {
          await arrivePromise;
          // Consume the entry once used.
          Storage.saveRoute(state.route, {active: true, currentIndex});
        }

        if (isFinal) {
          await Traversal.arrive(state.route);
          return;
        }

        const {link, aliases, candidateCount} = await scanPromise;

        if (!link) {
          // The DOM scan still couldn't surface the link (a redirect alias the title text
          // can't match, or the live page genuinely diverged from the graph). The graph says
          // this jump exists, so don't dead-end — navigate straight to the canonical article
          // and let the next page resume the flight.
          // (CLAUDE.md: always provide a fallback to direct-by-URL navigation.)
          // The warn carries enough context to diagnose a field report: candidateCount 0 means
          // no anchor matched the title at all (a matching gap), >0 means match-but-unusable.
          console.warn('[Wikinaut] wn/link-missing', {
            title: nextTitle,
            candidateCount,
            aliasCount: aliases.length,
            revealTried: true,
          });
          setStatus(
            `Couldn't find the link to "${nextTitle}" on this page — jumping by coordinates…`,
            {isError: true});
          await Traversal.jumpByUrl(nextTitle, currentIndex + 1, state.route);
          return;
        }

        // Belt-and-braces: navboxes are made collapsible (and collapsed) by MediaWiki some
        // seconds AFTER load, so the located link can be re-hidden at any moment. Reopen
        // before planning the flight so the cruise aims at painted content, not a phantom
        // rect; walkToLink repeats the guard at touchdown for collapses mid-cruise.
        Links.ensureVisible(link);

        // Every hop flies straight to the link. On the launch page the ship is already
        // airborne off the pad; on later pages it has just dropped out of warp at the
        // entry position (Transition arrival) — either way, no dock to leave.
        await Traversal.cruiseToLink(link);
        setStatus(`Target acquired: ${nextTitle}. Charging jump drive.`);
        await Traversal.walkToLink(link);

        await Traversal._jumpThrough(link, nextTitle, currentIndex, state.route);
      } catch (error) {
        console.error('[Wikinaut]', error.code || 'wn/unknown', error);
        setStatus(error.message || 'The ship hit unexpected turbulence. Try again.', {isError: true});
        showToast('Something went sideways. You can try again or chart a new course.');
        Storage.saveRoute(state?.route ?? [], {
          currentIndex: Number.isInteger(state?.currentIndex) ? state.currentIndex : 0,
        });
        Phase.set(PHASES.STALLED);
        dom.beginButton.disabled = false;
        Figure.hide();
      } finally {
        LinkFx.clearReticle();
        JourneyPortal.deactivate();
        if (dom.panel) delete dom.panel.dataset.jumping;  // un-fade if a jump aborted
        runtime.isWalking = false;
      }
    },

    // Find the on-page anchor for the next hop with the network OFF the critical path: most
    // hops match the route title directly, so scan for it first with zero requests. Only on a
    // miss pull the redirect aliases (session-cached — see Routing.fetchRedirectAliases) and
    // rescan, then finally try revealing a collapsed container. Returns the scanned candidate
    // count so the caller's link-missing diagnostics don't pay a second full-page scan.
    async _locateNextLink(nextTitle) {
      let aliases = [];
      let candidates = Links.candidates(nextTitle);
      let link = Links.pickFrom(candidates);

      if (!link) {
        // A live page may link via a redirect alias (route step "New York City", on-page
        // anchor literally "NYC"). Best-effort; an empty list just means no extra matches.
        aliases = await Routing.fetchRedirectAliases(nextTitle);
        if (aliases.length) {
          candidates = Links.candidates(nextTitle, aliases);
          link = Links.pickFrom(candidates);
        }
      }

      if (!link) {
        // The link may be tucked inside a collapsed navbox / dropdown / <details>. Open
        // any container hiding it and try again before falling back to a URL jump.
        const revealed = Links.reveal(nextTitle, aliases);
        if (revealed) {
          setStatus(`Uncovering the route to ${nextTitle}…`);
          link = Links.locate(nextTitle, aliases) || revealed;
        }
      }

      return {link, aliases, candidateCount: candidates.length};
    },

    // The engine side of a jump: play the hyperspace FX (watchdogged), persist the advanced
    // route + warp-entry point, and click through. tearThrough is pure FX; navigation and
    // persistence live here so a stalled/rejected animation can never block the actual jump —
    // the transition just gets skipped straight to its end state.
    async _jumpThrough(link, nextTitle, currentIndex, route) {
      let anchor;
      try {
        const watchdogMs = CONFIG.jumpDurationMs + 600;
        anchor = await Promise.race([
          Transition.tearThrough({link, onJumpStart: () => setStatus(`Jumping to ${nextTitle}…`)}),
          sleep(watchdogMs).then(() => null),
        ]);
      } catch (transitionError) {
        console.warn('[Wikinaut] wn/transition-failed, jumping anyway', transitionError);
        anchor = null;
      }
      if (!anchor) {
        anchor = Transition.anchorFromLink(link, link.getBoundingClientRect());
      }

      Storage.saveRoute(route, {
        active: true,
        currentIndex: currentIndex + 1,
        entry: {
          x: anchor.slitX - CONFIG.figureSize / 2,
          y: anchor.slitY - CONFIG.figureSize / 2,
          angle: runtime.figureAngle,
        },
      });
      link.click();
    },

    // The live page redirected/diverged off the plotted route (either a genuine drift, or the
    // clicked link resolved through a Wikipedia redirect to a title not on our route). Rather
    // than dead-ending, clear the stale route and set the console up so the player can chart a
    // fresh course from here with one click — the destination is prefilled.
    offerRecompute(state, currentTitle) {
      const destination = state.targetTitle || state.route[state.route.length - 1] || '';
      Storage.clear();
      renderRoute([]);
      console.warn('[Wikinaut] wn/off-course', {expected: state.route, arrived: currentTitle});
      setStatus(
        `The ship drifted off the plotted course (arrived at "${currentTitle}"). ` +
          (destination ? `Chart a fresh course to ${destination}?` : 'Chart a fresh course from here.'),
        {isError: true},
      );
      Phase.set(PHASES.STALLED);
      if (destination) {
        dom.input.value = destination;
        runtime.selectedPage = destination;
        updateChartGate();
      }
    },

    // Document-space flight: the article is the world, the scroll is the camera. One cubic
    // bézier per hop, planned in document coordinates from the ship's current position to the
    // link's center; the ship faces the curve's true tangent every frame while the camera
    // scrolls to keep it riding the comfort line — the page streams underneath the ship.
    async cruiseToLink(link) {
      const speed = Settings.get('walkingPixelsPerSecond');
      Figure.show();
      Figure.pose('walking');

      const half = CONFIG.figureSize / 2;
      // Comfort line: where the ship rides in the viewport — upper-middle (~40% down), kept
      // below the masthead and clear of the console band.
      const restLineY = clamp(window.innerHeight * 0.4, 100, panelObstacleRect().top - 100);
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      // The ship's fixed-position transform is viewport-space; the flight is planned and flown
      // in document space and converted per frame (viewport = doc − scroll).
      const start = {
        x: runtime.figurePosition.x + window.scrollX,
        y: runtime.figurePosition.y + window.scrollY,
      };
      const rect = link.getBoundingClientRect();
      const end = {
        x: rect.left + rect.width / 2 + window.scrollX - half,
        y: rect.top + rect.height / 2 + window.scrollY - half,
      };

      if (prefersReducedMotion()) {
        window.scrollTo(0, clamp(end.y + half - restLineY, 0, maxScroll));
        const t = Figure.targetAtLink(link);
        Figure.headToward(start.x, start.y, end.x, end.y);
        Figure.moveTo(t.x, t.y);
        Figure.pose('look');
        return;
      }

      const {p0, p1, p2, p3} = buildFlightPath(start, end, runtime.figureAngle);
      const lut = buildArcLengthLut(p0, p1, p2, p3);
      const duration = clamp(
        (lut.total / speed) * 1000, CONFIG.minWalkDurationMs, CONFIG.maxCruiseDurationMs);
      // Wall-clock-derived velocity ramps: the take-off build-up (~0.9s) and touchdown ease
      // (~0.7s) last the same real time on short and long hops alike, so a long flight never
      // leaps to cruise speed in its first frames.
      const rampUp = clamp(900 / duration, 0.1, 0.4);
      const rampDown = clamp(700 / duration, 0.1, 0.35);
      const startScroll = window.scrollY;
      const startAngle = runtime.figureAngle;
      // Comfort band the camera must keep the ship inside while it eases into lock — the ship
      // may surge ahead of the camera at launch, but never out of frame. The band edges ease
      // in from wherever the ship starts (it can legally sit slightly outside the band on the
      // pad), so the guard never snaps the scroll on the first frame.
      const frameTop = 70;
      const frameBottom = Math.min(window.innerHeight - 90, window.innerHeight * 0.82);
      const startCenterY = start.y + half - startScroll;

      await animate(duration, (progress) => {
        // Constant perceived speed: trapezoid distance profile → arc-length LUT → t.
        const t = lut.tForDistance(lut.total * trapezoidDistance(progress, rampUp, rampDown));
        const x = cubicBezier(t, p0.x, p1.x, p2.x, p3.x);
        const y = cubicBezier(t, p0.y, p1.y, p2.y, p3.y);

        // Face the tangent; ease out any initial mismatch between the parked heading and the
        // curve's first tangent over the accel ramp so the nose never snaps.
        const dx = cubicBezierDerivative(t, p0.x, p1.x, p2.x, p3.x);
        const dy = cubicBezierDerivative(t, p0.y, p1.y, p2.y, p3.y);
        let angle = runtime.figureAngle;
        if (Math.hypot(dx, dy) > 1e-3) angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (progress < rampUp) angle = lerpAngle(startAngle, angle, progress / rampUp);
        Figure.setAngle(angle);

        // Camera: scroll so the ship rides the comfort line. Eases into lock over the first
        // ~0.9s of real time (no jump at launch, and no seconds-long lag on slow hops), then
        // tracks exactly. The frame guard clamps the reel-in so the ship's center can never
        // leave [frameTop, frameBottom]; the document-edge clamp is applied last and wins —
        // near the edges the ship traverses the viewport instead.
        const follow = clamp(y + half - restLineY, 0, maxScroll);
        const lockT = Math.min(1, (progress * duration) / 900);
        const guardBottom = lerp(Math.max(startCenterY, frameBottom), frameBottom, lockT);
        const guardTop = lerp(Math.min(startCenterY, frameTop), frameTop, lockT);
        let camera = lerp(startScroll, follow, lockT);
        camera = clamp(camera, y + half - guardBottom, y + half - guardTop);
        camera = clamp(camera, 0, maxScroll);
        window.scrollTo(0, camera);

        Figure.moveTo(x - window.scrollX, y - camera);
        Trail.addPoint(runtime.figurePosition.x, runtime.figurePosition.y);
        JourneyPortal.ensureAbovePanel();
      });

      // Land on the link's live rect — absorbs any layout shift during the flight.
      const settled = Figure.targetAtLink(link);
      Figure.moveTo(settled.x, settled.y);
      Figure.pose('look');
    },

    async walkToLink(link) {
      // The cruise already set the ship down on the link; re-snap (in case the page
      // shifted), settle, and charge the jump drive. The link may have been re-hidden DURING
      // the cruise (MediaWiki collapses navboxes seconds after load) — reopen its container
      // first so the touchdown lands on painted content, never on a phantom rect.
      Links.ensureVisible(link);
      const target = Figure.targetAtLink(link);
      Figure.moveTo(target.x, target.y);
      Trail.clearRibbon();                                 // drop the cruise plume, keep embers
      LinkFx.spawnReticle(link.getBoundingClientRect());   // scan→lock onto the target link
      LinkFx.landingBurst(target.slitX, target.slitY);     // double shock-ring at touchdown
      Trail.burst(target.slitX, target.slitY, 16);         // scattering touchdown embers
      await sleep(140);
      Figure.pose('grab');                                 // charge the jump drive
      await sleep(220);
    },

    // Fallback when the link can't be found in the live DOM: persist the advanced route
    // (and the ship's current screen position, so the next page can drop it out of warp
    // in the same spot), play a degraded "emergency warp" flourish, and navigate straight
    // to the canonical article.
    async jumpByUrl(nextTitle, nextIndex, route) {
      Storage.saveRoute(route, {
        active: true,
        currentIndex: nextIndex,
        entry: Traversal.shipEntry(),
      });

      if (!prefersReducedMotion() && dom.figure?.dataset.visible === 'true') {
        const slitX = runtime.figurePosition.x + CONFIG.figureSize / 2;
        const slitY = runtime.figurePosition.y + CONFIG.figureSize / 2;
        Transition.renderEmergencyWarp({slitX, slitY});
        Figure.pose('warp');
        await sleep(260);
        Figure.hide();
        await sleep(60);
      } else {
        await sleep(prefersReducedMotion() ? 0 : 300);
      }

      location.assign(`/wiki/${Titles.toUrlTitle(nextTitle)}`);
    },

    // The ship's current viewport position + heading, for cross-page warp continuity.
    // Null when the ship isn't on screen (so the next page just flies in from the edge).
    shipEntry() {
      if (dom.figure?.dataset.visible !== 'true') return null;
      return {
        x: runtime.figurePosition.x,
        y: runtime.figurePosition.y,
        angle: runtime.figureAngle,
      };
    },

    async arrive(route) {
      Storage.clear();
      renderRoute(route, route.length - 1, -1);
      setStatus(`Arrived at ${route[route.length - 1]}. Course complete.`);
      Phase.set(PHASES.ARRIVED);
      // Victory flourish where the ship dropped out of warp, then it departs (fades out) —
      // the ship only exists for the duration of a flight.
      Figure.show();
      Figure.pose('victory');
      const vx = runtime.figurePosition.x + CONFIG.figureSize / 2;
      const vy = runtime.figurePosition.y + CONFIG.figureSize / 2;
      LinkFx.landingBurst(vx, vy);   // celebratory shock-rings at the destination
      Trail.burst(vx, vy, 26);       // and a shower of sparks
      dom.beginButton.disabled = true;
      runtime.route = route;
      await sleep(prefersReducedMotion() ? 600 : 1600);
      Figure.hide();
      Trail.clear();
      Phase.set(PHASES.IDLE);
    },
  };

  // ─── Links ───────────────────────────────────────────────────────────────────

  const Links = {
    // `aliases` (optional) is a list of titles known to redirect to `title` — see
    // Routing.fetchRedirectAliases — so a live page linking via a redirect alias still matches.
    locate(title, aliases = []) {
      return Links.pickFrom(Links.candidates(title, aliases));
    },

    // Choose the anchor the ship should fly to from an already-scanned candidate list —
    // callers that need the candidate list anyway (for diagnostics) scan once and pick here.
    // Candidates are {link, rect} entries (see candidates()); returns the bare link.
    pickFrom(candidates) {
      if (!candidates.length) return null;

      const best = Links.bestVisible(candidates);
      if (best && Links.visibilityScore(best.rect) > 0.7) return best.link;

      const chosen = Links.nearestBelowViewport(candidates) || Links.nearestToViewport(candidates);
      return chosen.link;
    },

    // Returns [{link, rect}] — each candidate's bounding rect is measured exactly once here
    // and every scorer/sorter reads the cached rect (a per-comparison getBoundingClientRect
    // in the sort paths forced repeated layout reads on link-dense pages).
    candidates(title, aliases = []) {
      const root =
        document.querySelector(SELECTORS.articleBody) ||
        document.querySelector(SELECTORS.contentRoot) ||
        document.body;
      // Cheap string filters first (href parse + title match), then the expensive
      // computed-style/rect visibility check only on the few links that matched — a Parsoid
      // article can carry ~2000 internal links and a per-link getComputedStyle scan is slow.
      const entries = [];
      for (const link of root.querySelectorAll(SELECTORS.articleLink)) {
        if (!Links.isArticleLinkHref(link)) continue;
        if (!Links.matchesTitle(link, title, aliases)) continue;
        const rect = link.getBoundingClientRect();
        if (!Links.isRendered(link, {rect})) continue;
        entries.push({link, rect});
      }
      return entries;
    },

    // The graph counts ALL namespace-0 links — including those in infoboxes, sidebars,
    // and bottom navboxes — so match against the href title, the link's `title` attribute
    // (catches odd encodings the href parse would miss), and any known redirect aliases of
    // `title` (catches a live page linking via a redirect the graph already resolved through).
    matchesTitle(link, title, aliases = []) {
      const linkTitle = Titles.fromLink(link);
      if (Titles.same(linkTitle, title)) return true;
      const titleAttr = link.getAttribute('title');
      if (titleAttr && Titles.same(titleAttr, title)) return true;
      if (aliases.length) {
        if (aliases.some((alias) => Titles.same(linkTitle, alias))) return true;
        if (titleAttr && aliases.some((alias) => Titles.same(titleAttr, alias))) return true;
      }
      return false;
    },

    // The single rendered-visibility test (used by candidates() in loose form and isOnPage
    // in strict form). Allow off-viewport links; only exclude truly hidden elements —
    // excluding hidden ones makes Links.locate return null, which is what triggers reveal.
    //
    // TWO hidden-by-a-collapsed-ancestor shapes exist and both must be caught:
    // - display:none ancestor → the link keeps display:inline but renders a 0×0 box.
    // - `hidden="until-found"` ancestor (how MediaWiki collapses navbox rows for
    //   find-in-page) → content-visibility:hidden, and the link keeps a NONZERO rect while
    //   being unpainted — a phantom the display/visibility/rect checks all miss. Only
    //   checkVisibility() sees through it; without the fix the ship lands in empty space.
    //
    // `strict` is the landing-time semantic: ANY zero dimension means unpaintable. The loose
    // candidate semantic only rejects a fully-collapsed 0×0 box. `rect` may be passed by a
    // caller that already measured it.
    isRendered(link, {strict = false, rect = null} = {}) {
      const box = rect || link.getBoundingClientRect();
      const flat = strict ? (box.width === 0 || box.height === 0)
        : (box.width === 0 && box.height === 0);
      if (flat) return false;
      if (typeof link.checkVisibility === 'function') {
        return link.checkVisibility(
          {contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true});
      }
      const style = window.getComputedStyle(link);
      return style.display !== 'none' && style.visibility !== 'hidden';
    },

    // The href/namespace test WITHOUT the visibility check — so Links.reveal can find a
    // target that's currently hidden inside a collapsed container.
    //
    // Namespace filtering must be a PREFIX-LIST test, never a blanket "contains a colon":
    // plenty of namespace-0 articles contain colons ("2001: A Space Odyssey", "Star Trek: The
    // Next Generation") and the graph includes them — a colon test silently rejected every
    // anchor to such a title and the flight degraded to a URL-jump with a misleading "link not
    // visible" report. (Candidates are title-matched against a known ns-0 route title anyway,
    // so this filter is only an early-out; it must never over-reject.)
    isArticleLinkHref(link) {
      const title = Titles.rawFromHref(link.getAttribute('href') || '');
      if (!title || Links.NAMESPACE_PREFIX_RE.test(title)) return false;
      // Only skip edit-section links and citation-reference superscripts ([1] → #cite_note).
      // Navboxes, sidebars, infoboxes, AND the references list itself are all counted by the
      // graph, so they must stay searchable.
      if (link.closest('.mw-editsection, .reference')) return false;
      return true;
    },

    // Known MediaWiki namespaces (href form: underscores, possibly "_talk" variants).
    NAMESPACE_PREFIX_RE: new RegExp(
      '^(?:talk|special|wikipedia|wp|project|file|image|media|mediawiki|template|help|' +
        'category|portal|draft|timedtext|module|user)(?:_talk)?:', 'i'),

    // Some target links live inside collapsed navboxes, collapsed infobox rows, <details>, or
    // nav dropdowns — the graph counts them but they're display:none on load, so Links.locate
    // can't see them. Find such a hidden candidate, expand every collapsed container on its
    // ancestor chain until it's on-page, and return it for the ship to land on. Returns null if
    // nothing matches (the caller then falls back to a direct URL jump). Never throws.
    reveal(title, aliases = []) {
      try {
        const root =
          document.querySelector(SELECTORS.articleBody) ||
          document.querySelector(SELECTORS.contentRoot) ||
          document.body;
        const matches = [...root.querySelectorAll(SELECTORS.articleLink)]
          .filter((link) => Links.isArticleLinkHref(link))
          .filter((link) => Links.matchesTitle(link, title, aliases));
        for (const link of matches) {
          if (Links.ensureVisible(link)) return link;
        }
      } catch (error) {
        console.warn('[Wikinaut] reveal failed', error);
      }
      return null;
    },

    // Make one hidden link visible, preferring the page's own machinery: on a live MediaWiki
    // collapsible (`.mw-made-collapsible`) click the REAL toggle first — the collapsible code
    // restores the rows' `hidden="until-found"` attributes and aria state natively — and only
    // then fall back to attribute/style surgery on the ancestor chain. Also the landing-time
    // guard: navboxes are made collapsible seconds AFTER load, so a link located while
    // visible can be re-hidden mid-flight. Returns whether the link is now truly on-page.
    ensureVisible(link) {
      if (Links.isOnPage(link)) return true;
      if (link.closest('.mw-made-collapsible')) Links.clickCollapsibleToggle(link);
      if (!Links.isOnPage(link)) Links.expandAncestors(link);
      if (!Links.isOnPage(link)) Links.clickCollapsibleToggle(link);
      if (!Links.isOnPage(link)) return false;
      Links.pulseContainer(link);
      return true;
    },

    // Brief highlight pulse on the container that was just expanded, so the reveal reads as an
    // intentional action rather than the page silently shifting under the player.
    pulseContainer(link) {
      if (prefersReducedMotion()) return;
      const container = link.closest('.mw-collapsible, .NavFrame, details, table') || link;
      container.classList.add('wikinaut-reveal-pulse');
      window.setTimeout(() => container.classList.remove('wikinaut-reveal-pulse'), 900);
    },

    // Walk from the link up to the article root, opening anything that hides it: <details>,
    // MediaWiki collapsibles (which drop `mw-collapsed` and set inline display:none on rows /
    // content wrappers), legacy `.collapsed`, and generic inline-hidden / [hidden] ancestors.
    // Clearing display:none only along the link's own chain reveals exactly that link without
    // disturbing unrelated collapsed content.
    expandAncestors(link) {
      let node = link;
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.tagName === 'DETAILS' && !node.open) node.open = true;
        if (node.classList) {
          node.classList.remove('mw-collapsed');
          node.classList.remove('collapsed');
          if (node.classList.contains('vector-dropdown')) node.classList.add('vector-dropdown--active');
        }
        if (node.style && node.style.display === 'none') node.style.display = '';
        if (node.hasAttribute && node.hasAttribute('hidden')) node.removeAttribute('hidden');
        node = node.parentElement;
      }
    },

    // Fallback for JS-driven collapsibles the style reset alone doesn't open: click the nearest
    // MediaWiki collapsible toggle above the link (lets Wikipedia's own handler expand it).
    clickCollapsibleToggle(link) {
      const container = link.closest('.mw-collapsible, .NavFrame');
      if (!container) return;
      const toggle = container.querySelector(
        '.mw-collapsible-toggle, .mw-collapsible-toggle-expanded, .NavToggle, summary');
      if (toggle && typeof toggle.click === 'function') toggle.click();
    },

    // Landing-time check: is the link truly paintable right now?
    isOnPage(link) {
      return Links.isRendered(link, {strict: true});
    },

    // The scorers below all take {link, rect} candidate entries and read the rect captured
    // at scan time — never re-measure inside a sort comparator.
    bestVisible(entries) {
      let best = null;
      let bestScore = -Infinity;
      for (const entry of entries) {
        const score =
          Links.visibilityScore(entry.rect) * 1000 - Links.distanceFromFigure(entry.rect);
        if (score > bestScore) {
          best = entry;
          bestScore = score;
        }
      }
      return best;
    },

    visibilityScore(rect) {
      const visW = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const visH = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      return (visW * visH) / Math.max(rect.width * rect.height, 1);
    },

    distanceFromFigure(rect) {
      return Math.hypot(
        rect.left + rect.width / 2 - runtime.figurePosition.x,
        rect.top + rect.height / 2 - runtime.figurePosition.y,
      );
    },

    nearestToViewport(entries) {
      const cy = window.innerHeight / 2;
      let best = null;
      let bestD = Infinity;
      for (const entry of entries) {
        const d = Math.abs(entry.rect.top - cy);
        if (d < bestD) {
          best = entry;
          bestD = d;
        }
      }
      return best;
    },

    nearestBelowViewport(entries) {
      const threshold = panelObstacleRect().top;
      let best = null;
      for (const entry of entries) {
        if (entry.rect.top <= threshold - 40) continue;
        if (!best || entry.rect.top < best.rect.top) best = entry;
      }
      return best;
    },
  };

  // ─── Link-anchored FX ────────────────────────────────────────────────────────
  // Reticle lock + landing burst, spawned at the target link's on-screen rect inside
  // the jump layer (which JourneyPortal has reparented above the live page). The
  // hyperspace jump's replaceChildren() naturally clears any lingering reticle.
  const LinkFx = {
    reticleEl: null,

    spawnReticle(rect) {
      LinkFx.clearReticle();
      if (!dom.ripLayer) return;
      dom.ripLayer.dataset.open = 'true';
      const el = document.createElement('div');
      el.className = 'wikinaut-reticle';
      LinkFx.positionReticle(el, rect);
      dom.ripLayer.append(el);
      LinkFx.reticleEl = el;
    },

    positionReticle(el, rect) {
      el.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
      el.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
      el.style.width = `${Math.round(Math.max(rect.width + 22, 46))}px`;
      el.style.height = `${Math.round(Math.max(rect.height + 16, 28))}px`;
    },

    repositionReticle(rect) {
      if (LinkFx.reticleEl) LinkFx.positionReticle(LinkFx.reticleEl, rect);
    },

    clearReticle() {
      if (LinkFx.reticleEl) {
        LinkFx.reticleEl.remove();
        LinkFx.reticleEl = null;
      }
    },

    landingBurst(centerX, centerY) {
      if (!dom.ripLayer || prefersReducedMotion()) return;
      dom.ripLayer.dataset.open = 'true';
      for (const variant of ['', ' secondary']) {
        const burst = document.createElement('div');
        burst.className = `wikinaut-landing-burst${variant}`;
        burst.style.left = `${Math.round(centerX)}px`;
        burst.style.top = `${Math.round(centerY)}px`;
        dom.ripLayer.append(burst);
        window.setTimeout(() => burst.remove(), 900);
      }
    },
  };

  // ─── Transition (hyperspace jump) ──────────────────────────────────────────────

  const Transition = {
    // Pure FX: plays the pre-jump orientation + hyperspace departure and returns the jump
    // anchor (viewport coords of the slit). Does NOT navigate or persist state — the engine
    // (Traversal.resume) does that once this resolves (or its watchdog times it out), so a
    // stalled/rejected animation can never block the actual jump. onJumpStart fires right as
    // the jump visually begins (streaks/flash), so the caller can narrate it at the right beat.
    async tearThrough({link, onJumpStart}) {
      // Make the link unmistakably visible (scroll it into the clear band + fade the panel
      // so it can never block it), then charge and jump to lightspeed.
      await Transition.ensureInView(link);

      let rect = link.getBoundingClientRect();
      const anchor = Transition.anchorFromLink(link, rect);
      Figure.faceToward(anchor.slitX);
      Figure.pose('tug');
      await sleep(prefersReducedMotion() ? 0 : 140);

      rect = link.getBoundingClientRect();
      Object.assign(anchor, Transition.anchorFromLink(link, rect));
      if (onJumpStart) onJumpStart();
      LinkFx.clearReticle();

      if (!prefersReducedMotion()) {
        // Lightspeed: streaks rip outward from the link, the ship snaps onto the jump
        // point, stretches along its heading and vanishes to a point.
        Transition.renderHyperspace(anchor, 'depart');
        Figure.moveTo(anchor.slitX - CONFIG.figureSize / 2, anchor.slitY - CONFIG.figureSize / 2);
        Figure.pose('warp');
        await sleep(320); // ship stretches to a point (must outlast the 300ms warp-stretch)
        Figure.hide();
        await sleep(60);
      }

      return anchor;
    },

    // The cruise already parks the link at the comfort line, so there's no scroll to do
    // here — that second adjustment was the pre-jump jank. Just fade/disable the console
    // (so it can never block the target) and re-lock the reticle for the jump.
    async ensureInView(link) {
      if (dom.panel) dom.panel.dataset.jumping = 'true';
      LinkFx.repositionReticle(link.getBoundingClientRect());
    },

    // Drop the ship out of warp at the saved entry point on a freshly loaded page, so the
    // jump reads as continuous across the navigation.
    async arrive(entry) {
      JourneyPortal.activate();
      runtime.figureAngle = entry.angle || 0;
      Figure.moveTo(entry.x, entry.y);
      const anchor = {slitX: entry.x + CONFIG.figureSize / 2, slitY: entry.y + CONFIG.figureSize / 2};

      if (prefersReducedMotion()) {
        Figure.show();
        Figure.pose('look');
        return;
      }
      Transition.renderHyperspace(anchor, 'arrive');
      Figure.show();
      Figure.pose('warp-in');
      await sleep(CONFIG.jumpDurationMs * 0.7);
      Figure.pose('look');
      dom.ripLayer.dataset.open = 'false';
      dom.ripLayer.replaceChildren();
    },

    anchorFromLink(link, rect) {
      const slitX = rect.left + rect.width / 2;
      const slitY = rect.top + rect.height / 2;
      return {slitX, slitY, entryX: slitX, entryY: slitY};
    },

    // Lightspeed field at the slit. mode 'depart' streaks fly outward; 'arrive' streaks
    // collapse inward. Streaks radiate in every direction from the jump point.
    renderHyperspace(anchor, mode = 'depart') {
      dom.ripLayer.replaceChildren();
      dom.ripLayer.dataset.open = 'true';
      dom.ripLayer.style.setProperty('--wn-slit-x', `${Math.round(anchor.slitX)}px`);
      dom.ripLayer.style.setProperty('--wn-slit-y', `${Math.round(anchor.slitY)}px`);

      // Starfield tunnel rushing forward behind the streaks.
      const tunnel = document.createElement('div');
      tunnel.className = 'wikinaut-warp-tunnel';
      tunnel.dataset.mode = mode;

      // Radial star-streaks. Their white→cyan→magenta gradient gives each one its own
      // chromatic separation; a denser field reads as a faster lightspeed rush.
      const warp = document.createElement('div');
      warp.className = 'wikinaut-warp';
      warp.dataset.mode = mode;
      const streakCount = 56;
      for (let i = 0; i < streakCount; i += 1) {
        const streak = document.createElement('div');
        streak.className = 'wikinaut-warp-streak';
        const angle = (360 / streakCount) * i + (Math.random() * 8 - 4);
        streak.style.transform = `rotate(${angle}deg)`;
        streak.style.animationDelay = `${Math.random() * 70}ms`;
        warp.append(streak);
      }

      // Expanding motion-blur shock ring, the big flash (with a cyan/magenta chromatic
      // fringe from its ::before/::after), and a white-hot core bloom on top.
      const ring = document.createElement('div');
      ring.className = 'wikinaut-warp-ring';
      ring.dataset.mode = mode;
      const flash = document.createElement('div');
      flash.className = 'wikinaut-flash';
      flash.dataset.mode = mode;
      const core = document.createElement('div');
      core.className = 'wikinaut-warp-core';
      core.dataset.mode = mode;

      dom.ripLayer.append(tunnel, warp, ring, flash, core);

      // A brief camera shudder as the drive punches through (departure only).
      if (mode === 'depart' && dom.root && !prefersReducedMotion()) {
        dom.root.dataset.warpShake = 'true';
        window.setTimeout(() => { if (dom.root) delete dom.root.dataset.warpShake; }, 240);
      }
    },

    // A shorter, amber-tinted warp for the degraded "couldn't find the link, jumping by
    // coordinates" fallback (Traversal.jumpByUrl) — reuses the hyperspace shapes but visually
    // distinct (amber, no chromatic split) so the player can tell a degraded jump from a
    // normal one. Anchored at the ship's current position since there's no link to anchor to.
    renderEmergencyWarp(anchor) {
      dom.ripLayer.replaceChildren();
      dom.ripLayer.dataset.open = 'true';
      dom.ripLayer.style.setProperty('--wn-slit-x', `${Math.round(anchor.slitX)}px`);
      dom.ripLayer.style.setProperty('--wn-slit-y', `${Math.round(anchor.slitY)}px`);

      const ring = document.createElement('div');
      ring.className = 'wikinaut-warp-ring wikinaut-warp-ring-emergency';
      ring.dataset.mode = 'depart';
      const flash = document.createElement('div');
      flash.className = 'wikinaut-flash wikinaut-flash-emergency';
      flash.dataset.mode = 'depart';
      dom.ripLayer.append(ring, flash);
    },
  };

  // ─── Network helpers ─────────────────────────────────────────────────────────

  // Parses JSON text, returning undefined (never throwing) on malformed input — callers decide
  // how to react to an unparsable body.
  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  async function requestJson(url, options = {}) {
    let text;
    try {
      text = await requestText(url, options);
    } catch (networkErr) {
      // A non-2xx response may still carry a JSON error body (e.g. our own backend's /paths
      // 400s: {"error": "...", "code": "page-not-found"}) — prefer that player-facing message
      // over the generic "Request failed (NNN)" if one is present.
      if (networkErr.body) {
        const parsed = tryParseJson(networkErr.body);
        if (parsed?.error) {
          const err = new Error(
            typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
          err.code = parsed.code ? `backend/${parsed.code}` : undefined;
          err.status = networkErr.status;
          throw err;
        }
      }
      throw networkErr;
    }

    const data = tryParseJson(text);
    if (data === undefined) {
      const err = new Error(
        'The navigation backend sent back something unreadable. Try again in a moment.');
      err.code = 'wn/backend-bad-response';
      throw err;
    }
    if (data?.error) {
      // MediaWiki errors are objects ({code, info}); surface a readable message.
      const mwErr = data.error;
      const err = new Error(
        mwErr.info || mwErr.code || (typeof mwErr === 'string' ? mwErr : JSON.stringify(mwErr)));
      err.code = data.code ? `backend/${data.code}` : undefined;
      throw err;
    }
    return data;
  }

  function requestText(url, options = {}) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: options.method || 'GET',
          url,
          headers: options.headers || {},
          data: options.body,
          responseType: 'text',
          timeout: 30000,
          onload(response) {
            if (response.status >= 200 && response.status < 300) {
              resolve(response.responseText);
            } else {
              const err = new Error(`Request failed (${response.status})`);
              err.status = response.status;
              err.body = response.responseText;
              reject(err);
            }
          },
          ontimeout() {
            reject(Object.assign(new Error('Request timed out.'), {code: 'wn/backend-timeout'}));
          },
          onerror() {
            reject(Object.assign(new Error('Network request failed.'), {code: 'wn/backend-unreachable'}));
          },
        });
      });
    }

    return fetch(url, options).then(async (response) => {
      const text = await response.text();
      if (!response.ok) {
        const err = new Error(`Request failed (${response.status})`);
        err.status = response.status;
        err.body = text;
        throw err;
      }
      return text;
    });
  }

  // ─── Animation helpers ───────────────────────────────────────────────────────

  // Tween driver on the shared FxLoop: concurrent animations (a cruise + the trail canvas)
  // ride one rAF chain instead of racing separate ones. A throwing onFrame REJECTS the
  // promise — if it merely unsubscribed (FxLoop's default for a bad subscriber), the caller's
  // await would strand forever and the engine's error handling (stall + retry) never engage.
  function animate(duration, onFrame) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      FxLoop.add(function tick(now) {
        let progress;
        try {
          progress = clamp((now - start) / duration, 0, 1);
          onFrame(progress);
        } catch (error) {
          reject(error);
          return false;
        }
        if (progress < 1) return true;
        resolve();
        return false;
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function easeInCubic(value) {
    return value * value * value;
  }

  // Cubic bézier on one axis: p0 → (controls) p1, p2 → p3.
  function cubicBezier(t, p0, p1, p2, p3) {
    const inv = 1 - t;
    return inv * inv * inv * p0 + 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t * p3;
  }

  // First derivative of the cubic — the flight uses it as the true tangent for the ship's
  // heading (no frame-delta approximation).
  function cubicBezierDerivative(t, p0, p1, p2, p3) {
    const inv = 1 - t;
    return 3 * inv * inv * (p1 - p0) + 6 * inv * t * (p2 - p1) + 3 * t * t * (p3 - p2);
  }

  // Shortest-arc interpolation between two headings in degrees (never swings the long way
  // around), for easing the nose onto a new curve without a snap.
  function lerpAngle(fromDeg, toDeg, t) {
    const diff = ((toDeg - fromDeg + 540) % 360) - 180;
    return fromDeg + diff * t;
  }

  // One graceful banking curve from `start` to `end` (document coords), departing along
  // `headingDeg`. Both control points are constrained to a single side of the chord, which
  // for a cubic guarantees the curvature never changes sign — exactly one banking turn,
  // never an S-curve. The bank side falls out of the geometry: whichever side of the chord
  // the ship's current heading already deviates toward.
  function buildFlightPath(start, end, headingDeg) {
    const chordX = end.x - start.x;
    const chordY = end.y - start.y;
    const span = Math.hypot(chordX, chordY);
    if (span < 1) {
      return {p0: {...start}, p1: {...start}, p2: {...end}, p3: {...end}};
    }
    const ux = chordX / span;
    const uy = chordY / span;
    const rad = (headingDeg * Math.PI) / 180;
    const hx = Math.cos(rad);
    const hy = Math.sin(rad);
    const cross = ux * hy - uy * hx;   // signed side of the chord the heading deviates toward
    const dot = ux * hx + uy * hy;
    const handle = Math.min(span * 0.35, 260);

    // Heading nearly parallel to the chord → essentially straight. Heading pointing sharply
    // backwards → honoring it would demand a loop a single bend can't express; fly straight
    // and let the caller's angle ease-in absorb the turn.
    if (Math.abs(Math.atan2(cross, dot)) < Math.PI / 22.5 || dot < -0.2) {
      return {
        p0: {...start},
        p1: {x: start.x + chordX / 3, y: start.y + chordY / 3},
        p2: {x: start.x + (2 * chordX) / 3, y: start.y + (2 * chordY) / 3},
        p3: {...end},
      };
    }

    const side = cross >= 0 ? 1 : -1;
    // Depart along the current heading (P1 lands on the bank side by construction)…
    const p1 = {x: start.x + hx * handle, y: start.y + hy * handle};
    // …and arrive along the chord tilted a few degrees, phased so P2 lands on the SAME side.
    const theta = (-side * 18 * Math.PI) / 180;
    const ax = ux * Math.cos(theta) - uy * Math.sin(theta);
    const ay = ux * Math.sin(theta) + uy * Math.cos(theta);
    const p2 = {x: end.x - ax * handle, y: end.y - ay * handle};

    // Belt-and-braces: if an extreme heading still left the pair straddling the chord,
    // reflect P2 across it (preserves the arrival distance, restores the single-side rule).
    const sideOf = (p) => chordX * (p.y - start.y) - chordY * (p.x - start.x);
    if (sideOf(p1) * sideOf(p2) < 0) {
      const t = ((p2.x - start.x) * chordX + (p2.y - start.y) * chordY) / (span * span);
      const footX = start.x + chordX * t;
      const footY = start.y + chordY * t;
      p2.x = 2 * footX - p2.x;
      p2.y = 2 * footY - p2.y;
    }
    return {p0: {...start}, p1, p2, p3: {...end}};
  }

  // Arc-length lookup for a cubic: maps distance-traveled → curve parameter t, so the ship
  // moves at constant speed no matter how unevenly t maps to distance along the curve.
  function buildArcLengthLut(p0, p1, p2, p3, samples = 96) {
    const ts = [0];
    const ds = [0];
    let total = 0;
    let prevX = p0.x;
    let prevY = p0.y;
    for (let i = 1; i <= samples; i += 1) {
      const t = i / samples;
      const x = cubicBezier(t, p0.x, p1.x, p2.x, p3.x);
      const y = cubicBezier(t, p0.y, p1.y, p2.y, p3.y);
      total += Math.hypot(x - prevX, y - prevY);
      ts.push(t);
      ds.push(total);
      prevX = x;
      prevY = y;
    }
    return {
      total,
      tForDistance(dist) {
        const d = clamp(dist, 0, total);
        let lo = 0;
        let hi = ds.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (ds[mid] < d) lo = mid + 1;
          else hi = mid;
        }
        if (lo === 0) return 0;
        const seg = ds[lo] - ds[lo - 1] || 1;
        return ts[lo - 1] + (ts[lo] - ts[lo - 1]) * ((d - ds[lo - 1]) / seg);
      },
    };
  }

  // Trapezoid velocity profile: accel/decel ramps at each end, constant cruise between.
  // Maps normalized time → normalized distance, so speed reads as constant without a harsh
  // full-speed landing. Ramps may be asymmetric (a longer, more visible take-off build-up
  // than the touchdown ease) — the caller derives them from wall-clock time so the launch
  // surge lasts the same real duration on short and long hops alike.
  function trapezoidDistance(progress, rampUp = 0.12, rampDown = rampUp) {
    const p = clamp(progress, 0, 1);
    const vPeak = 1 / (1 - (rampUp + rampDown) / 2);
    if (p < rampUp) return (vPeak * p * p) / (2 * rampUp);
    if (p > 1 - rampDown) {
      const q = 1 - p;
      return 1 - (vPeak * q * q) / (2 * rampDown);
    }
    return vPeak * (p - rampUp / 2);
  }

  function hexToRgb(hex) {
    const clean = String(hex || '').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    return {
      r: parseInt(full.slice(0, 2), 16) || 0,
      g: parseInt(full.slice(2, 4), 16) || 0,
      b: parseInt(full.slice(4, 6), 16) || 0,
    };
  }

  function rgbToHex({r, g, b}) {
    const c = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }

  // Per-channel lerp between two hex colors; t=0 → hexA, t=1 → hexB.
  function mixHex(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    return rgbToHex({
      r: lerp(a.r, b.r, t),
      g: lerp(a.g, b.g, t),
      b: lerp(a.b, b.b, t),
    });
  }

  // WCAG relative luminance (0 = black, 1 = white).
  function relativeLuminance(hex) {
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const {r, g, b} = hexToRgb(hex);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  // Lift a color toward white until it clears a luminance floor, so a near-black pick can
  // never render the console/ship unreadable on the dark fascia. Bounded iterations: even
  // pure black clears 0.15 well within eight 15% white mixes.
  function ensureReadable(hex, minLum = 0.15) {
    let out = hex;
    for (let i = 0; i < 8 && relativeLuminance(out) < minLum; i += 1) {
      out = mixHex(out, '#FFFFFF', 0.15);
    }
    return out;
  }

  // rgba() string from an arbitrary hex — like paletteRgba, for SVG presentation
  // attributes where var() can't resolve, but fed by the player's color.
  function rgbaFromHex(hex, alpha) {
    return `rgba(${paletteChannels(hex)},${alpha})`;
  }

  // The full derived colorway from the player's ONE color setting: console accent family,
  // hyperspace streaks, and the trail ramp endpoints all come from this single base, so
  // every glow on screen agrees. Plain white/black mixes reproduce the hand-tuned gold
  // family within a few RGB points for the default accent and generalize to any hue.
  function deriveColorway(rawHex) {
    const base = ensureReadable(rawHex, 0.15);
    return {
      base,
      hot: mixHex(base, '#FFFFFF', 0.65),      // white-hot centers (≈ stock accentHot)
      glow: mixHex(base, '#FFFFFF', 0.40),     // phosphor readouts (≈ stock accentGlow)
      deep: mixHex(base, '#000000', 0.20),     // launch-key shadow stop (≈ stock accentDeep)
      streakA: mixHex(base, '#FFFFFF', 0.45),  // hyperspace streaks: pale…
      streakB: mixHex(base, '#000000', 0.25),  // …and deep
      trailCore: mixHex(base, '#FFFFFF', 0.40),
      trailTail: mixHex(mixHex(base, '#808080', 0.30), '#000000', 0.30), // desaturated ember
      // Console body text. These carry most of the panel's lettering, so they are mixed
      // far enough toward white/grey to stay legible on the dark fascia at any hue while
      // still reading as the player's color rather than a fixed ivory/blue-grey.
      parchment: mixHex(base, '#FFFFFF', 0.80),  // engraved labels + atlas chart lettering
      dimWhite: mixHex(mixHex(base, '#FFFFFF', 0.55), '#808080', 0.35),  // secondary text
      // Engraved text ON the accent-filled LAUNCH cap. Dark rather than light because the
      // cap's middle gradient stop (where the lettering sits) is the base color itself.
      // Worst case is a dark saturated pick, which ensureReadable floors at 0.15 luminance
      // and so caps contrast near 4:1 — still clear of WCAG AA for this 700-weight key.
      ink: mixHex(base, '#000000', 0.88),
    };
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  // Escape dynamic (backend-supplied) titles before interpolating them into SVG/HTML
  // markup so a page title can never inject elements or break out of a text node.
  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

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
})();
