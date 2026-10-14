// Page 01: the project index, plus a hold-to-glitch effect on the hero photo.
// Exposes window.IntroSketch = { mount(container), unmount() } so the final
// stitched site can host it as one section. Classic script (not a module)
// so the page works when opened straight from file://.

(function () {
"use strict";

const GLITCH = {
  growRate: 60, // px/s mean growth of the glitch extent while held
  spurt: [0.15, 2.4], // growth rate multiplier wanders between these in random spurts
  spurtEvery: [120, 650], // ms between picking a new spurt target
  lobes: 6, // sine lobes that make the boundary irregular
  lobeAmp: 0.55, // total boundary wobble as a fraction of the extent
  spawnPerPx: 0.016, // streaks spawned per frame per px of extent
  clusterChance: 0.35, // chance a new streak spawns next to an existing one (clumps)
  maxStreaks: 560,
  edgeBias: 0.6, // 0..1 how strongly new streaks favour the boundary
  growMs: [150, 700], // a streak extends from 0 to full length over this time
  dieMs: [120, 900], // on release, each streak dies at a random point in this window
  flicker: 0.04, // chance per frame a streak is skipped (shimmer)
  // Streak kinds and their share of spawns (normalised at spawn time).
  mix: { stretch: 0.28, vstretch: 0.14, block: 0.1, slice: 0.1, mosaic: 0.16, glyphs: 0.14, noise: 0.08 },
  // Datamosh palette from the references: magenta, cyan, pink, teal, red, blue, white, yellow.
  palette: ["#ff2bd6", "#19e6e6", "#ff5c8a", "#2bd4a5", "#ff3b3b", "#3b6bff", "#ffffff", "#ffe34d", "#9b4dff"],
  glyphText: "designtechnology", // source string for the glyph bands
  glyphFont: "Consolas, 'Cascadia Mono', Menlo, monospace",
};

let listeners = [];
let rows = [];

// Glitch state
let hero, img, canvas, ctx;
let W = 0;
let H = 0;
let dpr = 1;
let cover = { scale: 1, ox: 0, oy: 0 }; // how the image maps into the canvas (object-fit: cover, top-aligned)
let held = false;
let radius = 0; // mean extent; the real boundary wobbles around it
let cursor = { x: 0, y: 0 };
let streaks = [];
let rafId = 0;
let lastT = 0;
let lobes = []; // {k, amp, phase, drift}
let spurtMul = 1;
let spurtTarget = 1;
let nextSpurt = 0;
let releasedAt = 0;

function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  listeners.push(() => target.removeEventListener(type, fn, opts));
}

// ---------------------------------------------------------------- index rows

function setActive(row) {
  for (const r of rows) r.classList.toggle("is-active", r === row);
}

function mountIndex(el) {
  rows = Array.from(el.querySelectorAll(".index__row"));
  const list = el.querySelector(".index__list");
  if (!rows.length || !list) return;
  for (const r of rows) {
    on(r, "pointerenter", () => setActive(r));
    on(r, "focusin", () => setActive(r));
  }
  on(list, "pointerleave", () => setActive(rows[0]));
  setActive(rows[0]);
}

// ---------------------------------------------------------------- glitch

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = hero.clientWidth;
  H = hero.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Match the CSS: object-fit cover, object-position 50% 0%.
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;
  const scale = Math.max(W / iw, H / ih);
  cover = { scale, ox: (W - iw * scale) / 2, oy: 0 };
}

/** Canvas point -> image pixel. */
function toImage(x, y) {
  return { x: (x - cover.ox) / cover.scale, y: (y - cover.oy) / cover.scale };
}

function drawBase() {
  ctx.drawImage(img, cover.ox, cover.oy, img.naturalWidth * cover.scale, img.naturalHeight * cover.scale);
}

function rnd(a, b) {
  return a + Math.random() * (b - a);
}

