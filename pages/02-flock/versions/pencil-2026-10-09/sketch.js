// Page 02: draw a path with a right-click drag; on release a flock follows it.
// Exposes window.FlockSketch = { mount(container), unmount() } so the final
// stitched site can host it as one section without edits. Classic script (not
// a module) so the page works when opened straight from file://.

(function () {
"use strict";

const CONFIG = {
  minPointGap: 8, // px between captured stroke points (larger = less mouse jitter captured)
  jitterWindow: 3, // moving-average radius over raw points before splining
  resampleGap: 10, // px between path samples after release
  minSamples: 3,
  boidsPerStroke: 16,
  maxBoids: 112,
  boidFade: 500, // ms each particle takes to shrink away at the end of its life
  tailSpread: 20, // path samples the flock is spread over at spawn (tail to head)
  tailLife: 0.45, // tail particle dies this fraction of the way along the path; head at 1.0
  lifeJitter: 0.12, // random +/- fraction applied to each particle's life
  strokeDash: [6, 6], // dash/gap px for the drawn path
  strokeAlpha: 0.28, // opacity of the path: light graphite, not a hard line
  strokeWidth: 0.8, // px: thin pencil line
  strokePasses: 2, // layered offset passes for a soft pencil edge
  dashFade: 350, // ms each dash takes to fade
  dashStagger: 18, // ms between one dash starting to fade and the next
  controlGap: 28, // px between spline control points; larger = follows the broad gesture, ignores wobble
  smoothDegree: 3, // Lane-Riesenfeld averaging steps per pass: 2 = quadratic (Chaikin), 3 = cubic B-spline
  smoothPasses: 4, // subdivision passes; the result is dense enough to draw as a polyline
  lookAhead: 5, // samples ahead the boid steers toward (larger = gentler, wider turns)
  advanceRate: 36, // path samples per second the target index moves (10px samples = 360px/s)
  maxSpeed: 5.2, // px per frame
  maxForce: 0.2, // lower = larger turning radius, smoother arcs
  accSmoothing: 0.09, // per-frame blend of new steering into the current one (lower = smoother, laggier)
  neighborDist: 32,
  separationDist: 10,
  wanderTurn: 0.07, // radians of random heading change per frame for the wander force
  weights: { path: 2.0, separation: 0.8, alignment: 0.9, cohesion: 0.5, wander: 0.1 },
  spawnSpread: 40, // px of random offset around each boid's spawn point
  // Per-boid variation so every particle has its own path, school-of-fish style.
  laneSpread: 52, // px: each boid rides a fixed lateral offset from the spline in [-laneSpread, laneSpread]
  wobbleAmp: 30, // px: amplitude of a slow side-to-side sway added to that offset
  wobbleFreq: [0.03, 0.08], // sway cycles per path sample, random per boid (slower = longer, wider arcs)
  wobbleDecay: 1.6, // sway amplitude is scaled by (1 - progress)^wobbleDecay: big waves early, calm by the end
  paceSpread: 0.35, // each boid's base pace is 1 +/- paceSpread times the flock rate
  // Speed profiles (fraction of boids): how pace changes over a boid's trip.
  profileMix: { burst: 0.3, lag: 0.25, surge: 0.3, steady: 0.15 },
  // Rogues: a few boids that mostly ignore the path and loop off on their own,
  // held only loosely near the flock so they never leave the scene entirely.
  rogueFraction: 0.08,
  rogueMin: 2, // at least this many per flock
  rogueWeights: { path: 0.7, separation: 0.8, alignment: 0.2, cohesion: 0.3, wander: 1.3 },
  rogueTurnBias: [0.02, 0.045], // rad/frame steady heading drift, random per rogue (makes loops)
  rogueTurnWobble: 0.06, // extra random heading noise per frame
  trailMs: 5_000, // how long a boid's trail lingers behind it
  trailAlpha: 0.55, // constant opacity of the trail
  trailWidth: 1.95, // px: plain-line trail width right behind the boid; tapers to 0 at the tail
  lineAlpha: 0.195, // opacity per pass for plain pencil lines (tubes/cubes use pencilAlpha)
  trailBuckets: 8, // width steps the trail is drawn in (more = smoother taper, more strokes)
  // Pencil look for the flock: layered offset passes in graphite, multiplied
  // where they overlap, then eroded by a paper-grain mask.
  // Pencil pressure: a slow per-boid signal in 0..1 recorded along the
  // trail, mapped to width and darkness, so lines press harder in places.
  pressurePeriod: [1_400, 4_000], // ms: slow component period, random per boid
  pressureFlutter: [450, 1_100], // ms: faster component period
  pressureWidth: [0.5, 1.35], // width factor at pressure 0 and 1
  pressureAlpha: [0.4, 1.55], // darkness factor at pressure 0 and 1
  pressureLevels: 5, // runs of equal pressure are drawn as one stroke
  pencilPasses: 3, // strokes per trail; the first is centred, the rest jittered
  pencilJitter: 0.5, // px: max offset of the extra passes (fixed per boid, so no shimmer)
  pencilAlpha: 0.3, // opacity per pass
  grainStrength: 0.5, // 0..1 how much the paper grain eats into the marks
  grainTile: 256, // px: size of the repeating grain tile
  // Tube style: a share of boids draw as skinny hand-drawn cylinders (two
  // contour edges, elliptical cap, ring lines) instead of a single stroke.
  tubeFraction: 0.5,
  tubeWidth: 7, // px: tube diameter at the head; tapers to a point at the tail
  tubeJitter: 0.14, // 0..1 how much the contour edges wobble (hand-drawn feel)
  tubeRingEvery: 14, // history points between ring lines along the tube
  tubePasses: 2, // pencil passes per edge (fewer than trails; tubes have 2 edges)
  // Chrome style: a few boids draw as smooth 3D metal cylinders (no pencil
  // wobble; a cross-section gradient does the shading).
  chromeFraction: 0.08,
  blackChromePerFlock: 1, // extra chrome trails per flock in black metal (uses coneStops)
  chromeWidth: 8, // px diameter at the head
  chromeStops: [
    [0.0, "#24262b"],
    [0.18, "#b9bdc4"],
    [0.32, "#ffffff"],
    [0.46, "#9ea3ab"],
    [0.62, "#3b3e45"],
    [0.82, "#6d7179"],
    [1.0, "#1d1f23"],
  ],
  // Orbiters: small 3D objects that orbit boids and weave through the trails.
  cubesPerFlock: 5, // pencil-shaded white cubes
  conesPerFlock: 3, // black chrome cones
  spheresPerFlock: 3, // white-filled wireframe spheres
  cubeSize: 5, // px half-edge
  sphereRadius: 11, // px
  sphereMeridians: 6, // longitude lines (each a full great circle)
  sphereParallels: 3, // latitude lines (excluding the equator count: these are spread evenly)
  coneHeight: 15, // px apex to base
  coneRadius: 5, // px base radius
  coneStops: [
    [0.0, "#000000"],
    [0.2, "#2c2e33"],
    [0.36, "#d6d9de"],
    [0.5, "#3a3d43"],
    [0.72, "#0a0a0c"],
    [0.88, "#45484e"],
    [1.0, "#000000"],
  ],
  orbitRadius: [16, 44], // px, random per orbiter; breathes +/- 40% so it crosses the trail band
  orbitSpeed: [0.7, 1.5], // rad/s around the host boid
  orbitSpin: [0.6, 1.4], // rad/s self-rotation
  orbitHostSwapMs: [3_000, 7_000], // how often an orbiter picks a new boid to orbit
  orbitFollow: 0.06, // per-frame ease of the anchor toward its host (smooth host swaps)
  orbitNearest: 3, // on a host swap, choose among this many nearest boids (no jumps across the flock)
  // Lead shapes: extra orbiters that always host onto the frontmost boids
  // and ride close to the head of the flock.
  leadShapesPerFlock: 2,
  leadShapes: ["sphere", "cube", "cone"], // picked at random per lead shape
  leadOrbitRadius: [8, 18], // px: tighter orbit than the rest
  leadFront: 3, // host is chosen among this many boids furthest along the path
  orbitMaxDrift: 110, // px/s cap on how fast the anchor may move, so a shape never lurches
  orbitExitAt: [0.3, 0.85], // each orbiter picks a random point along the host's path to scale off at
  orbitExitSpan: [0.06, 0.14], // and how much of the path the scale-off takes
  // Text weavers: this many boids per flock may draw on the front canvas
  // (above the copy) while their depth is positive, so they cross over and
  // under the text when a path is drawn across it.
  textWeaversPerFlock: 2,
  // Depth: each boid's z drifts on a slow sine; everything is drawn in short
  // chunks sorted by z, so white-filled tubes weave over and under trails.
  depthPeriod: [2_000, 5_000], // ms per z cycle, random per boid
  boidSize: 2.2,
};

let accentRgb = "214, 58, 58";
let pencilRgb = "52, 52, 58";
let grainPattern = null;
let canvas, ctx, container, hint;
let canvasFront, ctxFront; // layer above the copy text
let ctxBack; // the main (input) canvas context; `ctx` is swapped per draw item
let width = 0;
let height = 0;
let dpr = 1;
let rafId = 0;
let listeners = [];

/** @typedef {{x:number,y:number}} Pt */
/** @typedef {{points: Pt[], endedAt: number|null, pointerId: number, dashes?: Pt[][]}} Stroke */
/** @type {Stroke|null} */
let stroke = null;
/** @type {Stroke[]} */
let fadingStrokes = [];
/** @type {Flock[]} */
let flocks = [];

// ---------------------------------------------------------------- helpers

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function limit(v, max) {
  const m = Math.hypot(v.x, v.y);
  if (m > max && m > 0) {
    v.x = (v.x / m) * max;
    v.y = (v.y / m) * max;
  }
  return v;
}

function setMag(v, mag) {
  const m = Math.hypot(v.x, v.y) || 1;
  v.x = (v.x / m) * mag;
  v.y = (v.y / m) * mag;
  return v;
}

/** Moving average over raw mouse points; endpoints are kept so the curve starts and ends where drawn. */
function denoise(points, radius) {
  if (points.length < 3 || radius < 1) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let k = -radius; k <= radius; k++) {
      const p = points[Math.min(points.length - 1, Math.max(0, i + k))];
      sx += p.x;
      sy += p.y;
      c++;
    }
    out.push({ x: sx / c, y: sy / c });
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Turn raw mouse points into a smooth spline:
 * 1. denoise jitter, 2. thin to coarse control points so the curve follows
 * the gesture rather than every wobble, 3. Lane-Riesenfeld subdivision
 * (double every point, then average `smoothDegree` times per pass), which
 * converges to a uniform B-spline of that degree. Endpoints stay pinned.
 */
function smooth(points, passes) {
  let pts = resample(denoise(points, CONFIG.jitterWindow), CONFIG.controlGap);
  if (pts.length < 3) return pts;
  for (let p = 0; p < passes; p++) {
    let d = [];
    for (const q of pts) d.push(q, q);
    for (let k = 0; k < CONFIG.smoothDegree; k++) {
      const out = [d[0]];
      for (let i = 0; i < d.length - 1; i++) {
        out.push({ x: (d[i].x + d[i + 1].x) / 2, y: (d[i].y + d[i + 1].y) / 2 });
      }
      out.push(d[d.length - 1]);
      d = out;
    }
    pts = d;
  }
  return pts;
}

/** Unit left-hand normal at each sample of a polyline (central difference). */
function pathNormals(points) {
  const n = points.length;
  return points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const m = Math.hypot(tx, ty) || 1;
    return { x: -ty / m, y: tx / m };
  });
}

