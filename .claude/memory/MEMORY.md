# Curated Memory

One bullet per knowledge file. The `memory-keeper` subagent maintains this.
Full per-session logs live in `sessions/` and `INDEX.md` (auto-captured).

<!-- Example row (the agent will fill these in):
- [Topic title](knowledge/topic-slug.md) — one-line hook
-->

- [Hooks are PowerShell, not Python](knowledge/hooks-are-powershell-not-python.md) — no Python on this machine; keep `.ps1` hooks ASCII, and `settings.json` uses absolute paths
- [Site vision and page workflow](knowledge/site-vision-and-page-workflow.md) — ~10 interactive pages built one at a time, stitched into a scroll blog at the end; 100vh sections at 1440x900, not 1440x1080; brik.space reference is unfetchable
- [Drawn paths: smooth and dashed](knowledge/drawn-paths-smooth-and-dashed.md) — standing rule: user-drawn paths render as smooth dashed splines; followers use the smoothed path
- [No toolchain; verify in browser manually](knowledge/no-toolchain-verify-in-browser-manually.md) — no Node/npm/Python and no browser automation; classic scripts not ES modules because pages open from `file://`; user must report runtime results; duplicate `const` once broke a page; git installed 2026-10-14 (set GIT_TERMINAL_PROMPT=1 / GCM_INTERACTIVE=always to push), remote pixelslayer81/StyleShiftinfo
- [Page 02 flock rendering architecture](knowledge/flock-page-02-rendering-architecture.md) — pencil/chrome trails, rogue boids, depth-sorted weave with second canvas over text, 3D shapes; pencil backup location
- [User working style](knowledge/user-working-style-visual-iteration.md) — small visual increments, quick "dial" summaries, "always" = every instance
- [Style Shift page sources](knowledge/styleshift-page-sources.md) — page 03 is built from the `342450 Give Photo` app (CSS, copy, renders); Runway outpaint via REST from PowerShell (UTF-8 body, pin the scale in the prompt)
