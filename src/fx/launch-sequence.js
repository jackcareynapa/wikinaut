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
      await sleep(beat(260));
      const from = LaunchSequence.padPosition();
      Figure.moveTo(from.x, from.y + 26);
      Figure.show();
      Figure.pose('idle');
      // Rise out of the bay onto the pad. The pad is re-measured every frame: if the
      // panel is still settling (the route card's expansion can overlap a quick Launch
      // press), the ship tracks the live rect instead of arming against a stale one.
      await animate(beat(430), (p) => {
        const pad = LaunchSequence.padPosition();
        const eased = 1 - easeInCubic(1 - p);
        Figure.moveTo(pad.x, pad.y + 26 * (1 - eased));
      });
      await sleep(beat(140));
    },

    // 3 … 2 … 1 … . Calls onTick(n) before each digit so the caller can narrate it.
    async countdown(reduce, onTick) {
      for (const n of [3, 2, 1]) {
        if (onTick) onTick(n);
        LaunchSequence.showDigit(String(n), reduce);
        await sleep(reduce ? beat(140) : beat(760));
      }
      LaunchSequence.hideDigit();
    },

    // Spool-up: the drive charges (core pulses) and the craft hunkers against the hold-downs —
    // a short crouch storing energy before the bolts blow.
    async spoolUp(reduce) {
      const pad = LaunchSequence.padPosition();
      Figure.pose('grab');
      if (!reduce) {
        await animate(beat(300), (p) => {
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
        // Matches the climb it covers — beat(170) + beat(1000) — and the CSS duration is
        // tempo-scaled to the same figure. A fixed 1400ms stopped shaking a third of the way
        // up at the slowest speed setting.
        window.setTimeout(() => {
          if (dom.root) delete dom.root.dataset.shake;
        }, beat(1170));
      }

      // Hold a beat while thrust builds (flame + smoke ignite, embers fly), then climb
      // hard off the pad — ease-IN so it accelerates like a rocket, rising well clear of
      // the console while the engine trail blooms into a plume behind it.
      const riseY = clamp(start.y - 360, 8, start.y);
      if (reduce) {
        Figure.moveTo(start.x, riseY);
      } else {
        await sleep(beat(170));
        await animate(beat(1000), (progress, now) => {
          const eased = easeInCubic(progress);
          Figure.moveTo(start.x, lerp(start.y, riseY, eased));
          Trail.addPoint(runtime.figurePosition.x, runtime.figurePosition.y, now);
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
        {duration: beat(560), easing: 'cubic-bezier(.2,.8,.2,1)'},
      );
    },

    hideDigit() {
      if (!dom.countdown) return;
      dom.countdown.dataset.on = 'false';
      dom.countdown.textContent = '';
    },
  };