/** Resample a polyline to evenly spaced points. */
function resample(points, gap) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    let a = points[i - 1];
    const b = points[i];
    let segLen = dist(a, b);
    while (carry + segLen >= gap) {
      const t = (gap - carry) / segLen;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(p);
      a = p;
      segLen = dist(a, b);
      carry = 0;
    }
    carry += segLen;
  }
  if (dist(out[out.length - 1], points[points.length - 1]) > gap * 0.5) {
    out.push(points[points.length - 1]);
  }
  return out;
}

// ---------------------------------------------------------------- flocks

/**
 * Pick a speed profile for a boid. Returned object is read by profilePace().
 *  burst: starts fast, eases down   lag: starts slow, winds up
 *  surge: speeds up and slows in waves   steady: constant
 */
function makeProfile() {
  const m = CONFIG.profileMix;
  let r = Math.random() * (m.burst + m.lag + m.surge + m.steady);
  if ((r -= m.burst) < 0) return { type: "burst", a: 1.5 + Math.random() * 0.7, b: 0.5 + Math.random() * 0.25 };
  if ((r -= m.lag) < 0) return { type: "lag", a: 0.5 + Math.random() * 0.25, b: 1.3 + Math.random() * 0.6 };
  if ((r -= m.surge) < 0) {
    return { type: "surge", k: 1 + Math.floor(Math.random() * 3), amp: 0.3 + Math.random() * 0.35, phase: Math.random() * Math.PI * 2 };
  }
  return { type: "steady" };
}

/** Pace multiplier for a profile at progress s in [0, 1] along the path. */
function profilePace(p, s) {
  switch (p.type) {
    case "burst": return p.a + (p.b - p.a) * (1 - (1 - s) * (1 - s)); // ease-out: drops quickly, then levels
    case "lag": return p.a + (p.b - p.a) * s * s; // ease-in: dawdles, then takes off
    case "surge": return 1 + p.amp * Math.sin(s * Math.PI * 2 * p.k + p.phase);
    default: return 1;
  }
}