/** Small seeded PRNG (mulberry32) so a streak's internal layout is fixed frame to frame. */
function prng(seed) {
  let a = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickKind() {
  const m = GLITCH.mix;
  let total = 0;
  for (const k in m) total += m[k];
  let r = Math.random() * total;
  for (const k in m) {
    if ((r -= m[k]) < 0) return k;
  }
  return "stretch";
}

/** New irregular boundary: a few sine lobes with random frequency, phase and drift. */
function makeLobes() {
  const n = GLITCH.lobes;
  const amps = Array.from({ length: n }, () => Math.random() + 0.3);
  const sum = amps.reduce((a, b) => a + b, 0);
  lobes = amps.map((a, i) => ({
    k: i + 1 + Math.floor(Math.random() * 2),
    amp: (a / sum) * GLITCH.lobeAmp,
    phase: Math.random() * Math.PI * 2,
    drift: rnd(-0.9, 0.9), // rad/s the lobe rotates
  }));
}

/** Boundary distance from the cursor in direction `ang` at time `t` (ms). */
function extentAt(ang, t) {
  let f = 1;
  for (const l of lobes) f += l.amp * Math.sin(l.k * ang + l.phase + (l.drift * t) / 1000);
  return radius * Math.max(0.15, f);
}

/** Spawn one streak inside the irregular boundary, biased toward it, sometimes clumped. */
function spawnStreak(t) {
  let x, y, ang;
  if (streaks.length && Math.random() < GLITCH.clusterChance) {
    // Clump next to an existing streak.
    const o = streaks[Math.floor(Math.random() * streaks.length)];
    x = o.x + rnd(-18, 18);
    y = o.y + rnd(-10, 10);
    ang = Math.atan2(y - cursor.y, x - cursor.x);
  } else {
    ang = Math.random() * Math.PI * 2;
    const u = Math.random();
    const dist = extentAt(ang, t) * (GLITCH.edgeBias * Math.sqrt(u) + (1 - GLITCH.edgeBias) * u);
    x = cursor.x + Math.cos(ang) * dist;
    y = cursor.y + Math.sin(ang) * dist;
  }
  const dir = Math.cos(ang) >= 0 ? 1 : -1; // smear away from the cursor
  const kind = pickKind();
  const local = extentAt(ang, t);
  const s = {
    kind,
    x,
    y,
    dir,
    seed: Math.random(),
    born: t,
    growMs: rnd(GLITCH.growMs[0], GLITCH.growMs[1]),
    dieAt: Infinity,
    h: rnd(1, 9),
    len: rnd(18, Math.max(40, local * 0.9)),
    shift: rnd(8, 70),
    srcW: rnd(1, 3),
  };
  switch (kind) {
    case "vstretch": // a thin row pulled downward into a drip
      s.len = rnd(30, Math.max(60, local * 1.1));
      s.h = rnd(2, 12); // this is the drip's width
      s.dir = Math.random() < 0.85 ? 1 : -1; // mostly downward
      break;
    case "block":
      s.h = rnd(3, 18);
      break;
    case "slice": // a wide displaced band with chromatic fringing
      s.len = rnd(60, Math.max(120, local * 1.6));
      s.h = rnd(6, 40);
      s.shift = rnd(10, 48);
      s.x -= s.len / 2; // centred on the spawn point
      s.dir = 1;
      break;
    case "mosaic": // a clump of small blocks, datamosh style
      s.len = rnd(24, 90);
      s.h = rnd(14, 60);
      s.x -= s.len / 2;
      s.dir = 1;
      break;
    case "glyphs": // a band of tiny monospaced letters
      s.len = Math.min(300, rnd(40, Math.max(80, local * 1.2))); // capped: each char is a fillText
      s.h = rnd(8, 11); // font size
      s.rows = Math.random() < 0.3 ? 1 + Math.floor(rnd(1, 5)) : 1;
      s.dark = Math.random() < 0.45;
      break;
    case "noise":
      s.len = rnd(10, 60);
      break;
    default:
      break;
  }
  streaks.push(s);
  if (streaks.length > GLITCH.maxStreaks) streaks.shift();
}

function drawStreak(s, t) {
  if (Math.random() < GLITCH.flicker) return;
  // Extend from nothing to full length after spawning (ease-out).
  const g = Math.min(1, (t - s.born) / s.growMs);
  const len = s.len * (1 - (1 - g) * (1 - g));
  if (len < 1) return;
  const src = toImage(s.x, s.y);
  const x0 = s.dir > 0 ? s.x : s.x - len;
  const pal = GLITCH.palette;

  switch (s.kind) {
    case "stretch": {
      // A 1-3px column of the image, pulled sideways into a long smear.
      ctx.drawImage(img, src.x, src.y, s.srcW / cover.scale, s.h / cover.scale, x0, s.y, len, s.h);
      break;
    }
    case "vstretch": {
      // A 1-3px row of the image, pulled downward (or up) into a drip.
      const y0 = s.dir > 0 ? s.y : s.y - len;
      ctx.drawImage(img, src.x, src.y, s.h / cover.scale, s.srcW / cover.scale, s.x, y0, s.h, len);
      break;
    }
    case "block": {
      // A slab of the image, copied sideways by `shift`.
      const sw = len / cover.scale;
      ctx.drawImage(img, src.x - (s.dir > 0 ? 0 : sw), src.y, sw, s.h / cover.scale, x0 + s.dir * s.shift, s.y, len, s.h);
      break;
    }
    case "slice": {
      // A wide band shifted sideways, with cyan/magenta fringes at its edges
      // to suggest channel separation.
      const sw = len / cover.scale;
      const sh = s.h / cover.scale;
      const dx = s.x + s.shift * (s.seed < 0.5 ? 1 : -1);
      ctx.drawImage(img, src.x, src.y, sw, sh, dx, s.y, len, s.h);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = pal[1];
      ctx.fillRect(dx - 2, s.y, 2, s.h);
      ctx.fillStyle = pal[0];
      ctx.fillRect(dx + len, s.y, 2, s.h);
      ctx.globalAlpha = 1;
      break;
    }
    case "mosaic": {
      // Clump of small blocks: most from the palette, some flat samples of
      // the image. Layout is seeded so it does not crawl between frames.
      const r = prng(s.seed);
      const cell = 3 + Math.floor(r() * 4);
      const cols = Math.max(1, Math.floor(len / cell));
      const rows = Math.max(1, Math.floor(s.h / cell));
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const v = r();
          if (v < 0.42) continue; // gaps
          const bx = s.x + i * cell;
          const by = s.y + j * cell;
          if (v < 0.72) {
            ctx.fillStyle = pal[Math.floor(r() * pal.length)];
            ctx.fillRect(bx, by, cell, cell);
          } else {
            // Flat colour sampled from the image nearby (1px source, stretched).
            const p = toImage(bx + (r() - 0.5) * 40, by + (r() - 0.5) * 40);
            ctx.drawImage(img, p.x, p.y, 1, 1, bx, by, cell, cell);
          }
        }
      }
      break;
    }
    case "glyphs": {
      // Rows of tiny monospaced letters with gaps, light on dark areas or
      // dark on light ones (chosen at spawn).
      const r = prng(s.seed);
      const size = s.h;
      ctx.font = `${size}px ${GLITCH.glyphFont}`;
      ctx.textBaseline = "top";
      ctx.fillStyle = s.dark ? "rgba(20, 20, 24, 0.85)" : "rgba(235, 235, 240, 0.9)";
      const step = size * 0.95;
      const text = GLITCH.glyphText;
      const rows = s.rows || 1;
      for (let j = 0; j < rows; j++) {
        const n = Math.floor(len / step);
        let k = Math.floor(r() * text.length);
        for (let i = 0; i < n; i++) {
          const v = r();
          k = (k + 1) % text.length;
          if (v < 0.3) continue; // dropped characters
          ctx.fillText(text[k], x0 + i * step, s.y + j * (size + 2));
        }
      }
      break;
    }
    case "noise": {
      // Scatter of small saturated squares along the row.
      const r = prng(s.seed);
      const n = Math.floor(len / 4);
      for (let i = 0; i < n; i++) {
        if (r() > 0.45) continue;
        ctx.fillStyle = pal[Math.floor(r() * pal.length)];
        ctx.fillRect(x0 + i * 4, s.y + (i % 2) * 2, 1.5 + r() * 2, 1.5 + r() * 2);
      }
      break;
    }
    default:
      break;
  }
}

