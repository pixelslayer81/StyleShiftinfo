---
name: drawn-paths-smooth-and-dashed
description: User-drawn paths on any page must render as smooth dashed splines, never raw jagged polylines
metadata:
  type: feedback
---

On 2026-10-09, after seeing page 02's first version, the user said: "always make the path
spline smooth, make it dashed." The word "always" makes this a standing rule for every
page with user drawing, not just page 02.

**Why:** A raw polyline of mouse points looks jagged and technical; the smooth dashed
line is the look the user wants for drawn input across the site.

**How to apply:**
- Render strokes with `quadraticCurveTo` through segment midpoints (see `drawStroke` in
  `pages/02-flock/sketch.js`) and `ctx.setLineDash(CONFIG.strokeDash)`; reset the dash after.
- Anything that follows the path (particles, etc.) should follow the smoothed curve too:
  run Chaikin `smooth()` before `resample()`.
- Reuse these two helpers rather than re-deriving them on later pages.
- "Always" means every drawn path, not that it persists. The user explicitly wants the
  path to fade off once drawn (~2.5s); the followers are what remain. I once read
  "always" as "stays on screen" and had to revert it.
- The pipeline that satisfied "smooth spline": larger capture gap (6px), moving-average
  `denoise()` over raw points, 4 Chaikin passes, then render as Catmull-Rom cubic Beziers.
  Quadratic-through-midpoints on raw points was not smooth enough for the user.