class Boid {
  constructor(x, y, t, bornAt, life, pace, profile) {
    this.t0 = t; // where on the path this boid started; progress is measured from here
    this.profile = profile;
    this.speedCap = CONFIG.maxSpeed;
    this.rogue = false;
    this.turnBias = 0;
    this.overText = false;
    // Style: chrome (few), pencil tube (many), or plain pencil line (rest).
    const styleRoll = Math.random();
    this.chrome = styleRoll < CONFIG.chromeFraction;
    this.chromeBlack = false;
    this.tube = !this.chrome && styleRoll < CONFIG.chromeFraction + CONFIG.tubeFraction;
    const [z0, z1] = CONFIG.depthPeriod;
    this.zFreq = (Math.PI * 2) / (z0 + Math.random() * (z1 - z0));
    this.zPhase = Math.random() * Math.PI * 2;
    const [p0, p1] = CONFIG.pressurePeriod;
    const [q0, q1] = CONFIG.pressureFlutter;
    this.pFreq = (Math.PI * 2) / (p0 + Math.random() * (p1 - p0));
    this.pFlut = (Math.PI * 2) / (q0 + Math.random() * (q1 - q0));
    this.pPhase = Math.random() * Math.PI * 2;
    this.pPhase2 = Math.random() * Math.PI * 2;
    this.pos = { x, y };
    this.vel = { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 };
    this.acc = { x: 0, y: 0 };
    this.t = t; // fractional index into the flock's path
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.bornAt = bornAt;
    this.life = life; // ms; random per particle
    // Personal path: lateral lane, sway, and pace.
    this.pace = pace;
    this.lane = (Math.random() * 2 - 1) * CONFIG.laneSpread;
    this.wobbleAmp = CONFIG.wobbleAmp * (0.5 + Math.random() * 0.5);
    const [f0, f1] = CONFIG.wobbleFreq;
    this.wobbleFreq = (f0 + Math.random() * (f1 - f0)) * Math.PI * 2;
    this.wobblePhase = Math.random() * Math.PI * 2;
    /** @type {{x:number,y:number,t:number}[]} oldest first */
    this.hist = [];
    // Pencil passes: fixed per boid so the layered strokes do not shimmer.
    this.passes = Array.from({ length: CONFIG.pencilPasses }, (_, i) => ({
      dx: i === 0 ? 0 : (Math.random() - 0.5) * 2 * CONFIG.pencilJitter,
      dy: i === 0 ? 0 : (Math.random() - 0.5) * 2 * CONFIG.pencilJitter,
      w: 0.6 + Math.random() * 0.7, // pressure variation
      a: 0.7 + Math.random() * 0.5,
    }));
  }

  /** Pencil pressure 0..1 at time `now`: slow swell plus a faster flutter. */
  pressure(now) {
    const v = 0.65 * Math.sin(now * this.pFreq + this.pPhase) + 0.35 * Math.sin(now * this.pFlut + this.pPhase2);
    return 0.5 + 0.5 * v;
  }

  /** 1 for most of the life, shrinking to 0 over the last boidFade ms. Scales dot and trail. */
  scale(now) {
    const left = this.life - (now - this.bornAt);
    if (left <= 0) return 0;
    return Math.min(1, left / CONFIG.boidFade);
  }

  dead(now) {
    return now - this.bornAt >= this.life;
  }
}

/** A small 3D object (cube or cone) orbiting one of a flock's boids. */
class Orbiter {
  constructor(shape, host, now, lead = false) {
    const rnd = (r) => r[0] + Math.random() * (r[1] - r[0]);
    this.shape = shape;
    this.lead = lead; // tracks the front of the flock instead of wandering hosts
    this.host = host;
    this.anchor = { x: host.pos.x, y: host.pos.y };
    this.pos = { x: host.pos.x, y: host.pos.y };
    this.theta = Math.random() * Math.PI * 2;
    this.omega = rnd(CONFIG.orbitSpeed) * (Math.random() < 0.5 ? -1 : 1);
    this.radius = rnd(lead ? CONFIG.leadOrbitRadius : CONFIG.orbitRadius);
    this.breathe = Math.random() * Math.PI * 2;
    this.rot = { x: Math.random() * 6, y: Math.random() * 6, z: Math.random() * 6 };
    this.spin = { x: rnd(CONFIG.orbitSpin), y: rnd(CONFIG.orbitSpin) * 0.7, z: rnd(CONFIG.orbitSpin) * 0.4 };
    this.nextSwap = now + rnd(CONFIG.orbitHostSwapMs);
    this.z = 0;
    this.scale = 1;
    this.exitAt = rnd(CONFIG.orbitExitAt);
    this.exitSpan = rnd(CONFIG.orbitExitSpan);
    this.gone = false; // once scaled off it stays off, even if a later host is further back
  }

  step(now, dt, boids, pathLen) {
    const sec = dt / 1000;
    if (this.gone || !boids.length) return;
    if (this.host.dead(now) || now >= this.nextSwap) {
      // New host: lead shapes take one of the frontmost boids (furthest
      // along the path); the rest take one of the few nearest the current
      // anchor, so a shape drifts to a neighbour rather than leaping.
      const near = boids
        .filter((b) => b !== this.host)
        .sort(this.lead
          ? (p, q) => q.t - p.t
          : (p, q) => dist(p.pos, this.anchor) - dist(q.pos, this.anchor))
        .slice(0, this.lead ? CONFIG.leadFront : CONFIG.orbitNearest);
      if (near.length) this.host = near[Math.floor(Math.random() * near.length)];
      const [a, b] = CONFIG.orbitHostSwapMs;
      this.nextSwap = now + a + Math.random() * (b - a);
    }
    // Ease the anchor toward the host, with a hard cap on its speed.
    const f = CONFIG.orbitFollow;
    let mx = (this.host.pos.x - this.anchor.x) * f;
    let my = (this.host.pos.y - this.anchor.y) * f;
    const maxStep = CONFIG.orbitMaxDrift * sec;
    const mlen = Math.hypot(mx, my);
    if (mlen > maxStep) {
      mx = (mx / mlen) * maxStep;
      my = (my / mlen) * maxStep;
    }
    this.anchor.x += mx;
    this.anchor.y += my;
    this.theta += this.omega * sec;
    this.breathe += 0.9 * sec;
    const r = this.radius * (1 + 0.4 * Math.sin(this.breathe));
    this.pos.x = this.anchor.x + Math.cos(this.theta) * r;
    this.pos.y = this.anchor.y + Math.sin(this.theta) * r * 0.6; // slightly flattened orbit
    this.z = Math.sin(this.theta); // front half of the orbit is in front of the trails
    this.rot.x += this.spin.x * sec;
    this.rot.y += this.spin.y * sec;
    this.rot.z += this.spin.z * sec;
    // Scale off at this orbiter's own random point along the host's path
    // (eased), well before the end; never outlive the host's own shrink.
    const h = this.host;
    const progress = Math.min(1, (h.t - h.t0) / Math.max(1, pathLen - 1 - h.t0));
    const left = Math.max(0, Math.min(1, (this.exitAt - progress) / this.exitSpan));
    const eased = left * left * (3 - 2 * left); // smoothstep
    this.scale = Math.min(h.scale(now), eased);
    if (this.scale <= 0) this.gone = true;
  }
}

