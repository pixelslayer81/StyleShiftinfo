# Stop hook - once-per-session curated-memory checkpoint.
#
# Complements the deterministic capture hook (document_session.ps1): capture logs
# EVERY session losslessly; this fires once per session and asks Claude to distill
# the DURABLE, high-signal learnings into .claude/memory/knowledge/ so the injected
# MEMORY.md index grows automatically (no manual /memory run required).
#
# Loop-safe two ways: `stop_hook_active` true -> allow; per-session marker -> allow.
# Fires at most once per session; any error allows the stop.

$Reason = 'Memory checkpoint (fires once per session). Review this session for DURABLE, ' +
    'non-obvious learnings worth keeping for future sessions AND for OTHER people who ' +
    'open this project: user preferences, project decisions, gotchas, or reference ' +
    'pointers (URLs, tickets). For each, write or UPDATE a one-fact file in ' +
    '.claude/memory/knowledge/ using the frontmatter format in .claude/memory/README.md, ' +
    'and add/refresh a one-line pointer in .claude/memory/MEMORY.md. Prefer updating an ' +
    'existing file over duplicating; convert relative dates to absolute. Skip anything the ' +
    'repo/CLAUDE.md already records, anything already captured that only mattered to this ' +
    'one conversation, and raw transcript detail (the capture hook already logged the full ' +
    'session to .claude/memory/sessions/ - for a deeper consolidation the user can run ' +
    '/memory). If there is nothing durable to save, just end your turn normally.'

try {
    $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
} catch {
    exit 0  # fail safe: allow stop
}
if ($null -eq $data) { exit 0 }

if ($data.stop_hook_active) { exit 0 }

$sid = if ($data.session_id) { [string]$data.session_id } else { 'nosession' }
$marker = Join-Path ([System.IO.Path]::GetTempPath()) "claudemem_$sid.flag"
if (Test-Path -LiteralPath $marker) { exit 0 }
try {
    [System.IO.File]::WriteAllText($marker, '1')
} catch {
}

[Console]::Out.WriteLine((@{ decision = 'block'; reason = $Reason } | ConvertTo-Json -Compress))
exit 0
