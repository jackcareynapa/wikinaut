  /**
   * Tuning:
   * - walkingPixelsPerSecond: default flight pace (overridable via settings drawer). This is a
   *   true px/s cruise velocity — see planCruise — and it also sets the beat tempo for every
   *   cinematic hold in a flight via Settings.tempo()/beat().
   * - jumpDurationMs: how long the hyperspace jump plays before navigation. Scaled at runtime
   *   by --wn-tempo on the CSS side and by beat() on the JS side, so the two stay in step.
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
    minCruiseDurationMs: 180,   // degenerate-hop floor only (target already under the ship)
    // The flight window: how long the ship may cruise under its own power before the hop is
    // too long to fly whole. Beyond `speed x cruiseWindowMs` the ship BOOSTS — a brief warp
    // flourish skips it up the flight path — and then flies the final window at exactly the
    // slider speed. Capping the flown DISTANCE this way keeps every hop's visible approach at
    // the same pace; the old fixed 12s duration cap did the opposite, silently compressing
    // long hops and overriding the slider (it bit at 6600px on the default setting, which is
    // routine on a tall article).
    cruiseWindowMs: 9000,
    minCruiseWindowPx: 1200,    // …but never boost the ship closer in than this, so even the
                                // slowest setting gets a real approach (and its flights then
                                // run past cruiseWindowMs — which is what 100 px/s means)
    maxCruiseDurationMs: 60000, // runaway guard ONLY; planCruise + the window keep flights far
                                // below it, so if this ever bites it is a bug (it warns)
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