class Flock {
  constructor(path, count, bornAt) {
    this.path = path; // smoothed + resampled; boids follow it
    this.normals = pathNormals(path); // unit left-normal per sample, for lane offsets
    this.bornAt = bornAt;
    this.boids = [];
    const start = path[0];
    const n = path.length;
    // Life depends on the path: a particle's time-to-end is how long it takes
    // to travel from its start sample to the last one. The head lives the
    // full trip; the tail dies part-way (tailLife), so the ribbon shrinks
    // from the tail forward and nothing outlives the end of the path.
    for (let i = 0; i < count; i++) {
      const rank = i / Math.max(1, count - 1); // 0 = tail, 1 = head
      const t = Math.min(n - 1, rank * CONFIG.tailSpread + Math.random() * 0.8);
      const p = path[Math.floor(t)] || start;
      const pace = 1 + (Math.random() * 2 - 1) * CONFIG.paceSpread;
      const profile = makeProfile();
      // Time to the end = distance / speed integrated over the profile, so a
      // burst boid that slows down still dies exactly at the end of the path.
      const S = 24;
      let invSum = 0;
      for (let k = 0; k < S; k++) invSum += 1 / (pace * profilePace(profile, (k + 0.5) / S));
      const toEndMs = ((n - 1 - t) / CONFIG.advanceRate) * (invSum / S) * 1000;
      const fraction = CONFIG.tailLife + (1 - CONFIG.tailLife) * rank;
      const jitter = 1 + (Math.random() * 2 - 1) * CONFIG.lifeJitter;
      const life = Math.max(CONFIG.boidFade, toEndMs * Math.min(1, fraction * jitter));
      this.boids.push(
        new Boid(
          p.x + (Math.random() - 0.5) * CONFIG.spawnSpread,
          p.y + (Math.random() - 0.5) * CONFIG.spawnSpread,
          t,
          bornAt,
          life,
          pace,
          profile
        )
      );
    }
    this.orbiters = [];
    const pick = () => this.boids[Math.floor(Math.random() * this.boids.length)];
    for (let i = 0; i < CONFIG.cubesPerFlock && this.boids.length; i++) {
      this.orbiters.push(new Orbiter("cube", pick(), bornAt));
    }
    for (let i = 0; i < CONFIG.conesPerFlock && this.boids.length; i++) {
      this.orbiters.push(new Orbiter("cone", pick(), bornAt));
    }
    for (let i = 0; i < CONFIG.spheresPerFlock && this.boids.length; i++) {
      this.orbiters.push(new Orbiter("sphere", pick(), bornAt));
    }
    // Lead shapes start on the frontmost boids (highest t = head of the ribbon).
    const byFront = this.boids.slice().sort((p, q) => q.t - p.t);
    for (let i = 0; i < CONFIG.leadShapesPerFlock && byFront.length; i++) {
      const shape = CONFIG.leadShapes[Math.floor(Math.random() * CONFIG.leadShapes.length)];
      this.orbiters.push(new Orbiter(shape, byFront[i % byFront.length], bornAt, true));
    }
    // Black chrome: promote a non-chrome boid (or more) to black metal.
    const blackPool = this.boids.filter((b) => !b.chrome);
    for (let i = 0; i < CONFIG.blackChromePerFlock && blackPool.length; i++) {
      const b = blackPool.splice(Math.floor(Math.random() * blackPool.length), 1)[0];
      b.chrome = true;
      b.chromeBlack = true;
      b.tube = false;
    }
    // Text weavers: a couple of boids allowed onto the front canvas.
    const weavePool = this.boids.slice();
    for (let i = 0; i < CONFIG.textWeaversPerFlock && weavePool.length; i++) {
      weavePool.splice(Math.floor(Math.random() * weavePool.length), 1)[0].overText = true;
    }
    // Pick the rogues: random boids that get their own rules and a steady
    // turning bias (random direction) so they carve loops away from the path.
    const rogues = Math.max(CONFIG.rogueMin, Math.round(count * CONFIG.rogueFraction));
    const [t0, t1] = CONFIG.rogueTurnBias;
    const pool = this.boids.slice();
    for (let i = 0; i < rogues && pool.length; i++) {
      const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      b.rogue = true;
      b.turnBias = (t0 + Math.random() * (t1 - t0)) * (Math.random() < 0.5 ? -1 : 1);
    }
  }

  /** True while no boid has started shrinking; used for the population cap. */
  fresh(now) {
    return this.boids.length > 0 && this.boids[0].scale(now) >= 1;
  }

  /** Cut every remaining life short, keeping tail-first order, so the flock clears fast. */
  expire(now, within) {
    this.boids.forEach((b, i) => {
      const rank = i / Math.max(1, this.boids.length - 1);
      const remaining = CONFIG.boidFade + rank * within + Math.random() * 200;
      b.life = Math.min(b.life, now - b.bornAt + remaining);
    });
  }

  dead() {
    return this.boids.length === 0;
  }

