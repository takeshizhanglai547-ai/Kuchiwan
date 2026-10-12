# Read-only: gather what is needed to plan the functional check of candidate 159.
# - the 159 reports (what the new attack logic is supposed to do)
# - automation test declarations in the candidate source
# - which source files differ between playable 154 (main) and candidate 159
# - how earlier versions ran their native tests / film captures (command lines found in Work155-159 scripts)
# Changes nothing. Writes one text file to %TEMP% and opens it in Notepad.
[CmdletBinding()]
param(
    [string]$WorkRoot    = 'C:\Users\takes\Documents\Codex\2026-10-03\task',
    [string]$MainProject = 'C:\UnrealProjects\ForwardClaude\Project'
)
$cand = Join-Path $WorkRoot 'Work159\Candidate159\Project'
$o = Join-Path $env:TEMP 'verify159_inputs.txt'
& {
    '##### A. reports'
    foreach ($rel in 'Work159\REPORT_159_JA.md', 'Work159\Completion159\REPORT_COMPLETION159_JA.md',
                     'Work159\ProductionNotes\ATTACK_PENDING_CURRENT_JA.md', 'Work159\REPORT_CURRENT_DIRECTION_AND_STAGESELECT_JA.md') {
        $p = Join-Path $WorkRoot $rel
        "=== $rel"
        if (Test-Path -LiteralPath $p) { Get-Content -LiteralPath $p -Encoding UTF8 } else { '(not found)' }
        ''
    }

    '##### B. automation test declarations in candidate 159 source'
    Get-ChildItem -LiteralPath (Join-Path $cand 'Source') -Recurse -File -Filter '*.cpp' -ErrorAction SilentlyContinue |
        Select-String -Pattern 'IMPLEMENT_[A-Z_]*AUTOMATION_TEST|BEGIN_DEFINE_SPEC|DEFINE_SPEC\(' |
        ForEach-Object { '{0}:{1}: {2}' -f $_.Filename, $_.LineNumber, $_.Line.Trim() }
    ''

    '##### C. source differences: main 154 vs candidate 159'
    function Get-HashMap([string]$root) {
        $m = @{}
        if (Test-Path -LiteralPath $root) {
            Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
                $m[$_.FullName.Substring($root.Length).TrimStart('\')] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            }
        }
        $m
    }
    $a = Get-HashMap (Join-Path $MainProject 'Source')
    $b = Get-HashMap (Join-Path $cand 'Source')
    "main files=$($a.Count) candidate files=$($b.Count)"
    foreach ($k in ($b.Keys | Sort-Object)) {
        if (-not $a.ContainsKey($k)) { "ADDED     $k" } elseif ($a[$k] -ne $b[$k]) { "MODIFIED  $k" }
    }
    foreach ($k in ($a.Keys | Sort-Object)) { if (-not $b.ContainsKey($k)) { "REMOVED   $k" } }
    ''

    '##### D. how earlier test / film runs were launched (lines from scripts in Work155-159)'
    $ext = '.ps1', '.cmd', '.bat', '.cjs', '.mjs', '.js', '.py'
    foreach ($n in 155..159) {
        $w = Join-Path $WorkRoot "Work$n"
        if (-not (Test-Path -LiteralPath $w)) { continue }
        Get-ChildItem -LiteralPath $w -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $ext -contains $_.Extension -and $_.Length -lt 2MB -and $_.FullName -notmatch '\\(Content|Binaries|Intermediate|Saved|node_modules)\\' } |
            Select-String -Pattern 'Automation RunTests|RunTests|UnrealEditor-Cmd|UnrealEditor\.exe|-ExecCmds|-game\b|InnuUnreal-Win64' |
            Select-Object -First 80 |
            ForEach-Object { '{0}:{1}: {2}' -f $_.Path.Replace($WorkRoot, ''), $_.LineNumber, $_.Line.Trim() }
    }
} *>&1 | Out-File -FilePath $o -Encoding utf8
Write-Host "Saved: $o"
notepad $o
