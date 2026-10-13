#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Status', 'Remove')]
    [string]$Mode = 'Status'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$TaskName = 'FM WORKS - GAS Publisher'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Bridge = Join-Path $PSScriptRoot 'gas_local_bridge.mjs'
$Runner = Join-Path $PSScriptRoot 'Run-GasLocalBridgeWindows.ps1'
$OutputDir = Join-Path $Root 'artifacts\gas-local-bridge'
$LocalConfig = Join-Path $OutputDir 'windows-runner.json'

function Read-Task {
    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

if ($Mode -eq 'Status') {
    $task = Read-Task
    if ($null -eq $task) {
        Write-Output 'FM WORKS GAS publisher: not installed.'
        exit 0
    }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Output "Task: $TaskName"
    Write-Output "State: $($task.State)"
    Write-Output "Last run: $($info.LastRunTime)"
    Write-Output "Last task result: $($info.LastTaskResult)"
    Write-Output "Next run: $($info.NextRunTime)"
    Write-Output "Local state: $OutputDir"
    exit 0
}

if ($Mode -eq 'Remove') {
    $task = Read-Task
    if ($null -ne $task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
        Write-Output 'FM WORKS GAS publisher task unregistered.'
    } else {
        Write-Output 'Publisher task was not installed.'
    }
    Write-Output 'Google authorization, local configuration and publishing history remain untouched.'
    exit 0
}

if ($null -ne (Read-Task)) {
    throw "Task already exists: $TaskName. Use --status-windows and inspect it before any replacement."
}

if (-not (Test-Path (Join-Path $Root '.clasp.json'))) {
    throw 'Missing .clasp.json. Run node scripts/setup_gas_local_bridge.mjs --connect first.'
}
if (-not (Test-Path $Bridge) -or -not (Test-Path $Runner)) {
    throw 'Bridge or Windows runner missing from this Git checkout.'
}

$node = Get-Command 'node.exe' -ErrorAction Stop
$git = Get-Command 'git.exe' -ErrorAction Stop
$clasp = Get-Command 'clasp.cmd' -ErrorAction Stop
$nodeVersionRaw = & $node.Source --version
$nodeMajor = [int]([regex]::Match($nodeVersionRaw, '^v([0-9]+)').Groups[1].Value)
if ($nodeMajor -lt 20) {
    throw 'Node.js 20 or newer is required.'
}
Write-Output "Node: $($node.Source) $nodeVersionRaw"
Write-Output "Git: $($git.Source)"
Write-Output "clasp: $($clasp.Source)"

# Validate the exact deployment, v192 baseline and Google authorization BEFORE scheduling writes.
Write-Output 'Running read-only GAS deployment preflight...'
& $node.Source $Bridge '--preflight'
if ($LASTEXITCODE -ne 0) {
    throw 'GAS preflight failed. No scheduled task was registered. Check Script ID, Google login, source baseline and published version.'
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$config = @{
    nodePath = [string]$node.Source
    claspDir = [string](Split-Path -Parent $clasp.Source)
    installedAt = (Get-Date).ToString('o')
}
$config | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $LocalConfig -Encoding UTF8

$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $psExe)) {
    throw 'Windows PowerShell executable not found.'
}
$action = New-ScheduledTaskAction -Execute $psExe -Argument ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Runner + '"') -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'FM WORKS: owner-PC GAS release publisher (no GitHub Actions)' -ErrorAction Stop | Out-Null
Write-Output 'Installed FM WORKS publisher: every 5 minutes while this Windows account is signed in and the PC is awake.'
Write-Output 'The first release will be processed on the next scheduled run; check local state and the actual GAS UI.'
Write-Output 'Remove task: node scripts/setup_gas_local_bridge.mjs --remove-windows'
