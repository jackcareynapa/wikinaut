  // ─── Titles ──────────────────────────────────────────────────────────────────

  const Titles = {
    currentPageTitle() {
      const fromHeading = document.querySelector(SELECTORS.pageTitle)?.textContent?.trim();
      if (fromHeading) return fromHeading;
      const raw = location.pathname.replace(/^\/wiki\//, '');
      return safeDecode(raw).replace(/_/g, ' ');
    },

    // Title → the /wiki/<title> path segment. Percent-encoding is required: real article
    // titles contain '?' and '#' (e.g. "What's the Worst That Could Happen?"), and without
    // encoding everything after those characters is parsed as a query string or fragment,
    // so the direct-navigation fallback lands on the wrong page. ':' and '/' are put back
    // because MediaWiki article paths carry them literally (namespaces and subpages).
    toUrlTitle(title) {
      return encodeURIComponent(String(title ?? '').trim().replace(/\s+/g, '_'))
        .replace(/%3A/gi, ':')
        .replace(/%2F/gi, '/');
    },

    canonical(title) {
      return safeDecode(String(title || ''))
        .normalize('NFC')   // fold composed/decomposed accents so "Café" always equals "Café"
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

    // Raw (URL-form: underscores, still percent-encoded) article title from an href, or ''
    // when it isn't a same-wiki article link. Resolves EVERY href form the two renderers
    // emit — relative /wiki/Foo (legacy parser), ./Foo (Parsoid DOM), protocol-relative
    // //en.wikipedia.org/wiki/Foo (Parsoid read views), and fully-qualified — and rejects
    // other hosts (Commons/Wiktionary links also contain "/wiki/").
    rawFromHref(href) {
      if (!href) return '';
      let url;
      try {
        url = new URL(href, location.href);
      } catch {
        return '';
      }
      if (url.hostname !== location.hostname) return '';
      if (!url.pathname.startsWith('/wiki/')) return '';
      return url.pathname.slice('/wiki/'.length);
    },

    fromLink(link) {
      const raw = Titles.rawFromHref(link.getAttribute('href') || '');
      return raw ? safeDecode(raw).replace(/_/g, ' ') : '';
    },
  };
