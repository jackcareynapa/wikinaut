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
      /* Beat tempo from the flight-speed setting; Settings.applyToDom republishes it on all
         three hosts (the ship shell and jump layer leave #wikinaut-root during a journey). */
      --wn-tempo: 1;
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
    /* A page several routes pass through is ONE star — the layout is keyed on node identity,
       so the paths converge on it. A wider halo makes that convergence read at a glance. */
    .wikinaut-wp.shared .wikinaut-wp-node {
      stroke: rgba(var(--wn-parchment-rgb),0.9);
      stroke-width: 1.4;
      filter: drop-shadow(0 0 4px rgba(var(--wn-blue-glow-rgb),0.5));
    }
    /* Waypoints only the OTHER routes visit: quiet unlabelled markers. */
    .wikinaut-wp.off-route .wikinaut-wp-node {
      stroke: rgba(var(--wn-blue-rgb),0.65);
      stroke-width: 0.9;
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
    /* Tempo-scaled so it covers the whole climb (beat(170) + beat(1000)) at any speed. */
    #wikinaut-root[data-shake="true"] #wikinaut-panel {
      animation: wikinaut-shake calc(1170ms * var(--wn-tempo, 1)) ease-in-out;
    }
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
      animation: wikinaut-warp-zoom calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) cubic-bezier(.55,0,.85,.5) forwards;
    }
    /* Arrivals replay the departure keyframes in reverse (animation-direction) — one
       keyframe per effect instead of a hand-tuned "-in" twin for each. */
    .wikinaut-warp[data-mode="arrive"] {
      animation: wikinaut-warp-zoom calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) cubic-bezier(.2,.7,.3,1) reverse forwards;
    }
    @keyframes wikinaut-warp-zoom { 0% { transform: translate(-50%,-50%) scale(0.6); } 100% { transform: translate(-50%,-50%) scale(1.5); } }

    /* 56 of these play at once, so the streak animates a COMPOSITABLE property. Growing 'width'
       (the old keyframe) is a layout property: 56 elements re-laid-out and repainted every
       frame, on the main thread, at exactly the moment the arrival path is also running its
       synchronous full-page link scan. Fixed width + scaleX is the identical picture without
       the layout. The per-streak angle arrives as --wn-streak-angle (set by
       Transition.renderHyperspace) so the keyframe can own the whole composed transform —
       writing 'transform' on the element directly would be clobbered by the animation.
       No will-change on these OR on the warp layers below: promoting them measurably HURT
       (a repeatable ~60ms stall at the jump — 56 new layers, and the tunnel/flash are
       tens-of-vmax mix-blend-mode elements whose textures are expensive to allocate). */
    .wikinaut-warp-streak {
      position: absolute;
      left: 0;
      top: 0;
      height: 2px;
      width: 150vmax;
      transform-origin: 0 50%;
      transform: rotate(var(--wn-streak-angle, 0deg)) scaleX(0.0002);
      border-radius: 2px;
      background: linear-gradient(90deg, #ffffff, var(--wn-accent-glow) 22%, var(--wn-accent) 44%, var(--wn-streak-a) 72%, transparent);
      box-shadow: 0 0 12px var(--wn-streak-b), 0 0 4px #ffffff;
      animation: wikinaut-streak calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) cubic-bezier(.5,0,.85,.5) forwards;
    }
    .wikinaut-warp[data-mode="arrive"] .wikinaut-warp-streak {
      animation: wikinaut-streak calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) cubic-bezier(.2,.7,.3,1) reverse forwards;
    }
    @keyframes wikinaut-streak {
      0%   { transform: rotate(var(--wn-streak-angle, 0deg)) scaleX(0.0002); opacity: 0; }
      12%  { opacity: 1; }
      100% { transform: rotate(var(--wn-streak-angle, 0deg)) scaleX(1); opacity: 0; }
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
      animation: wikinaut-flash calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) ease-in forwards;
    }
    .wikinaut-flash[data-mode="arrive"] { animation: wikinaut-flash calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) ease-out reverse forwards; }
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
      animation: wikinaut-warp-tunnel calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) cubic-bezier(.55,0,.85,.5) forwards;
    }
    .wikinaut-warp-tunnel[data-mode="arrive"] { animation: wikinaut-warp-tunnel calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) cubic-bezier(.2,.7,.3,1) reverse forwards; }
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
      animation: wikinaut-warp-ring calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) cubic-bezier(.3,.7,.3,1) forwards;
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
      animation: wikinaut-flash calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) ease-in forwards;
    }
    .wikinaut-warp-core[data-mode="arrive"] { animation: wikinaut-flash calc(${CONFIG.jumpDurationMs}ms * var(--wn-tempo, 1)) ease-out reverse forwards; }

    /* Boost burn: the ship skipping up the flight path on a hop too long to fly whole
       (Traversal.boostIfDistant). A tighter, dimmer ring and a small core — an in-system burn,
       not the full between-articles hyperspace jump. */
    .wikinaut-warp-ring-boost {
      border-width: 2px;
      border-color: rgba(var(--wn-accent-rgb),0.75);
      box-shadow: 0 0 18px 3px rgba(var(--wn-accent-rgb),0.4), inset 0 0 10px rgba(255,255,255,0.45);
      animation-duration: calc(${CONFIG.jumpDurationMs}ms * 0.6 * var(--wn-tempo, 1));
    }
    .wikinaut-warp-core-boost {
      width: 4vmax;
      height: 4vmax;
      animation-duration: calc(${CONFIG.jumpDurationMs}ms * 0.6 * var(--wn-tempo, 1));
    }

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
      animation: wikinaut-warp-stretch calc(300ms * var(--wn-tempo, 1)) cubic-bezier(.6,0,.9,.4) forwards;
    }
    #wikinaut-ship-shell[data-pose="warp-in"] .wikinaut-ship-body {
      animation: wikinaut-warp-stretch calc(300ms * var(--wn-tempo, 1)) cubic-bezier(.2,.7,.3,1) reverse both;
    }
    @keyframes wikinaut-warp-stretch {
      0%   { transform: scaleX(1) scaleY(1); opacity: 1; }
      55%  { transform: scaleX(2.8) scaleY(0.62); opacity: 1; }
      100% { transform: scaleX(0.04) scaleY(0.32); opacity: 0; }
    }

    /* Boost burn: the ship stretches along its heading and snaps BACK. It is skipping up the
       flight path, not leaving the page, so it must not reuse [data-pose="warp"] — that one
       ends the keyframe at opacity 0 and holds there (animation-fill-mode: forwards),
       which made the ship vanish for the rest of the hop. */
    #wikinaut-ship-shell[data-pose="boost"] .wikinaut-ship-body {
      animation: wikinaut-boost-stretch calc(320ms * var(--wn-tempo, 1)) cubic-bezier(.4,0,.3,1) both;
    }
    @keyframes wikinaut-boost-stretch {
      0%   { transform: scaleX(1) scaleY(1); opacity: 1; }
      45%  { transform: scaleX(2.4) scaleY(0.7); opacity: 0.85; }
      100% { transform: scaleX(1) scaleY(1); opacity: 1; }
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
