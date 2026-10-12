<#
  UE ビルド障害（AppControl 0x800711C7）再診断用：読み取り専用の証拠収集スクリプト

  ・何も変更しません（プロセス終了・ファイル削除・設定変更・ビルド実行は一切しません）。
  ・唯一の書き込みは、結果を保存するテキストファイル1つ（既定は %TEMP%）です。
  ・外部への送信はしません。
  ・CodeIntegrity ログの読み取りには「管理者として実行」が必要な場合があります。

  実行例（PowerShell）:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\Collect-UEBuildBlockEvidence.ps1
  ※ -ExecutionPolicy Bypass はこの1回の実行にだけ効き、PC の設定は変えません。
#>
[CmdletBinding()]
param(
    [string]$ProjectRoot  = 'C:\UnrealProjects\ForwardClaude',
    [string]$WorkRoot     = 'C:\Users\takes\Documents\Codex\2026-10-03\task',
    [string]$IronWakeRepo = 'C:\Users\takes\Documents\Codex\2026-10-03\task-3\ironwake-repo',
    [string]$EngineRoot   = '',
    [int]$EventDays       = 60,
    [string]$OutFile      = (Join-Path $env:TEMP ("ue_appcontrol_diag_{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss')))
)

$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]
function Out-Line([string]$s = '') { $lines.Add($s); Write-Host $s }
function Section([string]$t) { Out-Line ''; Out-Line ('=' * 78); Out-Line "## $t"; Out-Line ('=' * 78) }

function Describe-File([string]$path) {
    try {
        $f = Get-Item -LiteralPath $path -ErrorAction Stop
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256 -ErrorAction Stop).Hash
        $sig = Get-AuthenticodeSignature -LiteralPath $path -ErrorAction SilentlyContinue
        $sigText = if ($sig) { "$($sig.Status)" + $(if ($sig.SignerCertificate) { " / $($sig.SignerCertificate.Subject)" } else { '' }) } else { 'n/a' }
        $motw = $null
        try { $motw = Get-Content -LiteralPath $path -Stream Zone.Identifier -ErrorAction Stop } catch { }
        Out-Line ("  {0}" -f $f.FullName)
        Out-Line ("    size={0}  created={1:u}  modified={2:u}" -f $f.Length, $f.CreationTimeUtc, $f.LastWriteTimeUtc)
        Out-Line ("    sha256={0}" -f $hash)
        Out-Line ("    authenticode={0}  MotW={1}" -f $sigText, $(if ($motw) { ($motw -join ' | ') } else { 'none' }))
    } catch {
        Out-Line "  $path : $($_.Exception.Message)"
    }
}

Out-Line "UE AppControl rediagnosis evidence  (generated $(Get-Date -Format u), host $env:COMPUTERNAME)"
Out-Line "Read-only. Output file: $OutFile"

# ---------------------------------------------------------------------------
Section '1. OS build and Smart App Control state'
try {
    $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    Out-Line ("  Windows: {0} {1} build {2}.{3}" -f $cv.ProductName, $cv.DisplayVersion, $cv.CurrentBuild, $cv.UBR)
} catch { Out-Line "  OS version: $($_.Exception.Message)" }
try {
    $p = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -ErrorAction Stop
    $v = $p.VerifiedAndReputablePolicyState
    $meaning = switch ($v) { 0 {'Off'} 1 {'On (enforce)'} 2 {'Evaluation'} default {'unknown/not present'} }
    Out-Line "  VerifiedAndReputablePolicyState = $v  ($meaning)"
} catch { Out-Line "  SAC registry: $($_.Exception.Message)" }
try {
    $mp = Get-MpComputerStatus -ErrorAction Stop
    Out-Line ("  Defender: AMServiceEnabled={0} RealTime={1} SmartAppControlState={2}" -f $mp.AMServiceEnabled, $mp.RealTimeProtectionEnabled, $mp.SmartAppControlState)
} catch { Out-Line "  Get-MpComputerStatus: $($_.Exception.Message)" }

