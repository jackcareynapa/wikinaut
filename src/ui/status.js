  // ─── UI helpers ─────────────────────────────────────────────────────────────

  // The status line at rest: first load, and again whenever a charted course is dropped.
  const IDLE_STATUS = 'Set a destination and chart a course through Wikipedia.';

  function setBusy(isBusy, message) {
    dom.input.disabled = isBusy;
    dom.chartButton.disabled = isBusy;
    if (message) setStatus(message);
  }

  function setStatus(message, {isError = false} = {}) {
    dom.status.textContent = message;
    dom.status.dataset.error = isError ? 'true' : 'false';
  }

  function setFreshness(date) {
    if (!dom.freshness) return;
    if (!date) {
      dom.freshness.textContent = '';
      return;
    }
    const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
    const label = date.toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
    dom.freshness.textContent =
      days < 10 ? `Star chart: ${label}` : `Star chart: ${label} (~${Math.ceil(days / 30)}mo old)`;
  }

  // One toast at a time, parked just above the console. It used to sit at a fixed
  // bottom:120px, which is inside the console once a chart is open, so it covered the star
  // chart and the settings drawer, and repeated toasts stacked exactly on top of each other.
  function showToast(message, ms = 4600) {
    dom.root.querySelectorAll('.wikinaut-toast').forEach((el) => el.remove());
    const toast = document.createElement('div');
    toast.className = 'wikinaut-toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    dom.root.append(toast);
    positionToast();
    window.setTimeout(() => toast.remove(), ms);
  }

  // Also re-run whenever the console resizes (reserveScrollRoom's observer), so a live toast
  // rides up with it when the chart or the settings drawer opens beneath it.
  function positionToast() {
    const toast = dom.root?.querySelector('.wikinaut-toast');
    if (!toast) return;
    const panelTop = dom.panel ? dom.panel.getBoundingClientRect().top : window.innerHeight - 120;
    toast.style.bottom = `${Math.max(16, Math.round(window.innerHeight - panelTop + 10))}px`;
  }
