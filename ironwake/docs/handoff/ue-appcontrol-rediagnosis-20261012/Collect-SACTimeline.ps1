# Read-only follow-up: when did Smart App Control start enforcing, and is the CodeIntegrity log still holding the 2026-10-11 block?
# Changes nothing. Writes one text file to %TEMP% and opens it in Notepad.
$o = Join-Path $env:TEMP 'sac_timeline.txt'
& {
    $log = 'Microsoft-Windows-CodeIntegrity/Operational'
    '=== log info'
    Get-WinEvent -ListLog $log | Format-List LogName, RecordCount, MaximumSizeInBytes, LogMode, IsEnabled
    $oldest = Get-WinEvent -LogName $log -Oldest -MaxEvents 1
    'OLDEST EVENT (UTC): ' + $oldest.TimeCreated.ToUniversalTime().ToString('u')
    $all = @(Get-WinEvent -LogName $log)
    '=== event counts by id'
    $all | Group-Object Id | Sort-Object Count -Descending | Format-Table Count, Name -AutoSize
    '=== events mentioning MarketplaceRules / BuildRules / InnuUnrealModuleRules (full XML search)'
    $all | Where-Object { $_.ToXml() -match 'MarketplaceRules|BuildRules|InnuUnrealModuleRules' } | Sort-Object TimeCreated |
        ForEach-Object { '{0:u} id={1} {2}' -f $_.TimeCreated.ToUniversalTime(), $_.Id, (($_.Message -split "`r?`n")[0]) }
    '=== policy activation / Smart App Control related events (last 80)'
    $all | Where-Object { $_.Id -in 3099, 3100, 3101, 3102, 3103 -or $_.ToXml() -match 'VerifiedAndReputable|SmartAppControl|Smart App Control' } |
        Sort-Object TimeCreated | Select-Object -Last 80 |
        ForEach-Object { '{0:u} id={1} {2}' -f $_.TimeCreated.ToUniversalTime(), $_.Id, ((($_.Message -split "`r?`n") | Select-Object -First 3) -join ' / ') }
    '=== first and last enforced block (3077) and audit (3076) of any file'
    foreach ($id in 3076, 3077) {
        $e = $all | Where-Object Id -eq $id | Sort-Object TimeCreated
        if ($e) { "id=$id count=$($e.Count) first=$($e[0].TimeCreated.ToUniversalTime().ToString('u')) last=$($e[-1].TimeCreated.ToUniversalTime().ToString('u'))" } else { "id=$id none" }
    }
    '=== CI policy registry'
    Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' | Format-List *
    '=== Defender / antivirus'
    Get-MpComputerStatus | Format-List AMRunningMode, AMProductVersion, RealTimeProtectionEnabled, SmartAppControlState, SmartAppControlExpiration
    Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Format-Table displayName, productState -AutoSize
} *>&1 | Out-File -FilePath $o -Encoding utf8
notepad $o
