# website

Scroll-through, blog-style site built one page at a time, stitched together at the end. Plain HTML/CSS/JS, no build step (no Node, npm or Python on this machine; Git for Windows is installed at `C:\Program Files\Git\cmd`, which may not be on the agent shell's PATH).

## Git

- Remote: `origin` = https://github.com/pixelslayer81/StyleShiftinfo.git, branch `main`.
- Pushing from the agent shell needs the prompt blocks lifted for that command:
  `$env:GIT_TERMINAL_PROMPT="1"; $env:GCM_INTERACTIVE="always"` (the harness sets them off).
- `.claude/memory/sessions/` is git-ignored; the curated knowledge is committed.

## Structure

- `pages/NN-slug/` — one folder per page (`index.html`, `style.css`, `sketch.js`); the number is scroll order.
- `shared/` — `reset.css`, `tokens.css` (all brand values), `fonts/`.
- Each `sketch.js` is a classic script exposing `window.<Name>Sketch = { mount, unmount }`. No ES modules: pages are opened from `file://`.
- Pages are full-viewport sections; design against a 1440 x 900 reference.
- Preview: `Start-Process pages\NN-slug\index.html`.

<!-- quickstart-memory -->
## Project memory

This project has an auto-memory system (`.claude/memory/`). Every session is captured to `sessions/`; durable learnings are curated into `knowledge/` and indexed in `MEMORY.md`, which is injected at the start of each session. Run `/memory` for a deeper distillation pass. See `.claude/memory/README.md`.