# ---------------------------------------------------------------------------
Section "2. CodeIntegrity events mentioning BuildRules / UnrealBuildTool (last $EventDays days)"
Out-Line '  3076 = audit only (would have been blocked; typical of Evaluation mode)'
Out-Line '  3077 = enforced block. 3033/3034 = signature-level related. Oldest first.'
try {
    $ev = Get-WinEvent -FilterHashtable @{
        LogName   = 'Microsoft-Windows-CodeIntegrity/Operational'
        Id        = 3033, 3034, 3076, 3077, 3089
        StartTime = (Get-Date).AddDays(-$EventDays)
    } -ErrorAction Stop | Where-Object { $_.Message -match 'BuildRules|UnrealBuildTool|Rules\.dll|UnrealEngine' } | Sort-Object TimeCreated
    if (-not $ev) { Out-Line '  (no matching events)' }
    $ev | ForEach-Object {
        $first = ($_.Message -split "`r?`n" | Select-Object -First 1)
        Out-Line ("  {0:u}  id={1}  {2}" -f $_.TimeCreated.ToUniversalTime(), $_.Id, $first)
    }
    Out-Line ''
    Out-Line '  Distinct blocked/audited file names:'
    $ev | ForEach-Object { if ($_.Message -match '([A-Za-z]:\\[^"]+?\.dll)') { $Matches[1] } } |
        Group-Object | ForEach-Object { Out-Line ("    {0}  x{1}" -f $_.Name, $_.Count) }
} catch { Out-Line "  Get-WinEvent: $($_.Exception.Message)  (try 'Run as administrator')" }

# ---------------------------------------------------------------------------
Section '3. Rules assemblies on disk (hash, signature, timestamps)'
$ruleDirs = @(
    (Join-Path $env:LOCALAPPDATA 'UnrealEngine\Intermediate\Build\BuildRules'),
    (Join-Path $ProjectRoot 'Project\Intermediate\Build\BuildRules')
)
foreach ($d in $ruleDirs) {
    Out-Line "  [$d]"
    if (Test-Path -LiteralPath $d) {
        Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc | ForEach-Object {
            if ($_.Extension -in '.dll', '.json', '.pdb') {
                if ($_.Extension -eq '.dll') { Describe-File $_.FullName }
                else { Out-Line ("  {0}  size={1} modified={2:u}" -f $_.FullName, $_.Length, $_.LastWriteTimeUtc) }
            }
        }
    } else { Out-Line '    (not found)' }
}
Out-Line ''
Out-Line '  Other *ModuleRules*.dll / *Rules.dll under Work155-159 (candidate copies):'
foreach ($n in 155..159) {
    $w = Join-Path $WorkRoot "Work$n"
    if (Test-Path -LiteralPath $w) {
        Get-ChildItem -LiteralPath $w -Recurse -File -Include '*Rules.dll' -ErrorAction SilentlyContinue | ForEach-Object { Describe-File $_.FullName }
    }
}

# ---------------------------------------------------------------------------
Section '4. UBT makefiles (existence decides whether rules DLLs must be loaded)'
$mkRoots = @((Join-Path $ProjectRoot 'Project\Intermediate\Build'))
foreach ($n in 155..159) { $w = Join-Path $WorkRoot "Work$n"; if (Test-Path -LiteralPath $w) { $mkRoots += $w } }
foreach ($r in $mkRoots) {
    if (Test-Path -LiteralPath $r) {
        Get-ChildItem -LiteralPath $r -Recurse -File -Filter 'Makefile.bin' -ErrorAction SilentlyContinue | ForEach-Object {
            Out-Line ("  {0}  size={1} modified={2:u}" -f $_.FullName, $_.Length, $_.LastWriteTimeUtc)
        }
    }
}

# ---------------------------------------------------------------------------
Section '5. Key lines from build logs (Work155-159)'
$pat = 'Creating makefile|no existing makefile|Makefile|BuildRules|MarketplaceRules|0x800711C7|Application Control|IOException|being used by another process|Result: |Total execution time|UnrealBuildTool\.dll|Running UnrealBuildTool|Using .*Engine'
foreach ($n in 155..159) {
    $w = Join-Path $WorkRoot "Work$n"
    if (-not (Test-Path -LiteralPath $w)) { continue }
    Get-ChildItem -LiteralPath $w -Recurse -File -Include '*.log' -ErrorAction SilentlyContinue | ForEach-Object {
        $hits = Select-String -LiteralPath $_.FullName -Pattern $pat -ErrorAction SilentlyContinue | Select-Object -First 40
        if ($hits) {
            Out-Line "  --- $($_.FullName)  (modified $($_.LastWriteTimeUtc.ToString('u')))"
            $hits | ForEach-Object { Out-Line ("    L{0}: {1}" -f $_.LineNumber, $_.Line.Trim()) }
        }
    }
}

