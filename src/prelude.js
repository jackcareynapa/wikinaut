  'use strict';

  if (window.__wikinautLoaded) return;
  window.__wikinautLoaded = true;

  // Hosts allowed to serve the backend over plain http. Everything else must be https,
  // because a backend URL receives the article titles the player is routing between.
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
