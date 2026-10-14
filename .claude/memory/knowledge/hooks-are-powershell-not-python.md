---
name: hooks-are-powershell-not-python
description: This project's memory hooks are PowerShell because the machine has no Python; rules for editing them safely
metadata:
  type: project
---

The memory hooks in `.claude/hooks/` are `.ps1` ports of the Python hooks used in the
other projects (Gify, Claude_Travel_Agent, Customer Momentum JA, 344750_Figma_to_adobe_ja).
Ported on 2026-10-09 at the user's request.

**Why:** On this machine (user `josep`) `python` resolves only to the Microsoft Store
stub, so `python ...` hook commands fail. The user chose a PowerShell port over
installing Python.

**How to apply:**
- Do not add hooks or scripts here that assume Python is installed; check first.
- Keep the `.ps1` files pure ASCII. Windows PowerShell 5.1 reads BOM-less scripts as
  ANSI, so literal emoji, em dashes or ellipses get mangled; build them from code points
  (as `document_session.ps1` does) and write files/stdout as UTF-8 explicitly.
- `settings.json` calls the hooks by absolute path (`E:/Claude_Code/Projects/website/...`)
  instead of `$CLAUDE_PROJECT_DIR`, which expands differently in bash and PowerShell.
  Moving or renaming the project folder means updating those five paths.
- The other four projects still call `python` and were not changed; the `.ps1` files can
  be copied to them as-is, with only the `settings.json` paths adjusted.