  step(now, dt) {
    this.boids = this.boids.filter((b) => !b.dead(now));
    const { boids, path, normals } = this;
    const n = path.length;
    const advance = (CONFIG.advanceRate * dt) / 1000;

    for (const b of boids) {
      const W = b.rogue ? CONFIG.rogueWeights : CONFIG.weights;
      let sep = { x: 0, y: 0 };
      let ali = { x: 0, y: 0 };
      let coh = { x: 0, y: 0 };
      let sepCount = 0;
      let nCount = 0;

      for (const o of boids) {
        if (o === b) continue;
        const d = dist(b.pos, o.pos);
        if (d > 0 && d < CONFIG.neighborDist) {
          ali.x += o.vel.x;
          ali.y += o.vel.y;
          coh.x += o.pos.x;
          coh.y += o.pos.y;
          nCount++;
          if (d < CONFIG.separationDist) {
            sep.x += (b.pos.x - o.pos.x) / d;
            sep.y += (b.pos.y - o.pos.y) / d;
            sepCount++;
          }
        }
      }

      if (sepCount) {
        sep.x /= sepCount;
        sep.y /= sepCount;
        setMag(sep, CONFIG.maxSpeed);
        sep.x -= b.vel.x;
        sep.y -= b.vel.y;
        limit(sep, CONFIG.maxForce);
      }
      if (nCount) {
        ali.x /= nCount;
        ali.y /= nCount;
        setMag(ali, CONFIG.maxSpeed);
        ali.x -= b.vel.x;
        ali.y -= b.vel.y;
        limit(ali, CONFIG.maxForce);

        coh.x = coh.x / nCount - b.pos.x;
        coh.y = coh.y / nCount - b.pos.y;
        setMag(coh, CONFIG.maxSpeed);
        coh.x -= b.vel.x;
        coh.y -= b.vel.y;
        limit(coh, CONFIG.maxForce);
      }

      // Path following: steer toward a sample a little ahead of this boid's
      // position along the path, and advance; clamp at the end (no looping,
      // the particle's life runs out there). The force scales with distance
      // from the path, so a boid that drifts is pulled back harder.
      // Current pace from this boid's profile, by how far along its trip it is.
      const progress = Math.min(1, (b.t - b.t0) / Math.max(1, n - 1 - b.t0));
      const cur = b.pace * profilePace(b.profile, progress);
      b.speedCap = CONFIG.maxSpeed * cur;
      b.t = Math.min(n - 1, b.t + advance * cur);
      // Interpolate the target between samples so it glides instead of
      // stepping; each boid aims at its own lane beside the spline, swaying.
      const ft = Math.min(n - 1, b.t + CONFIG.lookAhead);
      const i0 = Math.floor(ft);
      const i1 = Math.min(n - 1, i0 + 1);
      const u = ft - i0;
      const px = path[i0].x + (path[i1].x - path[i0].x) * u;
      const py = path[i0].y + (path[i1].y - path[i0].y) * u;
      const nx = normals[i0].x + (normals[i1].x - normals[i0].x) * u;
      const ny = normals[i0].y + (normals[i1].y - normals[i0].y) * u;
      // The sway dies down smoothly along the trip, so the wave in each
      // trail starts wide and settles toward the lane by the end.
      const calm = Math.pow(1 - progress, CONFIG.wobbleDecay);
      const side = b.lane + b.wobbleAmp * calm * Math.sin(b.t * b.wobbleFreq + b.wobblePhase);
      const target = { x: px + nx * side, y: py + ny * side };
      const follow = { x: target.x - b.pos.x, y: target.y - b.pos.y };
      const off = Math.hypot(follow.x, follow.y);
      setMag(follow, b.speedCap);
      follow.x -= b.vel.x;
      follow.y -= b.vel.y;
      // Force scales with the boid's pace too, so fast boids can still turn.
      limit(follow, CONFIG.maxForce * cur * (1 + Math.min(off / 20, 2)));

      // Wander keeps the "loosely" in "loosely follows"; the heading drifts
      // slowly so the force is a gentle curve rather than per-frame noise.
      // Rogues add a steady turning bias (so they loop) and never settle.
      if (b.rogue) {
        b.wanderAngle += b.turnBias + (Math.random() - 0.5) * CONFIG.rogueTurnWobble;
      } else {
        b.wanderAngle += (Math.random() - 0.5) * CONFIG.wanderTurn;
      }
      const wander = { x: Math.cos(b.wanderAngle), y: Math.sin(b.wanderAngle) };
      limit(wander, CONFIG.maxForce * (b.rogue ? 1 : calm)); // flock wander settles with the sway

      const ax = sep.x * W.separation + ali.x * W.alignment + coh.x * W.cohesion + follow.x * W.path + wander.x * W.wander;
      const ay = sep.y * W.separation + ali.y * W.alignment + coh.y * W.cohesion + follow.y * W.path + wander.y * W.wander;
      // Low-pass the steering: sudden force flips (separation, neighbour
      // changes) are eased in over several frames instead of kinking the path.
      const s = CONFIG.accSmoothing;
      b.acc.x += (ax - b.acc.x) * s;
      b.acc.y += (ay - b.acc.y) * s;
    }

    const cutoff = now - CONFIG.trailMs;
    for (const b of boids) {
      b.vel.x += b.acc.x;
      b.vel.y += b.acc.y;
      limit(b.vel, b.speedCap);
      b.pos.x += b.vel.x;
      b.pos.y += b.vel.y;
      // `j` is a fixed per-point wobble so tube edges stay put between frames;
      // `z` is the depth at that moment, so a trail can dip under and rise over.
      b.hist.push({
        x: b.pos.x,
        y: b.pos.y,
        t: now,
        j: Math.random() * 2 - 1,
        z: Math.sin(now * b.zFreq + b.zPhase),
        p: b.pressure(now),
      });
      while (b.hist.length && b.hist[0].t < cutoff) b.hist.shift();
    }
    for (const o of this.orbiters) o.step(now, dt, boids, n);
  }
}

// ---------------------------------------------------------------- rendering

/**
 * Render every boid of every flock, depth-sorted. Each visible trail is cut
 * into `trailBuckets` chunks (newest = chunk 0); each chunk gets the mean z
 * of its points. All chunks from all boids are sorted back-to-front and
 * drawn in that order, so a white-filled tube can pass over one trail and
 * under the next along its own length: they weave rather than collide.
 */
function renderFlocks(now) {
  const items = [];
  for (const f of flocks) {
    for (const b of f.boids) {
      const s = b.scale(now);
      if (s <= 0) continue;
      const h = b.hist;
      const span = CONFIG.trailMs * s;
      let start = h.length - 1;
      while (start > 0 && now - h[start - 1].t <= span) start--;
      const vis = h.length - start;
      if (vis < 2) continue;
      const buckets = CONFIG.trailBuckets;
      const per = Math.max(1, Math.ceil((vis - 1) / buckets));
      for (let k = 0; k < buckets; k++) {
        const to = h.length - 1 - k * per; // newer end
        const from = Math.max(start, to - per); // older end (shared with next chunk)
        if (to <= start || to - from < 1) break;
        items.push({ b, from, to, k, s, span, z: (h[from].z + h[to].z) / 2, head: k === 0 });
      }
    }
    for (const o of f.orbiters) {
      if (!o.gone && o.scale > 0 && f.boids.length) items.push({ orb: o, z: o.z });
    }
  }
  items.sort((a, c) => a.z - c.z);

  for (const c of [ctxBack, ctxFront]) {
    c.lineCap = "round";
    c.lineJoin = "round";
  }
  for (const it of items) {
    // Text weavers go to the front layer while they are "near" (z > 0).
    const front = it.b && it.b.overText && it.z > 0;
    ctx = front ? ctxFront : ctxBack;
    if (it.orb) ORB_DRAW[it.orb.shape](it.orb);
    else if (it.b.chrome) drawChromeChunk(it, now);
    else if (it.b.tube) drawTubeChunk(it, now);
    else drawLineChunk(it);
  }
  ctxFront.globalCompositeOperation = "source-over";
  ctx = ctxBack;
  ctx.globalCompositeOperation = "source-over";
}

