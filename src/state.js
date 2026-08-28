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
    // Bumped every time a flight ends (resume()'s finally). Per-frame callbacks capture it and
    // bail when it moves, so a tween that outlives its flight — an error path tore the flight
    // down while a cruise was mid-air — stops scrolling the document and moving the ship.
    flightGeneration: 0,
  };

  // Thrown by a frame callback whose flight has already been torn down. animate() rejects with
  // it; Traversal.resume swallows it, because it is a clean stop and not a fault to narrate.
  class FlightAbandoned extends Error {
    constructor() {
      super('Flight abandoned.');
      this.code = 'wn/flight-abandoned';
    }
  }

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
