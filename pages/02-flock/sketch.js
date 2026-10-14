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
  spawnSpread: 12, // px of random offset around each boid's spawn point
  // Ordered lanes: when true, trails never cross. Each boid gets a fixed,
  // evenly spaced lane; the sway is one flock-wide motion (lanes move
  // together); boids spawn exactly on their lane; and the forces that would
  // push a boid sideways (separation, cohesion, wander) and rogues are off.
  lanesOrdered: false,
  // Per-boid variation so every particle has its own path, school-of-fish style.
  laneSpread: 20, // px: each boid rides a fixed lateral offset from the spline in [-laneSpread, laneSpread]
  wobbleAmp: 18, // px: sway amplitude; close to laneSpread so neighbours cross lanes and weave
  wobbleFreq: [0.04, 0.1], // sway cycles per path sample, random per boid (faster = more crossings)
  wobbleDecay: 1.6, // sway amplitude is scaled by (1 - progress)^wobbleDecay: big waves early, calm by the end
  paceSpread: 0.35, // each boid's base pace is 1 +/- paceSpread times the flock rate
  // Speed profiles (fraction of boids): how pace changes over a boid's trip.
  profileMix: { burst: 0.3, lag: 0.25, surge: 0.3, steady: 0.15 },
  // Wrapper: a trail that coils around the main group like a helix seen
  // side-on: wide side-to-side sweep, with depth tied to the same phase so it
  // passes in front on one half and behind on the other.
  wrappersPerFlock: 1,
  wrapAmp: 40, // px: sweep amplitude, wider than the group (laneSpread + wobbleAmp)
  wrapFreq: 0.025, // coils per path sample (10px samples => one coil every ~400px)
  wrapSpeedBoost: 1.7, // wrappers may move this much faster (and steer harder) to keep up with the coil
  // Rogues: a few boids that mostly ignore the path and loop off on their own,
  // held only loosely near the flock so they never leave the scene entirely.
  rogueFraction: 0.19,
  rogueMin: 3, // at least this many per flock
  rogueWidthScale: 0.6, // rogues are plain pencil lines, drawn thinner than the rest
  rogueWeights: { path: 0.7, separation: 0.8, alignment: 0.2, cohesion: 0.3, wander: 1.3 },
  rogueTurnBias: [0.02, 0.045], // rad/frame steady heading drift, random per rogue (makes loops)
  rogueTurnWobble: 0.06, // extra random heading noise per frame
  trailMs: 5_000, // how long a boid's trail lingers behind it
  trailAlpha: 0.55, // constant opacity of the trail
  trailWidth: 1.95, // px: plain-line trail width right behind the boid; tapers to 0 at the tail
  lineAlpha: 0.195, // opacity per pass for plain pencil lines (tubes/cubes use pencilAlpha)
  chunkPoints: 20, // history points per depth-sorted chunk; boundaries are fixed by point number, so a chunk's depth never drifts (no flicker)
  haloPad: 2.6, // px added around each pencil line as a paper-coloured halo, so the top trail at a crossing cuts the one beneath (weave, not intersect)
  fill: "#f3f1ea", // off-white (paper) for solid bodies: cubes, sphere discs, tube bodies and caps
  // Pencil look for the flock: layered offset passes in graphite, multiplied
  // where they overlap, then eroded by a paper-grain mask.
  // Colour: when `colored` is true each boid and shape draws in one pencil
  // from the palette (coloured-pencil look); false = graphite only.
  colored: false,
  palette: [
    "242, 177, 52", // yellow-orange
    "138, 138, 138", // grey
    "95, 179, 179", // teal
    "181, 154, 122", // tan
    "47, 59, 53", // near-black green
    "217, 67, 47", // red
    "46, 158, 68", // green
    "47, 85, 200", // blue
    "166, 107, 191", // purple
    "242, 106, 27", // orange
  ],
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
  tubeFraction: 0, // white pencil tubes off: they ran alongside the chrome tubes and read as a pale line on them
  tubeWidth: 7, // px: tube diameter at the head; tapers to a point at the tail
  tubeJitter: 0.14, // 0..1 how much the contour edges wobble (hand-drawn feel)
  tubeRingEvery: 14, // history points between ring lines along the tube
  tubePasses: 2, // pencil passes per edge (fewer than trails; tubes have 2 edges)
  // Bar style: long hand-drawn 3D skinny rectangles (oblique boxes) with a
  // visible cap at both the head and the tail.
  barsPerFlock: 3,
  barWidth: 6, // px: face width at the head
  barDepth: { x: 3.2, y: -3.2 }, // px: screen offset of the back face (oblique projection)
  barTailScale: 0.65, // width at the tail as a fraction of the head (not 0, so the end cap shows)
  barJitter: 0.1, // 0..1 edge wobble
  // Chrome style: a few boids draw as smooth 3D metal cylinders (no pencil
  // wobble; a cross-section gradient does the shading).
  chromeFraction: 0.08,
  blackChromePerFlock: 2, // extra chrome trails per flock in black metal
  blackChromeStops: [ // flat black, no shading at all
    [0.0, "#000000"],
    [1.0, "#000000"],
  ],
  blackChromeDepthBias: 1.5, // above the silver tubes (1.2) so nothing ever lies across the black one
  // Lead texture for the black cylinder: a near-black body shaded with
  // heavy graphite strokes running along its length, then grain-eroded.
  leadFill: "#141417",
  leadRgb: "16, 16, 19",
  leadStrokes: [-0.72, -0.3, 0.12, 0.5, 0.82], // positions across the width, -1..1
  leadStrokeAlpha: 0.75,
  leadStrokeWidth: 1.3,
  leadJitter: 0.08, // edge wobble, 0..1
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
  slabsPerFlock: 2, // long skinny 3D rectangles, white fill
  cubeSize: 5, // px half-edge
  slabSize: { x: 12, y: 2.4, z: 2.4 }, // px half-extents of a slab (long along x)
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
  // Type collision: spheres shove the copy block when they hit it; the block
  // drifts back to rest so it arrives as the last trail draws off.
  typePush: 1.0, // fraction of a shape's penetration applied as a shove
  typeMaxOffset: 160, // px cap on how far a letter can be pushed
  typeIdleReturnMs: 1_500, // return time when no flock is alive
  typeWeight: [0.45, 2.2], // each letter's random weight; shove is divided by it (light letters fly, heavy ones budge)
  // Collision radius of each orbiter shape, as a multiple of its size.
  typeRadius: { sphere: 1.0, cube: 1.35, cone: 0.55, slab: 0.75 },
  // Trails: when true, each boid's head also shoves letters. Radius by style, px.
  trailsPushType: false,
  trailTypeRadius: { line: 3, chrome: 5, bar: 4.5, tube: 4.5 },
  // Cursor followers: a chain of tiny pencil triangles that trail the pointer.
  cursorCount: 14,
  cursorSize: 3.2, // px: triangle length at the head; shrinks along the chain
  cursorEase: 0.28, // per-frame ease of the first triangle toward the cursor
  cursorChainEase: 0.34, // per-frame ease of each triangle toward the one ahead
  cursorAlpha: 0.75, // at the head; fades along the chain
  // Text weavers: this many boids per flock may draw on the front canvas
  // (above the copy) while their depth is positive, so they cross over and
  // under the text when a path is drawn across it.
  textWeaversPerFlock: 2,
  // Chrome tubes sort above every pencil item (z is in [-1, 1]; this bias
  // lifts them clear of it) so a white tube's thin tail can never lie across
  // a metal tube and read as a pale line on it. Chrome vs chrome still weaves.
  chromeDepthBias: 1.2,
  // Depth: each boid's z drifts on a slow sine; everything is drawn in short
  // chunks sorted by z, so white-filled tubes weave over and under trails.
  depthPeriod: [1_500, 3_500], // ms per z cycle, random per boid (shorter = over/under swaps more often)
  boidSize: 2.2,
};

