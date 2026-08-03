  // ─── Session caches (latency only) ─────────────────────────────────────────────
  // Tiny sessionStorage-backed caches with insertion-order eviction, shared by the /paths
  // route cache and the redirect-alias cache. Pure latency optimizations: any storage failure
  // or miss just means a refetch, never an error. Session-scoped on purpose — route answers
  // and alias sets don't need to outlive the tab.
  const SessionCache = {
    _read(key) {
      try {
        const raw = sessionStorage.getItem(key);
        const entries = raw ? JSON.parse(raw) : [];
        return Array.isArray(entries) ? entries : [];
      } catch {
        return [];
      }
    },

    _write(key, entries) {
      try {
        sessionStorage.setItem(key, JSON.stringify(entries));
      } catch {}
    },

    get(key, id, maxAgeMs = 0) {
      const hit = SessionCache._read(key).find((entry) => entry.id === id);
      if (!hit) return undefined;
      if (maxAgeMs && Date.now() - hit.t > maxAgeMs) return undefined;
      return hit.v;
    },

    put(key, id, value, cap) {
      const entries = SessionCache._read(key).filter((entry) => entry.id !== id);
      entries.push({id, t: Date.now(), v: value});
      while (entries.length > cap) entries.shift();
      SessionCache._write(key, entries);
    },
  };
