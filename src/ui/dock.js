  // ─── Dock (idle ship home, near the console) ──────────────────────────────────

  function panelChromeTop() {
    if (dom.beginButton) {
      return dom.beginButton.getBoundingClientRect().top;
    }
    if (dom.panel) {
      const rect = dom.panel.getBoundingClientRect();
      return rect.bottom - 72;
    }
    return window.innerHeight - CONFIG.panelReservePx;
  }

  function panelObstacleRect() {
    const top = panelChromeTop();
    const panelBottom = dom.panel?.getBoundingClientRect().bottom ?? window.innerHeight;
    return {top, bottom: panelBottom, height: panelBottom - top};
  }
