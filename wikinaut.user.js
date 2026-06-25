// ==UserScript==
// @name         Wikinaut
// @namespace    https://github.com/jackcareynapa/wikinaut
// @version      1.0.0
// @description  Chart a course through Wikipedia — Wikinaut finds the shortest link-path to any article and flies you there through hyperspace.
// @author       jackcareynapa
// @match        https://en.wikipedia.org/wiki/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      wikinaut-api.fly.dev
// @connect      en.wikipedia.org
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function wikinautUserscript() {
  'use strict';

  if (window.__wikinautLoaded) return;
  window.__wikinautLoaded = true;

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
   * GM storage). See docs/deployment.md.
   */
  const CONFIG = {
    apiBaseUrl: 'https://wikinaut-api.fly.dev',
    wikipediaApiUrl: 'https://en.wikipedia.org/w/api.php',
    backendUrlKey: 'wikinaut:backendUrl',
    routeStorageKey: 'wikinautState:v1',
    settingsStorageKey: 'wikinautSettings:v1',
    figureSize: 56,
    minWalkDurationMs: 620,
    maxWalkDurationMs: 2200,
    jumpDurationMs: 1500,
    autocompleteLimit: 6,
    autocompleteDebounceMs: 180,
    routeSketchMs: 900,
    trailFadeMs: 1100,
    panelReservePx: 120,
    journeyPortalZ: 2147483646,
  };

  // Palette (retro-futuristic wireframe). Colors mirror the design spec.
  const PALETTE = {
    bg: '#0A0F1C',
    cyan: '#00F3FF',
    cyanCore: '#66FFFF',
    cyanGlow: '#A0FFFF',
    blue: '#1E90FF',
    blueGlow: '#7FC4FF',
    dimWhite: '#CCCCCC',
    purple: '#BD93F9',
    flash: '#E0FFFF',
    streakA: '#FF00FF',
    streakB: '#C715DB',
    amber: '#FFB84C',
    // Gunmetal hull tones for the fighter craft (matches spaceship.png).
    steelHi: '#C7D2E0',
    steel: '#8A97A8',
    steelDark: '#3A4453',
    steelShadow: '#1B2230',
  };

  const SETTINGS_DEFAULTS = {
    walkingPixelsPerSecond: 560,
    travelerColor: PALETTE.cyan,
    trailColor: PALETTE.purple,
  };

  const SELECTORS = {
    contentRoot: '#mw-content-text',
    articleBody: '#mw-content-text .mw-parser-output',
    pageTitle: '#firstHeading',
  };

  // ─── CSS ────────────────────────────────────────────────────────────────────
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Rajdhani:wght@400;500;600&display=swap');

    #wikinaut-root,
    #wikinaut-root * {
      box-sizing: border-box;
    }

    #wikinaut-root {
      --wn-bg: ${PALETTE.bg};
      --wn-cyan: ${PALETTE.cyan};
      --wn-cyan-core: ${PALETTE.cyanCore};
      --wn-cyan-glow: ${PALETTE.cyanGlow};
      --wn-blue: ${PALETTE.blue};
      --wn-dim: ${PALETTE.dimWhite};
      --wn-purple: ${PALETTE.purple};
      --wn-amber: ${PALETTE.amber};
      --wn-ship-color: ${PALETTE.cyan};
      color: var(--wn-cyan);
      font-family: 'Rajdhani', 'Segoe UI', system-ui, sans-serif;
    }

    /* ── Panel (wireframe monitor) ─────────────────────────────────────── */

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
      padding: 12px 16px;
      background:
        radial-gradient(120% 160% at 50% 120%, rgba(0,243,255,0.07), transparent 60%),
        linear-gradient(180deg, #0d1426 0%, var(--wn-bg) 100%);
      border: 1px solid rgba(0,243,255,0.55);
      border-radius: 8px;
      box-shadow:
        0 0 0 1px rgba(0,243,255,0.08),
        0 0 22px rgba(0,243,255,0.18),
        inset 0 0 28px rgba(0,243,255,0.06);
      backdrop-filter: blur(2px);
    }

    #wikinaut-panel::before {
      /* faint scanline grid */
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 8px;
      pointer-events: none;
      background-image: repeating-linear-gradient(0deg, rgba(0,243,255,0.05) 0 1px, transparent 1px 4px);
      opacity: 0.5;
    }

    #wikinaut-panel::after {
      /* HUD corner brackets (4 L-shapes), echoing spaceship.png's frame */
      content: '';
      position: absolute;
      inset: 5px;
      pointer-events: none;
      opacity: 0.75;
      filter: drop-shadow(0 0 4px rgba(0,243,255,0.45));
      background-image:
        linear-gradient(var(--wn-cyan), var(--wn-cyan)), linear-gradient(var(--wn-cyan), var(--wn-cyan)),
        linear-gradient(var(--wn-cyan), var(--wn-cyan)), linear-gradient(var(--wn-cyan), var(--wn-cyan)),
        linear-gradient(var(--wn-cyan), var(--wn-cyan)), linear-gradient(var(--wn-cyan), var(--wn-cyan)),
        linear-gradient(var(--wn-cyan), var(--wn-cyan)), linear-gradient(var(--wn-cyan), var(--wn-cyan));
      background-repeat: no-repeat;
      background-size: 15px 2px, 2px 15px, 15px 2px, 2px 15px, 15px 2px, 2px 15px, 15px 2px, 2px 15px;
      background-position:
        left top, left top, right top, right top,
        left bottom, left bottom, right bottom, right bottom;
    }

    #wikinaut-panel > * { position: relative; }

    .wikinaut-field { position: relative; display: flex; flex-direction: column; gap: 4px; }

    .wikinaut-label {
      font-family: 'Orbitron', sans-serif;
      font-size: 10px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--wn-cyan);
      text-shadow: 0 0 8px rgba(0,243,255,0.6);
    }

    #wikinaut-target-input {
      width: 100%;
      padding: 9px 12px;
      background: rgba(3,8,18,0.85);
      border: 1px solid rgba(0,243,255,0.45);
      border-radius: 4px;
      color: var(--wn-cyan-glow);
      font-family: 'Rajdhani', sans-serif;
      font-size: 15px;
      letter-spacing: 0.5px;
      outline: none;
      transition: border-color 120ms, box-shadow 120ms;
    }
    #wikinaut-target-input::placeholder { color: rgba(0,243,255,0.4); }
    #wikinaut-target-input:focus {
      border-color: var(--wn-cyan);
      box-shadow: 0 0 14px rgba(0,243,255,0.4), inset 0 0 10px rgba(0,243,255,0.12);
    }

    .wikinaut-button {
      padding: 9px 16px;
      border: 1px solid var(--wn-cyan);
      border-radius: 4px;
      background: linear-gradient(180deg, rgba(0,243,255,0.18), rgba(0,243,255,0.05));
      color: var(--wn-cyan-glow);
      font-family: 'Orbitron', sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      cursor: pointer;
      white-space: nowrap;
      text-shadow: 0 0 8px rgba(0,243,255,0.5);
      transition: box-shadow 120ms, background 120ms, transform 80ms;
    }
    .wikinaut-button:hover:not(:disabled) {
      box-shadow: 0 0 16px rgba(0,243,255,0.5);
      background: linear-gradient(180deg, rgba(0,243,255,0.3), rgba(0,243,255,0.1));
    }
    .wikinaut-button:active:not(:disabled) { transform: translateY(1px); }
    .wikinaut-button:disabled { opacity: 0.4; cursor: not-allowed; }
    .wikinaut-button.secondary {
      border-color: rgba(0,243,255,0.5);
      background: rgba(0,243,255,0.04);
      color: var(--wn-cyan);
    }
    .wikinaut-button.icon {
      padding: 9px 11px;
      font-size: 14px;
    }
    .wikinaut-button.icon[aria-expanded="true"] {
      box-shadow: 0 0 14px rgba(0,243,255,0.55);
    }

    /* ── Autocomplete ──────────────────────────────────────────────────── */

    #wikinaut-suggestions {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 0;
      right: 0;
      display: none;
      flex-direction: column;
      background: rgba(5,10,22,0.97);
      border: 1px solid rgba(0,243,255,0.45);
      border-radius: 4px;
      box-shadow: 0 0 18px rgba(0,243,255,0.25);
      overflow: hidden;
      z-index: 5;
    }
    #wikinaut-suggestions[data-open="true"] { display: flex; }

    .wikinaut-suggestion {
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: var(--wn-dim);
      font-family: 'Rajdhani', sans-serif;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
      border-bottom: 1px solid rgba(0,243,255,0.12);
    }
    .wikinaut-suggestion:last-child { border-bottom: none; }
    .wikinaut-suggestion:hover,
    .wikinaut-suggestion:focus {
      background: rgba(0,243,255,0.12);
      color: var(--wn-cyan-glow);
      outline: none;
    }

    #wikinaut-input-hint {
      min-height: 12px;
      font-family: 'Rajdhani', sans-serif;
      font-size: 11px;
      letter-spacing: 0.4px;
      line-height: 1.1;
      color: ${PALETTE.amber};
      opacity: 0;
      transition: opacity 140ms ease;
    }
    #wikinaut-input-hint[data-state="warn"] { opacity: 0.95; }

    /* ── Route card / star map ─────────────────────────────────────────── */

    #wikinaut-route-card {
      grid-column: 1 / -1;
      position: relative;
      padding: 10px 12px 8px;
      border: 1px solid rgba(0,243,255,0.25);
      border-radius: 6px;
      background:
        radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.5), transparent),
        radial-gradient(1px 1px at 70% 60%, rgba(0,243,255,0.6), transparent),
        radial-gradient(1px 1px at 45% 80%, rgba(189,147,249,0.5), transparent),
        radial-gradient(1px 1px at 88% 25%, rgba(255,255,255,0.4), transparent),
        linear-gradient(180deg, rgba(3,8,18,0.7), rgba(3,8,18,0.95));
      background-size: 200px 100px, 240px 120px, 180px 90px, 220px 110px, 100% 100%;
      animation: wikinaut-drift 60s linear infinite;
      overflow: hidden;
    }

    @keyframes wikinaut-drift {
      from { background-position: 0 0, 0 0, 0 0, 0 0, 0 0; }
      to   { background-position: -200px 40px, 240px -60px, -180px 50px, 220px -40px, 0 0; }
    }

    #wikinaut-status {
      font-family: 'Rajdhani', sans-serif;
      font-size: 13px;
      letter-spacing: 0.4px;
      color: var(--wn-cyan-glow);
      margin-bottom: 6px;
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

    .wikinaut-chart-grid line { stroke: rgba(0,243,255,0.10); stroke-width: 0.5; }
    .wikinaut-chart-ring { fill: none; stroke: rgba(0,243,255,0.13); stroke-width: 0.6; }
    .wikinaut-chart-star { fill: #fff; }

    /* Dotted plotted track (static) with a glowing line drawn on top (animated). */
    #wikinaut-route-track {
      fill: none;
      stroke: rgba(0,243,255,0.28);
      stroke-width: 1.4;
      stroke-linecap: round;
      stroke-dasharray: 0.5 6;
    }
    #wikinaut-route-path {
      fill: none;
      stroke: var(--wn-cyan);
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      filter: drop-shadow(0 0 4px rgba(0,243,255,0.6));
    }

    .wikinaut-wp {
      opacity: 0;
      transform: scale(0.3);
      transform-box: fill-box;
      transform-origin: center;
      animation: wikinaut-wp-pop 380ms cubic-bezier(.2,.8,.2,1) forwards;
      animation-delay: var(--d, 0ms);
    }
    .wikinaut-wp-node { fill: rgba(3,8,18,0.9); stroke: rgba(0,243,255,0.5); stroke-width: 1.2; }
    .wikinaut-wp-core { fill: var(--wn-dim); }
    .wikinaut-wp-label {
      fill: var(--wn-dim);
      font-family: 'Rajdhani', sans-serif;
      font-size: 9px;
      letter-spacing: 0.2px;
    }
    .wikinaut-wp.current .wikinaut-wp-node { stroke: var(--wn-cyan); filter: drop-shadow(0 0 6px rgba(0,243,255,0.6)); }
    .wikinaut-wp.current .wikinaut-wp-core { fill: var(--wn-cyan); }
    .wikinaut-wp.current .wikinaut-wp-label { fill: var(--wn-cyan-glow); }
    .wikinaut-wp.next .wikinaut-wp-node { stroke: var(--wn-purple); }
    .wikinaut-wp.next .wikinaut-wp-core { fill: var(--wn-purple); }
    .wikinaut-wp.next .wikinaut-wp-label { fill: #e9ddff; }
    .wikinaut-wp.dest .wikinaut-wp-node { stroke: var(--wn-amber); }
    .wikinaut-wp.dest .wikinaut-wp-core { fill: var(--wn-amber); }

    @keyframes wikinaut-wp-pop {
      from { opacity: 0; transform: scale(0.3); }
      to   { opacity: 1; transform: scale(1); }
    }

    #wikinaut-freshness {
      margin-top: 5px;
      font-family: 'Orbitron', sans-serif;
      font-size: 9px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: rgba(0,243,255,0.55);
    }

    /* ── Launch sequence (spaceport gantry + bay doors + exhaust + smoke + shake) ── */

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

    .wikinaut-gantry-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .wikinaut-gantry {
      transform: scaleY(0);
      transform-origin: 50% 100%;
      transition: transform 460ms cubic-bezier(.2,.8,.2,1);
    }
    .wikinaut-gantry line {
      stroke: rgba(0,243,255,0.7);
      stroke-width: 2;
      stroke-linecap: round;
      filter: drop-shadow(0 0 3px rgba(0,243,255,0.6));
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

    .wikinaut-baydoor {
      position: absolute;
      bottom: 0;
      width: 46%;
      height: 8px;
      background: linear-gradient(180deg, ${PALETTE.steel}, ${PALETTE.steelDark});
      border: 1px solid rgba(0,243,255,0.5);
      transition: transform 380ms ease;
    }
    .wikinaut-baydoor.left { left: 4%; }
    .wikinaut-baydoor.right { right: 4%; }
    #wikinaut-panel[data-launch="arming"] .wikinaut-baydoor.left,
    #wikinaut-panel[data-launch="launch"] .wikinaut-baydoor.left { transform: translateX(-94%); }
    #wikinaut-panel[data-launch="arming"] .wikinaut-baydoor.right,
    #wikinaut-panel[data-launch="launch"] .wikinaut-baydoor.right { transform: translateX(94%); }

    /* Ground-effect exhaust column rising from the pad base. */
    .wikinaut-exhaust {
      position: absolute;
      left: 50%;
      bottom: 2px;
      width: 30px;
      height: 84px;
      transform: translateX(-50%) scaleY(0);
      transform-origin: 50% 100%;
      background: linear-gradient(180deg,
        rgba(255,255,255,0) 0%,
        rgba(127,196,255,0.4) 14%,
        rgba(255,236,150,0.9) 40%,
        rgba(255,150,40,0.95) 72%,
        rgba(255,70,20,0.55) 100%);
      border-radius: 48% 48% 40% 40%;
      filter: blur(2px) drop-shadow(0 0 14px rgba(255,150,40,0.85));
      opacity: 0;
    }
    #wikinaut-panel[data-launch="launch"] .wikinaut-exhaust {
      opacity: 1;
      animation: wikinaut-flame-grow 640ms ease-out forwards, wikinaut-flame-flicker 90ms steps(2) infinite;
    }
    @keyframes wikinaut-flame-grow {
      0%   { transform: translateX(-50%) scaleY(0.1); }
      45%  { transform: translateX(-50%) scaleY(1.18); }
      100% { transform: translateX(-50%) scaleY(1); }
    }
    @keyframes wikinaut-flame-flicker {
      0% { opacity: 0.82; filter: blur(2px) drop-shadow(0 0 12px rgba(255,150,40,0.8)); }
      100% { opacity: 1; filter: blur(3px) drop-shadow(0 0 18px rgba(255,180,60,0.95)); }
    }

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
      font-family: 'Orbitron', sans-serif;
      font-size: 64px;
      font-weight: 800;
      color: var(--wn-cyan-glow);
      text-shadow: 0 0 18px rgba(0,243,255,0.85);
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

    /* ── Settings drawer ───────────────────────────────────────────────── */

    #wikinaut-settings-section {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 10px 14px;
      padding: 10px 12px;
      border: 1px solid rgba(0,243,255,0.25);
      border-radius: 6px;
      background: rgba(3,8,18,0.85);
    }
    #wikinaut-settings-section[hidden] { display: none; }

    .wikinaut-settings-row { display: contents; }
    .wikinaut-settings-label {
      font-family: 'Orbitron', sans-serif;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--wn-cyan);
    }
    .wikinaut-settings-value { font-size: 12px; color: var(--wn-dim); }
    .wikinaut-range { width: 100%; accent-color: ${PALETTE.cyan}; }
    .wikinaut-color-input {
      width: 40px; height: 24px; padding: 0;
      background: transparent; border: 1px solid rgba(0,243,255,0.4); border-radius: 3px;
      cursor: pointer;
    }
    #wikinaut-backend-input {
      grid-column: 2 / -1;
      padding: 7px 10px;
      background: rgba(3,8,18,0.9);
      border: 1px solid rgba(0,243,255,0.4);
      border-radius: 4px;
      color: var(--wn-cyan-glow);
      font-family: 'Rajdhani', sans-serif;
      font-size: 13px;
      outline: none;
    }
    #wikinaut-backend-input:focus { border-color: var(--wn-cyan); box-shadow: 0 0 10px rgba(0,243,255,0.35); }
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
    #wikinaut-ship-shell svg { width: 100%; height: 100%; overflow: visible; }

    /* Gunmetal fighter: metallic hull, tinted canopy, glowing blue engine. */
    .wikinaut-ship-hull {
      fill: url(#wikinaut-hull-grad);
      stroke: ${PALETTE.steelShadow};
      stroke-width: 1;
      stroke-linejoin: round;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.55));
    }
    .wikinaut-ship-wing {
      fill: url(#wikinaut-wing-grad);
      stroke: ${PALETTE.steelShadow};
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
      stroke: ${PALETTE.steelShadow};
      stroke-width: 0.7;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.5;
    }
    .wikinaut-ship-core {
      fill: var(--wn-ship-color, ${PALETTE.blueGlow});
      filter: drop-shadow(0 0 5px var(--wn-ship-color, ${PALETTE.blue}));
    }
    .wikinaut-ship-thruster {
      fill: var(--wn-ship-color, ${PALETTE.blue});
      opacity: 0;
      filter: drop-shadow(0 0 6px var(--wn-ship-color, ${PALETTE.blue}));
    }

    .wikinaut-ship-body { transform-origin: 50% 50%; }
    #wikinaut-ship-shell[data-pose="idle"] .wikinaut-ship-body { animation: wikinaut-hover 2.2s ease-in-out infinite; }
    #wikinaut-ship-shell[data-pose="walking"] .wikinaut-ship-thruster,
    #wikinaut-ship-shell[data-pose="push"] .wikinaut-ship-thruster { animation: wikinaut-thrust 220ms steps(2) infinite; }
    #wikinaut-ship-shell[data-pose="look"] .wikinaut-ship-body,
    #wikinaut-ship-shell[data-pose="look-out"] .wikinaut-ship-body { animation: wikinaut-scan 1.6s ease-in-out infinite; }
    #wikinaut-ship-shell[data-pose="grab"] .wikinaut-ship-core,
    #wikinaut-ship-shell[data-pose="tug"] .wikinaut-ship-core { animation: wikinaut-charge 0.5s ease-in-out infinite alternate; }
    #wikinaut-ship-shell[data-pose="timid"] .wikinaut-ship-body { animation: wikinaut-charge 0.3s ease-in-out infinite alternate; }
    #wikinaut-ship-shell[data-pose="victory"] .wikinaut-ship-body { animation: wikinaut-orbit 2.4s linear infinite; }

    @keyframes wikinaut-hover { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    @keyframes wikinaut-thrust { from { opacity: 0.3; } to { opacity: 1; } }
    @keyframes wikinaut-scan { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
    @keyframes wikinaut-charge { from { filter: drop-shadow(0 0 4px ${PALETTE.cyanCore}); } to { filter: drop-shadow(0 0 12px ${PALETTE.flash}); } }
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
    .wikinaut-warp[data-mode="arrive"] {
      animation: wikinaut-warp-zoom-in ${CONFIG.jumpDurationMs}ms cubic-bezier(.2,.7,.3,1) forwards;
    }
    @keyframes wikinaut-warp-zoom { 0% { transform: translate(-50%,-50%) scale(0.6); } 100% { transform: translate(-50%,-50%) scale(1.5); } }
    @keyframes wikinaut-warp-zoom-in { 0% { transform: translate(-50%,-50%) scale(1.6); } 100% { transform: translate(-50%,-50%) scale(1); } }

    .wikinaut-warp-streak {
      position: absolute;
      left: 0;
      top: 0;
      height: 2px;
      width: 2px;
      transform-origin: 0 50%;
      border-radius: 2px;
      background: linear-gradient(90deg, #ffffff, ${PALETTE.cyan} 30%, ${PALETTE.streakA} 60%, transparent);
      box-shadow: 0 0 8px ${PALETTE.streakB};
      animation: wikinaut-streak ${CONFIG.jumpDurationMs}ms cubic-bezier(.5,0,.85,.5) forwards;
    }
    .wikinaut-warp[data-mode="arrive"] .wikinaut-warp-streak {
      animation: wikinaut-streak-in ${CONFIG.jumpDurationMs}ms cubic-bezier(.2,.7,.3,1) forwards;
    }
    @keyframes wikinaut-streak {
      0%   { width: 4px; opacity: 0; }
      12%  { opacity: 1; }
      100% { width: 150vmax; opacity: 0; }
    }
    @keyframes wikinaut-streak-in {
      0%   { width: 150vmax; opacity: 0; }
      30%  { opacity: 1; }
      100% { width: 4px; opacity: 0; }
    }

    .wikinaut-flash {
      position: absolute;
      left: var(--wn-slit-x, 50%);
      top: var(--wn-slit-y, 50%);
      width: 40vmax;
      height: 40vmax;
      transform: translate(-50%, -50%) scale(0);
      border-radius: 50%;
      background: radial-gradient(circle, #ffffff 0%, ${PALETTE.cyanGlow} 26%, rgba(0,243,255,0.35) 46%, transparent 70%);
      opacity: 0;
      animation: wikinaut-flash ${CONFIG.jumpDurationMs}ms ease-in forwards;
    }
    .wikinaut-flash[data-mode="arrive"] { animation: wikinaut-flash-in ${CONFIG.jumpDurationMs}ms ease-out forwards; }
    @keyframes wikinaut-flash {
      0%   { opacity: 0; transform: translate(-50%,-50%) scale(0); }
      70%  { opacity: 0.5; }
      100% { opacity: 1; transform: translate(-50%,-50%) scale(1.1); }
    }
    @keyframes wikinaut-flash-in {
      0%   { opacity: 1; transform: translate(-50%,-50%) scale(1.1); }
      100% { opacity: 0; transform: translate(-50%,-50%) scale(0); }
    }

    /* Ship stretches along its heading then snaps to a point as it jumps to lightspeed. */
    #wikinaut-ship-shell[data-pose="warp"] .wikinaut-ship-body {
      animation: wikinaut-warp-stretch 460ms cubic-bezier(.6,0,.9,.4) forwards;
    }
    @keyframes wikinaut-warp-stretch {
      0%   { transform: scaleX(1) scaleY(1); opacity: 1; }
      55%  { transform: scaleX(2.8) scaleY(0.62); opacity: 1; }
      100% { transform: scaleX(0.04) scaleY(0.32); opacity: 0; }
    }
    /* Reverse stretch: the ship snaps back from a point into shape as it drops out of warp. */
    #wikinaut-ship-shell[data-pose="warp-in"] .wikinaut-ship-body {
      animation: wikinaut-warp-unstretch 460ms cubic-bezier(.2,.7,.3,1) forwards;
    }
    @keyframes wikinaut-warp-unstretch {
      0%   { transform: scaleX(0.04) scaleY(0.32); opacity: 0; }
      45%  { transform: scaleX(2.4) scaleY(0.6); opacity: 1; }
      100% { transform: scaleX(1) scaleY(1); opacity: 1; }
    }

    /* During a jump the console fades right out so it can never block the target link. */
    #wikinaut-panel { transition: opacity 220ms ease; }
    #wikinaut-panel[data-jumping="true"] { opacity: 0.1; }

    /* ── Link-anchored FX (reticle lock + landing burst) ──────────────────
       Spawned at the target link's rect inside the (reparented, above-page)
       jump layer, so the animation reads as originating from the link itself. */
    .wikinaut-reticle {
      position: absolute;
      transform: translate(-50%, -50%);
      border: 1.5px solid var(--wn-cyan);
      border-radius: 4px;
      box-shadow: 0 0 12px rgba(0,243,255,0.55), inset 0 0 10px rgba(0,243,255,0.18);
      pointer-events: none;
      animation: wikinaut-reticle-pulse 1s ease-in-out infinite;
    }
    .wikinaut-reticle::before,
    .wikinaut-reticle::after {
      content: '';
      position: absolute;
      background: rgba(0,243,255,0.6);
    }
    .wikinaut-reticle::before { left: 4px; right: 4px; top: 50%; height: 1px; transform: translateY(-50%); }
    .wikinaut-reticle::after  { top: 4px; bottom: 4px; left: 50%; width: 1px; transform: translateX(-50%); }
    @keyframes wikinaut-reticle-pulse {
      0%,100% { opacity: 0.5;  box-shadow: 0 0 8px rgba(0,243,255,0.4), inset 0 0 8px rgba(0,243,255,0.15); }
      50%     { opacity: 1;    box-shadow: 0 0 16px rgba(0,243,255,0.7), inset 0 0 12px rgba(0,243,255,0.3); }
    }

    .wikinaut-landing-burst {
      position: absolute;
      width: 56px;
      height: 56px;
      margin: -28px 0 0 -28px;
      border-radius: 50%;
      border: 2px solid var(--wn-cyan-glow);
      box-shadow: 0 0 14px rgba(0,243,255,0.6);
      pointer-events: none;
      animation: wikinaut-landing-burst 600ms ease-out forwards;
    }
    @keyframes wikinaut-landing-burst {
      0%   { transform: scale(0.12); opacity: 0.95; }
      100% { transform: scale(1);    opacity: 0; }
    }

    /* ── Toast ─────────────────────────────────────────────────────────── */

    .wikinaut-toast {
      position: fixed;
      right: 20px;
      bottom: 120px;
      z-index: 2147483005;
      max-width: min(380px, calc(100vw - 40px));
      padding: 10px 14px;
      border: 1px solid var(--wn-amber);
      border-radius: 4px;
      background: rgba(8,12,24,0.96);
      box-shadow: 0 0 16px rgba(255,184,76,0.3);
      color: var(--wn-amber);
      font-family: 'Rajdhani', sans-serif;
      font-size: 13px;
      line-height: 1.45;
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
  `;

  // ─── State ──────────────────────────────────────────────────────────────────

  const dom = {};
  const runtime = {
    phase: 'idle',
    route: null,
    selectedTitle: '',
    selectedPage: null,
    figureAngle: 0,
    isWalking: false,
    figurePosition: {x: 0, y: 0},
    justLaunched: false,
    autocompleteTimer: 0,
    autocompleteAbortId: 0,
    settingsOpen: false,
  };

  // ─── Phase machine (drives both nav-computer UI and ship) ─────────────────────
  // Single source of truth for "where are we in the flight loop". CSS keys off
  // `#wikinaut-panel[data-phase=…]` so visual states stay declarative.
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
      if (dom.panel) dom.panel.dataset.phase = next;
    },
    is(...names) {
      return names.includes(runtime.phase);
    },
  };

  // ─── Backend URL (default + self-host override via GM storage) ────────────────

  const Backend = {
    get url() {
      let stored = '';
      try {
        stored =
          typeof GM_getValue === 'function'
            ? GM_getValue(CONFIG.backendUrlKey, '')
            : localStorage.getItem(CONFIG.backendUrlKey) || '';
      } catch {
        stored = '';
      }
      stored = String(stored || '').trim().replace(/\/+$/, '');
      return stored || CONFIG.apiBaseUrl;
    },

    get override() {
      try {
        const v =
          typeof GM_getValue === 'function'
            ? GM_getValue(CONFIG.backendUrlKey, '')
            : localStorage.getItem(CONFIG.backendUrlKey) || '';
        return String(v || '').trim();
      } catch {
        return '';
      }
    },

    set(url) {
      const value = String(url || '').trim().replace(/\/+$/, '');
      try {
        if (typeof GM_setValue === 'function') GM_setValue(CONFIG.backendUrlKey, value);
        else if (value) localStorage.setItem(CONFIG.backendUrlKey, value);
        else localStorage.removeItem(CONFIG.backendUrlKey);
      } catch {}
    },
  };

  // ─── Settings ─────────────────────────────────────────────────────────────

  const Settings = {
    _cache: null,

    load() {
      try {
        const raw = sessionStorage.getItem(CONFIG.settingsStorageKey);
        Settings._cache = raw
          ? {...SETTINGS_DEFAULTS, ...JSON.parse(raw)}
          : {...SETTINGS_DEFAULTS};
      } catch {
        Settings._cache = {...SETTINGS_DEFAULTS};
      }
      return Settings._cache;
    },

    save(patch) {
      Settings._cache = {...(Settings._cache ?? SETTINGS_DEFAULTS), ...patch};
      try {
        sessionStorage.setItem(CONFIG.settingsStorageKey, JSON.stringify(Settings._cache));
      } catch {}
    },

    reset() {
      Settings._cache = {...SETTINGS_DEFAULTS};
      try {
        sessionStorage.removeItem(CONFIG.settingsStorageKey);
      } catch {}
    },

    get(key) {
      return (Settings._cache ?? SETTINGS_DEFAULTS)[key] ?? SETTINGS_DEFAULTS[key];
    },

    applyToDom() {
      if (!dom.root) return;
      dom.root.style.setProperty('--wn-ship-color', Settings.get('travelerColor'));
    },
  };

  // ─── Trail canvas (cyan → purple particle wake) ───────────────────────────────

  const Trail = {
    canvas: null,
    ctx: null,
    points: [],
    _rafId: null,
    _lastPointTime: 0,

    init() {
      const canvas = document.createElement('canvas');
      canvas.id = 'wikinaut-trail-canvas';
      Trail._resize(canvas);
      dom.root.prepend(canvas);
      Trail.canvas = canvas;
      Trail.ctx = canvas.getContext('2d');
      window.addEventListener('resize', () => Trail._resize(canvas), {passive: true});
    },

    _resize(canvas) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    },

    addPoint(x, y) {
      const now = performance.now();
      if (now - Trail._lastPointTime < 24) return;
      Trail._lastPointTime = now;
      Trail.points.push({
        x: x + CONFIG.figureSize / 2,
        y: y + CONFIG.figureSize / 2,
        t: now,
        sparkle: Math.random() < 0.22,
      });
      if (!Trail._rafId) Trail._rafId = requestAnimationFrame(Trail._draw.bind(Trail));
    },

    _draw() {
      const ctx = Trail.ctx;
      if (!ctx) return;

      const now = performance.now();
      const fadeMs = CONFIG.trailFadeMs;

      ctx.clearRect(0, 0, Trail.canvas.width, Trail.canvas.height);
      Trail.points = Trail.points.filter((p) => now - p.t < fadeMs);

      // Wake fades from bright cyan (fresh) toward purple (old) per the palette spec.
      const start = hexToRgb(PALETTE.cyan);
      const end = hexToRgb(Settings.get('trailColor') || PALETTE.purple);

      for (const pt of Trail.points) {
        const age = (now - pt.t) / fadeMs;
        const alpha = (1 - age) * (1 - age);
        const radius = (pt.sparkle ? 1.4 : 2.4) + (1 - age) * 2.4;
        const r = Math.round(lerp(start.r, end.r, age));
        const g = Math.round(lerp(start.g, end.g, age));
        const b = Math.round(lerp(start.b, end.b, age));

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = pt.sparkle
          ? `rgba(${hexToRgb(PALETTE.cyanGlow).r},${hexToRgb(PALETTE.cyanGlow).g},${hexToRgb(PALETTE.cyanGlow).b},${alpha.toFixed(3)})`
          : `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
        ctx.shadowColor = `rgba(${r},${g},${b},${(alpha * 0.8).toFixed(3)})`;
        ctx.shadowBlur = 5 + (1 - age) * 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      if (Trail.points.length > 0) {
        Trail._rafId = requestAnimationFrame(Trail._draw.bind(Trail));
      } else {
        Trail._rafId = null;
      }
    },

    clear() {
      Trail.points = [];
      if (Trail.ctx) Trail.ctx.clearRect(0, 0, Trail.canvas.width, Trail.canvas.height);
      if (Trail._rafId) {
        cancelAnimationFrame(Trail._rafId);
        Trail._rafId = null;
      }
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
              <line x1="20" y1="82" x2="20" y2="14" />
              <line x1="84" y1="82" x2="84" y2="14" />
              <line x1="20" y1="14" x2="40" y2="6" />
              <line x1="84" y1="14" x2="64" y2="6" />
              <line x1="20" y1="40" x2="84" y2="40" />
              <line x1="20" y1="62" x2="84" y2="62" />
            </g>
          </svg>
          <div class="wikinaut-exhaust"></div>
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
        <button id="wikinaut-settings-button" class="wikinaut-button secondary icon" type="button" title="Console settings" aria-expanded="false">⚙</button>
        <div id="wikinaut-route-card" aria-live="polite">
          <div id="wikinaut-status">Set a destination and chart a course through Wikipedia.</div>
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
            <label class="wikinaut-settings-label" for="wikinaut-ship-color">Ship</label>
            <input type="color" id="wikinaut-ship-color" class="wikinaut-color-input" />
          </div>
          <div class="wikinaut-settings-row">
            <label class="wikinaut-settings-label" for="wikinaut-trail-color">Trail</label>
            <input type="color" id="wikinaut-trail-color" class="wikinaut-color-input" />
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
      routeStrip: root.querySelector('#wikinaut-starmap'),
      freshness: root.querySelector('#wikinaut-freshness'),
      launchpad: root.querySelector('#wikinaut-launchpad'),
      countdown: root.querySelector('#wikinaut-countdown'),
      backendInput: root.querySelector('#wikinaut-backend-input'),
      speedSlider: root.querySelector('#wikinaut-speed-slider'),
      speedValue: root.querySelector('#wikinaut-speed-value'),
      travelerColorInput: root.querySelector('#wikinaut-ship-color'),
      trailColorInput: root.querySelector('#wikinaut-trail-color'),
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
    dom.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        chartCourse();
      }
      if (event.key === 'Escape') closeSuggestions();
    });

    dom.chartButton.addEventListener('click', chartCourse);
    dom.beginButton.addEventListener('click', beginWalk);

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
      Backend.set(dom.backendInput.value);
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

    dom.trailColorInput.addEventListener('input', () => {
      Settings.save({trailColor: dom.trailColorInput.value});
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
    dom.trailColorInput.value = Settings.get('trailColor');
    dom.backendInput.placeholder = CONFIG.apiBaseUrl;
    dom.backendInput.value = Backend.override;
  }

  // ─── UI helpers ─────────────────────────────────────────────────────────────

  function setBusy(isBusy, message) {
    dom.input.disabled = isBusy;
    dom.chartButton.disabled = isBusy;
    if (message) setStatus(message);
  }

  function setStatus(message) {
    dom.status.textContent = message;
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

  function onDestinationInput() {
    runtime.selectedTitle = dom.input.value.trim();
    // Editing abandons any locked destination and charted course (strict gating).
    runtime.selectedPage = null;
    runtime.route = null;
    dom.beginButton.disabled = true;
    updateChartGate();
    clearTimeout(runtime.autocompleteTimer);

    const query = dom.input.value.trim();
    if (query.length < 2) {
      closeSuggestions();
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
        runtime.selectedTitle = title;
        runtime.selectedPage = title;    // a real OpenSearch pick — unlocks Chart Course
        // A fresh destination invalidates any previously charted route.
        runtime.route = null;
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
      const route = await Routing.fetchRoute(sourceTitle, targetTitle);
      runtime.route = route;
      Storage.save({
        active: false,
        currentIndex: 0,
        route,
        targetTitle: route[route.length - 1],
      });
      renderRoute(route, 0);
      const hops = route.length - 1;
      setStatus(`Course locked — ${hops} ${hops === 1 ? 'jump' : 'jumps'}. Ready to launch.`);
      dom.beginButton.disabled = route.length < 2;
      Phase.set(route.length < 2 ? PHASES.IDLE : PHASES.COURSE_READY);
    } catch (error) {
      runtime.route = null;
      Storage.clear();
      dom.beginButton.disabled = true;
      renderRoute([]);
      setStatus(error.message || 'No course found. Try a different destination.');
      Phase.set(PHASES.IDLE);
    } finally {
      setBusy(false);
    }
  }

  // Render the route as a plotted star-chart: waypoints laid out across a 2D chart,
  // joined by a dotted track with a glowing line that "draws on" so charting reads as a
  // course being plotted (not a static reveal). Expands the panel in place.
  function renderRoute(route, currentIndex = -1, nextIndex = currentIndex + 1) {
    const host = dom.routeStrip;
    host.replaceChildren();
    if (!route || !route.length) {
      if (dom.panel) dom.panel.dataset.expanded = 'false';
      return;
    }
    if (dom.panel) dom.panel.dataset.expanded = 'true';

    const W = 320;
    const H = 176;
    const padX = 28;
    const padV = 34;
    const n = route.length;
    const innerW = W - padX * 2;
    const amp = (H - padV * 2) / 2;
    const midY = H / 2;

    const pts = route.map((title, i) => ({
      i,
      title,
      x: n === 1 ? W / 2 : padX + innerW * (i / (n - 1)),
      y: midY + Math.sin(i * 0.9 + 0.6) * amp,
    }));

    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const frac = (v) => v - Math.floor(v);
    let stars = '';
    for (let i = 0; i < 28; i += 1) {
      const sx = frac(Math.sin(i * 12.9898) * 43758.5453) * W;
      const sy = frac(Math.cos(i * 4.1414) * 24634.633) * H;
      const r = i % 6 === 0 ? 1.1 : 0.6;
      stars += `<circle class="wikinaut-chart-star" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${r}" opacity="${(0.25 + (i % 4) * 0.16).toFixed(2)}"></circle>`;
    }

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
      `<g class="wikinaut-chart-grid">` +
      `<circle class="wikinaut-chart-ring" cx="${W / 2}" cy="${midY}" r="${midY - 6}"></circle>` +
      `<circle class="wikinaut-chart-ring" cx="${W / 2}" cy="${midY}" r="${midY - 28}"></circle>` +
      `<line x1="0" y1="${midY}" x2="${W}" y2="${midY}"></line>` +
      `<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}"></line>` +
      `</g>${stars}` +
      `<path id="wikinaut-route-track" d="${d}"></path>` +
      `<path id="wikinaut-route-path" d="${d}"></path>${waypoints}</svg>`;

    // "Plot" the glowing course line by drawing it on with stroke-dashoffset.
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
  }

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

    Storage.save({
      active: true,
      currentIndex,
      route,
      targetTitle: route[route.length - 1],
    });
    dom.beginButton.disabled = true;

    // The launch sequence (countdown + gantry + lift-off) plays only here, on the origin
    // page. resume() then continues the flight; the first hop skips the dock-exit because
    // the ship is already airborne off the panel top.
    await LaunchSequence.play();
    runtime.justLaunched = true;
    await Traversal.resume();
  }

  // ─── Routing ─────────────────────────────────────────────────────────────────

  const Routing = {
    async fetchRoute(sourceTitle, targetTitle) {
      let data;
      try {
        data = await requestJson(`${Backend.url}/paths`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({source: sourceTitle, target: targetTitle}),
        });
      } catch (err) {
        if (err.message.includes('Request failed')) {
          throw new Error(
            `Couldn't reach the navigation backend (${err.message}). ` +
              `Check your connection, or set a Backend URL in settings.`,
          );
        }
        throw err;
      }

      if (!data.paths || !data.paths.length) {
        throw new Error(
          `No course found between "${sourceTitle}" and "${targetTitle}". ` +
            `One of these articles may not be in the graph yet, ` +
            `or there's simply no Wikipedia link path between them.`,
        );
      }

      const firstPath = data.paths[0];
      const route = firstPath.map((pageId) => {
        const page = data.pages?.[String(pageId)];
        if (!page?.title) {
          throw new Error('The course response was missing a page title. Please try again.');
        }
        return page.title;
      });

      if (route.length < 2) {
        throw new Error('That course is too short to fly — try a more distant destination.');
      }

      return route;
    },

    async fetchGraphMeta() {
      const data = await requestJson(`${Backend.url}/ok`);
      const ts = data?.timestamp ?? data?.built_at ?? data?.date ?? data?.updated;
      if (!ts) return null;
      const date = new Date(ts);
      return isNaN(date.getTime()) ? null : date;
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

    toUrlTitle(title) {
      return title.trim().replace(/\s+/g, '_');
    },

    canonical(title) {
      return safeDecode(String(title || ''))
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

    fromLink(link) {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('/wiki/')) return '';
      const title = href.split('#')[0].split('?')[0].replace(/^\/wiki\//, '');
      return safeDecode(title).replace(/_/g, ' ');
    },
  };

  // ─── Storage (route state) ───────────────────────────────────────────────────

  const Storage = {
    load() {
      try {
        const raw = sessionStorage.getItem(CONFIG.routeStorageKey);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },

    save(state) {
      sessionStorage.setItem(CONFIG.routeStorageKey, JSON.stringify(state));
    },

    clear() {
      sessionStorage.removeItem(CONFIG.routeStorageKey);
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
      // tones come from <defs> gradients; .wikinaut-ship-core / .wikinaut-ship-thruster
      // stay so the pose keyframes still drive the engine.
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
          </defs>
          <g class="wikinaut-ship-body">
            <polygon class="wikinaut-ship-thruster" points="11,33 11,39 -4,36"></polygon>
            <polygon class="wikinaut-ship-wing" points="48,31 24,31 14,14"></polygon>
            <polygon class="wikinaut-ship-wing" points="48,41 24,41 14,58"></polygon>
            <polygon class="wikinaut-ship-wing" points="20,31 13,22 18,31"></polygon>
            <polygon class="wikinaut-ship-wing" points="20,41 13,50 18,41"></polygon>
            <path class="wikinaut-ship-hull" d="M66 36 L52 32 L38 30 L20 31 L11 33 L11 39 L20 41 L38 42 L52 40 Z"></path>
            <polygon class="wikinaut-ship-canopy" points="56,36 49,32 43,36 49,40"></polygon>
            <path class="wikinaut-ship-line" d="M20 36 H60"></path>
            <path class="wikinaut-ship-line" d="M38 31 V41 M28 31 V41"></path>
            <circle class="wikinaut-ship-core" cx="13" cy="36" r="2.6"></circle>
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
  const LaunchSequence = {
    async play() {
      const reduce = prefersReducedMotion();

      // Render the ship above everything in the panel's launch bay (top-center), nose up.
      // The ship is otherwise hidden — it only exists from launch until arrival.
      JourneyPortal.activate();
      Phase.set(PHASES.COUNTDOWN);
      Trail.clear();

      const pad = LaunchSequence.padPosition();
      Figure.show();
      runtime.figureAngle = -90;          // nose up
      Figure.moveTo(pad.x, pad.y);
      Figure.pose('idle');

      // Gantry rails rise + bay doors part.
      dom.panel.dataset.launch = 'arming';
      await sleep(reduce ? 0 : 500);

      // 3 … 2 … 1 …
      for (const n of [3, 2, 1]) {
        setStatus(`Launch in ${n}…`);
        LaunchSequence.showDigit(String(n), reduce);
        await sleep(reduce ? 140 : 760);
      }
      LaunchSequence.hideDigit();

      // Ignition.
      Phase.set(PHASES.LAUNCHING);
      setStatus('Launch!');
      dom.panel.dataset.launch = 'launch';
      Figure.pose('push');

      if (!reduce) {
        dom.root.dataset.shake = 'true';
        window.setTimeout(() => {
          if (dom.root) delete dom.root.dataset.shake;
        }, 1400);
      }

      // Hold on the pad a beat while thrust builds (flame + smoke ignite), then climb
      // hard off the pad — ease-IN so it accelerates like a rocket, rising well clear.
      const start = {...runtime.figurePosition};
      const riseY = clamp(start.y - 340, 8, start.y);
      if (reduce) {
        Figure.moveTo(start.x, riseY);
      } else {
        await sleep(200);
        await animate(950, (progress) => {
          const eased = easeInCubic(progress);
          Figure.moveTo(start.x, lerp(start.y, riseY, eased));
          Trail.addPoint(runtime.figurePosition.x, runtime.figurePosition.y);
          JourneyPortal.ensureAbovePanel();
        });
      }

      // Retract the launch rig; the ship is airborne and the flight loop takes over.
      delete dom.panel.dataset.launch;
      Figure.pose('look');
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
      if (!state?.active || !Array.isArray(state.route)) return;

      runtime.isWalking = true;
      Phase.set(PHASES.FLYING);
      JourneyPortal.activate();
      try {
        const currentTitle = Titles.currentPageTitle();
        let currentIndex = Number.isInteger(state.currentIndex) ? state.currentIndex : 0;

        if (!Titles.same(state.route[currentIndex], currentTitle)) {
          const actualIndex = Titles.indexInRoute(state.route, currentTitle);
          if (actualIndex === -1) {
            setStatus('The ship drifted off the plotted course. Chart a fresh course from here.');
            Storage.clear();
            renderRoute([]);
            return;
          }
          currentIndex = actualIndex;
          Storage.save({...state, currentIndex});
        }

        renderRoute(state.route, currentIndex, currentIndex + 1);

        // Drop out of warp where the previous jump entered, so the ship/portal reappear
        // in the same screen spot they left from. Consume the entry once used.
        if (state.entry) {
          await Transition.arrive(state.entry);
          Storage.save({
            active: true,
            currentIndex,
            route: state.route,
            targetTitle: state.route[state.route.length - 1],
          });
        }

        if (currentIndex >= state.route.length - 1) {
          await Traversal.arrive(state.route);
          return;
        }

        const nextTitle = state.route[currentIndex + 1];
        setStatus(`Scanning for ${nextTitle}…`);
        const link = Links.locate(nextTitle);

        if (!link) {
          // The DOM scan couldn't surface the link (collapsed/lazy section, a redirect
          // alias the title text can't match, or the live page genuinely diverged from
          // the graph). The graph says this jump exists, so don't dead-end — navigate
          // straight to the canonical article and let the next page resume the flight.
          // (CLAUDE.md: always provide a fallback to direct-by-URL navigation.)
          setStatus(`Link to "${nextTitle}" isn't visible here — jumping by coordinates…`);
          await Traversal.jumpByUrl(nextTitle, currentIndex + 1, state.route);
          return;
        }

        // Every hop flies straight to the link. On the launch page the ship is already
        // airborne off the pad; on later pages it has just dropped out of warp at the
        // entry position (Transition arrival) — either way, no dock to leave.
        runtime.justLaunched = false;
        await Traversal.cruiseToLink(link);
        setStatus(`Target acquired: ${nextTitle}. Charging jump drive.`);
        await Traversal.walkToLink(link);
        await Transition.tearThrough({
          link,
          nextTitle,
          route: state.route,
          nextIndex: currentIndex + 1,
        });
      } catch (error) {
        console.error('[Wikinaut]', error);
        setStatus(error.message || 'The ship hit unexpected turbulence. Try again.');
        showToast('Something went sideways. You can try again or chart a new course.');
        Storage.save({
          active: false,
          currentIndex: Number.isInteger(state?.currentIndex) ? state.currentIndex : 0,
          route: state?.route ?? [],
          targetTitle: state?.route?.[state.route.length - 1] ?? '',
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

    // Fly the ship to the link along a banked arc while the page parallax-drifts under it
    // (different easing + slight lag), so off-screen targets glide into view without the
    // ship and page sliding in lockstep.
    async cruiseToLink(link) {
      const speed = Settings.get('walkingPixelsPerSecond');

      // Document-space anchor for the link center survives scrolling.
      const rect = link.getBoundingClientRect();
      const linkCenterX = rect.left + rect.width / 2;
      const linkDocCenterY = rect.top + window.scrollY + rect.height / 2;

      // Comfort band: where on screen the link should settle — below the masthead and
      // well clear of the console panel, so it's decidedly visible for the jump.
      const bandTop = 110;
      const bandBottom = Math.max(bandTop + 60, panelObstacleRect().top - 100);
      const desiredViewportY = clamp(linkDocCenterY - window.scrollY, bandTop, bandBottom);

      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const startScroll = window.scrollY;
      const desiredScrollY = clamp(linkDocCenterY - desiredViewportY, 0, maxScroll);
      const scrollDelta = desiredScrollY - startScroll;
      // Where the link actually lands once scroll is clamped to page bounds.
      const finalViewportY = linkDocCenterY - desiredScrollY;

      const targetX = clamp(linkCenterX - CONFIG.figureSize / 2, 8, window.innerWidth - CONFIG.figureSize - 8);
      const targetY = clamp(finalViewportY - CONFIG.figureSize / 2, 8, window.innerHeight - CONFIG.figureSize - 8);

      const start = {...runtime.figurePosition};
      Figure.show();
      Figure.pose('walking');

      if (prefersReducedMotion()) {
        if (scrollDelta) window.scrollTo(0, desiredScrollY);
        Figure.headToward(start.x, start.y, targetX, targetY);
        Figure.moveTo(targetX, targetY);
        Figure.pose('look');
        return;
      }

      // Flight path = a quadratic bézier that bows off the straight line so the ship
      // sweeps a banked arc. The control point sits at the midpoint pushed perpendicular
      // to the chord (always bowing "upward", away from the console), magnitude ∝ span.
      const dx = targetX - start.x;
      const dy = targetY - start.y;
      const span = Math.hypot(dx, dy) || 1;
      let perpX = -dy / span;
      let perpY = dx / span;
      if (perpY > 0) {
        perpX = -perpX;
        perpY = -perpY; // keep the bow pointing up
      }
      const bow = Math.min(span * 0.32, 200);
      const ctrlX = (start.x + targetX) / 2 + perpX * bow;
      const ctrlY = (start.y + targetY) / 2 + perpY * bow;

      // Pace by the arc's (approx) length so longer sweeps don't feel rushed.
      const arcPx = Math.max(span + bow * 0.6, Math.abs(scrollDelta) * 0.65, 1);
      const duration = clamp((arcPx / speed) * 1000, CONFIG.minWalkDurationMs, CONFIG.maxWalkDurationMs * 1.5);

      let prevX = start.x;
      let prevY = start.y;
      await animate(duration, (progress) => {
        const eased = easeInOutCubic(progress);
        // The page drifts under the ship on a *different* curve (and slightly lagged), so
        // it reads as parallax — the world sliding past — rather than tracking 1:1.
        if (scrollDelta) {
          const scrollEase = easeOutQuad(clamp((progress - 0.08) / 0.92, 0, 1));
          window.scrollTo(0, startScroll + scrollDelta * scrollEase);
        }
        const fx = quadBezier(eased, start.x, ctrlX, targetX);
        const fy = quadBezier(eased, start.y, ctrlY, targetY);
        // Bank to the path's heading (the bézier tangent ≈ frame-to-frame delta).
        Figure.headToward(prevX, prevY, fx, fy);
        Figure.moveTo(fx, fy);
        Trail.addPoint(fx, fy);
        JourneyPortal.ensureAbovePanel();
        prevX = fx;
        prevY = fy;
      });

      Figure.moveTo(targetX, targetY);
      Figure.pose('look');
    },

    async walkToLink(link) {
      // The cruise already set the ship down on the link; re-snap (in case the page
      // shifted), settle, and charge the jump drive.
      const target = Figure.targetAtLink(link);
      LinkFx.spawnReticle(link.getBoundingClientRect());  // lock onto the target link
      Figure.moveTo(target.x, target.y);
      LinkFx.landingBurst(target.slitX, target.slitY);    // burst at the link, where the ship touches down
      await sleep(220);
      Trail.clear();
      Figure.pose('grab');
      await sleep(380);
    },

    // Fallback when the link can't be found in the live DOM: persist the advanced route
    // (and the ship's current screen position, so the next page can drop it out of warp
    // in the same spot) and navigate straight to the canonical article.
    async jumpByUrl(nextTitle, nextIndex, route) {
      Storage.save({
        active: true,
        currentIndex: nextIndex,
        route,
        targetTitle: route[route.length - 1],
        entry: Traversal.shipEntry(),
      });
      await sleep(prefersReducedMotion() ? 0 : 480);
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
    locate(title) {
      const candidates = Links.candidates(title);
      if (!candidates.length) return null;

      const best = Links.bestVisible(candidates);
      if (best && Links.visibilityScore(best) > 0.7) return best;

      return Links.nearestBelowViewport(candidates) || Links.nearestToViewport(candidates);
    },

    async waitUntilVisible(link, timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline) {
        if (Links.visibilityScore(link) > 0.7) return;
        await sleep(60);
      }
    },

    candidates(title) {
      const root =
        document.querySelector(SELECTORS.articleBody) ||
        document.querySelector(SELECTORS.contentRoot) ||
        document.body;
      return [...root.querySelectorAll('a[href^="/wiki/"]')]
        .filter((link) => Links.isArticleLink(link))
        .filter((link) => Links.matchesTitle(link, title));
    },

    // The graph counts ALL namespace-0 links — including those in infoboxes, sidebars,
    // and bottom navboxes — so match against both the href title and the link's `title`
    // attribute (the latter catches odd encodings the href parse would miss).
    matchesTitle(link, title) {
      if (Titles.same(Titles.fromLink(link), title)) return true;
      const titleAttr = link.getAttribute('title');
      return Boolean(titleAttr) && Titles.same(titleAttr, title);
    },

    isArticleLink(link) {
      const href = link.getAttribute('href') || '';
      const title = href.split('#')[0].split('?')[0].replace(/^\/wiki\//, '');
      if (!title || title.includes(':')) return false;
      // Only skip edit-section and citation-reference machinery. Navboxes, sidebars, and
      // infoboxes ARE counted by the graph, so they must stay searchable.
      if (link.closest('.mw-editsection, .reference, .reflist')) return false;
      // Allow off-viewport links; only exclude truly hidden elements.
      const style = window.getComputedStyle(link);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return true;
    },

    bestVisible(links) {
      let best = null;
      let bestScore = -Infinity;
      for (const link of links) {
        const score = Links.visibilityScore(link) * 1000 - Links.distanceFromFigure(link);
        if (score > bestScore) {
          best = link;
          bestScore = score;
        }
      }
      return best;
    },

    visibilityScore(link) {
      const rect = link.getBoundingClientRect();
      const visW = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const visH = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      return (visW * visH) / Math.max(rect.width * rect.height, 1);
    },

    distanceFromFigure(link) {
      const rect = link.getBoundingClientRect();
      return Math.hypot(
        rect.left + rect.width / 2 - runtime.figurePosition.x,
        rect.top + rect.height / 2 - runtime.figurePosition.y,
      );
    },

    nearestToViewport(links) {
      const cy = window.innerHeight / 2;
      return links
        .map((link) => ({link, d: Math.abs(link.getBoundingClientRect().top - cy)}))
        .sort((a, b) => a.d - b.d)[0].link;
    },

    nearestBelowViewport(links) {
      const threshold = panelObstacleRect().top;
      const below = links
        .filter((link) => link.getBoundingClientRect().top > threshold - 40)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      return below[0] || null;
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
      const burst = document.createElement('div');
      burst.className = 'wikinaut-landing-burst';
      burst.style.left = `${Math.round(centerX)}px`;
      burst.style.top = `${Math.round(centerY)}px`;
      dom.ripLayer.append(burst);
      burst.addEventListener('animationend', () => burst.remove(), {once: true});
      window.setTimeout(() => burst.remove(), 900);
    },
  };

  // ─── Transition (hyperspace jump) ──────────────────────────────────────────────

  const Transition = {
    async tearThrough({link, nextTitle, route, nextIndex}) {
      // Make the link unmistakably visible (scroll it into the clear band + fade the panel
      // so it can never block it), then charge and jump to lightspeed.
      await Transition.ensureInView(link);

      let rect = link.getBoundingClientRect();
      const anchor = Transition.anchorFromLink(link, rect);
      Figure.faceToward(anchor.slitX);
      Figure.pose('tug');
      await sleep(prefersReducedMotion() ? 0 : 320);

      rect = link.getBoundingClientRect();
      Object.assign(anchor, Transition.anchorFromLink(link, rect));
      setStatus(`Jumping to ${nextTitle}…`);
      LinkFx.clearReticle();

      if (!prefersReducedMotion()) {
        // Lightspeed: streaks rip outward from the link, the ship snaps onto the jump
        // point, stretches along its heading and vanishes to a point.
        Transition.renderHyperspace(anchor, 'depart');
        Figure.moveTo(anchor.slitX - CONFIG.figureSize / 2, anchor.slitY - CONFIG.figureSize / 2);
        Figure.pose('warp');
        await sleep(CONFIG.jumpDurationMs * 0.72);
        Figure.hide();
        await sleep(110);
      }

      Transition.commit(route, nextIndex, anchor);
      link.click();
    },

    // Persist the advanced route AND the jump point (viewport coords + heading) so the
    // next page can drop the ship out of warp in the very same screen spot.
    commit(route, nextIndex, anchor) {
      Storage.save({
        active: true,
        currentIndex: nextIndex,
        route,
        targetTitle: route[route.length - 1],
        entry: {
          x: anchor.slitX - CONFIG.figureSize / 2,
          y: anchor.slitY - CONFIG.figureSize / 2,
          angle: runtime.figureAngle,
        },
      });
    },

    // Scroll the link into the upper-middle band (well clear of the panel) and fade the
    // console, so the target is decidedly in view for the jump.
    async ensureInView(link) {
      if (dom.panel) dom.panel.dataset.jumping = 'true';
      const margin = 120;
      const rect = link.getBoundingClientRect();
      const panelTop = panelObstacleRect().top;
      const clear = rect.top >= margin && rect.bottom <= panelTop - margin;
      if (clear) return;

      const docCenterY = rect.top + window.scrollY + rect.height / 2;
      const bandLo = margin + 40;
      const bandHi = Math.max(bandLo + 60, panelTop - margin);
      const targetViewportY = clamp(docCenterY - window.scrollY, bandLo, bandHi);
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const desired = clamp(docCenterY - targetViewportY, 0, maxScroll);
      window.scrollTo({top: desired, behavior: prefersReducedMotion() ? 'auto' : 'smooth'});
      await Links.waitUntilVisible(link, 1400);
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

      const warp = document.createElement('div');
      warp.className = 'wikinaut-warp';
      warp.dataset.mode = mode;
      const streakCount = 40;
      for (let i = 0; i < streakCount; i += 1) {
        const streak = document.createElement('div');
        streak.className = 'wikinaut-warp-streak';
        const angle = (360 / streakCount) * i + (Math.random() * 8 - 4);
        streak.style.transform = `rotate(${angle}deg)`;
        streak.style.animationDelay = `${Math.random() * 140}ms`;
        warp.append(streak);
      }

      const flash = document.createElement('div');
      flash.className = 'wikinaut-flash';
      flash.dataset.mode = mode;

      dom.ripLayer.append(warp);
      dom.ripLayer.append(flash);
    },
  };

  // ─── Network helpers ─────────────────────────────────────────────────────────

  function requestJson(url, options = {}) {
    return requestText(url, options).then((text) => {
      const data = JSON.parse(text);
      if (data?.error) {
        // MediaWiki errors are objects ({code, info}); surface a readable message.
        const err = data.error;
        throw new Error(err.info || err.code || (typeof err === 'string' ? err : JSON.stringify(err)));
      }
      return data;
    });
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
              reject(new Error(`Request failed (${response.status})`));
            }
          },
          ontimeout() {
            reject(new Error('Request timed out.'));
          },
          onerror() {
            reject(new Error('Network request failed.'));
          },
        });
      });
    }

    return fetch(url, options).then(async (response) => {
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      return response.text();
    });
  }

  // ─── Animation helpers ───────────────────────────────────────────────────────

  function animate(duration, onFrame) {
    return new Promise((resolve) => {
      const start = performance.now();
      function tick(now) {
        const progress = clamp((now - start) / duration, 0, 1);
        onFrame(progress);
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(tick);
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

  function easeInOutCubic(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  function easeInCubic(value) {
    return value * value * value;
  }

  function easeOutQuad(value) {
    return 1 - (1 - value) * (1 - value);
  }

  // Quadratic bézier on one axis: p0 → (control) p1 → p2.
  function quadBezier(t, p0, p1, p2) {
    const inv = 1 - t;
    return inv * inv * p0 + 2 * inv * t * p1 + t * t * p2;
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
      dom.input.value = state.targetTitle || state.route[state.route.length - 1] || '';
      // A saved course counts as a locked destination so Chart stays usable on reload.
      runtime.selectedPage = dom.input.value || null;
      renderRoute(state.route, state.currentIndex || 0, (state.currentIndex || 0) + 1);
      if (state.active) {
        setStatus('Resuming course — picking up where the ship left off…');
        window.setTimeout(() => Traversal.resume(), 420);
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
