# SessionStart hook for Claude Code.
#
# Surfaces curated project memory into context at the start of each session so
# Claude begins with accumulated knowledge without being asked. Reads
# `.claude/memory/MEMORY.md` (agent-curated) plus a few recent rows from
# `INDEX.md` (hook-captured) and emits them as `additionalContext`.
#
# Contract: never block, never raise. Always exit 0. If there's nothing useful
# to inject, emit nothing.

$ErrorActionPreference = 'Stop'

$HooksDir = $PSScriptRoot
$ClaudeDir = Split-Path -Parent $HooksDir
$MemoryDir = Join-Path $ClaudeDir 'memory'
$MemoryPath = Join-Path $MemoryDir 'MEMORY.md'
$IndexPath = Join-Path $MemoryDir 'INDEX.md'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

$RecentSessions = 5


function Read-TextFile([string]$path) {
    try {
        return [System.IO.File]::ReadAllText($path, $Utf8).Trim()
    } catch {
        return ''
    }
}


function Get-RecentIndexRows {
    $text = Read-TextFile $IndexPath
    if (-not $text) { return '' }
    $rows = @($text -split "`r?`n" | Where-Object { $_.Contains('](sessions/') })
    if ($rows.Count -eq 0) { return '' }
    $header = "| Last updated | Session | Turns | First prompt |`n" +
        "|---|---|---|---|`n"
    return $header + (($rows | Select-Object -First $RecentSessions) -join "`n")
}


function Test-CuratedContent([string]$memoryText) {
    # MEMORY.md ships with a placeholder line; treat that as "empty".
    if (-not $memoryText) { return $false }
    return -not $memoryText.Contains('No curated knowledge yet')
}


function Main {
    $memoryText = Read-TextFile $MemoryPath
    $indexRows = Get-RecentIndexRows

    $parts = @()
    if (Test-CuratedContent $memoryText) {
        $parts += "## Curated project memory (.claude/memory/MEMORY.md)`n`n" + $memoryText
    }
    if ($indexRows) {
        $parts += "## Recent Claude Code sessions (.claude/memory/INDEX.md)`n`n" + $indexRows
    }

    if ($parts.Count -eq 0) { return }  # nothing worth injecting yet

    $context = 'The following is this project''s persistent memory, auto-loaded at ' +
        'session start. Read it before starting work. Run `/memory` to refresh ' +
        "the curated layer.`n`n" + ($parts -join "`n`n")

    $out = @{
        hookSpecificOutput = @{
            hookEventName = 'SessionStart'
            additionalContext = $context
        }
    } | ConvertTo-Json -Compress

    # Write UTF-8 bytes directly; the console code page would mangle non-ASCII.
    $bytes = $Utf8.GetBytes($out + "`n")
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}


try {
    Main
} catch {
}
exit 0
