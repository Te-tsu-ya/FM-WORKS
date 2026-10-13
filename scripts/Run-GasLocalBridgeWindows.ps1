#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$OutputDir = Join-Path $Root 'artifacts\gas-local-bridge'
$LocalConfig = Join-Path $OutputDir 'windows-runner.json'
$Bridge = Join-Path $PSScriptRoot 'gas_local_bridge.mjs'
$LogFile = Join-Path $OutputDir 'windows-task.log'

if (-not (Test-Path $LocalConfig)) { throw 'Windows GAS publisher was not installed.' }
$config = Get-Content -LiteralPath $LocalConfig -Raw | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $config.nodePath)) { throw 'The configured Node.js executable no longer exists.' }
if (-not (Test-Path -LiteralPath (Join-Path $config.claspDir 'clasp.cmd'))) { throw 'The configured clasp.cmd no longer exists.' }
$env:PATH = $config.claspDir + ';' + (Split-Path -Parent $config.nodePath) + ';' + $env:PATH

# GitHub/GAS credentials are never copied into the task arguments or the repository.
try {
    & $config.nodePath $Bridge '--once' *>> $LogFile
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 1 }
    exit $code
} catch {
    # Keep this generic: no environment variables, login credentials or token-bearing command lines.
    '[GAS publisher task failed; inspect source and local bridge state]' | Out-File -LiteralPath $LogFile -Append -Encoding UTF8
    exit 1
}
