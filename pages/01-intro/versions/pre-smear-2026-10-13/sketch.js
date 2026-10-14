// Page 01: the project index, plus a hold-to-glitch effect on the hero photo.
// Exposes window.IntroSketch = { mount(container), unmount() } so the final
// stitched site can host it as one section. Classic script (not a module)
// so the page works when opened straight from file://.

(function () {
"use strict";

const GLITCH = {
  growRate: 40, // px/s mean growth of the glitch extent while held
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
  // Scribble reveal: inside the glitch region the photo becomes the
  // pre-rendered ballpoint drawing (assets/hero-scribble.png) on paper.
  // Set false to go back to glitch-only.
  scribble: false,
  scribbleSrc: "assets/hero-scribble.png",
  paper: "#e6e6ea", // sheet colour under the ink
  scribbleStreakScale: 0.45, // streak density while the scribble is on (keeps the drawing readable)
  boundarySamples: 72, // points around the irregular boundary used for the reveal clip
  // Hover trail: a small glitch that rides with the cursor over the photo
  // without any click. Streaks are short-lived so it trails and clears.
  hover: {
    on: true,
    radius: 36, // px extent around the cursor
    spawnPerFrame: [1, 2],
    life: [220, 800], // ms each streak lives
  },
  // Reveal: while hovering, the glitch eats blocky bites out of the photo
  // around the cursor, exposing a second image beneath; the bites heal when
  // the pointer leaves. Set `on: false` to revert.
  reveal: {
    on: false, // off for now; the chrome assets and alignment stay in place for later
    src: "assets/hero-chrome.jpg", // same aspect as the hero photo
    radius: [26, 110], // px: bite area around the cursor grows from the first to the second while the cursor rests
    growMs: 4000, // ms to reach the full radius
    bitesPerFrame: [2, 4],
    biteW: [12, 90], // px: bites are glitch-shaped: wide, short
    biteH: [2, 12],
    biteLife: [500, 1100], // ms each bite stays before it is removed (hard-edged on/off, no fade)
    maxBites: 700,
    moveReset: 4, // px: cursor movement beyond this restarts the growth, so the old hole closes behind it
    // Registration of the chrome render onto the photo, measured by edge
    // correlation: scale about the centre, then offset as fractions of the
    // photo's width / height (the render was not pixel-aligned as generated).
    align: { scale: 0.975, dx: -36 / 1376, dy: 22 / 768 },
  },
  // Ambient pockets: small glitches that appear on their own at random spots,
  // flare briefly and die, with no input needed.
  ambient: {
    on: true,
    every: [900, 3600], // ms between new pockets
    radius: [12, 42], // px extent of a pocket
    life: [450, 1900], // ms a pocket keeps spawning
    maxPockets: 3,
    spawnPerFrame: [1, 3],
    growMs: 260, // a pocket reaches full extent over this time
  },
};

let listeners = [];
let rows = [];

// Glitch state
let hero, img, canvas, ctx;
let scribbleImg = null; // the pen drawing, same aspect as the photo
let scribbleReady = false;
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
let pockets = []; // ambient glitch pockets {x, y, r, born, endAt}
let nextPocket = 0;
let hovering = false; // pointer is over the photo
const hoverPocket = { x: 0, y: 0, r: 0, hover: true }; // moves with the cursor
// Reveal state
let revealImg = null;
let revealReady = false;
let maskCanvas, maskCtx, layerCanvas, layerCtx;
let maskHasInk = false; // any bite alive
let hoverSince = 0; // when the current hover started (drives the bite radius)
let bites = []; // {x, y, w, h, tail, dieAt}: the eaten rectangles, each hard on until it expires

function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  listeners.push(() => target.removeEventListener(type, fn, opts));
}

// ---------------------------------------------------------------- index rows

function setActive(row) {
  for (const r of rows) r.classList.toggle("is-active", r === row);
}

// Flowing menu: a red marquee banner per row that wipes in from the edge the
// pointer crossed and out by the edge it leaves through. The banner's inner
// layer counter-translates so its content stays put while the red moves.
const FLOW = {
  on: true,
  image: "assets/hero.png", // the pill image inside the marquee
  minParts: 6, // repeats per half; the track holds two halves for a seamless loop
};

function closestEdge(e, el) {
  const r = el.getBoundingClientRect();
  const y = e.clientY - r.top;
  return y < r.height / 2 ? "top" : "bottom";
}

function buildMarquee(row) {
  const num = row.querySelector(".index__num")?.textContent.trim() || "";
  const title = row.querySelector(".index__title")?.textContent.trim() || "";
  const part = () =>
    `<div class="marquee__part"><span>${num} ${title}</span><div class="marquee__img" style="background-image:url('${FLOW.image}')"></div></div>`;
  const half = Array.from({ length: FLOW.minParts }, part).join("");
  const m = document.createElement("div");
  m.className = "marquee";
  m.setAttribute("aria-hidden", "true");
  m.innerHTML = `<div class="marquee__inner"><div class="marquee__track">${half}${half}</div></div>`;
  row.appendChild(m);
  return m;
}

/** Jump the banner to a parked position without animating, then animate to the target. */
function slide(m, fromEdge, toVisible) {
  const inner = m.querySelector(".marquee__inner");
  const sign = fromEdge === "top" ? -1 : 1;
  if (toVisible) {
    m.classList.add("is-snapping");
    m.style.transform = `translate3d(0, ${sign * 101}%, 0)`;
    inner.style.transform = `translate3d(0, ${-sign * 101}%, 0)`;
    void m.offsetHeight; // commit the parked position before animating
    m.classList.remove("is-snapping");
    m.style.transform = "translate3d(0, 0, 0)";
    inner.style.transform = "translate3d(0, 0, 0)";
  } else {
    m.style.transform = `translate3d(0, ${sign * 101}%, 0)`;
    inner.style.transform = `translate3d(0, ${-sign * 101}%, 0)`;
  }
}

function mountIndex(el) {
  rows = Array.from(el.querySelectorAll(".index__row"));
  const list = el.querySelector(".index__list");
  if (!rows.length || !list) return;
  setActive(null); // no resting red row: the banner is the only highlight
  if (!FLOW.on) return;
  for (const r of rows) {
    const m = buildMarquee(r);
    on(r, "pointerenter", (e) => slide(m, closestEdge(e, r), true));
    on(r, "pointerleave", (e) => slide(m, closestEdge(e, r), false));
  }
}

// ---------------------------------------------------------------- glitch

// ---------------------------------------------------------------- reveal

let releasedHoverAt = 0;

function resizeReveal() {
  if (!maskCanvas) {
    maskCanvas = document.createElement("canvas");
    maskCtx = maskCanvas.getContext("2d");
    layerCanvas = document.createElement("canvas");
    layerCtx = layerCanvas.getContext("2d");
  }
  for (const c of [maskCanvas, layerCanvas]) {
    c.width = canvas.width;
    c.height = canvas.height;
  }
  maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bites = [];
  maskHasInk = false;
}

/**
 * Add bites around a resting cursor; drop bites as they expire; rebuild the
 * mask from the live list. Every bite is fully on until the moment it is
 * removed, so the hole grows and shrinks by whole pieces: no fading.
 */
function updateReveal(t) {
  const R = GLITCH.reveal;
  if (!R.on || !revealReady || !maskCtx) return;
  if (hovering && !held) {
    const g = Math.min(1, (t - hoverSince) / R.growMs);
    const radius = R.radius[0] + (R.radius[1] - R.radius[0]) * (1 - (1 - g) * (1 - g));
    const n = Math.floor(rnd(R.bitesPerFrame[0], R.bitesPerFrame[1] + 1));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = radius * Math.sqrt(Math.random());
      const w = Math.round(rnd(R.biteW[0], R.biteW[1]));
      const h = Math.round(rnd(R.biteH[0], R.biteH[1]));
      bites.push({
        x: Math.round(cursor.x + Math.cos(ang) * d - w / 2),
        y: Math.round(cursor.y + Math.sin(ang) * d - h / 2),
        w,
        h,
        // a stray pixel-row tail on some bites, like the stretch streaks
        tail: Math.random() < 0.4 ? Math.round(rnd(10, 90)) : 0,
        dieAt: t + rnd(R.biteLife[0], R.biteLife[1]),
      });
    }
    if (bites.length > R.maxBites) bites.splice(0, bites.length - R.maxBites);
  }
  // Expire, then redraw the mask as hard rectangles.
  if (bites.length) bites = bites.filter((b) => t < b.dieAt);
  maskCtx.globalCompositeOperation = "source-over";
  maskCtx.clearRect(0, 0, W, H);
  maskCtx.fillStyle = "#000";
  for (const b of bites) {
    maskCtx.fillRect(b.x, b.y, b.w, b.h);
    if (b.tail) maskCtx.fillRect(b.x + b.w, b.y + (b.h >> 1), b.tail, 1 + (b.w & 1));
  }
  maskHasInk = bites.length > 0;
}

