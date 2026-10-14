// Page 03: Style Shift. Wires the app mock: radio groups, before/after,
// accordion adjustments, a staged restyle run (the real pipeline's step
// labels), look selection, the accordion library, results collapse.
// Exposes window.StyleShiftSketch = { mount(container), unmount() }. Classic
// script (not a module) so the page works when opened straight from file://.

(function () {
"use strict";

const LOOK_LABEL = {
  original: "Original",
  candid: "Candid",
  shadows: "Shadows",
  "pantone-blue": "Pantone Blue",
  "pantone-green": "Pantone Green",
  "pantone-pink": "Pantone Pink",
};
const RES_PX = { "1k": "1376×768", "2k": "2752×1536", "4k": "5504×3072" };

// The live pipeline's step labels (lowercased by the UI) with a detail each.
const RUN_STEPS = [
  ["queued", ""],
  ["analyzing photo", "claude vision — writing the content lock"],
  ["building the locked prompt", "locks: identity · pose/wardrobe · camera · composition · environment · era · 16:9 native"],
  ["generating on runway", "gemini_image3_pro @ 16:9 (2K)"],
  ["downloading the render", "4.6 MB received"],
  ["content audit", "comparing render vs source — 5 hard rules"],
  ["colorist grading", "measuring luminance percentiles · deriving exposure / warmth / saturation / levels"],
  ["applying the treatment", "adding film grain — strength 19.5 @ 2752px · scale 1.5"],
];

// Library: 23 renders grouped by look, Candid first; the first is the hero.
// (Device-only product shots are left out.)
const LIBRARY = [
  // Candid: the thirteen supplied renders in the order given (lib-30 leads),
  // then the earlier Candid set (reversed, selfie third from its end)
  ["lib-30", "Candid"], ["lib-31", "Candid"], ["lib-32", "Candid"], ["lib-33", "Candid"],
  ["lib-34", "Candid"], ["lib-35", "Candid"], ["lib-36", "Candid"], ["lib-37", "Candid"],
  ["lib-38", "Candid"], ["lib-39", "Candid"], ["lib-40", "Candid"], ["lib-41", "Candid"],
  ["lib-42", "Candid"],
  ["lib-23", "Candid"], ["lib-22", "Candid"], ["lib-20", "Candid"],
  ["lib-17", "Candid"], ["lib-24", "Candid"], ["lib-14", "Candid"], ["lib-06", "Candid"],
  // Shadows
  ["lib-25", "Shadows"],
  // Pantone Blue
  ["lib-11", "Pantone Blue"], ["lib-21", "Pantone Blue"],
  // Pantone Green
  ["lib-01", "Pantone Green"], ["lib-02", "Pantone Green"], ["lib-04", "Pantone Green"],
  ["lib-12", "Pantone Green"], ["lib-18", "Pantone Green"],
  // Pantone Pink
  ["lib-03", "Pantone Pink"], ["lib-05", "Pantone Pink"], ["lib-10", "Pantone Pink"],
  ["lib-13", "Pantone Pink"], ["lib-15", "Pantone Pink"], ["lib-16", "Pantone Pink"],
];

let listeners = [];
let root;
let state = { look: "candid", res: "2k", ba: "after", format: "single", crop: "off" };
let runTimer = 0;
let hoverTimer = 0; // library hover-dwell timer

function on(target, type, fn, opts) {
  if (!target) return;
  target.addEventListener(type, fn, opts);
  listeners.push(() => target.removeEventListener(type, fn, opts));
}
const $ = (sel) => root.querySelector(sel);

function setStatus(html, proc) {
  const el = $("#status");
  if (!el) return;
  el.innerHTML = html;
  el.classList.toggle("proc", proc !== false);
}

// --------------------------------------------------------- radio groups

function mountGroups() {
  for (const group of root.querySelectorAll("[data-group]")) {
    const key = group.dataset.group;
    on(group, "click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn || !group.contains(btn)) return;
      for (const b of group.querySelectorAll("button[data-value]")) b.classList.toggle("on", b === btn);
      state[key] = btn.dataset.value;
      onChange(key);
    });
  }
}

function onChange(key) {
  const img = $("#stage-img");
  if (key === "look") {
    setStatus(`Look — ${LOOK_LABEL[state.look]}. Hit Run restyle to render.`);
  }
  if (key === "ba") img.classList.toggle("is-before", state.ba === "before");
  if (key === "res") setStatus(`Resolution — ${state.res.toUpperCase()} (${RES_PX[state.res]}px).`);
  if (key === "format" && $("#panel-note")) {
    $("#panel-note").innerHTML = state.format === "batch"
      ? "Batch runs every photo on automatic settings — flash, grain, levels and crop are set to auto."
      : "Adjustments re-process the generated photo locally — no new generation. Set them, then hit <em>Apply</em>.";
    $("#btn-run").textContent = state.format === "batch" ? "Run restyle (1)" : "Run restyle";
  }
  if (key === "crop") setStatus(state.crop === "off" ? "Crop off." : `Crop — ${state.crop}. Use the gizmo: red/green arrows move on one axis, the yellow centre square scales, the ring rotates.`);
}

// ---------------------------------------------------------- accordions

function mountAccordions() {
  for (const acc of root.querySelectorAll(".acc")) {
    const head = acc.querySelector(".acc-head");
    const caret = acc.querySelector(".acc-caret");
    on(head, "click", () => {
      const open = acc.classList.toggle("is-open");
      caret.innerHTML = open ? "&#9662;" : "&#9656;";
    });
    // Live value readouts.
    for (const row of acc.querySelectorAll(".sliderrow")) {
      const range = row.querySelector('input[type="range"]');
      const val = row.querySelector(".val");
      const num = row.querySelector(".numinput");
      if (!range) continue;
      on(range, "input", () => {
        const v = Number(range.value);
        if (num) num.value = String(v);
        if (val) {
          const label = row.querySelector("label").textContent.toLowerCase();
          val.textContent = label === "hue" ? `${v}°` : Number.isInteger(Number(range.step)) || Number(range.step) >= 1 ? String(v) : v.toFixed(2);
        }
        applyPreview();
      });
      if (num) on(num, "input", () => { range.value = num.value; range.dispatchEvent(new Event("input")); });
    }
  }
  on($("#btn-revert"), "click", () => {
    for (const range of root.querySelectorAll('.acc input[type="range"]')) {
      range.value = range.defaultValue;
      range.dispatchEvent(new Event("input"));
    }
    setStatus("Reverted to the original render.");
  });
}

/** Local preview of the colour controls on the stage image. */
function applyPreview() {
  const get = (acc, i = 0) => Number(root.querySelectorAll(`[data-acc="${acc}"] input[type="range"]`)[i]?.value || 0);
  const heat = get("flash");
  const warmth = get("colour", 0);
  const exposure = get("colour", 1) || 1;
  const hue = get("hue", 0);
  const sat = get("hue", 1);
  const img = $("#stage-img");
  img.style.filter = `brightness(${exposure * (1 + heat / 400)}) sepia(${Math.max(0, warmth) * 0.4}) hue-rotate(${hue}deg) saturate(${1 + sat / 100})`;
}

// ------------------------------------------------------------- restyle

function runRestyle() {
  const img = $("#stage-img");
  if (img.classList.contains("is-rendering")) return;
  img.classList.add("is-rendering");
  const runBtn = $("#btn-run");
  if (runBtn) runBtn.textContent = "Working…";
  let i = 0;
  const tick = () => {
    if (i < RUN_STEPS.length) {
      const [step, detail] = RUN_STEPS[i++];
      setStatus(`<span class="proc-cursor">▌</span> ${step}${detail ? " — " + detail : ""}`);
      runTimer = setTimeout(tick, 520);
    } else {
      img.classList.remove("is-rendering");
      if (runBtn) runBtn.textContent = state.format === "batch" ? "Run restyle (1)" : "Run restyle";
      setStatus(`Done — ${RES_PX[state.res]}px.`);
    }
  };
  tick();
}

function mountButtons() {
  on($("#btn-run"), "click", runRestyle);
  on($("#btn-run-2"), "click", runRestyle);
  on($("#btn-rerun"), "click", runRestyle);
  on($("#btn-clear"), "click", () => setStatus("Cleared. Drop in a photo."));
  on($("#btn-download"), "click", () => setStatus(`Downloading — ${LOOK_LABEL[state.look]} ${RES_PX[state.res]}px PNG.`));
  on($("#btn-library"), "click", addToLibrary);
  on($("#btn-library-2"), "click", addToLibrary);
  on($("#btn-download-all"), "click", () => setStatus("Downloading the library as a zip."));
  on($("#looks-grid"), "click", (e) => {
    const fig = e.target.closest(".look");
    if (!fig || fig.dataset.look === "original") return;
    const radio = root.querySelector(`[data-group="look"] button[data-value="${fig.dataset.look}"]`);
    if (radio) radio.click();
    else {
      state.look = fig.dataset.look;
      onChange("look");
    }
  });
  // Results card collapse / expand: the card animates its height to zero
  // (a pill-capped line pivoting at the top edge) and the button strip
  // below it masks away with it, as in the app.
  const card = $("#auditcard");
  const mask = $("#auditactions");
  const btn = $("#btn-collapse");
  if (btn) on(btn, "click", () => {
    const collapsing = !card.classList.contains("is-collapsed");
    card.style.height = `${card.scrollHeight}px`;
    mask.style.height = `${mask.scrollHeight}px`;
    requestAnimationFrame(() => {
      card.classList.toggle("is-collapsed", collapsing);
      mask.classList.toggle("is-collapsed", collapsing);
      if (!collapsing) {
        card.style.height = `${card.scrollHeight}px`;
        mask.style.height = `${mask.scrollHeight}px`;
        setTimeout(() => { card.style.height = ""; mask.style.height = ""; }, 620);
      }
    });
    btn.title = collapsing ? "Expand the results" : "Collapse the results";
    btn.innerHTML = collapsing
      ? '<span class="audit-collapse-caret">&#9656;</span> Expand'
      : '<span class="audit-collapse-caret">&#9662;</span> Collapse';
  });
}

// -------------------------------------------------------------- library

// The app's AccordionGallery props: expandRatio 0.29, gap 2, radius 4,
// showLabels false, defaultIndex 0. The hero overlay carries Crop above a
// heart / Save / Delete row.
function makePanel(id, label) {
  const el = document.createElement("div");
  el.className = "ag-panel";
  el.dataset.id = id;
  el.innerHTML = `
    <img src="assets/${id}.jpg" alt="${label}" loading="lazy">
    <div class="ag-actions">
      <button class="btn btn--fill btn--tocanvas" title="Send this image back to the canvas to apply a crop">Crop</button>
      <div class="ag-actions-row">
        <button class="heart" title="Favourite"><svg viewBox="0 0 24 21"><path d="M12 20s-9-5.6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.4-9 12-9 12z"/></svg></button>
        <button class="btn btn--fill btn--save">Save</button>
        <button class="btn btn--delete">Delete</button>
      </div>
    </div>`;
  return el;
}

/** Proxy scrollbar below the panel: its inner width mirrors the gallery's
    true width (hero + slivers + padding), and the two scroll in sync. */
function measureLibrary() {
  const panel = $("#library-panel");
  const inner = $("#library-scrollbar-inner");
  const ag = $("#gallery");
  if (!panel || !inner || !ag) return;
  const pad = 28; // panel padding 14px each side
  const agW = panel.clientWidth - pad;
  const n = ag.children.length;
  const hero = 0.48 * agW;
  const sliver = Math.min(44, Math.max(18, 0.022 * agW));
  const total = hero + Math.max(0, n - 1) * (sliver + 2) + pad;
  inner.style.width = `${Math.max(total, panel.scrollWidth)}px`;
}

function mountLibrary() {
  const ag = $("#gallery");
  if (!ag) return;
  for (const [id, label] of LIBRARY) ag.appendChild(makePanel(id, label));
  const panels = () => Array.from(ag.querySelectorAll(".ag-panel"));
  const select = (p) => { for (const q of panels()) q.classList.toggle("ag-panel--on", q === p); };
  select(panels()[0]); // defaultIndex 0
  // Hover expands after a short dwell (so sweeping across the strip does not
  // ripple every sliver open); it stays expanded after the pointer leaves,
  // so there is always one hero.
  const HOVER_DWELL = 660; // ms (three beats of 220)
  on(ag, "pointerover", (e) => {
    const p = e.target.closest(".ag-panel");
    if (!p || p.classList.contains("ag-panel--on")) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => select(p), HOVER_DWELL);
  });
  on(ag, "pointerout", (e) => {
    const p = e.target.closest(".ag-panel");
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(".ag-panel") : null;
    if (p && to !== p) clearTimeout(hoverTimer); // left the panel before the dwell elapsed
  });
  on(ag, "click", (e) => {
    const heart = e.target.closest(".heart");
    if (heart) { heart.classList.toggle("on"); return; }
    const btn = e.target.closest(".btn");
    if (btn) {
      const p = btn.closest(".ag-panel");
      if (btn.classList.contains("btn--delete")) {
        const next = p.nextElementSibling || p.previousElementSibling;
        p.remove();
        if (next) select(next);
        measureLibrary();
      } else if (btn.classList.contains("btn--save")) {
        setStatus("Saved to your Downloads folder.");
      } else {
        setStatus("Sent back to the canvas — pick a crop format.");
      }
      return;
    }
    const p = e.target.closest(".ag-panel");
    if (p) select(p);
  });
  // Scroll sync, both ways, guarded against feedback.
  const panel = $("#library-panel");
  const bar = $("#library-scrollbar");
  let syncing = false;
  on(panel, "scroll", () => { if (syncing) return; syncing = true; bar.scrollLeft = panel.scrollLeft; syncing = false; });
  on(bar, "scroll", () => { if (syncing) return; syncing = true; panel.scrollLeft = bar.scrollLeft; syncing = false; });
  on(window, "resize", measureLibrary);
  measureLibrary();
}