let accentRgb = "214, 58, 58";
let pencilRgb = "52, 52, 58";
let bgColor = "#f3efe7"; // the page background (--bg); halos use it so they vanish into the page
let nextBoidId = 1;

// Weights used when lanes are ordered: only the lane-following force and
// heading alignment act, so nothing pushes a boid across a neighbour's lane.
const ORDERED_WEIGHTS = { path: 2.4, separation: 0, alignment: 0.6, cohesion: 0, wander: 0 };

/** Pencil colour for a new boid or shape: a palette entry, or graphite. */
function pickPencil() {
  if (!CONFIG.colored) return pencilRgb;
  return CONFIG.palette[Math.floor(Math.random() * CONFIG.palette.length)];
}
let grainPattern = null;
let canvas, ctx, container;
let canvasFront, ctxFront; // layer above the copy text
let ctxBack; // the main (input) canvas context; `ctx` is swapped per draw item
const cursor = { x: -100, y: -100, inside: false };
/** @type {{x:number,y:number,heading:number}[]} head first */
let followers = [];
let copyEl = null; // the DOM copy block whose letters the spheres can push around
/** @type {{el: HTMLElement, x: number, y: number, w: number, h: number, ox: number, oy: number}[]} */
let letters = []; // one entry per character span: rest box in container coords + current offset
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
    this.wrap = false;
    this.wrapPhase = Math.random() * Math.PI * 2;
    this.rgb = pickPencil();
    // Style: chrome (few), pencil tube (many), or plain pencil line (rest).
    const styleRoll = Math.random();
    this.chrome = styleRoll < CONFIG.chromeFraction;
    this.chromeBlack = false;
    this.bar = false;
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
    this.seq = 0; // running point number, for stable chunk boundaries
    this.id = nextBoidId++; // unique, for a stable depth-sort tie-break
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
    this.rgb = pickPencil();
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
    const ordered = CONFIG.lanesOrdered;
    // Flock-wide sway (used when lanes are ordered so lanes never cross).
    const [wf0, wf1] = CONFIG.wobbleFreq;
    this.swayFreq = (wf0 + Math.random() * (wf1 - wf0)) * Math.PI * 2;
    this.swayPhase = Math.random() * Math.PI * 2;
    // Evenly spaced lanes handed out in shuffled order.
    const laneSlots = Array.from({ length: count }, (_, i) =>
      count > 1 ? ((i / (count - 1)) * 2 - 1) * CONFIG.laneSpread : 0
    );
    for (let i = laneSlots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [laneSlots[i], laneSlots[j]] = [laneSlots[j], laneSlots[i]];
    }
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
      let sx = p.x + (Math.random() - 0.5) * CONFIG.spawnSpread;
      let sy = p.y + (Math.random() - 0.5) * CONFIG.spawnSpread;
      if (ordered) {
        // Spawn exactly on the lane so the trail starts in order.
        const nrm = this.normals[Math.floor(t)];
        sx = p.x + nrm.x * laneSlots[i];
        sy = p.y + nrm.y * laneSlots[i];
      }
      const b = new Boid(sx, sy, t, bornAt, life, pace, profile);
      if (ordered) {
        b.lane = laneSlots[i];
        b.wobbleAmp = CONFIG.wobbleAmp; // same amplitude for all
        b.wobbleFreq = this.swayFreq; // same rhythm for all
        b.wobblePhase = this.swayPhase;
        // Start moving along the path, not in a random direction.
        const nx = this.normals[Math.floor(t)];
        b.vel = { x: nx.y * 2, y: -nx.x * 2 };
      }
      this.boids.push(b);
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
    for (let i = 0; i < CONFIG.slabsPerFlock && this.boids.length; i++) {
      this.orbiters.push(new Orbiter("slab", pick(), bornAt));
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
    // Bars: promote plain-line boids to long 3D rectangles.
    const barPool = this.boids.filter((b) => !b.chrome && !b.tube);
    for (let i = 0; i < CONFIG.barsPerFlock && barPool.length; i++) {
      barPool.splice(Math.floor(Math.random() * barPool.length), 1)[0].bar = true;
    }
    // Wrappers: plain-line boids that coil around the group.
    const wrapPool = this.boids.filter((b) => !b.chrome && !b.tube && !b.bar);
    for (let i = 0; i < CONFIG.wrappersPerFlock && wrapPool.length; i++) {
      const b = wrapPool.splice(Math.floor(Math.random() * wrapPool.length), 1)[0];
      b.wrap = true;
      b.lane = 0;
    }
    // Text weavers: a couple of boids allowed onto the front canvas.
    const weavePool = this.boids.slice();
    for (let i = 0; i < CONFIG.textWeaversPerFlock && weavePool.length; i++) {
      weavePool.splice(Math.floor(Math.random() * weavePool.length), 1)[0].overText = true;
    }
    // Pick the rogues: random boids that get their own rules and a steady
    // turning bias (random direction) so they carve loops away from the path.
    const rogues = ordered ? 0 : Math.max(CONFIG.rogueMin, Math.round(count * CONFIG.rogueFraction));
    const [t0, t1] = CONFIG.rogueTurnBias;
    // Rogues are always plain pencil lines (thin), never tubes, bars, chrome or wrappers.
    const pool = this.boids.filter((b) => !b.chrome && !b.tube && !b.bar && !b.wrap);
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
      const W = b.rogue ? CONFIG.rogueWeights : CONFIG.lanesOrdered ? ORDERED_WEIGHTS : CONFIG.weights;
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
      const boost = b.wrap ? CONFIG.wrapSpeedBoost : 1; // headroom for the coil's sideways motion
      b.speedCap = CONFIG.maxSpeed * cur * boost;
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
      const side = b.wrap
        ? CONFIG.wrapAmp * Math.sin(b.t * CONFIG.wrapFreq * Math.PI * 2 + b.wrapPhase) // full coil, never calms
        : b.lane + b.wobbleAmp * calm * Math.sin(b.t * b.wobbleFreq + b.wobblePhase);
      const target = { x: px + nx * side, y: py + ny * side };
      const follow = { x: target.x - b.pos.x, y: target.y - b.pos.y };
      const off = Math.hypot(follow.x, follow.y);
      setMag(follow, b.speedCap);
      follow.x -= b.vel.x;
      follow.y -= b.vel.y;
      // Force scales with the boid's pace too, so fast boids can still turn.
      limit(follow, CONFIG.maxForce * cur * boost * (1 + Math.min(off / 20, 2)));

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
        // A wrapper's depth follows its coil (cos of the same phase as its
        // side sweep), so it is in front while crossing one way and behind
        // crossing back: it visibly wraps the group.
        z: b.wrap
          ? Math.cos(b.t * CONFIG.wrapFreq * Math.PI * 2 + b.wrapPhase)
          : Math.sin(now * b.zFreq + b.zPhase),
        p: b.pressure(now),
        n: b.seq++,
      });
      while (b.hist.length && b.hist[0].t < cutoff) b.hist.shift();
    }
    for (const o of this.orbiters) o.step(now, dt, boids, n);
  }
}

