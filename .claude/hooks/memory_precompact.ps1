# PreCompact hook - curate durable learnings BEFORE the conversation compacts.
#
# Runs alongside the capture hook (document_session.ps1), which snapshots the full
# session before compaction. This one asks Claude to distill the DURABLE learnings
# into .claude/memory/knowledge/ first, so the injected MEMORY.md keeps growing even
# across long, compacting sessions.
#
# Alternates per session via a temp flag to avoid a block/retry loop:
#   - no flag  -> set flag, BLOCK once and prompt Claude to curate.
#   - flag set -> clear it and ALLOW compaction.
# Any error, or unmanageable flag, falls through to ALLOW so compaction never wedges.

$Reason = 'Pre-compaction memory checkpoint. The conversation is about to be COMPACTED and ' +
    'detail will be lost. First, review this session for DURABLE, non-obvious learnings ' +
    'worth keeping for FUTURE sessions and for OTHER people who open this project: user ' +
    'preferences, project decisions, gotchas, or reference pointers (URLs, tickets). For ' +
    'each, write or UPDATE a one-fact file in .claude/memory/knowledge/ using the ' +
    'frontmatter format in .claude/memory/README.md, and add/refresh a one-line pointer in ' +
    '.claude/memory/MEMORY.md. Prefer updating an existing file over duplicating; convert ' +
    'relative dates to absolute. Skip what the repo/CLAUDE.md already records and raw ' +
    'transcript detail (the capture hook already snapshotted the full session to ' +
    '.claude/memory/sessions/). When done, end your turn so compaction can proceed. If ' +
    'there is nothing durable to save, just end your turn.'

try {
    $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
} catch {
    exit 0  # fail safe: allow compaction
}
if ($null -eq $data) { exit 0 }

$sid = if ($data.session_id) { [string]$data.session_id } else { 'nosession' }
$flag = Join-Path ([System.IO.Path]::GetTempPath()) "claudemem_precompact_$sid.flag"
try {
    if (Test-Path -LiteralPath $flag) {
        Remove-Item -LiteralPath $flag -Force -ErrorAction Stop
        exit 0
    }
    [System.IO.File]::WriteAllText($flag, '1')
} catch {
    exit 0
}

[Console]::Out.WriteLine((@{ decision = 'block'; reason = $Reason } | ConvertTo-Json -Compress))
exit 0