function addToLibrary() {
  const ag = $("#gallery");
  const map = { candid: "lib-38", shadows: "lib-25", "pantone-blue": "lib-11", "pantone-green": "lib-04", "pantone-pink": "lib-03" };
  const p = makePanel(map[state.look] || "lib-19", LOOK_LABEL[state.look]);
  ag.prepend(p);
  for (const q of ag.querySelectorAll(".ag-panel")) q.classList.toggle("ag-panel--on", q === p);
  measureLibrary();
  setStatus("Added to the library.");
}

// ------------------------------------------------------------- lightbox

// Clicking one of the six looks expands it. Set false to revert to plain tiles.
const LOOKS_EXPAND = true;

let lightboxOpen = false;
let lightboxFrom = null; // the tile that opened it, for the return flight

function lightboxTargetRect() {
  const pad = 48;
  const maxW = Math.min(window.innerWidth - pad * 2, 1560);
  const maxH = window.innerHeight - pad * 2;
  let w = maxW;
  let h = w * 9 / 16;
  if (h > maxH) { h = maxH; w = h * 16 / 9; }
  return { left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2, width: w, height: h };
}

function placeFigure(fig, r) {
  fig.style.left = `${r.left}px`;
  fig.style.top = `${r.top}px`;
  fig.style.width = `${r.width}px`;
  fig.style.height = `${r.height}px`;
}

