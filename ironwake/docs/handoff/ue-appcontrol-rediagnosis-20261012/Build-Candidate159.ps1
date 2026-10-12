# Build candidate 159 (InnuUnrealEditor Win64 Development) with the official UE 5.7 Build.bat, after safety checks.
#
# - Aborts (changes nothing) if Smart App Control is not Off, if the game / editor / UBT is running,
#   if the candidate project is missing, or if free disk space is low. It never stops any process.
# - Writes only: Candidate159\Project\{Binaries,Intermediate} (normal UBT output), the shared UBT cache under
#   %LOCALAPPDATA%\UnrealEngine (normal), and a log + summary under Candidate159\Build159\<timestamp>\.
# - Records hashes of the current playable 154 binaries before and after, to prove they were not touched.
[CmdletBinding()]
param(
    [string]$Candidate   = 'C:\Users\takes\Documents\Codex\2026-10-03\task\Work159\Candidate159',
    [string]$MainProject = 'C:\UnrealProjects\ForwardClaude\Project',
    [string]$EngineRoot  = 'C:\Program Files\Epic Games\UE_5.7',
    [int]$MinFreeGB      = 15
)
$ErrorActionPreference = 'Continue'
$uproject = Join-Path $Candidate 'Project\InnuUnreal.uproject'
$bat      = Join-Path $EngineRoot 'Engine\Build\BatchFiles\Build.bat'
$stamp    = Get-Date -Format 'yyyyMMdd-HHmmss'
$outDir   = Join-Path $Candidate "Build159\$stamp"
$summary  = New-Object System.Collections.Generic.List[string]
function S([string]$t) { $summary.Add($t); Write-Host $t }
function Hash([string]$p) { if (Test-Path -LiteralPath $p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash } else { 'missing' } }
function Stop-Here([string]$why) {
    S "ABORTED (nothing built): $why"
    Write-Host ''
    Write-Host '===== copy everything from the line "BUILD159 SUMMARY" above into the chat ====='
    exit 1
}

S "BUILD159 SUMMARY  (local $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), UTC $((Get-Date).ToUniversalTime().ToString('u')))"

# ---- 1. preflight -----------------------------------------------------------------------------
$sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState
S "SAC VerifiedAndReputablePolicyState = $sac  (0 = Off)"
if ($sac -ne 0) { Stop-Here 'Smart App Control is not Off yet (a restart may be needed for the change to apply).' }

$busy = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '^(InnuUnreal|UnrealEditor|ShaderCompileWorker|LiveCodingConsole|UnrealBuildTool)' -or
    ($_.Name -match '^dotnet' -and $_.CommandLine -match 'UnrealBuildTool')
}
if ($busy) {
    $busy | ForEach-Object { S ("  running: pid={0} {1}" -f $_.ProcessId, $_.Name) }
    Stop-Here 'Game, editor or build tool is running. Please close it normally and run this again (it is not stopped automatically).'
}
S 'No game / editor / build tool running.'

if (-not (Test-Path -LiteralPath $uproject)) { Stop-Here "Candidate project not found: $uproject" }
if (-not (Test-Path -LiteralPath $bat)) { Stop-Here "Build.bat not found: $bat" }
$free = [math]::Round((Get-PSDrive -Name C).Free / 1GB, 1)
S "Free space on C: = $free GB"
if ($free -lt $MinFreeGB) { Stop-Here "Less than $MinFreeGB GB free." }

$mainDll  = Join-Path $MainProject 'Binaries\Win64\UnrealEditor-InnuUnreal.dll'
$mainExe  = Join-Path $MainProject 'Binaries\Win64\InnuUnreal-Win64-Shipping.exe'
$mktDll   = Join-Path $env:LOCALAPPDATA 'UnrealEngine\Intermediate\Build\BuildRules\MarketplaceRules.dll'
$before = @{ mainDll = Hash $mainDll; mainExe = Hash $mainExe; mkt = Hash $mktDll }
S "before: main154 editor dll = $($before.mainDll)"
S "before: main154 shipping exe = $($before.mainExe)"
S "before: MarketplaceRules.dll = $($before.mkt)"

# ---- 2. build ---------------------------------------------------------------------------------
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$log = Join-Path $outDir 'build-editor.log'
S "log: $log"
$start = Get-Date
$w = New-Object System.IO.StreamWriter($log, $false, (New-Object System.Text.UTF8Encoding($false)))
try {
    & $bat InnuUnrealEditor Win64 Development "-Project=$uproject" -WaitMutex -NoHotReload -MaxParallelActions=2 2>&1 |
        ForEach-Object { $line = "$_"; $w.WriteLine($line); $w.Flush(); Write-Host $line }
    $exit = $LASTEXITCODE
} finally { $w.Close() }
$mins = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
S ''
S "Build.bat exit code = $exit  ($mins min)"
Select-String -LiteralPath $log -Pattern 'Creating makefile|Invalidating makefile|0x800711C7|Application Control|IOException|error C\d+|error LNK\d+|Result: |Total execution time' |
    Select-Object -First 40 | ForEach-Object { S ("  L{0}: {1}" -f $_.LineNumber, $_.Line.Trim()) }

# ---- 3. after ---------------------------------------------------------------------------------
S ''
S 'New binaries in Candidate159 (written after build start):'
$bin = Join-Path $Candidate 'Project\Binaries\Win64'
if (Test-Path -LiteralPath $bin) {
    Get-ChildItem -LiteralPath $bin -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in '.dll', '.modules', '.target' -and $_.LastWriteTime -ge $start } |
        ForEach-Object { S ("  {0}  size={1}  modified={2:u}  sha256={3}" -f $_.Name, $_.Length, $_.LastWriteTimeUtc, (Hash $_.FullName)) }
} else { S '  (no Binaries\Win64 folder)' }

$after = @{ mainDll = Hash $mainDll; mainExe = Hash $mainExe; mkt = Hash $mktDll }
S ("main154 editor dll unchanged   = {0}" -f ($after.mainDll -eq $before.mainDll))
S ("main154 shipping exe unchanged = {0}" -f ($after.mainExe -eq $before.mainExe))
S ("MarketplaceRules.dll unchanged = {0}" -f ($after.mkt -eq $before.mkt))
try {
    $ci = Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-CodeIntegrity/Operational'; Id = 3076, 3077; StartTime = $start } -ErrorAction Stop
    S "CodeIntegrity 3076/3077 events during build: $($ci.Count)"
} catch { S 'CodeIntegrity 3076/3077 events during build: 0' }

$summary | Set-Content -LiteralPath (Join-Path $outDir 'SUMMARY.txt') -Encoding UTF8
Write-Host ''
Write-Host "Summary saved: $(Join-Path $outDir 'SUMMARY.txt')"
Write-Host '===== copy everything from the line "BUILD159 SUMMARY" above into the chat, or attach SUMMARY.txt ====='
