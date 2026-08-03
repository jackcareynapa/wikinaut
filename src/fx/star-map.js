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
