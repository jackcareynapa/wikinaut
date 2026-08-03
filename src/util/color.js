  function hexToRgb(hex) {
    const clean = String(hex || '').replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    return {
      r: parseInt(full.slice(0, 2), 16) || 0,
      g: parseInt(full.slice(2, 4), 16) || 0,
      b: parseInt(full.slice(4, 6), 16) || 0,
    };
  }

  function rgbToHex({r, g, b}) {
    const c = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }

  // Per-channel lerp between two hex colors; t=0 → hexA, t=1 → hexB.
  function mixHex(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    return rgbToHex({
      r: lerp(a.r, b.r, t),
      g: lerp(a.g, b.g, t),
      b: lerp(a.b, b.b, t),
    });
  }

  // WCAG relative luminance (0 = black, 1 = white).
  function relativeLuminance(hex) {
    const lin = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const {r, g, b} = hexToRgb(hex);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  // Lift a color toward white until it clears a luminance floor, so a near-black pick can
  // never render the console/ship unreadable on the dark fascia. Bounded iterations: even
  // pure black clears 0.15 well within eight 15% white mixes.
  function ensureReadable(hex, minLum = 0.15) {
    let out = hex;
    for (let i = 0; i < 8 && relativeLuminance(out) < minLum; i += 1) {
      out = mixHex(out, '#FFFFFF', 0.15);
    }
    return out;
  }

  // rgba() string from an arbitrary hex — like paletteRgba, for SVG presentation
  // attributes where var() can't resolve, but fed by the player's color.
  function rgbaFromHex(hex, alpha) {
    return `rgba(${paletteChannels(hex)},${alpha})`;
  }

  // The full derived colorway from the player's ONE color setting: console accent family,
  // hyperspace streaks, and the trail ramp endpoints all come from this single base, so
  // every glow on screen agrees. Plain white/black mixes reproduce the hand-tuned gold
  // family within a few RGB points for the default accent and generalize to any hue.
  function deriveColorway(rawHex) {
    const base = ensureReadable(rawHex, 0.15);
    return {
      base,
      hot: mixHex(base, '#FFFFFF', 0.65),      // white-hot centers (≈ stock accentHot)
      glow: mixHex(base, '#FFFFFF', 0.40),     // phosphor readouts (≈ stock accentGlow)
      deep: mixHex(base, '#000000', 0.20),     // launch-key shadow stop (≈ stock accentDeep)
      streakA: mixHex(base, '#FFFFFF', 0.45),  // hyperspace streaks: pale…
      streakB: mixHex(base, '#000000', 0.25),  // …and deep
      trailCore: mixHex(base, '#FFFFFF', 0.40),
      trailTail: mixHex(mixHex(base, '#808080', 0.30), '#000000', 0.30), // desaturated ember
      // Console body text. These carry most of the panel's lettering, so they are mixed
      // far enough toward white/grey to stay legible on the dark fascia at any hue while
      // still reading as the player's color rather than a fixed ivory/blue-grey.
      parchment: mixHex(base, '#FFFFFF', 0.80),  // engraved labels + atlas chart lettering
      dimWhite: mixHex(mixHex(base, '#FFFFFF', 0.55), '#808080', 0.35),  // secondary text
      // Engraved text ON the accent-filled LAUNCH cap. Dark rather than light because the
      // cap's middle gradient stop (where the lettering sits) is the base color itself.
      // Worst case is a dark saturated pick, which ensureReadable floors at 0.15 luminance
      // and so caps contrast near 4:1 — still clear of WCAG AA for this 700-weight key.
      ink: mixHex(base, '#000000', 0.88),
    };
  }
