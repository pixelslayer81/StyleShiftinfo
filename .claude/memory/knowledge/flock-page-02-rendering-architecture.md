---
topic: Page 02 flock - rendering architecture and versions
updated: 2026-10-09
---

Page 02 (`pages/02-flock/`): right-click draws a spline; release spawns a flock following it. On 2026-10-09 it evolved from plain particles into a layered stylised renderer. Per-iteration parameter values are intentionally not recorded; read `sketch.js` for current dials.

Durable structure and decisions:
- Trail styles tried, in order: pencil (graphite, layered passes, paper grain, pressure variation), skinny white hand-drawn tubes, silver and black chrome tubes. Style is swappable; the pencil version is the user's reference look.
- Flock behaviour has "rogue" boids and per-boid speed profiles so the flock is not uniform.
- Depth-sorted "weave" rendering: a second canvas sits above the copy text so some boids/trails pass in front of the text and others behind.
- Orbiting 3D shapes (cubes, black chrome cones, wireframe spheres; lead shapes at the front) are part of the depth sort.
- Backup of the pencil version: `pages/02-flock/versions/pencil-2026-10-09/`. Next planned experiment: a coloured-pencil palette variant (work on the live files, revert from the backup if needed).

Related: [[drawn-paths-smooth-and-dashed]], [[site-vision-and-page-workflow]].
