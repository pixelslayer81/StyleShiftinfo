---
name: site-vision-and-page-workflow
description: The site is ~10 interactive pages built one at a time, then stitched into a scroll-through blog; why pages are 100vh sections at a 1440x900 reference, not 1440x1080
metadata:
  type: project
---

Decided 2026-10-09 with the user. The site is a portfolio of ~10 interactive "vibe coding / AI tools"
pages, each about one project. The user builds them one page at a time (page 02, the
flocking-particle page, was first), and will connect them at the end into a single
scroll-down, blog-style site where each page is one section.

**Why:** The user asked whether to use one folder per page and whether the default size
should be 1440 x 1080. Per-page folders were chosen because organization matters at
10 pages; `pages/NN-slug/` with a numeric prefix gives scroll order for free. 1440 x 1080
was rejected because it is a TV aspect; common laptop viewports (1440 x 900, 1536 x 864)
are shorter and would crop it. Pages are full-viewport (`100vw x 100vh`) sections instead,
laid out against a 1440 x 900 reference.

**How to apply:**
- New pages go in `pages/NN-slug/` with `index.html`, `style.css`, `sketch.js`; keep
  `window.<Name>Sketch = { mount, unmount }` so the final stitch can host each page as
  a section. (Structure details are in CLAUDE.md and README.md; this file is the why.)
- Design and screenshot against 1440 x 900; nothing should depend on a fixed pixel size.
- Page 01 (intro) is an empty placeholder; the user has not described it yet.
- Page 02's copy is temp text ("The AI Task Force is a cross-functional team...") that the
  user supplied as a placeholder; expect it to be replaced.
- The user's reference for page 02's feel was https://brik.space/toolviewer?slug=canvas-context-guard-mo49tab6
  (right-click draw, release spawns flocking particles following the path). The page is
  JS-rendered, so WebFetch returns only Brik marketing copy; do not expect to read the demo.
- Work from a plan first: the user opened this session in plan mode and wanted the plan
  reviewed before any files were written.