// Cube geometry: 8 corners, 6 faces (corner indices, counter-clockwise).
const CUBE_V = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_F = [
  [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
  [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4],
];

/** Rotate a local point by an orbiter's rotation (X, then Y, then Z) and place it at its position. */
function project(c, x, y, z) {
  const { x: ax, y: ay, z: az } = c.rot;
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
  const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
  const x3 = x2 * cz - y1 * sz, y3 = x2 * sz + y1 * cz;
  return { x: c.pos.x + x3, y: c.pos.y + y3, z: z2 };
}

/** Convex hull of 2D points (Andrew's monotone chain), counter-clockwise. */
function convexHull(points) {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Draw a black chrome cone: project apex and base ring, fill the silhouette
 * (convex hull) with a metal gradient running across the cone's axis, and,
 * when the base faces the viewer, fill the base disc darker.
 */
function drawCone(c) {
  const H = CONFIG.coneHeight * c.scale;
  const R = CONFIG.coneRadius * c.scale;
  if (H < 0.5) return;
  const apex = project(c, 0, -H / 2, 0);
  const baseC = project(c, 0, H / 2, 0);
  const N = 14;
  const base = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    base.push(project(c, Math.cos(a) * R, H / 2, Math.sin(a) * R));
  }
  const hull = convexHull([apex, ...base]);
  if (hull.length < 3) return;

  // Gradient across the axis: highlight stripe runs apex to base.
  let ax = baseC.x - apex.x;
  let ay = baseC.y - apex.y;
  const m = Math.hypot(ax, ay) || 1;
  const nx = -ay / m;
  const ny = ax / m;
  const g = ctx.createLinearGradient(baseC.x - nx * R, baseC.y - ny * R, baseC.x + nx * R, baseC.y + ny * R);
  for (const [o, col] of CONFIG.coneStops) g.addColorStop(o, col);

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(hull[0].x, hull[0].y);
  for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
  ctx.closePath();
  ctx.fill();

  // Base disc, when it faces us: a darker ring-to-centre shade.
  const baseNormalZ = project({ pos: { x: 0, y: 0 }, rot: c.rot }, 0, 1, 0).z;
  if (baseNormalZ > 0.05) {
    const d = ctx.createRadialGradient(baseC.x - nx * R * 0.3, baseC.y - ny * R * 0.3, 0, baseC.x, baseC.y, R);
    d.addColorStop(0, "#5b5e65");
    d.addColorStop(0.6, "#111214");
    d.addColorStop(1, "#000000");
    ctx.fillStyle = d;
    ctx.beginPath();
    ctx.moveTo(base[0].x, base[0].y);
    for (let i = 1; i < N; i++) ctx.lineTo(base[i].x, base[i].y);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Draw a wireframe sphere: white disc, then meridians and parallels
 * projected through the orbiter's rotation. Segments on the far side are
 * drawn faint (hidden-line style); near-side segments full pencil weight.
 */
function drawSphere(c) {
  const R = CONFIG.sphereRadius * c.scale;
  if (R < 0.5) return;
  const STEPS = 28;
  const curves = [];
  // Meridians: great circles through the poles, rotated about Y.
  for (let m = 0; m < CONFIG.sphereMeridians; m++) {
    const a = (m / CONFIG.sphereMeridians) * Math.PI;
    const pts = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * Math.PI * 2;
      pts.push(project(c, Math.cos(t) * Math.cos(a) * R, Math.sin(t) * R, Math.cos(t) * Math.sin(a) * R));
    }
    curves.push(pts);
  }
  // Parallels: circles at evenly spaced latitudes.
  for (let p = 1; p <= CONFIG.sphereParallels; p++) {
    const lat = (p / (CONFIG.sphereParallels + 1)) * Math.PI - Math.PI / 2;
    const r = Math.cos(lat) * R;
    const y = Math.sin(lat) * R;
    const pts = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * Math.PI * 2;
      pts.push(project(c, Math.cos(t) * r, y, Math.sin(t) * r));
    }
    curves.push(pts);
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(c.pos.x, c.pos.y, R, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "multiply";
  ctx.lineWidth = Math.max(0.3, 0.75 * c.scale);
  // Two passes: far-side segments faint, then near-side segments on top.
  for (const [front, alpha] of [[false, CONFIG.pencilAlpha * 0.3], [true, CONFIG.pencilAlpha * 1.5]]) {
    ctx.strokeStyle = `rgba(${pencilRgb}, ${alpha})`;
    ctx.beginPath();
    for (const pts of curves) {
      let open = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if ((p.z >= 0) === front) {
          if (open) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
          open = true;
        } else open = false;
      }
    }
    ctx.stroke();
  }
  // Outline for the silhouette.
  ctx.strokeStyle = `rgba(${pencilRgb}, ${CONFIG.pencilAlpha * 1.2})`;
  ctx.beginPath();
  ctx.arc(c.pos.x, c.pos.y, R, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Draw a cube in pencil: rotate, orthographic-project, sort faces by depth,
 * fill each white with a light graphite tint by facing, stroke the edges.
 */
function drawCube(c) {
  const size = CONFIG.cubeSize * c.scale;
  const pts = CUBE_V.map(([x, y, z]) => project(c, x * size, y * size, z * size));
  const faces = CUBE_F.map((f) => ({
    f,
    z: (pts[f[0]].z + pts[f[1]].z + pts[f[2]].z + pts[f[3]].z) / 4,
  })).sort((a, b) => a.z - b.z);

  ctx.lineWidth = Math.max(0.3, 0.8 * c.scale);
  for (const { f, z } of faces) {
    // Faces turned away sit darker; the tint stays light so it reads as paper.
    const tint = 0.04 + 0.1 * (1 - (z + 1) / 2);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(pts[f[0]].x, pts[f[0]].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[f[i]].x, pts[f[i]].y);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgba(${pencilRgb}, ${tint})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${pencilRgb}, ${CONFIG.pencilAlpha * 1.5})`;
    ctx.stroke();
  }
}

const ORB_DRAW = { cube: drawCube, cone: drawCone, sphere: drawSphere };

/** Width and darkness factors for a pressure value 0..1. */
function pressureFactors(p) {
  const [w0, w1] = CONFIG.pressureWidth;
  const [a0, a1] = CONFIG.pressureAlpha;
  return { w: w0 + (w1 - w0) * p, a: a0 + (a1 - a0) * p };
}

/**
 * Stroke a polyline through `pts` (any objects with x, y and a pressure `p`),
 * split into runs of similar pressure; each run gets its own width and
 * alpha so the line presses harder and lighter along its length.
 */
function strokeWithPressure(pts, dx, dy, baseWidth, baseAlpha) {
  const levels = CONFIG.pressureLevels;
  let level = -1;
  let open = false;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    const l = Math.min(levels - 1, Math.floor(q.p * levels));
    if (l !== level) {
      if (open) {
        ctx.lineTo(q.x + dx, q.y + dy);
        ctx.stroke();
      }
      level = l;
      const f = pressureFactors((l + 0.5) / levels);
      ctx.lineWidth = Math.max(0.2, baseWidth * f.w);
      ctx.strokeStyle = `rgba(${pencilRgb}, ${Math.min(1, baseAlpha * f.a)})`;
      ctx.beginPath();
      ctx.moveTo(q.x + dx, q.y + dy);
      open = true;
    } else {
      ctx.lineTo(q.x + dx, q.y + dy);
    }
  }
  if (open) ctx.stroke();
}

/** One chunk of a plain pencil trail: layered passes, width by chunk index and pressure. */
function drawLineChunk(it) {
  const { b, from, to, k, s } = it;
  const h = b.hist;
  const pts = h.slice(from, to + 1);
  ctx.globalCompositeOperation = "multiply"; // overlapping passes darken like graphite
  for (const pass of b.passes) {
    const w = CONFIG.trailWidth * pass.w * s * (1 - k / CONFIG.trailBuckets);
    strokeWithPressure(pts, pass.dx, pass.dy, w, CONFIG.lineAlpha * pass.a);
  }
  if (it.head) {
    ctx.fillStyle = `rgba(${pencilRgb}, 0.55)`;
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, CONFIG.boidSize * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Edge polylines for a tube chunk: points offset along the local normal by
 * a width that tapers with age. `jitter` adds each point's fixed wobble
 * (pencil tubes); chrome passes 0 for clean edges.
 */
function tubeEdges(it, now, half, jitter) {
  const { b, from, to, span } = it;
  const h = b.hist;
  const left = [];
  const right = [];
  const normals = [];
  let heading = 0;
  for (let i = from; i <= to; i++) {
    const p = h[i];
    const q = i > 0 ? h[i - 1] : h[i + 1];
    const tx = i > 0 ? p.x - q.x : q.x - p.x;
    const ty = i > 0 ? p.y - q.y : q.y - p.y;
    const m = Math.hypot(tx, ty) || 1;
    const nx = -ty / m;
    const ny = tx / m;
    const taper = Math.max(0, 1 - (now - p.t) / span);
    const w = half * taper * (1 + p.j * jitter);
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
    normals.push({ x: nx, y: ny, w, angle: Math.atan2(ty, tx) });
    if (i === h.length - 1) heading = Math.atan2(ty, tx);
  }
  return { left, right, normals, heading };
}

/**
 * One chunk of a smooth 3D chrome cylinder: the body is filled with a
 * linear gradient running across the tube (rim, highlight, rim), oriented
 * by the chunk's mid normal; the head gets a shaded elliptical cap.
 */
function drawChromeChunk(it, now) {
  const { b, s } = it;
  const h = b.hist;
  const half = (CONFIG.chromeWidth / 2) * s;
  const { left, right, normals, heading } = tubeEdges(it, now, half, 0);
  if (left.length < 2) return;

  const mid = Math.floor(left.length / 2);
  const L = left[mid];
  const R = right[mid];
  const g = ctx.createLinearGradient(L.x, L.y, R.x, R.y);
  for (const [o, c] of b.chromeBlack ? CONFIG.coneStops : CONFIG.chromeStops) g.addColorStop(o, c);

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();

  if (it.head) {
    const head = h[h.length - 1];
    const n = normals[normals.length - 1];
    const cap = ctx.createLinearGradient(
      head.x + n.x * half, head.y + n.y * half,
      head.x - n.x * half, head.y - n.y * half
    );
    if (b.chromeBlack) {
      cap.addColorStop(0, "#8a8d94");
      cap.addColorStop(0.5, "#1a1b1f");
      cap.addColorStop(1, "#000000");
    } else {
      cap.addColorStop(0, "#d8dbe0");
      cap.addColorStop(0.5, "#5a5e66");
      cap.addColorStop(1, "#26282d");
    }
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.ellipse(head.x, head.y, half * 0.4, half, heading, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * One chunk of a skinny hand-drawn cylinder: a white-filled body (which
 * hides whatever was drawn beneath it), two wobbly contour edges, ring
 * lines, and an elliptical cap on the head chunk.
 */
function drawTubeChunk(it, now) {
  const { b, from, s } = it;
  const h = b.hist;
  const half = (CONFIG.tubeWidth / 2) * s;
  const { left, right, normals, heading } = tubeEdges(it, now, half, CONFIG.tubeJitter);
  if (left.length < 2) return;
  const rings = [];
  normals.forEach((n, k) => {
    const i = from + k;
    if (i !== h.length - 1 && (h.length - 1 - i) % CONFIG.tubeRingEvery === 0 && n.w > 1) {
      rings.push({ x: h[i].x, y: h[i].y, w: n.w, angle: n.angle });
    }
  });

  // Body: opaque white, so it occludes anything drawn earlier (deeper).
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();

  // Edges: layered pencil passes, with the boid's pressure along them.
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < left.length; i++) {
    left[i].p = h[from + i].p;
    right[i].p = h[from + i].p;
  }
  for (const pass of b.passes.slice(0, CONFIG.tubePasses)) {
    for (const edge of [left, right]) {
      strokeWithPressure(edge, pass.dx, pass.dy, 0.9 * pass.w * s, CONFIG.pencilAlpha * 1.4 * pass.a);
    }
  }

  // Rings across the tube, lighter.
  ctx.strokeStyle = `rgba(${pencilRgb}, ${CONFIG.pencilAlpha * 0.9})`;
  ctx.lineWidth = 0.7 * s;
  for (const r of rings) {
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, r.w * 0.35, r.w, r.angle, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Cap on the head chunk: white-filled ellipse seen slightly from the side.
  if (it.head) {
    const head = h[h.length - 1];
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(head.x, head.y, half * 0.4, half, heading, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = `rgba(${pencilRgb}, ${CONFIG.pencilAlpha * 1.6})`;
    ctx.lineWidth = Math.max(0.3, 0.9 * s);
    ctx.stroke();
  }
}

/** Build a repeating paper-grain tile: random alpha per pixel, used to erode the marks. */
function makeGrain() {
  const size = CONFIG.grainTile;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext("2d");
  const img = tctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // Skewed toward 0 so most of the stroke survives and only flecks drop out.
    const r = Math.random();
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
    d[i + 3] = Math.round(r * r * r * 255 * CONFIG.grainStrength);
  }
  tctx.putImageData(img, 0, 0);
  return ctx.createPattern(tile, "repeat");
}

/** Erode everything drawn so far on a context with the grain tile, in device pixels. */
function applyGrain(c, cv) {
  if (!grainPattern) return;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = grainPattern;
  c.fillRect(0, 0, cv.width, cv.height);
  c.restore();
}

/** Returns true if a flock was spawned; false if the stroke was too short. */
function spawnFlock(points, now) {
  const path = resample(smooth(points, CONFIG.smoothPasses), CONFIG.resampleGap);
  if (path.length < CONFIG.minSamples) return false;
  // Cap: only flocks not yet fading count. Expire the oldest of those
  // (tail-first, within ~600ms) until there is room for the new one.
  let live = flocks.filter((f) => f.fresh(now));
  while (live.length && live.length * CONFIG.boidsPerStroke + CONFIG.boidsPerStroke > CONFIG.maxBoids) {
    live[0].expire(now, 600);
    live.shift();
  }
  flocks.push(new Flock(path, CONFIG.boidsPerStroke, now));
  return true;
}

// ---------------------------------------------------------------- strokes

/**
 * Split the smoothed spline into dashes along its arc length. Each dash is a
 * short polyline, so dashes can be drawn with individual alpha.
 * @returns {Pt[][]}
 */
function buildDashes(rawPoints) {
  if (rawPoints.length < 2) return [];
  const p = smooth(rawPoints, CONFIG.smoothPasses);
  const [onLen, offLen] = CONFIG.strokeDash;
  const dashes = [];
  let cur = [p[0]];
  let on = true;
  let remaining = onLen;
  for (let i = 1; i < p.length; i++) {
    let a = p[i - 1];
    const b = p[i];
    let seg = dist(a, b);
    while (seg >= remaining) {
      const t = remaining / seg;
      const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (on) {
        cur.push(cut);
        dashes.push(cur);
      }
      on = !on;
      cur = [cut];
      remaining = on ? onLen : offLen;
      a = cut;
      seg = dist(a, b);
    }
    if (on) cur.push(b);
    remaining -= seg;
  }
  if (on && cur.length > 1) dashes.push(cur);
  return dashes;
}

// Fixed offsets for the pencil passes on the drawn path (so it does not shimmer).
const STROKE_PASSES = [
  { dx: 0, dy: 0, a: 1 },
  { dx: 0.5, dy: -0.4, a: 0.6 },
];

/** Pressure 0..1 for dash `i` of a stroke with the given seed: slow drift along the line. */
function dashPressure(i, seed) {
  const v = 0.65 * Math.sin(i * 0.21 + seed) + 0.35 * Math.sin(i * 0.57 + seed * 1.7);
  return 0.5 + 0.5 * v;
}

/** Draw one dash polyline as a graphite mark: thin, layered passes, scaled by pressure. */
function drawDash(pts, alpha, pressure) {
  if (alpha <= 0) return;
  const f = pressureFactors(pressure);
  ctx.lineWidth = Math.max(0.2, CONFIG.strokeWidth * f.w);
  for (const p of STROKE_PASSES.slice(0, CONFIG.strokePasses)) {
    ctx.strokeStyle = `rgba(${pencilRgb}, ${Math.min(1, alpha * f.a * p.a)})`;
    ctx.beginPath();
    ctx.moveTo(pts[0].x + p.dx, pts[0].y + p.dy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + p.dx, pts[i].y + p.dy);
    ctx.stroke();
  }
}

/** Draw a whole path at one alpha (used for the live stroke). */
function drawStroke(rawPoints, alpha, seed) {
  ctx.lineCap = "round";
  buildDashes(rawPoints).forEach((d, i) => drawDash(d, alpha, dashPressure(i, seed)));
}

/** Draw a released stroke; dashes fade one after another from the start. */
function drawFadingStroke(s, now) {
  if (!s.dashes) s.dashes = buildDashes(s.points);
  const elapsed = now - s.endedAt;
  ctx.lineCap = "round";
  s.dashes.forEach((d, i) => {
    const k = (elapsed - i * CONFIG.dashStagger) / CONFIG.dashFade;
    drawDash(d, CONFIG.strokeAlpha * (1 - Math.min(1, Math.max(0, k))), dashPressure(i, s.seed));
  });
}

function strokeDone(s, now) {
  const count = s.dashes ? s.dashes.length : 0;
  return now - s.endedAt > count * CONFIG.dashStagger + CONFIG.dashFade;
}

// ---------------------------------------------------------------- loop

let lastFrame = 0;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  // Clamp dt so a backgrounded tab does not teleport the flock on return.
  const dt = lastFrame ? Math.min(50, now - lastFrame) : 16;
  lastFrame = now;

  // Clear to transparent each frame (the page's white shows through), so
  // the grain erosion below only affects the marks, not a painted background.
  ctx.clearRect(0, 0, width, height);
  ctxFront.clearRect(0, 0, width, height);

  for (const f of flocks) f.step(now, dt);
  renderFlocks(now);
  flocks = flocks.filter((f) => !f.dead());
  // Paper grain on the flock only: the drawn path is laid down after this.
  applyGrain(ctx, canvas);
  applyGrain(ctxFront, canvasFront);

  // Every released stroke fades out dash by dash; the flock is what remains.
  for (const s of fadingStrokes) drawFadingStroke(s, now);
  fadingStrokes = fadingStrokes.filter((s) => !strokeDone(s, now));

  if (stroke) drawStroke(stroke.points, CONFIG.strokeAlpha, stroke.seed);
}

// ---------------------------------------------------------------- input

function toLocal(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onPointerDown(e) {
  // Right button is the intended input; left/touch is the fallback.
  if (e.button !== 2 && e.button !== 0) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  stroke = { points: [toLocal(e)], endedAt: null, pointerId: e.pointerId, seed: Math.random() * 100 };
  hint?.classList.add("is-hidden");
}

function onPointerMove(e) {
  if (!stroke || e.pointerId !== stroke.pointerId) return;
  const p = toLocal(e);
  const last = stroke.points[stroke.points.length - 1];
  if (dist(p, last) >= CONFIG.minPointGap) stroke.points.push(p);
}

function onPointerUp(e) {
  if (!stroke || e.pointerId !== stroke.pointerId) return;
  const now = performance.now();
  stroke.endedAt = now;
  stroke.dashes = buildDashes(stroke.points);
  fadingStrokes.push(stroke);
  spawnFlock(stroke.points, now);
  stroke = null;
}

function onKeyDown(e) {
  if (e.key === "c" || e.key === "C") {
    flocks = [];
    fadingStrokes = [];
    ctx.clearRect(0, 0, width, height);
    ctxFront.clearRect(0, 0, width, height);
  }
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = container.clientWidth;
  height = container.clientHeight;
  for (const [cv, c] of [[canvas, ctxBack], [canvasFront, ctxFront]]) {
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    cv.style.width = `${width}px`;
    cv.style.height = `${height}px`;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);
  }
}

function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  listeners.push(() => target.removeEventListener(type, fn, opts));
}

// ---------------------------------------------------------------- api

function mount(el) {
  container = el;
  canvas = el.querySelector("canvas:not(.page__canvas--front)");
  canvasFront = el.querySelector(".page__canvas--front");
  hint = el.querySelector(".hint");
  ctxBack = canvas.getContext("2d");
  ctxFront = canvasFront.getContext("2d");
  ctx = ctxBack;

  const css = getComputedStyle(document.documentElement);
  const rgb = css.getPropertyValue("--accent-rgb").trim();
  if (rgb) accentRgb = rgb;
  const prgb = css.getPropertyValue("--pencil-rgb").trim();
  if (prgb) pencilRgb = prgb;
  grainPattern = makeGrain();

  resize();
  on(window, "resize", resize);
  // Window-level: on Windows the menu fires on mouse-up, which can land
  // outside the canvas when a right-drag ends past the edge.
  on(window, "contextmenu", (e) => e.preventDefault());
  on(canvas, "pointerdown", onPointerDown);
  on(canvas, "pointermove", onPointerMove);
  on(canvas, "pointerup", onPointerUp);
  on(canvas, "pointercancel", onPointerUp);
  on(window, "keydown", onKeyDown);

  rafId = requestAnimationFrame(frame);
}

function unmount() {
  cancelAnimationFrame(rafId);
  lastFrame = 0;
  for (const off of listeners) off();
  listeners = [];
  flocks = [];
  fadingStrokes = [];
  stroke = null;
}

window.FlockSketch = { mount, unmount };
})();
