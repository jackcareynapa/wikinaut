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

  // ─── Deterministic noise ─────────────────────────────────────────────────────
  // Seeds for anything that must LOOK scattered but be byte-identical on every render: the
  // star chart's node placement and its fixed-star field. A chart is re-inked whenever the
  // pager moves, the ship advances a hop, or the page reloads mid-flight — so "scattered"
  // here can never mean Math.random(), or the stars would crawl.

  // FNV-1a, 32-bit.
  function hashString(value) {
    const text = String(value);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // Deterministic [0,1) from a seed plus any number of salts — a channel name, a column
  // index, a page title. Salting (rather than advancing a stateful PRNG) is what keeps a
  // node's offset a pure function of (chart, column, title): the same page shared by three
  // routes resolves to ONE coordinate regardless of the order the routes are walked in.
  function seededUnit(seed, ...salts) {
    let h = seed >>> 0;
    for (const salt of salts) {
      h = (h ^ hashString(salt)) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
    }
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  // The same, mapped to [-1,1) — the usual form for an offset.
  function seededSigned(seed, ...salts) {
    return seededUnit(seed, ...salts) * 2 - 1;
  }
