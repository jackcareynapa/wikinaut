  // ─── Backend URL (default + self-host override via GM storage) ────────────────

  const Backend = {
    // The stored override, trimmed ('' when unset or storage is unreadable) — the single
    // reader both getters share.
    _stored() {
      try {
        const value =
          typeof GM_getValue === 'function'
            ? GM_getValue(CONFIG.backendUrlKey, '')
            : localStorage.getItem(CONFIG.backendUrlKey) || '';
        return String(value || '').trim();
      } catch {
        return '';
      }
    },

    get url() {
      return Backend._stored().replace(/\/+$/, '') || CONFIG.apiBaseUrl;
    },

    get override() {
      return Backend._stored();
    },

    // Every charted course sends the player's current and destination article titles to this
    // URL, so only http(s) origins are accepted: without a scheme check a typo (or a pasted
    // "javascript:"/"data:" string) would be stored and handed to GM_xmlhttpRequest. Plain
    // http is allowed for local development but not for a remote host, where it would put
    // the titles on the wire in the clear.
    isValidUrl(url) {
      let parsed;
      try {
        parsed = new URL(String(url || '').trim());
      } catch {
        return false;
      }
      if (parsed.protocol === 'https:') return true;
      return parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname);
    },

    // Returns true when the value was accepted (an empty value clears the override).
    set(url) {
      const value = String(url || '').trim().replace(/\/+$/, '');
      if (value && !Backend.isValidUrl(value)) return false;
      try {
        if (typeof GM_setValue === 'function') GM_setValue(CONFIG.backendUrlKey, value);
        else if (value) localStorage.setItem(CONFIG.backendUrlKey, value);
        else localStorage.removeItem(CONFIG.backendUrlKey);
      } catch {}
      return true;
    },
  };