# ---------------------------------------------------------------------------
Section '6. Engine source: where MarketplaceRules is created and when makefiles are rebuilt'
if (-not $EngineRoot) {
    foreach ($k in 'HKLM:\SOFTWARE\EpicGames\Unreal Engine\5.7', 'HKLM:\SOFTWARE\WOW6432Node\EpicGames\Unreal Engine\5.7') {
        try { $EngineRoot = (Get-ItemProperty $k -ErrorAction Stop).InstalledDirectory; if ($EngineRoot) { break } } catch { }
    }
    if (-not $EngineRoot) { $EngineRoot = 'C:\Program Files\Epic Games\UE_5.7' }
}
Out-Line "  EngineRoot = $EngineRoot"
$bv = Join-Path $EngineRoot 'Engine\Build\Build.version'
if (Test-Path -LiteralPath $bv) { Out-Line ("  Build.version: " + ((Get-Content -LiteralPath $bv -Raw) -replace '\s+', ' ')) }
$ubtSrc = Join-Path $EngineRoot 'Engine\Source\Programs\UnrealBuildTool'
$srcPat = 'Marketplace|InstalledEngine|IsEngineInstalled|no existing makefile|bNeedsRulesAssembly|CreateTargetRulesAssembly|CreatePluginRulesAssembly|LoadFile|LoadFrom|Assembly\.Load'
foreach ($rel in 'System\RulesCompiler.cs', 'Modes\BuildMode.cs', 'System\DynamicCompilation.cs', 'Configuration\TargetMakefile.cs', 'System\RulesAssembly.cs') {
    $f = Join-Path $ubtSrc $rel
    Out-Line "  --- $rel"
    if (Test-Path -LiteralPath $f) {
        Select-String -LiteralPath $f -Pattern $srcPat -ErrorAction SilentlyContinue | Select-Object -First 60 |
            ForEach-Object { Out-Line ("    L{0}: {1}" -f $_.LineNumber, $_.Line.Trim()) }
    } else { Out-Line '    (not found in this install)' }
}
$mpDir = Join-Path $EngineRoot 'Engine\Plugins\Marketplace'
Out-Line "  Plugins in $mpDir :"
if (Test-Path -LiteralPath $mpDir) {
    Get-ChildItem -LiteralPath $mpDir -Recurse -File -Filter '*.uplugin' -ErrorAction SilentlyContinue | ForEach-Object { Out-Line "    $($_.FullName)" }
} else { Out-Line '    (not found)' }

# ---------------------------------------------------------------------------
Section '7. Processes (listed only; nothing is stopped)'
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'Unreal|InnuUnreal|dotnet|UnrealBuildTool|ShaderCompileWorker|LiveCoding|Codex|node' } |
    ForEach-Object { Out-Line ("  pid={0}  {1}  started={2}  {3}" -f $_.ProcessId, $_.Name, $_.CreationDate, ($_.CommandLine -replace '\s+', ' ')) }

# ---------------------------------------------------------------------------
Section '8. Git state (read-only)'
foreach ($repo in $ProjectRoot, $IronWakeRepo) {
    Out-Line "  --- $repo"
    if (Test-Path -LiteralPath (Join-Path $repo '.git')) {
        & git -C $repo rev-parse --abbrev-ref HEAD 2>&1 | ForEach-Object { Out-Line "    branch: $_" }
        & git -C $repo log --oneline -5 2>&1 | ForEach-Object { Out-Line "    $_" }
        & git -C $repo status --short 2>&1 | Select-Object -First 60 | ForEach-Object { Out-Line "    $_" }
    } else { Out-Line '    (not a git repo or not found)' }
}

$lines | Set-Content -LiteralPath $OutFile -Encoding UTF8
Write-Host ''
Write-Host "Saved: $OutFile"
