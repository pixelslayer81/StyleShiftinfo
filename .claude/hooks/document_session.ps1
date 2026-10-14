# Auto-capture hook for Claude Code.
#
# Runs on the `Stop` event (every time Claude finishes responding) and on
# `PreCompact`. Reads the session transcript and rewrites a per-session markdown
# log under `.claude/memory/sessions/`, then upserts a one-line pointer in
# `.claude/memory/INDEX.md`. This is the "auto-sync" piece: local files only,
# no git, no LLM calls, no network. It is deterministic and cheap.
#
# The intelligent distillation (turning these raw logs into curated knowledge)
# is done separately by the `memory-keeper` subagent - see .claude/memory/README.md.
#
# Contract: never block Claude, never raise. Always exit 0.
#
# Keep this file pure ASCII: Windows PowerShell 5.1 reads BOM-less scripts as
# ANSI, so non-ASCII characters are built from code points below.

$ErrorActionPreference = 'Stop'

# --- Resolve paths from this file's location (cwd-independent) ---------------
$HooksDir = $PSScriptRoot
$ClaudeDir = Split-Path -Parent $HooksDir                # <repo>/.claude
$MemoryDir = Join-Path $ClaudeDir 'memory'
$SessionsDir = Join-Path $MemoryDir 'sessions'
$IndexPath = Join-Path $MemoryDir 'INDEX.md'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

# Wrappers injected by the harness that are noise in a human-readable log.
$StripTags = [regex]'(?s)<(local-command-[^>]*|command-[^>]*|system-reminder)>.*?</\1>'
$StripOpen = [regex]'</?(local-command-[^>]*|command-[^>]*|system-reminder)>'
$MaxMsgChars = 4000   # truncate any single message to keep logs readable

$Ellipsis = [string][char]0x2026
$EmDash = [string][char]0x2014
$MidDot = [string][char]0xB7
$UserLabel = [char]::ConvertFromUtf32(0x1F9D1) + ' User'
$ClaudeLabel = [char]::ConvertFromUtf32(0x1F916) + ' Claude'

Add-Type -AssemblyName System.Web.Extensions
$Json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$Json.MaxJsonLength = [int]::MaxValue
$Json.RecursionLimit = 512


function Clean-Text([string]$text) {
    $text = $StripTags.Replace($text, '')
    $text = $StripOpen.Replace($text, '')
    return $text.Trim()
}


function Truncate-Text([string]$text) {
    if ($text.Length -le $MaxMsgChars) { return $text }
    return $text.Substring(0, $MaxMsgChars).TrimEnd() + ' ' + $Ellipsis + '[truncated]'
}


function Read-StdinPayload {
    try {
        if ([Console]::IsInputRedirected) {
            $reader = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $Utf8)
            $raw = $reader.ReadToEnd()
            if ($raw.Trim()) {
                $obj = $Json.DeserializeObject($raw)
                if ($obj -is [System.Collections.IDictionary]) { return $obj }
            }
        }
    } catch {}
    return @{}
}


