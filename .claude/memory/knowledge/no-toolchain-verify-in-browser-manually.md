---
name: no-toolchain-verify-in-browser-manually
description: Machine has no Node/npm/git and sessions have no browser automation, so pages open from file:// and runtime checks fall to the user
metadata:
  type: project
---

Confirmed 2026-10-09: `node`, `npm`, `pnpm` and `git` are all absent on this machine
(in addition to Python, see [[hooks-are-powershell-not-python]]). The Claude Code session
also had no browser-automation tool (no Chrome extension or built-in browser MCP), so
the agent cannot run the page or read its console.

**Why:** This is why the site is plain HTML/CSS/JS with no build step, and why page scripts
are classic `<script src>` files rather than ES modules: Chrome/Edge refuse `import` from
`file://` (origin `null`), and with no server available the user opens files directly.

**How to apply:**
- Do not propose frameworks, bundlers or `npm install` steps without first checking
  whether the toolchain has since been installed (`Get-Command node, git`).
- Keep every `sketch.js` a classic IIFE exposing a `window.*Sketch` global; no `import`/`export`.
- After writing a page, do a careful static read of the script, then
  `Start-Process pages\NN-slug\index.html` and ask the user to report behaviour and
  console errors. State plainly that runtime was not verified by the agent.
- No git: there is no history to lean on; README/CLAUDE.md are the only record of decisions.
  Copy a page's current files into `pages/NN-slug/versions/<name>-<date>/` before big
  style changes; that folder is the revert mechanism.
- No bundler/linter means syntax errors surface only in the browser. A duplicate `const`
  in one scope once broke the entire page 02. After editing, re-read the edited scope for
  redeclared names and unbalanced braces.
