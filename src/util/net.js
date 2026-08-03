  // ─── Network helpers ─────────────────────────────────────────────────────────

  // Parses JSON text, returning undefined (never throwing) on malformed input — callers decide
  // how to react to an unparsable body.
  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  async function requestJson(url, options = {}) {
    let text;
    try {
      text = await requestText(url, options);
    } catch (networkErr) {
      // A non-2xx response may still carry a JSON error body (e.g. our own backend's /paths
      // 400s: {"error": "...", "code": "page-not-found"}) — prefer that player-facing message
      // over the generic "Request failed (NNN)" if one is present.
      if (networkErr.body) {
        const parsed = tryParseJson(networkErr.body);
        if (parsed?.error) {
          const err = new Error(
            typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
          err.code = parsed.code ? `backend/${parsed.code}` : undefined;
          err.status = networkErr.status;
          throw err;
        }
      }
      throw networkErr;
    }

    const data = tryParseJson(text);
    if (data === undefined) {
      const err = new Error(
        'The navigation backend sent back something unreadable. Try again in a moment.');
      err.code = 'wn/backend-bad-response';
      throw err;
    }
    if (data?.error) {
      // MediaWiki errors are objects ({code, info}); surface a readable message.
      const mwErr = data.error;
      const err = new Error(
        mwErr.info || mwErr.code || (typeof mwErr === 'string' ? mwErr : JSON.stringify(mwErr)));
      err.code = data.code ? `backend/${data.code}` : undefined;
      throw err;
    }
    return data;
  }

  function requestText(url, options = {}) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: options.method || 'GET',
          url,
          headers: options.headers || {},
          data: options.body,
          responseType: 'text',
          timeout: 30000,
          onload(response) {
            if (response.status >= 200 && response.status < 300) {
              resolve(response.responseText);
            } else {
              const err = new Error(`Request failed (${response.status})`);
              err.status = response.status;
              err.body = response.responseText;
              reject(err);
            }
          },
          ontimeout() {
            reject(Object.assign(new Error('Request timed out.'), {code: 'wn/backend-timeout'}));
          },
          onerror() {
            reject(Object.assign(new Error('Network request failed.'), {code: 'wn/backend-unreachable'}));
          },
        });
      });
    }

    return fetch(url, options).then(async (response) => {
      const text = await response.text();
      if (!response.ok) {
        const err = new Error(`Request failed (${response.status})`);
        err.status = response.status;
        err.body = text;
        throw err;
      }
      return text;
    });
  }
