---
description: Distill recent chat logs into curated project knowledge
---

Invoke the `memory-keeper` subagent to read the auto-captured session logs in
`.claude/memory/sessions/` and `.claude/memory/INDEX.md`, then distill any new
durable facts, decisions, and constraints into `.claude/memory/knowledge/` and
update `.claude/memory/MEMORY.md`.

Use today's date (from the session context) for any `updated:` fields. Only
process sessions newer than what `MEMORY.md` already reflects. Report a short
summary of what changed. $ARGUMENTS
