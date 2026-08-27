  // ─── StarMap — the celestial atlas plate ─────────────────────────────────────
  // Renders the plotted course as an atlas chart: a hairline graticule with meridian ticks, a
  // scatter of fixed stars, the voyage line inked in gold (drawn on with stroke-dashoffset so
  // charting reads as plotting, not a static reveal), and serif star-name labels. `alternates`
  // are the other equally-short routes, drawn UNDER the selected path as dimmer polylines.
  //
  // The layout is keyed on NODE IDENTITY, not on route index: every route that passes through
  // an article meets it at the SAME star, so the paths visibly converge and fan apart — a
  // route DAG. (The old laneY(hopIndex, routeLength, laneIndex) never looked at the title, so
  // a shared page was drawn twice, in two places, with two tooltips.)
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
      const routes = StarMap.orderedRoutes(route, alternates, lane);
      const pos = StarMap.layout(routes);
      const usage = StarMap.nodeUsage(routes);
      const n = route.length;

      const pts = route.map((title, i) => ({i, title, ...pos.get(StarMap.nodeKey(i, title))}));
      const d = StarMap.pathData(pts);

      // One <g> per DISTINCT node, never one per route-and-node: a page on three routes is a
      // single star. Nodes on the selected route carry the labels and the current/next/dest
      // states; the rest are quiet markers with a tooltip.
      const onRoute = new Map(pts.map((p) => [StarMap.nodeKey(p.i, p.title), p]));
      const nodes = [...pos.values()]
        .sort((a, b) => a.i - b.i)
        .map((p) => {
          const key = StarMap.nodeKey(p.i, p.title);
          const selected = onRoute.get(key);
          const cls = ['wikinaut-wp'];
          if (usage.get(key) > 1) cls.push('shared');
          if (!selected) cls.push('off-route');
          if (selected) {
            if (p.i === currentIndex) cls.push('current');
            if (p.i === nextIndex) cls.push('next');
            if (p.i === n - 1) cls.push('dest');
          }
          const delay =
            Math.round((n <= 1 ? 0 : p.i / (n - 1)) * CONFIG.routeSketchMs) + 120;
          const cx = p.x.toFixed(1);
          const cy = p.y.toFixed(1);
          let markup = `<g class="${cls.join(' ')}" style="--d:${delay}ms">`;
          if (selected) {
            const label = p.title.length > 16 ? `${p.title.slice(0, 15)}…` : p.title;
            const ly = p.i % 2 === 0 ? p.y - 9 : p.y + 15;
            markup +=
              `<circle class="wikinaut-wp-node" cx="${cx}" cy="${cy}" r="4.4"></circle>` +
              `<circle class="wikinaut-wp-core" cx="${cx}" cy="${cy}" r="1.8"></circle>` +
              `<text class="wikinaut-wp-label" x="${cx}" y="${ly.toFixed(1)}" text-anchor="middle">${escapeXml(label)}</text>`;
          } else {
            markup += `<circle class="wikinaut-wp-node" cx="${cx}" cy="${cy}" r="2.4"></circle>`;
          }
          return `${markup}<title>${escapeXml(p.title)}</title></g>`;
        })
        .join('');

      host.innerHTML =
        `<svg id="wikinaut-starchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-label="Plotted course star chart">` +
        `${StarMap.graticule()}${StarMap.stars()}${StarMap.alternatesMarkup(alternates, pos)}` +
        `<path id="wikinaut-route-track" d="${d}"></path>` +
        `<path id="wikinaut-route-path" d="${d}"></path>${nodes}</svg>`;

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

    // The full route set in LANE order (each route's index in runtime.routes), so the layout is
    // identical no matter which route is currently selected — paging the ◀/▶ pager re-inks the
    // chart without moving a single star.
    orderedRoutes(route, alternates, lane) {
      const byLane = [];
      byLane[lane] = route;
      for (const alt of alternates) byLane[alt.lane] = alt.route;
      const routes = byLane.filter(Boolean);
      return routes.length ? routes : [route];
    },

    nodeKey(i, title) {
      return `${i}\u0001${title}`;   // titles contain spaces; join on a non-title char
    },

    // How many routes pass through each node, so a shared star can be drawn as one.
    nodeUsage(routes) {
      const usage = new Map();
      for (const route of routes) {
        route.forEach((title, i) => {
          const key = StarMap.nodeKey(i, title);
          usage.set(key, (usage.get(key) || 0) + 1);
        });
      }
      return usage;
    },

    // The chart's geometry, computed once for the whole route set and keyed on node identity.
    //
    // All equally-short routes have the same length, so the hop index IS the column. Within a
    // column, collect the DISTINCT titles across every route (in lane order — deterministic and
    // selection-independent) and give each one its own slot around the column's baseline. The
    // baseline keeps the old hand-plotted sine wander so the plate still reads as a chart, but
    // it is damped and clamped as a column gets busier so the fan always fits the margins.
    layout(routes) {
      const key = routes.map((r) => r.join('\u0001')).join('\u0002');
      if (StarMap._layoutKey === key && StarMap._layout) return StarMap._layout;

      const {W, H} = StarMap;
      const cols = Math.max(...routes.map((r) => r.length));
      const innerW = W - StarMap.PAD_X * 2;
      const amp = (H - StarMap.PAD_V * 2) / 2;
      const midY = H / 2;

      const columns = Array.from({length: cols}, () => []);
      for (const route of routes) {
        route.forEach((title, i) => {
          if (!columns[i].includes(title)) columns[i].push(title);
        });
      }
      const busiest = Math.max(1, ...columns.map((c) => c.length));

      const map = new Map();
      columns.forEach((titles, i) => {
        const x = cols === 1 ? W / 2 : StarMap.PAD_X + innerW * (i / (cols - 1));
        const spread = titles.length - 1;
        const spacing = spread ? Math.min(26, (H - StarMap.PAD_V * 2) / spread) : 0;
        const halfSpan = (spread * spacing) / 2;
        const lo = StarMap.PAD_V + halfSpan;
        const hi = H - StarMap.PAD_V - halfSpan;
        const wander = midY + Math.sin(i * 0.9 + 0.6) * amp * (1 - spread / (busiest + 1));
        const baseline = lo <= hi ? clamp(wander, lo, hi) : midY;
        titles.forEach((title, k) => {
          map.set(StarMap.nodeKey(i, title), {
            i,
            title,
            x,
            y: baseline + (k - spread / 2) * spacing,
          });
        });
      });

      StarMap._layoutKey = key;
      StarMap._layout = map;
      return map;
    },

    _layoutKey: '',
    _layout: null,

    pathData(pts) {
      return pts
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
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

    // Alternate-route underlay: the other equally-short routes, drawn as dimmer polylines
    // through the SAME stars the selected route uses. They no longer stamp their own node
    // circles — a shared page is one star, drawn once by render() — so the only thing an
    // alternate contributes is its line and its lane color.
    // Built via paletteRgba (not CSS var()): these land in SVG presentation attributes,
    // which don't resolve custom properties.
    alternatesMarkup(alternates, pos) {
      // The accent lane follows the player's color (rebuilt per render, so live color
      // changes track); the rest stay stock PALETTE — they're the contrast lanes, and
      // streakB here is a lane identity color, not the hyperspace streak.
      const altColors = [paletteRgba('blue', 0.55), paletteRgba('purple', 0.55),
        rgbaFromHex(Settings.colorway().base, 0.4), paletteRgba('blueGlow', 0.5),
        paletteRgba('streakB', 0.45)];
      let altMarkup = '';
      alternates.forEach((alt) => {
        if (alt.route.length < 2) return;
        const altPts = alt.route.map((title, i) => pos.get(StarMap.nodeKey(i, title)));
        if (altPts.some((p) => !p)) return;
        const color = altColors[alt.lane % altColors.length];
        altMarkup += `<g class="wikinaut-route-alt" style="stroke:${color}">` +
          `<path d="${StarMap.pathData(altPts)}"></path></g>`;
      });
      return altMarkup;
    },
  };
