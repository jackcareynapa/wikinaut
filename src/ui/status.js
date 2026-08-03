  // ─── UI helpers ─────────────────────────────────────────────────────────────

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

  function showToast(message, ms = 4600) {
    const toast = document.createElement('div');
    toast.className = 'wikinaut-toast';
    toast.textContent = message;
    dom.root.append(toast);
    window.setTimeout(() => toast.remove(), ms);
  }
