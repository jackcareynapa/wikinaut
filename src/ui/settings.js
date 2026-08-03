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
