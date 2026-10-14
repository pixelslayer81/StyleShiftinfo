# Project memory

A **4-layer, local-only** memory system so this project captures all context and
keeps getting smarter across sessions and across people. Lives in `.claude/` so it
travels with the repo (commit it when you want it shared).

## The four layers
1. **Capture (automatic, lossless).** `document_session.ps1` runs on **Stop** and
   **PreCompact** and writes a clean, wrapper-stripped log of the whole session to
   `sessions/<id>.md`, indexed in `INDEX.md`. Deterministic — no LLM, no network,
   never blocks. *Nothing is ever lost.*
2. **Auto-curate (automatic, inline).** `memory_record.ps1` (Stop, once/session) and
   `memory_precompact.ps1` (before compaction) prompt Claude to distill the session's
   **durable, high-signal** learnings into `knowledge/` and update `MEMORY.md` — so the
   curated layer grows every session with no manual step.
3. **Deep-distill (on demand).** The `memory-keeper` subagent, run via **`/memory`**,
   reads the raw `sessions/` logs and consolidates/cleans `knowledge/` + `MEMORY.md`.
   Use it periodically for a deeper pass than the inline checkpoints.
4. **Recall (automatic).** `load_memory.ps1` (SessionStart) injects `MEMORY.md` (plus a
   few recent session rows) into context at the start of every session.

## Layout
```
.claude/memory/
├── README.md        ← this file
├── MEMORY.md        ← curated index: one bullet per knowledge file (injected each session)
├── INDEX.md         ← auto: one row per session (hook-owned; don't hand-edit)
├── knowledge/       ← curated one-fact topic files (auto-curate + /memory own these)
└── sessions/        ← auto: full per-session logs (hook-owned; don't hand-edit)
```

## Format for `knowledge/` files
One file = one fact, with frontmatter:
```markdown
---
name: short-kebab-case-slug
description: one-line summary (used to judge relevance on recall)
metadata:
  type: user | feedback | project | reference
---

The fact. For feedback/project, add **Why:** and **How to apply:** lines.
Link related memories with [[their-name]].
```
`MEMORY.md` holds one line per knowledge file — `- [Title](knowledge/file.md) — hook` —
no frontmatter, no fact content.

## Discipline
- Update an existing knowledge file rather than duplicating; delete ones that turn out wrong.
- Don't curate what the repo/CLAUDE.md already records or what only mattered to one chat
  (the raw log in `sessions/` already has that).
- Convert relative dates to absolute.

## Why the split
Capture can't reason, so it records everything (nothing lost). Curation reasons, so it
keeps the injected signal small and high-value. Capture feeds distillation.
