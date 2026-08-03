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