/** Draw the underlying image through the mask, over the photo. */
function drawReveal() {
  if (!maskHasInk || !revealReady) return;
  layerCtx.globalCompositeOperation = "source-over";
  layerCtx.clearRect(0, 0, W, H);
  // The chrome is drawn into the photo's cover rect, then registered to it.
  const al = GLITCH.reveal.align || { scale: 1, dx: 0, dy: 0 };
  const cw = img.naturalWidth * cover.scale;
  const ch = img.naturalHeight * cover.scale;
  const dw = cw * al.scale;
  const dh = ch * al.scale;
  // Edge fill first (a plain stretch-to-fit), so the thin strips the
  // registered copy leaves uncovered at the frame edges still show chrome.
  layerCtx.drawImage(revealImg, cover.ox, cover.oy, cw, ch);
  layerCtx.drawImage(revealImg, cover.ox + (cw - dw) / 2 + cw * al.dx, cover.oy + (ch - dh) / 2 + ch * al.dy, dw, dh);
  layerCtx.globalCompositeOperation = "destination-in";
  layerCtx.save();
  layerCtx.setTransform(1, 0, 0, 1, 0, 0);
  layerCtx.drawImage(maskCanvas, 0, 0);
  layerCtx.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layerCanvas, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------- canvas

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

/** Trace the irregular boundary as a closed path (for clipping the reveal). */
function boundaryPath(t) {
  const n = GLITCH.boundarySamples;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const d = extentAt(ang, t);
    const x = cursor.x + Math.cos(ang) * d;
    const y = cursor.y + Math.sin(ang) * d;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Inside the boundary: paper, then the pen drawing mapped exactly like the photo. */
function drawScribbleReveal(t) {
  if (!scribbleReady) return;
  ctx.save();
  boundaryPath(t);
  ctx.clip();
  ctx.fillStyle = GLITCH.paper;
  ctx.fillRect(0, 0, W, H);
  // The drawing shares the photo's aspect ratio, so the photo's cover
  // transform places it pixel-for-pixel over the same features.
  const sx = (img.naturalWidth * cover.scale) / scribbleImg.naturalWidth;
  ctx.drawImage(scribbleImg, cover.ox, cover.oy, scribbleImg.naturalWidth * sx, scribbleImg.naturalHeight * sx);
  ctx.restore();
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

/**
 * Spawn one streak. With no `pocket`, it goes inside the cursor's irregular
 * boundary (biased toward it, sometimes clumped). With a pocket, it goes
 * inside that pocket's small circle and is tagged so it dies with it.
 */
function spawnStreak(t, pocket) {
  const cx = pocket ? pocket.x : cursor.x;
  const cy = pocket ? pocket.y : cursor.y;
  const extent = (ang) => (pocket ? pocket.r : extentAt(ang, t));
  const own = pocket ? streaks.filter((s) => s.pocket === pocket) : streaks;
  let x, y, ang;
  if (own.length && Math.random() < GLITCH.clusterChance) {
    // Clump next to an existing streak.
    const o = own[Math.floor(Math.random() * own.length)];
    x = o.x + rnd(-18, 18);
    y = o.y + rnd(-10, 10);
    ang = Math.atan2(y - cy, x - cx);
  } else {
    ang = Math.random() * Math.PI * 2;
    const u = Math.random();
    const dist = extent(ang) * (GLITCH.edgeBias * Math.sqrt(u) + (1 - GLITCH.edgeBias) * u);
    x = cx + Math.cos(ang) * dist;
    y = cy + Math.sin(ang) * dist;
  }
  const dir = Math.cos(ang) >= 0 ? 1 : -1; // smear away from the centre
  const kind = pickKind();
  const local = extent(ang);
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
    pocket: pocket || null,
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

/** Ambient pockets: spawn new ones on a random timer, feed the live ones, retire the old. */
function updatePockets(t) {
  const A = GLITCH.ambient;
  if (!A.on) return;
  if (t >= nextPocket) {
    if (pockets.length < A.maxPockets) {
      const r = rnd(A.radius[0], A.radius[1]);
      pockets.push({
        x: rnd(r, W - r),
        y: rnd(r, H - r),
        rTarget: r,
        r: 4,
        born: t,
        endAt: t + rnd(A.life[0], A.life[1]),
      });
    }
    nextPocket = t + rnd(A.every[0], A.every[1]);
  }
  for (const p of pockets) {
    const g = Math.min(1, (t - p.born) / A.growMs);
    p.r = 4 + (p.rTarget - 4) * (1 - (1 - g) * (1 - g));
    if (t < p.endAt) {
      const n = Math.floor(rnd(A.spawnPerFrame[0], A.spawnPerFrame[1] + 1));
      for (let i = 0; i < n; i++) spawnStreak(t, p);
    }
  }
  // Retire finished pockets: their streaks get random death times.
  const done = pockets.filter((p) => t >= p.endAt);
  if (done.length) {
    for (const s of streaks) {
      if (s.pocket && done.includes(s.pocket) && s.dieAt === Infinity) {
        s.dieAt = t + rnd(GLITCH.dieMs[0], GLITCH.dieMs[1]);
      }
    }
    pockets = pockets.filter((p) => t < p.endAt);
  }
}

function frame(t) {
  rafId = requestAnimationFrame(frame);
  const dt = lastT ? Math.min(50, t - lastT) : 16;
  lastT = t;

  updatePockets(t);
  updateReveal(t);
  // Hover trail: feed a small pocket that sits on the cursor while it is
  // over the photo and not held; its streaks expire on their own.
  if (GLITCH.hover.on && hovering && !held) {
    const Hv = GLITCH.hover;
    hoverPocket.x = cursor.x;
    hoverPocket.y = cursor.y;
    hoverPocket.r = Hv.radius;
    const n = Math.floor(rnd(Hv.spawnPerFrame[0], Hv.spawnPerFrame[1] + 1));
    for (let i = 0; i < n; i++) {
      spawnStreak(t, hoverPocket);
      streaks[streaks.length - 1].dieAt = t + rnd(Hv.life[0], Hv.life[1]);
    }
  }
  // Streaks past their death time go, whoever owns them.
  streaks = streaks.filter((s) => t < s.dieAt);

  if (held) {
    // Growth in spurts: the rate multiplier wanders toward a new random
    // target every so often, so the spread stalls and lurches.
    if (t >= nextSpurt) {
      spurtTarget = rnd(GLITCH.spurt[0], GLITCH.spurt[1]);
      nextSpurt = t + rnd(GLITCH.spurtEvery[0], GLITCH.spurtEvery[1]);
    }
    spurtMul += (spurtTarget - spurtMul) * 0.08;
    radius = Math.min(Math.hypot(W, H) * 0.9, radius + (GLITCH.growRate * spurtMul * dt) / 1000);
    const density = GLITCH.spawnPerPx * (GLITCH.scribble && scribbleReady ? GLITCH.scribbleStreakScale : 1);
    const count = Math.min(12, Math.ceil(radius * density * spurtMul));
    for (let i = 0; i < count; i++) spawnStreak(t);
  }

  // Nothing to show: hide the canvas so the plain <img> is what's seen.
  if (!streaks.length && !held && !maskHasInk) {
    if (canvas.classList.contains("is-active")) {
      ctx.clearRect(0, 0, W, H);
      canvas.classList.remove("is-active");
    }
    return;
  }
  canvas.classList.add("is-active");
  ctx.clearRect(0, 0, W, H);
  drawBase();
  if (GLITCH.reveal.on) drawReveal();
  if (GLITCH.scribble && held) drawScribbleReveal(t);
  for (const s of streaks) drawStreak(s, t);
}

function startLoop() {
  if (rafId) return;
  lastT = 0;
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  radius = 0;
  streaks = [];
  pockets = [];
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
  // Fresh press (no cursor streaks alive): new boundary and growth.
  if (!streaks.some((s) => !s.pocket)) {
    radius = 4;
    makeLobes();
    spurtMul = spurtTarget = 1;
    nextSpurt = 0;
  }
  // Re-press while dying: revive the cursor's streaks (pockets keep their own clocks).
  for (const s of streaks) if (!s.pocket) s.dieAt = Infinity;
  startLoop();
}

function onMove(e) {
  const p = localPoint(e);
  // A real move restarts the reveal's growth from its small start radius.
  if (!hovering || Math.hypot(p.x - cursor.x, p.y - cursor.y) > GLITCH.reveal.moveReset) hoverSince = performance.now();
  cursor = p;
  hovering = true;
}

function onLeave() {
  hovering = false;
  releasedHoverAt = performance.now();
}

function onUp() {
  if (!held) return;
  held = false;
  // Give the cursor's streaks their own death times; pockets are untouched.
  releasedAt = performance.now();
  for (const s of streaks) if (!s.pocket) s.dieAt = releasedAt + rnd(GLITCH.dieMs[0], GLITCH.dieMs[1]);
}

function mountGlitch(el) {
  hero = el.querySelector(".hero");
  img = el.querySelector("#hero-photo");
  canvas = el.querySelector("#hero-glitch");
  if (!hero || !img || !canvas) return;
  ctx = canvas.getContext("2d");
  // Once the photo is in, size the canvas and start the always-on loop
  // (ambient pockets need it running without any input).
  const ready = () => {
    resize();
    resizeReveal();
    startLoop();
  };
  if (GLITCH.reveal.on) {
    revealImg = new Image();
    revealImg.onload = () => { revealReady = true; };
    revealImg.src = GLITCH.reveal.src;
  }
  if (img.complete && img.naturalWidth) ready();
  else on(img, "load", ready);
  if (GLITCH.scribble) {
    scribbleImg = new Image();
    scribbleImg.onload = () => { scribbleReady = true; };
    scribbleImg.src = GLITCH.scribbleSrc;
  }
  on(window, "resize", () => { resize(); resizeReveal(); });
  on(canvas, "pointerdown", onDown);
  on(canvas, "pointermove", onMove);
  on(canvas, "pointerup", onUp);
  on(canvas, "pointercancel", onUp);
  on(canvas, "pointerenter", onMove);
  on(canvas, "pointerleave", onLeave);
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