// ---------------------------------------------------------------- rendering

/**
 * Render every boid of every flock, depth-sorted. Each visible trail is cut
 * into fixed chunks of `chunkPoints` points (newest = chunk 0); each chunk gets the mean z
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
      // Chunk boundaries fall on points whose sequence number is a multiple
      // of chunkPoints. Membership (and so depth) of a chunk is fixed for
      // its whole life; only the newest chunk grows and the oldest shrinks.
      const P = CONFIG.chunkPoints;
      const bias = b.chromeBlack ? CONFIG.blackChromeDepthBias : b.chrome ? CONFIG.chromeDepthBias : 0;
      let to = h.length - 1;
      let k = 0;
      while (to > start) {
        let from = to - 1;
        while (from > start && h[from].n % P !== 0) from--;
        if (to - from >= 1) {
          const zRaw = (h[from].z + h[to].z) / 2;
          // Age of the chunk's midpoint drives the width taper.
          const age = Math.min(1, (now - h[Math.floor((from + to) / 2)].t) / span);
          items.push({ b, from, to, k, s, span, z: zRaw + bias, zRaw, age, head: k === 0, id: b.id });
        }
        to = from;
        k++;
      }
    }
    for (const o of f.orbiters) {
      if (!o.gone && o.scale > 0 && f.boids.length) items.push({ orb: o, z: o.z });
    }
  }
  // Stable order: ties broken by boid and chunk so equal depths never swap.
  items.sort((a, c) => a.z - c.z || (a.id || 0) - (c.id || 0) || (c.k || 0) - (a.k || 0));

  for (const c of [ctxBack, ctxFront]) {
    c.lineCap = "round";
    c.lineJoin = "round";
  }
  for (const it of items) {
    // Text weavers go to the front layer while they are "near" (z > 0).
    const front = it.b && it.b.overText && it.zRaw > 0;
    ctx = front ? ctxFront : ctxBack;
    if (it.orb) ORB_DRAW[it.orb.shape](it.orb);
    else if (it.b.chrome) drawChromeChunk(it, now);
    else if (it.b.bar) drawBarChunk(it, now);
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
  ctx.fillStyle = CONFIG.fill;
  ctx.beginPath();
  ctx.arc(c.pos.x, c.pos.y, R, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = "multiply";
  ctx.lineWidth = Math.max(0.3, 0.75 * c.scale);
  // Two passes: far-side segments faint, then near-side segments on top.
  for (const [front, alpha] of [[false, CONFIG.pencilAlpha * 0.3], [true, CONFIG.pencilAlpha * 1.5]]) {
    ctx.strokeStyle = `rgba(${c.rgb}, ${alpha})`;
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
  ctx.strokeStyle = `rgba(${c.rgb}, ${CONFIG.pencilAlpha * 1.2})`;
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
  drawBox(c, size, size, size);
}

/** A long skinny box: same drawing as the cube with unequal half-extents. */
function drawSlab(c) {
  const d = CONFIG.slabSize;
  drawBox(c, d.x * c.scale, d.y * c.scale, d.z * c.scale);
}

