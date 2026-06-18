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
   * - scrollTimeoutMs: max ms to poll for a link to scroll into view.
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
    jumpDurationMs: 2600,
    chargeDurationMs: 620,
    hopDurationMs: 640,
    autocompleteLimit: 6,
    autocompleteDebounceMs: 180,
    routeSketchMs: 900,
    trailFadeMs: 1100,
    scrollTimeoutMs: 4000,
    panelReservePx: 120,
    pushScrollStepPx: 90,
    scanDurationMs: 900,
    dockExitDurationMs: 520,
    dockWidth: 76,
    dockHeight: 84,
    figureHandOffsetX: 0.72,
    figureHandOffsetY: 0.58,
    journeyPortalZ: 2147483646,
  };

  // Palette (retro-futuristic wireframe). Colors mirror the design spec.
  const PALETTE = {
    bg: '#0A0F1C',
    cyan: '#00F3FF',
    cyanCore: '#66FFFF',
    cyanGlow: '#A0FFFF',
    blue: '#1E90FF',
    dimWhite: '#CCCCCC',
    purple: '#BD93F9',
    flash: '#E0FFFF',
    streakA: '#FF00FF',
    streakB: '#C715DB',
    amber: '#FFB84C',
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

    #wikinaut-starmap {
      display: flex;
      align-items: center;
      gap: 0;
      flex-wrap: nowrap;
      overflow-x: auto;
      padding: 6px 2px 4px;
      scrollbar-width: thin;
    }
    #wikinaut-starmap::-webkit-scrollbar { height: 5px; }
    #wikinaut-starmap::-webkit-scrollbar-thumb { background: rgba(0,243,255,0.35); border-radius: 3px; }

    .wikinaut-star-node {
      display: flex;
      align-items: center;
      gap: 6px;
      opacity: 0;
      animation: wikinaut-trace 380ms cubic-bezier(.2,.8,.2,1) forwards;
      flex: 0 0 auto;
    }
    .wikinaut-star-link {
      width: 28px;
      height: 1px;
      background: linear-gradient(90deg, rgba(0,243,255,0.2), rgba(0,243,255,0.7));
      flex: 0 0 auto;
    }
    .wikinaut-star-dot {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border: 1px solid rgba(0,243,255,0.45);
      border-radius: 999px;
      background: rgba(0,243,255,0.05);
      color: var(--wn-dim);
      font-family: 'Rajdhani', sans-serif;
      font-size: 12px;
      letter-spacing: 0.3px;
      white-space: nowrap;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wikinaut-star-dot::before {
      content: '';
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--wn-dim);
      box-shadow: 0 0 5px rgba(204,204,204,0.6);
      flex: 0 0 auto;
    }
    .wikinaut-star-node.current .wikinaut-star-dot {
      border-color: var(--wn-cyan);
      color: var(--wn-cyan-glow);
      box-shadow: 0 0 12px rgba(0,243,255,0.45);
    }
    .wikinaut-star-node.current .wikinaut-star-dot::before {
      background: var(--wn-cyan);
      box-shadow: 0 0 8px var(--wn-cyan);
    }
    .wikinaut-star-node.next .wikinaut-star-dot {
      border-color: var(--wn-purple);
      color: #e9ddff;
    }
    .wikinaut-star-node.next .wikinaut-star-dot::before {
      background: var(--wn-purple);
      box-shadow: 0 0 8px var(--wn-purple);
    }

    @keyframes wikinaut-trace {
      from { opacity: 0; transform: translateX(-6px); }
      to   { opacity: 1; transform: translateX(0); }
    }

    #wikinaut-freshness {
      margin-top: 5px;
      font-family: 'Orbitron', sans-serif;
      font-size: 9px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: rgba(0,243,255,0.55);
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

    /* ── Docking bay (idle ship home) ──────────────────────────────────── */

    #wikinaut-dock {
      position: fixed;
      z-index: 2147483002;
      width: ${CONFIG.dockWidth}px;
      height: ${CONFIG.dockHeight}px;
      pointer-events: none;
    }
    .wikinaut-dock-svg { width: 100%; height: 100%; overflow: visible; }
    .wikinaut-dock-line { fill: none; stroke: rgba(0,243,255,0.55); stroke-width: 1.4; }
    .wikinaut-dock-bay {
      position: absolute;
      left: 18%;
      top: 28%;
      width: 64%;
      height: 44%;
    }
    .wikinaut-dock-door {
      position: absolute;
      left: 18%;
      bottom: 8%;
      width: 64%;
      height: 8%;
      background: rgba(0,243,255,0.25);
      transform-origin: top center;
      transition: transform ${CONFIG.dockExitDurationMs}ms ease;
    }
    #wikinaut-dock[data-door-open="true"] .wikinaut-dock-door { transform: scaleY(0.1); }

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
    #wikinaut-ship-shell[data-in-house="true"] { opacity: 0.9; }
    #wikinaut-ship-shell svg { width: 100%; height: 100%; overflow: visible; }
    #wikinaut-ship-shell[data-facing="left"] svg { transform: scaleX(-1); }

    .wikinaut-ship-line {
      fill: none;
      stroke: var(--wn-ship-color, ${PALETTE.cyan});
      stroke-width: 1.8;
      stroke-linejoin: round;
      stroke-linecap: round;
      filter: drop-shadow(0 0 3px rgba(0,243,255,0.7));
    }
    .wikinaut-ship-hull { fill: rgba(0,243,255,0.08); }
    .wikinaut-ship-core {
      fill: ${PALETTE.cyanCore};
      filter: drop-shadow(0 0 5px ${PALETTE.cyanCore});
    }
    .wikinaut-ship-thruster {
      stroke: ${PALETTE.cyanGlow};
      opacity: 0;
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

    #wikinaut-ship-shell[data-pose="hop"] {
      animation: wikinaut-hop ${CONFIG.hopDurationMs}ms cubic-bezier(.5,0,.6,1) forwards;
    }

    @keyframes wikinaut-hover { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
    @keyframes wikinaut-thrust { from { opacity: 0.3; } to { opacity: 1; } }
    @keyframes wikinaut-scan { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
    @keyframes wikinaut-charge { from { filter: drop-shadow(0 0 4px ${PALETTE.cyanCore}); } to { filter: drop-shadow(0 0 12px ${PALETTE.flash}); } }
    @keyframes wikinaut-orbit { from { transform: rotate(0); } to { transform: rotate(360deg); } }
    @keyframes wikinaut-hop {
      from { transform: translate3d(var(--wn-hop-start-x), var(--wn-hop-start-y), 0) scale(1); opacity: 1; }
      to   { transform: translate3d(var(--wn-hop-x), var(--wn-hop-y), 0) scale(0.2); opacity: 0; }
    }

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

    .wikinaut-warp {
      position: absolute;
      left: var(--wn-slit-x, 50%);
      top: var(--wn-slit-y, 50%);
      width: 4px;
      height: 4px;
      transform: translate(-50%, -50%);
    }
    .wikinaut-warp-streak {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 2px;
      height: 2px;
      transform-origin: 0 0;
      background: linear-gradient(90deg, ${PALETTE.cyan}, ${PALETTE.streakA}, transparent);
      box-shadow: 0 0 6px ${PALETTE.streakB};
      animation: wikinaut-streak ${CONFIG.jumpDurationMs}ms cubic-bezier(.5,0,.85,.5) forwards;
    }
    @keyframes wikinaut-streak {
      0%   { width: 2px; opacity: 0; }
      15%  { opacity: 1; }
      100% { width: 180vmax; opacity: 0; }
    }
    .wikinaut-flash {
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at var(--wn-slit-x, 50%) var(--wn-slit-y, 50%), ${PALETTE.flash}, rgba(199,21,219,0.4) 35%, transparent 72%);
      opacity: 0;
      animation: wikinaut-flash ${CONFIG.jumpDurationMs}ms ease-in forwards;
    }
    @keyframes wikinaut-flash {
      0%   { opacity: 0; }
      55%  { opacity: 0.15; }
      85%  { opacity: 0.95; }
      100% { opacity: 1; }
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
    route: null,
    selectedTitle: '',
    isWalking: false,
    figurePosition: {x: 0, y: 0},
    inHouse: true,
    autocompleteTimer: 0,
    autocompleteAbortId: 0,
    settingsOpen: false,
    houseDocked: 'above',
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
      <div id="wikinaut-dock" aria-hidden="true">
        <svg class="wikinaut-dock-svg" viewBox="0 0 76 84" aria-hidden="true">
          <path class="wikinaut-dock-line" d="M6 30 L38 8 L70 30 L70 78 L6 78 Z"/>
          <path class="wikinaut-dock-line" d="M14 30 H62 M14 44 H62"/>
        </svg>
        <div class="wikinaut-dock-bay" id="wikinaut-dock-bay"></div>
        <div class="wikinaut-dock-door" id="wikinaut-dock-door"></div>
      </div>
      <div id="wikinaut-ship-shell" data-visible="false" data-pose="idle" data-facing="right" data-in-house="true" aria-hidden="true">
        ${Figure.renderSvg()}
      </div>
      <section id="wikinaut-panel" aria-label="Wikinaut navigation console">
        <label class="wikinaut-field">
          <span class="wikinaut-label">Set coordinates</span>
          <input id="wikinaut-target-input" type="text" autocomplete="off" placeholder="Destination article — Philosophy, Cat, Moon…" />
          <div id="wikinaut-suggestions" role="listbox" aria-label="Wikipedia article suggestions"></div>
        </label>
        <button id="wikinaut-chart-button" class="wikinaut-button" type="button">Chart Course</button>
        <button id="wikinaut-begin-button" class="wikinaut-button secondary" type="button" disabled>Launch</button>
        <button id="wikinaut-settings-button" class="wikinaut-button secondary icon" type="button" title="Console settings" aria-expanded="false">⚙</button>
        <div id="wikinaut-route-card" aria-live="polite">
          <div id="wikinaut-status">Set a destination and chart a course through Wikipedia.</div>
          <div id="wikinaut-starmap"></div>
          <div id="wikinaut-freshness"></div>
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
      house: root.querySelector('#wikinaut-dock'),
      houseWindow: root.querySelector('#wikinaut-dock-bay'),
      houseDoor: root.querySelector('#wikinaut-dock-door'),
      figure: root.querySelector('#wikinaut-ship-shell'),
      ripLayer: root.querySelector('#wikinaut-jump-layer'),
      input: root.querySelector('#wikinaut-target-input'),
      suggestions: root.querySelector('#wikinaut-suggestions'),
      chartButton: root.querySelector('#wikinaut-chart-button'),
      beginButton: root.querySelector('#wikinaut-begin-button'),
      settingsButton: root.querySelector('#wikinaut-settings-button'),
      settingsSection: root.querySelector('#wikinaut-settings-section'),
      status: root.querySelector('#wikinaut-status'),
      routeStrip: root.querySelector('#wikinaut-starmap'),
      freshness: root.querySelector('#wikinaut-freshness'),
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
    House.anchorToPanel();
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
      House.anchorToPanel();
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

    window.addEventListener(
      'resize',
      () => {
        if (runtime.inHouse) House.anchorToPanel();
      },
      {passive: true},
    );
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
    dom.beginButton.disabled = true;
    runtime.route = null;
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

  async function fetchSuggestions(query) {
    const requestId = ++runtime.autocompleteAbortId;
    try {
      const results = await Routing.autocomplete(query);
      if (requestId !== runtime.autocompleteAbortId) return;
      renderSuggestions(results);
    } catch {
      if (requestId === runtime.autocompleteAbortId) closeSuggestions();
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
      button.addEventListener('click', () => {
        dom.input.value = title;
        runtime.selectedTitle = title;
        closeSuggestions();
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

    if (!targetTitle) {
      showToast('Set a destination article first.');
      dom.input.focus();
      return;
    }

    if (Titles.same(sourceTitle, targetTitle)) {
      renderRoute([sourceTitle], 0);
      setStatus('You are already at your destination. Holding orbit.');
      await House.enter('victory');
      dom.beginButton.disabled = true;
      return;
    }

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
      await House.enter('idle');
    } catch (error) {
      runtime.route = null;
      Storage.clear();
      dom.beginButton.disabled = true;
      renderRoute([]);
      setStatus(error.message || 'No course found. Try a different destination.');
      await House.enter('idle');
    } finally {
      setBusy(false);
    }
  }

  function renderRoute(route, currentIndex = -1, nextIndex = currentIndex + 1) {
    dom.routeStrip.replaceChildren();
    if (!route || !route.length) return;

    route.forEach((title, index) => {
      const node = document.createElement('span');
      node.className = 'wikinaut-star-node';
      if (index === currentIndex) node.classList.add('current');
      if (index === nextIndex) node.classList.add('next');
      node.style.animationDelay = `${Math.min(index * 90, CONFIG.routeSketchMs)}ms`;

      if (index > 0) {
        const link = document.createElement('span');
        link.className = 'wikinaut-star-link';
        node.append(link);
      }

      const dot = document.createElement('span');
      dot.className = 'wikinaut-star-dot';
      dot.textContent = title;
      dot.title = title;
      node.append(dot);

      dom.routeStrip.append(node);
    });
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
      const params = new URLSearchParams({
        action: 'opensearch',
        search: query,
        limit: String(CONFIG.autocompleteLimit),
        namespace: '0',
        format: 'json',
        origin: '*',
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
      const title = href.split('#')[0].replace(/^\/wiki\//, '');
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

  const House = {
    anchorToPanel() {
      if (!dom.house || !dom.panel) return;
      const panelRect = dom.panel.getBoundingClientRect();
      const houseW = CONFIG.dockWidth;
      const houseH = CONFIG.dockHeight;
      const gap = 8;
      let left;
      let top;
      let docked = 'above';

      if (window.innerWidth <= 640) {
        left = panelRect.left;
        top = panelRect.top - houseH - 6;
      } else {
        const idealLeft = panelRect.left - houseW - gap;
        if (idealLeft >= 8 && idealLeft + houseW <= panelRect.left - 4) {
          left = idealLeft;
          top = panelRect.top + (panelRect.height - houseH) / 2;
          docked = 'left';
        } else {
          left = panelRect.left;
          top = panelRect.top - houseH - 6;
        }
      }

      runtime.houseDocked = docked;
      dom.panel.dataset.houseDocked = docked === 'left' ? 'left' : 'false';
      dom.house.style.left = `${Math.round(left)}px`;
      dom.house.style.top = `${Math.round(top)}px`;
      if (runtime.inHouse) {
        const home = House.figureHomePosition();
        Figure.moveTo(home.x, home.y);
      }
    },

    figureHomePosition() {
      const windowRect = dom.houseWindow.getBoundingClientRect();
      return {
        x: windowRect.left + windowRect.width / 2 - CONFIG.figureSize / 2,
        y: windowRect.top + windowRect.height * 0.5 - CONFIG.figureSize / 2,
      };
    },

    exitPosition() {
      const houseRect = dom.house.getBoundingClientRect();
      return {
        x: houseRect.right + 6,
        y: houseRect.top + 28,
      };
    },

    async enter(pose = 'idle') {
      House.anchorToPanel();
      runtime.inHouse = true;
      dom.house.dataset.doorOpen = 'false';
      dom.figure.dataset.inHouse = 'true';
      const home = House.figureHomePosition();
      Figure.show();
      Figure.moveTo(home.x, home.y);
      Figure.pose(pose);
    },

    async lookOut(durationMs = CONFIG.scanDurationMs) {
      if (!runtime.inHouse) await House.enter();
      Figure.pose('look-out');
      await sleep(durationMs);
    },

    async exit() {
      if (!runtime.inHouse) return;
      dom.house.dataset.doorOpen = 'true';
      await sleep(CONFIG.dockExitDurationMs * 0.35);
      dom.figure.dataset.inHouse = 'false';
      const exit = House.exitPosition();
      await Figure.walkTo(exit.x, exit.y);
      runtime.inHouse = false;
      dom.house.dataset.doorOpen = 'false';
      Figure.pose('look');
      await sleep(180);
    },
  };

  // ─── Ship (wireframe craft; keeps the Figure API the traversal logic expects) ──

  const Figure = {
    renderSvg() {
      return `
        <svg viewBox="0 0 72 72" role="img" aria-label="Wireframe spacecraft">
          <g class="wikinaut-ship-body">
            <path class="wikinaut-ship-line wikinaut-ship-hull" d="M6 36 L40 16 L66 36 L40 56 Z"></path>
            <path class="wikinaut-ship-line" d="M40 16 L34 36 L40 56"></path>
            <path class="wikinaut-ship-line" d="M40 16 L52 30 M40 56 L52 42"></path>
            <circle class="wikinaut-ship-core" cx="30" cy="36" r="4"></circle>
            <path class="wikinaut-ship-line wikinaut-ship-thruster" d="M6 36 L-2 31 M6 36 L-2 41"></path>
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

    faceToward(targetX) {
      dom.figure.dataset.facing = targetX < runtime.figurePosition.x ? 'left' : 'right';
    },

    moveTo(x, y) {
      runtime.figurePosition = {x, y};
      dom.figure.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    },

    targetAtLink(link) {
      const rect = link.getBoundingClientRect();
      const linkCenterX = rect.left + rect.width / 2;
      const linkCenterY = rect.top + rect.height / 2;
      const facingLeft = linkCenterX < runtime.figurePosition.x;
      const handOffsetX = facingLeft ? 1 - CONFIG.figureHandOffsetX : CONFIG.figureHandOffsetX;
      const targetX = linkCenterX - CONFIG.figureSize * handOffsetX;
      const targetY = linkCenterY - CONFIG.figureSize * CONFIG.figureHandOffsetY;
      const panelTop = panelChromeTop();
      return {
        x: clamp(targetX, 8, window.innerWidth - CONFIG.figureSize - 8),
        y: clamp(targetY, 8, panelTop - CONFIG.figureSize - 12),
        slitX: linkCenterX,
        slitY: linkCenterY,
      };
    },

    async walkTo(x, y) {
      Figure.show();
      Figure.faceToward(x);
      Figure.pose('walking');

      const start = {...runtime.figurePosition};
      const distance = Math.hypot(x - start.x, y - start.y);
      const speed = Settings.get('walkingPixelsPerSecond');
      const duration = clamp(
        (distance / speed) * 1000,
        CONFIG.minWalkDurationMs,
        CONFIG.maxWalkDurationMs,
      );

      await animate(duration, (progress) => {
        const eased = easeInOutCubic(progress);
        const fx = lerp(start.x, x, eased);
        const fy = lerp(start.y, y, eased) + Math.sin(progress * Math.PI * 6) * 1.6;
        Figure.moveTo(fx, fy);
        Trail.addPoint(fx, fy);
      });

      Figure.moveTo(x, y);
      Figure.pose('look');
    },

    async hopInto(slitX, slitY) {
      const facingLeft = slitX < runtime.figurePosition.x;
      const handOffsetX = facingLeft ? 1 - CONFIG.figureHandOffsetX : CONFIG.figureHandOffsetX;
      const hopX = slitX - CONFIG.figureSize * handOffsetX;
      const hopY = slitY - CONFIG.figureSize * CONFIG.figureHandOffsetY;
      const startX = runtime.figurePosition.x;
      const startY = runtime.figurePosition.y;
      dom.figure.style.setProperty('--wn-hop-start-x', `${Math.round(startX)}px`);
      dom.figure.style.setProperty('--wn-hop-start-y', `${Math.round(startY)}px`);
      dom.figure.style.setProperty('--wn-hop-x', `${Math.round(hopX)}px`);
      dom.figure.style.setProperty('--wn-hop-y', `${Math.round(hopY)}px`);
      dom.figure.style.transform = '';
      Figure.faceToward(slitX);
      Figure.pose('hop');
      await sleep(CONFIG.hopDurationMs);
      runtime.figurePosition = {x: hopX, y: hopY};
    },
  };

  // ─── Traversal ───────────────────────────────────────────────────────────────

  const Traversal = {
    async resume() {
      if (runtime.isWalking) return;

      const state = Storage.load();
      if (!state?.active || !Array.isArray(state.route)) return;

      runtime.isWalking = true;
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

        if (currentIndex >= state.route.length - 1) {
          await Traversal.arrive(state.route);
          return;
        }

        const nextTitle = state.route[currentIndex + 1];
        setStatus(`Scanning for ${nextTitle}…`);
        const link = Links.locate(nextTitle);

        if (!link) {
          setStatus(
            `The course says jump to "${nextTitle}", but this article doesn't link there. ` +
              `The live web outpaced the star chart.`,
          );
          showToast(
            `Link to "${nextTitle}" not found on this page. ` +
              `The graph may be outdated for this jump — chart a new course to continue.`,
            6000,
          );
          Storage.save({
            active: false,
            currentIndex,
            route: state.route,
            targetTitle: state.route[state.route.length - 1],
          });
          dom.beginButton.disabled = false;
          await House.enter('idle');
          return;
        }

        await Traversal.departAndReach(link);
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
        dom.beginButton.disabled = false;
        await House.enter('idle');
      } finally {
        JourneyPortal.deactivate();
        runtime.isWalking = false;
      }
    },

    pushZonePosition() {
      const chromeTop = panelChromeTop();
      return {
        x: window.innerWidth / 2 - CONFIG.figureSize / 2,
        y: chromeTop - CONFIG.figureSize - 12,
      };
    },

    async departAndReach(link) {
      await House.lookOut();
      const visible = Links.visibilityScore(link) > 0.7;
      if (visible) {
        setStatus('Target in visual range — undocking.');
      } else {
        setStatus('Target out of range — scrolling the sector into view.');
      }
      await House.exit();
      if (!visible) {
        await Traversal.pushViewportToLink(link);
      }
    },

    async pushViewportToLink(link) {
      const rect = link.getBoundingClientRect();
      const scrollingUp = rect.top < 80;

      if (scrollingUp) {
        const pushPos = {
          x: window.innerWidth / 2 - CONFIG.figureSize / 2,
          y: 72,
        };
        await Figure.walkTo(pushPos.x, pushPos.y);
        Figure.pose('push');
        const deadline = performance.now() + CONFIG.scrollTimeoutMs;
        while (performance.now() < deadline) {
          if (Links.visibilityScore(link) > 0.7) break;
          if (window.scrollY <= 0) break;
          const step = Math.min(CONFIG.pushScrollStepPx, window.scrollY);
          const startScroll = window.scrollY;
          await animate(480, (progress) => {
            window.scrollTo(0, startScroll - step * easeInOutCubic(progress));
            const pushPos = Traversal.pushZonePosition();
            Figure.moveTo(pushPos.x, pushPos.y);
            JourneyPortal.ensureAbovePanel();
          });
          await sleep(60);
        }
        Figure.pose('look');
        return;
      }

      const pushPos = Traversal.pushZonePosition();
      await Figure.walkTo(pushPos.x, pushPos.y);
      Figure.pose('push');

      const deadline = performance.now() + CONFIG.scrollTimeoutMs;
      let strokes = 0;

      while (performance.now() < deadline) {
        if (Links.visibilityScore(link) > 0.7) break;

        const maxScroll =
          document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
        if (maxScroll <= 2) break;

        const step = Math.min(CONFIG.pushScrollStepPx, maxScroll);
        const startScroll = window.scrollY;

        await animate(480, (progress) => {
          const eased = easeInOutCubic(progress);
          window.scrollTo(0, startScroll + step * eased);
          const pushPos = Traversal.pushZonePosition();
          Figure.moveTo(pushPos.x, pushPos.y);
          JourneyPortal.ensureAbovePanel();
        });

        strokes += 1;
        if (strokes > 24) break;
        await sleep(60);
      }

      Figure.pose('look');
      const target = Figure.targetAtLink(link);
      const finalPushPos = Traversal.pushZonePosition();
      if (
        Math.abs(target.slitX - (finalPushPos.x + CONFIG.figureSize * CONFIG.figureHandOffsetX)) > 40
      ) {
        await Figure.walkTo(target.x, finalPushPos.y);
      }
    },

    async walkToLink(link) {
      const target = Figure.targetAtLink(link);
      await Figure.walkTo(target.x, target.y);
      await sleep(320);
      Trail.clear();
      Figure.pose('grab');
      await sleep(400);
    },

    async arrive(route) {
      JourneyPortal.deactivate();
      Storage.clear();
      renderRoute(route, route.length - 1, -1);
      setStatus(`Arrived at ${route[route.length - 1]}. Course complete.`);
      await House.enter('victory');
      dom.beginButton.disabled = true;
      runtime.route = route;
      await sleep(1400);
      await House.enter('idle');
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
        .filter((link) => Titles.same(Titles.fromLink(link), title));
    },

    isArticleLink(link) {
      const href = link.getAttribute('href') || '';
      const title = href.split('#')[0].replace(/^\/wiki\//, '');
      if (!title || title.includes(':')) return false;
      if (
        link.closest(
          '.mw-editsection, .reference, .reflist, .navbox, .metadata, .ambox, .sidebar, .vertical-navbox',
        )
      )
        return false;
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

  // ─── Transition (hyperspace jump) ──────────────────────────────────────────────

  const Transition = {
    async tearThrough({link, nextTitle, route, nextIndex}) {
      const chromeTop = panelChromeTop();
      let rect = link.getBoundingClientRect();
      if (rect.bottom > chromeTop - 24) {
        link.scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'nearest'});
        await Links.waitUntilVisible(link, 1800);
        rect = link.getBoundingClientRect();
      }

      const anchor = Transition.anchorFromLink(link, rect);
      Figure.faceToward(anchor.slitX);
      Figure.pose('tug');
      await sleep(420);

      rect = link.getBoundingClientRect();
      Object.assign(anchor, Transition.anchorFromLink(link, rect));

      Transition.renderHyperspace(anchor);
      await sleep(CONFIG.jumpDurationMs * 0.45);
      Figure.pose('timid');
      setStatus(`Jumping to ${nextTitle}…`);
      await sleep(CONFIG.chargeDurationMs);
      await Figure.hopInto(anchor.entryX, anchor.entryY);
      await sleep(120);

      Storage.save({
        active: true,
        currentIndex: nextIndex,
        route,
        targetTitle: route[route.length - 1],
      });

      link.click();
    },

    anchorFromLink(link, rect) {
      const slitX = rect.left + rect.width / 2;
      const slitY = rect.top + rect.height / 2;
      return {
        slitX,
        slitY,
        entryX: slitX,
        entryY: slitY,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    },

    renderHyperspace(anchor) {
      dom.ripLayer.replaceChildren();
      dom.ripLayer.dataset.open = 'true';
      dom.ripLayer.style.setProperty('--wn-slit-x', `${Math.round(anchor.slitX)}px`);
      dom.ripLayer.style.setProperty('--wn-slit-y', `${Math.round(anchor.slitY)}px`);

      const warp = document.createElement('div');
      warp.className = 'wikinaut-warp';
      const streakCount = 28;
      for (let i = 0; i < streakCount; i += 1) {
        const streak = document.createElement('div');
        streak.className = 'wikinaut-warp-streak';
        const angle = (360 / streakCount) * i + Math.random() * 6;
        streak.style.transform = `rotate(${angle}deg)`;
        streak.style.animationDelay = `${Math.random() * 180}ms`;
        warp.append(streak);
      }

      const flash = document.createElement('div');
      flash.className = 'wikinaut-flash';

      dom.ripLayer.append(warp);
      dom.ripLayer.append(flash);
    },
  };

  // ─── Network helpers ─────────────────────────────────────────────────────────

  function requestJson(url, options = {}) {
    return requestText(url, options).then((text) => {
      const data = JSON.parse(text);
      if (data?.error) throw new Error(data.error);
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

  function lerp(start, end, progress) {
    return start + (end - start) * progress;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function easeInOutCubic(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
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

  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    Settings.load();
    injectStyles();
    createRoot();
    bindEvents();
    Trail.init();
    Settings.applyToDom();
    syncSettingsUI();

    House.anchorToPanel();
    void House.enter('idle');

    JourneyPortal.deactivate();
    dom.ripLayer.dataset.open = 'false';
    dom.ripLayer.replaceChildren();

    // Fetch graph freshness non-blocking; the backend /ok may not return a build date.
    Routing.fetchGraphMeta().then(setFreshness).catch(() => {});

    const state = Storage.load();
    if (state?.route?.length) {
      runtime.route = state.route;
      dom.input.value = state.targetTitle || state.route[state.route.length - 1] || '';
      renderRoute(state.route, state.currentIndex || 0, (state.currentIndex || 0) + 1);
      if (state.active) {
        setStatus('Resuming course — picking up where the ship left off…');
        window.setTimeout(() => Traversal.resume(), 420);
      } else {
        setStatus('Saved course ready. Press Launch when ready.');
        dom.beginButton.disabled = state.route.length < 2;
      }
    }
  }

  init();
})();