function Find-Transcript($payload) {
    $path = $payload['transcript_path']
    if ($path -and (Test-Path -LiteralPath $path -PathType Leaf)) { return $path }
    # Fallback: newest transcript in this project's history dir.
    $projectDir = $payload['cwd']
    if (-not $projectDir) { $projectDir = (Get-Location).Path }
    $slug = [regex]::Replace([System.IO.Path]::GetFullPath($projectDir), '[^A-Za-z0-9]', '-')
    $guess = Join-Path (Join-Path (Join-Path $HOME '.claude') 'projects') $slug
    $candidates = @()
    foreach ($dir in @((Split-Path -Parent $ClaudeDir), $guess)) {
        if (Test-Path -LiteralPath $dir -PathType Container) {
            $candidates += @(Get-ChildItem -LiteralPath $dir -Filter '*.jsonl' -File)
        }
    }
    if ($candidates.Count -eq 0) { return $null }
    return ($candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}


function Get-BlockText($content) {
    # Joined text of the `text` blocks in a list-shaped message content.
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($b in $content) {
        if ($b -is [System.Collections.IDictionary] -and $b['type'] -eq 'text' -and $b['text']) {
            $parts.Add([string]$b['text'])
        }
    }
    return ($parts -join "`n")
}


function Extract-Turns([string]$transcriptPath) {
    # Returns @{ Turns = list of @{Role; Ts; Text}; Meta = hashtable }.
    $turns = New-Object System.Collections.Generic.List[object]
    $meta = @{}
    foreach ($line in [System.IO.File]::ReadLines($transcriptPath, $Utf8)) {
        # Cheap pre-filter: only user/assistant records matter, skip the rest unparsed.
        if ($line.IndexOf('"type":"user"') -lt 0 -and $line.IndexOf('"type":"assistant"') -lt 0) { continue }
        try { $rec = $Json.DeserializeObject($line) } catch { continue }
        if ($rec -isnot [System.Collections.IDictionary]) { continue }

        if (-not $meta['sessionId'] -and $rec['sessionId']) { $meta['sessionId'] = $rec['sessionId'] }
        if ($rec['cwd']) { $meta['cwd'] = $rec['cwd'] }
        if ($rec['gitBranch']) { $meta['gitBranch'] = $rec['gitBranch'] }

        $rtype = $rec['type']
        if ($rtype -ne 'user' -and $rtype -ne 'assistant') { continue }
        if ($rec['isMeta'] -or $rec['isSidechain']) { continue }

        $msg = $rec['message']
        if ($msg -isnot [System.Collections.IDictionary]) { continue }
        $content = $msg['content']
        $ts = [string]$rec['timestamp']

        if ($rtype -eq 'user') {
            # Real user prompts are plain strings. List content is a
            # tool_result and is skipped as machine noise.
            if ($content -isnot [string]) { continue }
            $text = Clean-Text $content
            if ($text) { $turns.Add(@{ Role = 'user'; Ts = $ts; Text = (Truncate-Text $text) }) }
        } else {
            if ($content -is [string] -or $content -isnot [System.Collections.IEnumerable]) { continue }
            $text = Clean-Text (Get-BlockText $content)
            if ($text) { $turns.Add(@{ Role = 'assistant'; Ts = $ts; Text = (Truncate-Text $text) }) }
            if ($msg['model']) { $meta['model'] = $msg['model'] }
        }
    }
    return @{ Turns = $turns; Meta = $meta }
}


function Write-SessionFile([string]$sessionId, $turns, $meta) {
    [void][System.IO.Directory]::CreateDirectory($SessionsDir)
    $firstTs = $turns[0].Ts
    $lastTs = $turns[$turns.Count - 1].Ts
    $nUser = @($turns | Where-Object { $_.Role -eq 'user' }).Count

    $started = if ($firstTs) { $firstTs } else { 'unknown' }
    $updated = if ($lastTs) { $lastTs } else { 'unknown' }
    $branch = if ($meta['gitBranch']) { $meta['gitBranch'] } else { 'n/a' }
    $model = if ($meta['model']) { $meta['model'] } else { 'n/a' }

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("# Session $sessionId")
    $lines.Add('')
    $lines.Add("- **Started:** $started")
    $lines.Add("- **Last updated:** $updated")
    $lines.Add("- **User turns:** $nUser")
    $lines.Add("- **Branch:** $branch")
    $lines.Add("- **Model:** $model")
    $lines.Add('')
    $lines.Add("> Auto-generated by the document_session Stop hook. Do not hand-edit $EmDash" +
        ' it is rewritten every turn. Curated knowledge lives in ../knowledge/.')
    $lines.Add('')
    $lines.Add('---')
    $lines.Add('')
    foreach ($t in $turns) {
        $label = if ($t.Role -eq 'user') { $UserLabel } else { $ClaudeLabel }
        $stamp = if ($t.Ts) { " $MidDot $($t.Ts)" } else { '' }
        $lines.Add("### $label$stamp")
        $lines.Add('')
        $lines.Add($t.Text)
        $lines.Add('')
    }

    $path = Join-Path $SessionsDir "$sessionId.md"
    [System.IO.File]::WriteAllText($path, (($lines -join "`n").TrimEnd() + "`n"), $Utf8)
    return @{ FirstTs = $firstTs; LastTs = $lastTs; NUser = $nUser }
}


function Get-FirstUserPrompt($turns) {
    foreach ($t in $turns) {
        if ($t.Role -eq 'user') {
            $snippet = (($t.Text -split '\s+') | Where-Object { $_ }) -join ' '
            if ($snippet.Length -gt 90) { return $snippet.Substring(0, 90) + $Ellipsis }
            return $snippet
        }
    }
    return '(no user prompt)'
}


function Update-Index([string]$sessionId, [string]$firstTs, [string]$lastTs, [int]$nUser, [string]$summary) {
    [void][System.IO.Directory]::CreateDirectory($MemoryDir)
    $header = "# Session Index`n`n" +
        'Auto-maintained by the document_session hook. One row per chat session; ' +
        "full logs are in ``sessions/``.`n`n" +
        "| Last updated | Session | Turns | First prompt |`n" +
        "|---|---|---|---|`n"
    $rowKey = "sessions/$sessionId.md"
    $safeSummary = $summary.Replace('|', '\|')
    $stamp = if ($lastTs) { $lastTs } elseif ($firstTs) { $firstTs } else { 'unknown' }
    $newRow = "| $stamp | [$rowKey]($rowKey) | $nUser | $safeSummary |"

    $rows = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $IndexPath -PathType Leaf) {
        foreach ($s in [System.IO.File]::ReadAllLines($IndexPath, $Utf8)) {
            if (-not ($s.StartsWith('| ') -and $s.Contains('](sessions/'))) { continue }
            if ($s.Contains($rowKey)) { continue }  # drop the stale row for this session
            $rows.Add($s)
        }
    }
    $rows.Add($newRow)
    # Sort newest-first by the leading timestamp cell.
    $sorted = $rows | Sort-Object { $_.Split('|')[1].Trim() } -Descending

    [System.IO.File]::WriteAllText($IndexPath, ($header + ($sorted -join "`n") + "`n"), $Utf8)
}


function Main {
    $payload = Read-StdinPayload
    $transcript = Find-Transcript $payload
    if (-not $transcript) { return }
    $result = Extract-Turns $transcript
    $turns = $result.Turns
    $meta = $result.Meta
    if ($turns.Count -eq 0) { return }
    $sessionId = $payload['session_id']
    if (-not $sessionId) { $sessionId = $meta['sessionId'] }
    if (-not $sessionId) { $sessionId = [System.IO.Path]::GetFileNameWithoutExtension($transcript) }
    $info = Write-SessionFile $sessionId $turns $meta
    Update-Index $sessionId $info.FirstTs $info.LastTs $info.NUser (Get-FirstUserPrompt $turns)
}


try {
    Main
} catch {
    # Never disrupt the session over a logging failure.
}
exit 0
