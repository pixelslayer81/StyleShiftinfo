---
topic: User working style - small visual increments
updated: 2026-10-09
---

- The user iterates on look and feel in many small visual steps (page 02 went through dozens in one day). Make one focused change per request; do not bundle redesigns.
- After each change, give a quick "dial" summary: which few parameters/knobs now control the new behaviour and which way to turn them. Keep it short.
- Feedback wording is literal about scope: "always" means "every instance" (every drawn path, every boid), not "persist on screen". See [[drawn-paths-smooth-and-dashed]] for the time it was misread.
- Before a big stylistic fork, snapshot the current look into a `versions/` folder (see [[no-toolchain-verify-in-browser-manually]]) so the user can revert or compare.
