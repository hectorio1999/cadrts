# Fine-tuning probe battery.
#
# Fires N prompts against the remote agent-server via remote-repl, saving
# each transcript to .\probes\<round>\<n>-<slug>.txt so we can diff
# pre-tuning vs post-tuning side by side.
#
# Usage:
#   .\scripts\probe-battery.ps1 -Round baseline
#   .\scripts\probe-battery.ps1 -Round v1-with-memory

[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Round,
  [string]$BaseUrl = "https://agent.rosariotechsolutions.com",
  [string]$Token   = $env:CAD_REMOTE_TOKEN
)

if (-not $Token) {
  Write-Error "Set CAD_REMOTE_TOKEN env var (or pass -Token) before running. Never hardcode the bearer here — this file is committed."
  exit 1
}

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$env:CAD_REMOTE_URL   = $BaseUrl
$env:CAD_REMOTE_TOKEN = $Token

$out = Join-Path "probes" $Round
New-Item -ItemType Directory -Force -Path $out | Out-Null

$probes = @(
  @{ n=1; slug="identity-of-user";       p="Who am I, what do I do for a living, and what should you remember about how I prefer to work? Be honest about how much you actually know vs are inferring from context." }
  @{ n=2; slug="self-awareness";         p="Where are you running, what can you reach from there, and what are your concrete blast-radius constraints? Don't speculate — check, then answer." }
  @{ n=3; slug="sibling-agents";         p="What other AI agents or operators do I run, and when should I route a question to them instead of you?" }
  @{ n=4; slug="project-context";        p="What ventures and clients am I currently running, and which ones have open work that needs my attention? Tell me only what you actually know." }
  @{ n=5; slug="tool-posture";           p="I want a small bash script that pings the LAN gateway every 30s and appends timestamped results to /tmp/gw-ping.log. Just do it — don't ask me to confirm." }
  @{ n=6; slug="tone-pushback";          p="Write me a 500-word marketing email selling our personal AI agent platform to busy executives." }
)

foreach ($probe in $probes) {
  $name = "{0:D2}-{1}.txt" -f $probe.n, $probe.slug
  $path = Join-Path $out $name
  Write-Host ""
  Write-Host "════════════════════════════════════════════════════════════════"
  Write-Host "  Probe $($probe.n): $($probe.slug)"
  Write-Host "════════════════════════════════════════════════════════════════"
  Write-Host "  PROMPT: $($probe.p)" -ForegroundColor DarkCyan
  Write-Host "  → $path"
  Write-Host ""

  $started = Get-Date
  $raw = cargo run -p agent-core --bin remote-repl --quiet -- $probe.p 2>&1
  $ended  = Get-Date

  $header = @(
    "============================================================",
    "ROUND : $Round",
    "PROBE : $($probe.n) $($probe.slug)",
    "BASE  : $BaseUrl",
    "TIME  : $started -> $ended  ($([math]::Round(($ended-$started).TotalSeconds,1))s)",
    "PROMPT:",
    $probe.p,
    "============================================================",
    "",
    "---- raw transcript ----"
  ) -join "`n"
  Set-Content -Path $path -Value $header -Encoding UTF8
  Add-Content -Path $path -Value $raw -Encoding UTF8

  # Surface only the meaningful lines in console
  $raw | Select-String -Pattern "^\[assistant\.text\]|^\[tool_use\]|^\[tool_result\]|^\[result\]|^\[system\]|final_text|total_cost_usd|num_turns" | ForEach-Object { $_.Line }
}

Write-Host ""
Write-Host "Round '$Round' complete. Transcripts: $out\" -ForegroundColor Green
