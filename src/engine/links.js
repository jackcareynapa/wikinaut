  // ─── Links ───────────────────────────────────────────────────────────────────

  const Links = {
    // `aliases` (optional) is a list of titles known to redirect to `title` — see
    // Routing.fetchRedirectAliases — so a live page linking via a redirect alias still matches.
    locate(title, aliases = []) {
      return Links.pickFrom(Links.candidates(title, aliases));
    },

    // Choose the anchor the ship should fly to from an already-scanned candidate list —
    // callers that need the candidate list anyway (for diagnostics) scan once and pick here.
    // Candidates are {link, rect} entries (see candidates()); returns the bare link.
    pickFrom(candidates) {
      if (!candidates.length) return null;

      const best = Links.bestVisible(candidates);
      if (best && Links.visibilityScore(best.rect) > 0.7) return best.link;

      const chosen = Links.nearestBelowViewport(candidates) || Links.nearestToViewport(candidates);
      return chosen.link;
    },

    // Returns [{link, rect}] — each candidate's bounding rect is measured exactly once here
    // and every scorer/sorter reads the cached rect (a per-comparison getBoundingClientRect
    // in the sort paths forced repeated layout reads on link-dense pages).
    candidates(title, aliases = []) {
      const root =
        document.querySelector(SELECTORS.articleBody) ||
        document.querySelector(SELECTORS.contentRoot) ||
        document.body;
      // Cheap string filters first (href parse + title match), then the expensive
      // computed-style/rect visibility check only on the few links that matched — a Parsoid
      // article can carry ~2000 internal links and a per-link getComputedStyle scan is slow.
      const entries = [];
      for (const link of root.querySelectorAll(SELECTORS.articleLink)) {
        if (!Links.isArticleLinkHref(link)) continue;
        if (!Links.matchesTitle(link, title, aliases)) continue;
        const rect = link.getBoundingClientRect();
        if (!Links.isRendered(link, {rect})) continue;
        entries.push({link, rect});
      }
      return entries;
    },

    // The graph counts ALL namespace-0 links — including those in infoboxes, sidebars,
    // and bottom navboxes — so match against the href title, the link's `title` attribute
    // (catches odd encodings the href parse would miss), and any known redirect aliases of
    // `title` (catches a live page linking via a redirect the graph already resolved through).
    matchesTitle(link, title, aliases = []) {
      const linkTitle = Titles.fromLink(link);
      if (Titles.same(linkTitle, title)) return true;
      const titleAttr = link.getAttribute('title');
      if (titleAttr && Titles.same(titleAttr, title)) return true;
      if (aliases.length) {
        if (aliases.some((alias) => Titles.same(linkTitle, alias))) return true;
        if (titleAttr && aliases.some((alias) => Titles.same(titleAttr, alias))) return true;
      }
      return false;
    },

    // The single rendered-visibility test (used by candidates() in loose form and isOnPage
    // in strict form). Allow off-viewport links; only exclude truly hidden elements —
    // excluding hidden ones makes Links.locate return null, which is what triggers reveal.
    //
    // TWO hidden-by-a-collapsed-ancestor shapes exist and both must be caught:
    // - display:none ancestor → the link keeps display:inline but renders a 0×0 box.
    // - `hidden="until-found"` ancestor (how MediaWiki collapses navbox rows for
    //   find-in-page) → content-visibility:hidden, and the link keeps a NONZERO rect while
    //   being unpainted — a phantom the display/visibility/rect checks all miss. Only
    //   checkVisibility() sees through it; without the fix the ship lands in empty space.
    //
    // `strict` is the landing-time semantic: ANY zero dimension means unpaintable. The loose
    // candidate semantic only rejects a fully-collapsed 0×0 box. `rect` may be passed by a
    // caller that already measured it.
    isRendered(link, {strict = false, rect = null} = {}) {
      const box = rect || link.getBoundingClientRect();
      const flat = strict ? (box.width === 0 || box.height === 0)
        : (box.width === 0 && box.height === 0);
      if (flat) return false;
      if (typeof link.checkVisibility === 'function') {
        return link.checkVisibility(
          {contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true});
      }
      const style = window.getComputedStyle(link);
      return style.display !== 'none' && style.visibility !== 'hidden';
    },

    // The href/namespace test WITHOUT the visibility check — so Links.reveal can find a
    // target that's currently hidden inside a collapsed container.
    //
    // Namespace filtering must be a PREFIX-LIST test, never a blanket "contains a colon":
    // plenty of namespace-0 articles contain colons ("2001: A Space Odyssey", "Star Trek: The
    // Next Generation") and the graph includes them — a colon test silently rejected every
    // anchor to such a title and the flight degraded to a URL-jump with a misleading "link not
    // visible" report. (Candidates are title-matched against a known ns-0 route title anyway,
    // so this filter is only an early-out; it must never over-reject.)
    isArticleLinkHref(link) {
      const title = Titles.rawFromHref(link.getAttribute('href') || '');
      if (!title || Links.NAMESPACE_PREFIX_RE.test(title)) return false;
      // Only skip edit-section links and citation-reference superscripts ([1] → #cite_note).
      // Navboxes, sidebars, infoboxes, AND the references list itself are all counted by the
      // graph, so they must stay searchable.
      if (link.closest('.mw-editsection, .reference')) return false;
      return true;
    },

    // Known MediaWiki namespaces (href form: underscores, possibly "_talk" variants).
    NAMESPACE_PREFIX_RE: new RegExp(
      '^(?:talk|special|wikipedia|wp|project|file|image|media|mediawiki|template|help|' +
        'category|portal|draft|timedtext|module|user)(?:_talk)?:', 'i'),

    // Some target links live inside collapsed navboxes, collapsed infobox rows, <details>, or
    // nav dropdowns — the graph counts them but they're display:none on load, so Links.locate
    // can't see them. Find such a hidden candidate, expand every collapsed container on its
    // ancestor chain until it's on-page, and return it for the ship to land on. Returns null if
    // nothing matches (the caller then falls back to a direct URL jump). Never throws.
    reveal(title, aliases = []) {
      try {
        const root =
          document.querySelector(SELECTORS.articleBody) ||
          document.querySelector(SELECTORS.contentRoot) ||
          document.body;
        const matches = [...root.querySelectorAll(SELECTORS.articleLink)]
          .filter((link) => Links.isArticleLinkHref(link))
          .filter((link) => Links.matchesTitle(link, title, aliases));
        for (const link of matches) {
          if (Links.ensureVisible(link)) return link;
        }
      } catch (error) {
        console.warn('[Wikinaut] reveal failed', error);
      }
      return null;
    },

    // Make one hidden link visible, preferring the page's own machinery: on a live MediaWiki
    // collapsible (`.mw-made-collapsible`) click the REAL toggle first — the collapsible code
    // restores the rows' `hidden="until-found"` attributes and aria state natively — and only
    // then fall back to attribute/style surgery on the ancestor chain. Also the landing-time
    // guard: navboxes are made collapsible seconds AFTER load, so a link located while
    // visible can be re-hidden mid-flight. Returns whether the link is now truly on-page.
    ensureVisible(link) {
      if (Links.isOnPage(link)) return true;
      if (link.closest('.mw-made-collapsible')) Links.clickCollapsibleToggle(link);
      if (!Links.isOnPage(link)) Links.expandAncestors(link);
      if (!Links.isOnPage(link)) Links.clickCollapsibleToggle(link);
      if (!Links.isOnPage(link)) return false;
      Links.pulseContainer(link);
      return true;
    },

    // Brief highlight pulse on the container that was just expanded, so the reveal reads as an
    // intentional action rather than the page silently shifting under the player.
    pulseContainer(link) {
      if (prefersReducedMotion()) return;
      const container = link.closest('.mw-collapsible, .NavFrame, details, table') || link;
      container.classList.add('wikinaut-reveal-pulse');
      window.setTimeout(() => container.classList.remove('wikinaut-reveal-pulse'), 900);
    },

    // Walk from the link up to the article root, opening anything that hides it: <details>,
    // MediaWiki collapsibles (which drop `mw-collapsed` and set inline display:none on rows /
    // content wrappers), legacy `.collapsed`, and generic inline-hidden / [hidden] ancestors.
    // Clearing display:none only along the link's own chain reveals exactly that link without
    // disturbing unrelated collapsed content.
    expandAncestors(link) {
      let node = link;
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.tagName === 'DETAILS' && !node.open) node.open = true;
        if (node.classList) {
          node.classList.remove('mw-collapsed');
          node.classList.remove('collapsed');
          if (node.classList.contains('vector-dropdown')) node.classList.add('vector-dropdown--active');
        }
        if (node.style && node.style.display === 'none') node.style.display = '';
        if (node.hasAttribute && node.hasAttribute('hidden')) node.removeAttribute('hidden');
        node = node.parentElement;
      }
    },

    // Fallback for JS-driven collapsibles the style reset alone doesn't open: click the nearest
    // MediaWiki collapsible toggle above the link (lets Wikipedia's own handler expand it).
    clickCollapsibleToggle(link) {
      const container = link.closest('.mw-collapsible, .NavFrame');
      if (!container) return;
      const toggle = container.querySelector(
        '.mw-collapsible-toggle, .mw-collapsible-toggle-expanded, .NavToggle, summary');
      if (toggle && typeof toggle.click === 'function') toggle.click();
    },

    // Landing-time check: is the link truly paintable right now?
    isOnPage(link) {
      return Links.isRendered(link, {strict: true});
    },

    // The scorers below all take {link, rect} candidate entries and read the rect captured
    // at scan time — never re-measure inside a sort comparator.
    bestVisible(entries) {
      let best = null;
      let bestScore = -Infinity;
      for (const entry of entries) {
        const score =
          Links.visibilityScore(entry.rect) * 1000 - Links.distanceFromFigure(entry.rect);
        if (score > bestScore) {
          best = entry;
          bestScore = score;
        }
      }
      return best;
    },

    visibilityScore(rect) {
      const visW = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const visH = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      return (visW * visH) / Math.max(rect.width * rect.height, 1);
    },

    distanceFromFigure(rect) {
      return Math.hypot(
        rect.left + rect.width / 2 - runtime.figurePosition.x,
        rect.top + rect.height / 2 - runtime.figurePosition.y,
      );
    },

    nearestToViewport(entries) {
      const cy = window.innerHeight / 2;
      let best = null;
      let bestD = Infinity;
      for (const entry of entries) {
        const d = Math.abs(entry.rect.top - cy);
        if (d < bestD) {
          best = entry;
          bestD = d;
        }
      }
      return best;
    },

    nearestBelowViewport(entries) {
      const threshold = panelObstacleRect().top;
      let best = null;
      for (const entry of entries) {
        if (entry.rect.top <= threshold - 40) continue;
        if (!best || entry.rect.top < best.rect.top) best = entry;
      }
      return best;
    },
  };