function frame(t) {
  rafId = requestAnimationFrame(frame);
  const dt = lastT ? Math.min(50, t - lastT) : 16;
  lastT = t;

  if (held) {
    // Growth in spurts: the rate multiplier wanders toward a new random
    // target every so often, so the spread stalls and lurches.
    if (t >= nextSpurt) {
      spurtTarget = rnd(GLITCH.spurt[0], GLITCH.spurt[1]);
      nextSpurt = t + rnd(GLITCH.spurtEvery[0], GLITCH.spurtEvery[1]);
    }
    spurtMul += (spurtTarget - spurtMul) * 0.08;
    radius = Math.min(Math.hypot(W, H) * 0.9, radius + (GLITCH.growRate * spurtMul * dt) / 1000);
    const count = Math.min(12, Math.ceil(radius * GLITCH.spawnPerPx * spurtMul));
    for (let i = 0; i < count; i++) spawnStreak(t);
  } else {
    // Released: streaks die off in random order; stop when none remain.
    streaks = streaks.filter((s) => t < s.dieAt);
    if (!streaks.length) {
      stopLoop();
      return;
    }
  }

  ctx.clearRect(0, 0, W, H);
  drawBase();
  for (const s of streaks) drawStreak(s, t);
}

function startLoop() {
  if (rafId) return;
  canvas.classList.add("is-active");
  lastT = 0;
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  radius = 0;
  streaks = [];
  ctx.clearRect(0, 0, W, H);
  canvas.classList.remove("is-active");
}

function localPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  cursor = localPoint(e);
  held = true;
  if (!rafId) {
    radius = 4;
    streaks = [];
    makeLobes();
    spurtMul = spurtTarget = 1;
    nextSpurt = 0;
  }
  // Re-press while dying: revive every streak.
  for (const s of streaks) s.dieAt = Infinity;
  startLoop();
}

function onMove(e) {
  if (!held) return;
  cursor = localPoint(e);
}

function onUp() {
  if (!held) return;
  held = false;
  // Give every streak its own death time; the loop runs until all are gone.
  releasedAt = performance.now();
  for (const s of streaks) s.dieAt = releasedAt + rnd(GLITCH.dieMs[0], GLITCH.dieMs[1]);
}

function mountGlitch(el) {
  hero = el.querySelector(".hero");
  img = el.querySelector("#hero-photo");
  canvas = el.querySelector("#hero-glitch");
  if (!hero || !img || !canvas) return;
  ctx = canvas.getContext("2d");
  const ready = () => resize();
  if (img.complete && img.naturalWidth) ready();
  else on(img, "load", ready);
  on(window, "resize", resize);
  on(canvas, "pointerdown", onDown);
  on(canvas, "pointermove", onMove);
  on(canvas, "pointerup", onUp);
  on(canvas, "pointercancel", onUp);
  on(canvas, "contextmenu", (e) => e.preventDefault());
}

// ---------------------------------------------------------------- api

function mount(el) {
  mountIndex(el);
  mountGlitch(el);
}

function unmount() {
  if (ctx) stopLoop();
  for (const off of listeners) off();
  listeners = [];
  rows = [];
  held = false;
}

window.IntroSketch = { mount, unmount };
})();
