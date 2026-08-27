  // ─── Geometry ────────────────────────────────────────────────────────────────

  // THE rect the ship should aim at — never call getBoundingClientRect() on a link directly.
  //
  // An <a> that wraps across two lines has TWO layout fragments, and getBoundingClientRect()
  // returns their UNION: a box spanning both lines and (because the second fragment starts at
  // the column margin) usually the full column width. Its center sits between the lines, over
  // unrelated text — which is exactly why the ship flew to "a region around the link" and tore
  // the jump slit open in blank space. The bug is deterministic, not a timing race: every
  // wrapped link hits it.
  //
  // getClientRects() exposes the fragments individually. Pick the substantial one — largest
  // area, boosted if it's on screen, tie-broken by proximity to the ship — and fly to that.
  function anchorRect(el) {
    let rects = [];
    try {
      rects = [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    } catch {
      rects = [];
    }
    // No fragments at all (detached, or display:contents): the union is all there is.
    if (!rects.length) return el.getBoundingClientRect();
    if (rects.length === 1) return rects[0];

    let best = rects[0];
    let bestScore = -Infinity;
    for (const rect of rects) {
      const dist = Math.hypot(
        rect.left + rect.width / 2 - runtime.figurePosition.x,
        rect.top + rect.height / 2 - runtime.figurePosition.y);
      // Area is the primary signal (the bulk of the link text, not a two-character orphan);
      // an on-screen fragment gets up to a 1.5x boost; distance only breaks ties.
      const score =
        rect.width * rect.height * (1 + viewportOverlap(rect) * 0.5) - dist * 0.02;
      if (score > bestScore) {
        best = rect;
        bestScore = score;
      }
    }
    return best;
  }

  // Fraction of `rect` currently inside the viewport: 0 fully off-screen, 1 fully visible.
  function viewportOverlap(rect) {
    const visW = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const visH = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return (visW * visH) / Math.max(rect.width * rect.height, 1);
  }

  // Viewport-space center of an element's anchor fragment — the one point every layer
  // (ship, reticle, landing burst, jump slit) must agree on.
  function anchorCenter(el) {
    const rect = anchorRect(el);
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
  }