function openLightbox(tile) {
  const lb = document.getElementById("lightbox");
  const fig = lb.querySelector(".lightbox__figure");
  const img = document.getElementById("lightbox-img");
  const cap = document.getElementById("lightbox-cap");
  const tileImg = tile.querySelector("img");
  const tag = tile.querySelector(".look-tag");
  img.src = tileImg.src;
  img.alt = tileImg.alt;
  cap.innerHTML = tag ? tag.innerHTML : "";
  cap.className = "lightbox__cap";
  for (const c of tag ? tag.classList : []) {
    if (c.startsWith("look-tag--")) cap.classList.add("lightbox__cap--" + c.slice("look-tag--".length));
  }
  lightboxFrom = tile;
  lb.hidden = false;
  // Start at the tile's rect (no transition), then fly to the centre.
  fig.style.transition = "none";
  placeFigure(fig, tileImg.getBoundingClientRect());
  void fig.offsetHeight;
  fig.style.transition = "";
  requestAnimationFrame(() => {
    lb.classList.add("is-open");
    placeFigure(fig, lightboxTargetRect());
  });
  lightboxOpen = true;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  if (!lightboxOpen) return;
  const lb = document.getElementById("lightbox");
  const fig = lb.querySelector(".lightbox__figure");
  lb.classList.remove("is-open");
  if (lightboxFrom) placeFigure(fig, lightboxFrom.querySelector("img").getBoundingClientRect());
  lightboxOpen = false;
  document.body.style.overflow = "";
  setTimeout(() => { if (!lightboxOpen) lb.hidden = true; }, 540);
}

function mountLightbox() {
  if (!LOOKS_EXPAND) return;
  const lb = document.getElementById("lightbox");
  const grid = $("#looks-grid");
  if (!lb || !grid) return;
  on(grid, "click", (e) => {
    const tile = e.target.closest(".look");
    if (tile) openLightbox(tile);
  });
  on(lb.querySelector(".lightbox__backdrop"), "click", closeLightbox);
  on(lb.querySelector(".lightbox__figure"), "click", closeLightbox);
  on(window, "keydown", (e) => { if (e.key === "Escape") closeLightbox(); });
  on(window, "resize", () => { if (lightboxOpen) placeFigure(lb.querySelector(".lightbox__figure"), lightboxTargetRect()); });
}

// ------------------------------------------------------------------ api

function mount(el) {
  root = el;
  mountGroups();
  mountAccordions();
  mountButtons();
  mountLibrary();
  mountLightbox();
}

function unmount() {
  clearTimeout(runTimer);
  clearTimeout(hoverTimer);
  for (const off of listeners) off();
  listeners = [];
}

window.StyleShiftSketch = { mount, unmount };
})();