/** Box with half-extents hx, hy, hz: faces depth-sorted, paper-filled, pencil-tinted and edged. */
function drawBox(c, hx, hy, hz) {
  const pts = CUBE_V.map(([x, y, z]) => project(c, x * hx, y * hy, z * hz));
  const faces = CUBE_F.map((f) => ({
    f,
    z: (pts[f[0]].z + pts[f[1]].z + pts[f[2]].z + pts[f[3]].z) / 4,
  })).sort((a, b) => a.z - b.z);

  ctx.lineWidth = Math.max(0.3, 0.8 * c.scale);
  for (const { f, z } of faces) {
    // Faces turned away sit darker; the tint stays light so it reads as paper.
    const tint = 0.04 + 0.1 * (1 - (z + 1) / 2);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = CONFIG.fill;
    ctx.beginPath();
    ctx.moveTo(pts[f[0]].x, pts[f[0]].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[f[i]].x, pts[f[i]].y);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgba(${c.rgb}, ${tint})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${c.rgb}, ${CONFIG.pencilAlpha * 1.5})`;
    ctx.stroke();
  }
}

const ORB_DRAW = { cube: drawCube, cone: drawCone, sphere: drawSphere, slab: drawSlab };

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
function strokeWithPressure(pts, dx, dy, baseWidth, baseAlpha, rgb = pencilRgb) {
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
      ctx.strokeStyle = `rgba(${rgb}, ${Math.min(1, baseAlpha * f.a)})`;
      ctx.beginPath();
      ctx.moveTo(q.x + dx, q.y + dy);
      open = true;
    } else {
      ctx.lineTo(q.x + dx, q.y + dy);
    }
  }
  if (open) ctx.stroke();
}

/** One chunk of a plain pencil trail: paper halo, then layered passes with pressure. */
function drawLineChunk(it) {
  const { b, from, to, s, age } = it;
  const h = b.hist;
  const pts = h.slice(from, to + 1);
  const taper = (1 - age) * (b.rogue ? CONFIG.rogueWidthScale : 1);
  // Halo: paper-coloured, butt-capped so it stays inside this chunk's span
  // and does not bite into the neighbouring chunk of the same trail.
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "butt";
  ctx.strokeStyle = bgColor;
  ctx.lineWidth = CONFIG.trailWidth * s * taper + CONFIG.haloPad;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "multiply"; // overlapping passes darken like graphite
  for (const pass of b.passes) {
    const w = CONFIG.trailWidth * pass.w * s * taper;
    strokeWithPressure(pts, pass.dx, pass.dy, w, CONFIG.lineAlpha * pass.a, b.rgb);
  }
  if (it.head) {
    ctx.fillStyle = `rgba(${b.rgb}, 0.55)`;
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, CONFIG.boidSize * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Fill a closed polygon in paper off-white plus a pencil tint; stroke its outline only if asked. */
function facePoly(pts, rgb, fillTint, edgeAlpha, lineWidth) {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = CONFIG.fill;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "multiply";
  if (fillTint > 0) {
    ctx.fillStyle = `rgba(${rgb}, ${fillTint})`;
    ctx.fill();
  }
  if (edgeAlpha > 0) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = `rgba(${rgb}, ${edgeAlpha})`;
    ctx.stroke();
  }
}

/** Pencil-stroke an open polyline. */
function strokePolyline(pts, rgb, alpha, lineWidth) {
  ctx.globalCompositeOperation = "multiply";
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/**
 * One chunk of a long hand-drawn 3D rectangle: a front face along the
 * trail, a back face offset by barDepth, the two side faces between them,
 * and square caps on the head chunk and the oldest visible chunk. Width
 * tapers only to barTailScale so the tail cap stays visible.
 */
function drawBarChunk(it, now) {
  const { b, from, to, s, span } = it;
  const h = b.hist;
  const half = (CONFIG.barWidth / 2) * s;
  const d = { x: CONFIG.barDepth.x * s, y: CONFIG.barDepth.y * s };
  const fl = []; // front-left edge
  const fr = []; // front-right edge
  for (let i = from; i <= to; i++) {
    const p = h[i];
    const q = i > 0 ? h[i - 1] : h[i + 1];
    const tx = i > 0 ? p.x - q.x : q.x - p.x;
    const ty = i > 0 ? p.y - q.y : q.y - p.y;
    const m = Math.hypot(tx, ty) || 1;
    const nx = -ty / m;
    const ny = tx / m;
    const age = Math.min(1, (now - p.t) / span);
    const w = half * (1 - (1 - CONFIG.barTailScale) * age) * (1 + p.j * CONFIG.barJitter);
    fl.push({ x: p.x + nx * w, y: p.y + ny * w, p: p.p });
    fr.push({ x: p.x - nx * w, y: p.y - ny * w, p: p.p });
  }
  if (fl.length < 2) return;
  const bl = fl.map((q) => ({ x: q.x + d.x, y: q.y + d.y, p: q.p }));
  const br = fr.map((q) => ({ x: q.x + d.x, y: q.y + d.y, p: q.p }));
  const rev = (a) => a.slice().reverse();
  const edgeA = CONFIG.pencilAlpha * 1.3;
  const lw = Math.max(0.3, 0.8 * s);
  const rgb = b.rgb;

  // Painter's order: back face, the two side faces, then the front face.
  // Faces are fill-only; the long edges are stroked separately so chunk
  // boundaries do not show as cross-lines.
  facePoly([...bl, ...rev(br)], rgb, 0.1, 0, lw);
  facePoly([...fl, ...rev(bl)], rgb, 0.16, 0, lw);
  facePoly([...fr, ...rev(br)], rgb, 0.06, 0, lw);
  facePoly([...fl, ...rev(fr)], rgb, 0, 0, lw);

  // Back-face long edges, lighter; front-face long edges with pencil pressure.
  strokePolyline(bl, rgb, edgeA * 0.6, lw);
  strokePolyline(br, rgb, edgeA * 0.6, lw);
  ctx.globalCompositeOperation = "multiply";
  for (const pass of b.passes.slice(0, CONFIG.tubePasses)) {
    strokeWithPressure(fl, pass.dx, pass.dy, 0.9 * pass.w * s, edgeA * pass.a, rgb);
    strokeWithPressure(fr, pass.dx, pass.dy, 0.9 * pass.w * s, edgeA * pass.a, rgb);
  }

  // Caps: the square end faces. Head cap on the newest chunk; tail cap on
  // the oldest visible chunk (its `from` is the start of the visible span).
  const oldestVisible = from === 0 || now - h[from - 1].t > span;
  if (it.head) {
    const n = fl.length - 1;
    facePoly([fl[n], fr[n], br[n], bl[n]], rgb, 0.2, edgeA * 1.1, lw);
  }
  if (oldestVisible) {
    facePoly([fl[0], fr[0], br[0], bl[0]], rgb, 0.2, edgeA * 1.1, lw);
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
  if (it.b.chromeBlack) return drawLeadChunk(it, now);
  const { b, s } = it;
  const h = b.hist;
  const half = (CONFIG.chromeWidth / 2) * s;
  const { left, right, normals, heading } = tubeEdges(it, now, half, 0);
  if (left.length < 2) return;

  const mid = Math.floor(left.length / 2);
  const L = left[mid];
  const R = right[mid];
  const g = ctx.createLinearGradient(L.x, L.y, R.x, R.y);
  for (const [o, c] of b.chromeBlack ? CONFIG.blackChromeStops : CONFIG.chromeStops) g.addColorStop(o, c);

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
      cap.addColorStop(0, "#000000");
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
 * One chunk of the all-black lead cylinder: near-black body, then several
 * heavy graphite strokes laid along its length at fixed positions across
 * the width (with pencil pressure), and dark contour edges. The paper grain
 * applied afterwards gives it the tooth of solid pencil shading.
 */
function drawLeadChunk(it, now) {
  const { b, from, s } = it;
  const h = b.hist;
  const half = (CONFIG.chromeWidth / 2) * s;
  const { left, right, normals, heading } = tubeEdges(it, now, half, CONFIG.leadJitter);
  if (left.length < 2) return;

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = CONFIG.leadFill;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();

  // Shading strokes along the length: each sits at a fixed fraction of the
  // local width and carries the boid's pressure, like repeated pencil passes.
  ctx.globalCompositeOperation = "multiply";
  ctx.lineCap = "round";
  for (const f of CONFIG.leadStrokes) {
    const line = [];
    for (let i = 0; i < normals.length; i++) {
      const p = h[from + i];
      const n = normals[i];
      line.push({ x: p.x + n.x * n.w * f, y: p.y + n.y * n.w * f, p: p.p });
    }
    strokeWithPressure(line, 0, 0, CONFIG.leadStrokeWidth * s, CONFIG.leadStrokeAlpha, CONFIG.leadRgb);
  }
  // Contour edges, darkest.
  for (let i = 0; i < left.length; i++) {
    left[i].p = h[from + i].p;
    right[i].p = h[from + i].p;
  }
  strokeWithPressure(left, 0, 0, 1.0 * s, 0.9, CONFIG.leadRgb);
  strokeWithPressure(right, 0, 0, 1.0 * s, 0.9, CONFIG.leadRgb);

  // Head cap: flat dark ellipse with a dark rim.
  if (it.head) {
    const head = h[h.length - 1];
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = CONFIG.leadFill;
    ctx.beginPath();
    ctx.ellipse(head.x, head.y, half * 0.4, half, heading, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = `rgba(${CONFIG.leadRgb}, 0.9)`;
    ctx.lineWidth = Math.max(0.3, 0.9 * s);
    ctx.stroke();
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
  ctx.fillStyle = CONFIG.fill;
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
      strokeWithPressure(edge, pass.dx, pass.dy, 0.9 * pass.w * s, CONFIG.pencilAlpha * 1.4 * pass.a, b.rgb);
    }
  }

  // Rings across the tube, lighter.
  ctx.strokeStyle = `rgba(${b.rgb}, ${CONFIG.pencilAlpha * 0.9})`;
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
    ctx.fillStyle = CONFIG.fill;
    ctx.beginPath();
    ctx.ellipse(head.x, head.y, half * 0.4, half, heading, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = `rgba(${b.rgb}, ${CONFIG.pencilAlpha * 1.6})`;
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

// ---------------------------------------------------------------- cursor followers

/** Move the chain: the head eases toward the cursor, each triangle toward the one ahead. */
function updateFollowers() {
  if (!followers.length) {
    followers = Array.from({ length: CONFIG.cursorCount }, () => ({ x: cursor.x, y: cursor.y, heading: 0 }));
  }
  let tx = cursor.x;
  let ty = cursor.y;
  for (let i = 0; i < followers.length; i++) {
    const f = followers[i];
    const e = i === 0 ? CONFIG.cursorEase : CONFIG.cursorChainEase;
    const dx = tx - f.x;
    const dy = ty - f.y;
    f.x += dx * e;
    f.y += dy * e;
    if (Math.hypot(dx, dy) > 0.3) f.heading = Math.atan2(dy, dx); // hold heading when still
    tx = f.x;
    ty = f.y;
  }
}

/** Draw the triangles in pencil: a small arrowhead pointing along its motion. */
function drawFollowers() {
  if (!cursor.inside || !followers.length) return;
  ctx.globalCompositeOperation = "multiply";
  const n = followers.length;
  followers.forEach((f, i) => {
    const t = 1 - i / n;
    const size = CONFIG.cursorSize * (0.45 + 0.55 * t);
    const a = CONFIG.cursorAlpha * (0.25 + 0.75 * t);
    const c = Math.cos(f.heading);
    const s = Math.sin(f.heading);
    // Tip ahead, two base corners behind.
    const tip = { x: f.x + c * size, y: f.y + s * size };
    const b1 = { x: f.x - c * size * 0.7 - s * size * 0.55, y: f.y - s * size * 0.7 + c * size * 0.55 };
    const b2 = { x: f.x - c * size * 0.7 + s * size * 0.55, y: f.y - s * size * 0.7 - c * size * 0.55 };
    ctx.fillStyle = `rgba(${pencilRgb}, ${a})`;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(b1.x, b1.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.closePath();
    ctx.fill();
  });
  ctx.globalCompositeOperation = "source-over";
}

// ---------------------------------------------------------------- type collision

/**
 * Wrap every non-space character of the copy in its own span (once), walking
 * into child elements such as <strong> so their styling is kept. Spaces stay
 * as bare text so the paragraph still wraps naturally.
 */
function splitLetters(root) {
  if (root.dataset.split) return;
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const ch of child.textContent) {
          if (/\s/.test(ch)) {
            frag.appendChild(document.createTextNode(ch));
          } else {
            const span = document.createElement("span");
            span.className = "ch";
            span.textContent = ch;
            frag.appendChild(span);
          }
        }
        node.replaceChild(frag, child);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(root);
  root.dataset.split = "1";
}

/** Measure each letter's rest box (transforms removed) in container coordinates. */
function measureCopy() {
  if (!copyEl) return;
  splitLetters(copyEl);
  const spans = Array.from(copyEl.querySelectorAll(".ch"));
  for (const s of spans) s.style.transform = "none";
  const c = container.getBoundingClientRect();
  const [w0, w1] = CONFIG.typeWeight;
  letters = spans.map((el, i) => {
    const r = el.getBoundingClientRect();
    // Keep a letter's weight across re-measures so resizing does not reshuffle them.
    const weight = letters[i] ? letters[i].weight : w0 + Math.random() * (w1 - w0);
    return { el, x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height, ox: 0, oy: 0, weight };
  });
  for (const s of spans) s.style.transform = "";
}

/** Approximate collision radius of an orbiter, by shape. */
function orbiterRadius(o) {
  const m = CONFIG.typeRadius[o.shape] || 1;
  switch (o.shape) {
    case "sphere": return CONFIG.sphereRadius * o.scale * m;
    case "cube": return CONFIG.cubeSize * o.scale * m;
    case "cone": return CONFIG.coneHeight * o.scale * m;
    case "slab": return CONFIG.slabSize.x * o.scale * m;
    default: return CONFIG.cubeSize * o.scale;
  }
}

/**
 * Every shape shoves individual letters when it overlaps them; the shove is
 * divided by the letter's weight, so letters scatter unevenly. Each letter
 * then eases back to rest on a timer that ends when the last trail draws off.
 */
function updateCopy(now, dt) {
  if (!letters.length) return;
  let remaining = 0;
  const spheres = [];
  const tr = CONFIG.trailTypeRadius;
  for (const f of flocks) {
    for (const b of f.boids) {
      remaining = Math.max(remaining, b.life - (now - b.bornAt));
      // Optionally, the head of every trail is a small collider too.
      if (!CONFIG.trailsPushType) continue;
      const s = b.scale(now);
      if (s <= 0) continue;
      const R = (b.chrome ? tr.chrome : b.bar ? tr.bar : b.tube ? tr.tube : tr.line) * s;
      spheres.push({ x: b.pos.x, y: b.pos.y, R });
    }
    for (const o of f.orbiters) {
      if (!o.gone && o.scale > 0) {
        spheres.push({ x: o.pos.x, y: o.pos.y, R: orbiterRadius(o) });
      }
    }
  }
  const horizon = flocks.length ? remaining + CONFIG.trailMs : CONFIG.typeIdleReturnMs;
  const k = Math.min(1, dt / Math.max(dt, horizon));
  const cap = CONFIG.typeMaxOffset;

  for (const L of letters) {
    for (const s of spheres) {
      // Quick reject: sphere nowhere near this letter.
      const bx = L.x + L.ox;
      const by = L.y + L.oy;
      if (s.x < bx - s.R || s.x > bx + L.w + s.R || s.y < by - s.R || s.y > by + L.h + s.R) continue;
      // Closest point on the letter box to the sphere centre.
      const cx = Math.max(bx, Math.min(s.x, bx + L.w));
      const cy = Math.max(by, Math.min(s.y, by + L.h));
      let dx = cx - s.x;
      let dy = cy - s.y;
      let d = Math.hypot(dx, dy);
      if (d >= s.R) continue;
      if (d < 1e-3) {
        // Centre inside the box: push out along the shortest axis.
        const l = s.x - bx, r = bx + L.w - s.x;
        const t = s.y - by, btm = by + L.h - s.y;
        const m = Math.min(l, r, t, btm);
        dx = m === l ? -1 : m === r ? 1 : 0;
        dy = m === t ? -1 : m === btm ? 1 : 0;
        d = 0;
      } else {
        dx /= d;
        dy /= d;
      }
      const push = ((s.R - d) * CONFIG.typePush) / L.weight;
      L.ox += dx * push;
      L.oy += dy * push;
    }
    if (L.ox === 0 && L.oy === 0) continue;
    // Cap, then ease back toward rest.
    const off = Math.hypot(L.ox, L.oy);
    if (off > cap) {
      L.ox *= cap / off;
      L.oy *= cap / off;
    }
    L.ox -= L.ox * k;
    L.oy -= L.oy * k;
    if (Math.abs(L.ox) < 0.05 && Math.abs(L.oy) < 0.05) {
      L.ox = 0;
      L.oy = 0;
      L.el.style.transform = "";
      continue;
    }
    L.el.style.transform = `translate(${L.ox.toFixed(2)}px, ${L.oy.toFixed(2)}px)`;
  }
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
  updateCopy(now, dt);
  updateFollowers();
  renderFlocks(now);
  drawFollowers();
  flocks = flocks.filter((f) => !f.dead());
  // Paper grain on the flock only: the drawn path is laid down after this.
  applyGrain(ctx, canvas);
  applyGrain(ctxFront, canvasFront);

  // Every released stroke fades out dash by dash; the flock is what remains.
  // Multiply: graphite over the black tube stays black instead of lightening it.
  ctx.globalCompositeOperation = "multiply";
  for (const s of fadingStrokes) drawFadingStroke(s, now);
  fadingStrokes = fadingStrokes.filter((s) => !strokeDone(s, now));
  if (stroke) drawStroke(stroke.points, CONFIG.strokeAlpha, stroke.seed);
  ctx.globalCompositeOperation = "source-over";
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
}

function onPointerMove(e) {
  const c = toLocal(e);
  cursor.x = c.x;
  cursor.y = c.y;
  cursor.inside = true;
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
  measureCopy();
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
  copyEl = el.querySelector(".copy");
  ctxBack = canvas.getContext("2d");
  ctxFront = canvasFront.getContext("2d");
  ctx = ctxBack;

  const css = getComputedStyle(document.documentElement);
  const rgb = css.getPropertyValue("--accent-rgb").trim();
  if (rgb) accentRgb = rgb;
  const prgb = css.getPropertyValue("--pencil-rgb").trim();
  if (prgb) pencilRgb = prgb;
  const bg = css.getPropertyValue("--bg").trim();
  if (bg) bgColor = bg;
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
  on(canvas, "pointerleave", () => { cursor.inside = false; });
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
  for (const L of letters) L.el.style.transform = "";
  letters = [];
  followers = [];
  cursor.inside = false;
}

window.FlockSketch = { mount, unmount };
})();
