<#
.SYNOPSIS
  Removes the ESS Robber Intel Windows service and its app folder.

.DESCRIPTION
  Keeps the database and logs in ProgramData unless -RemoveData is set. Run elevated.
#>
[CmdletBinding()]
param(
  [string]$ServiceName = "EssRobberIntel",
  [switch]$RemoveData
)

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$AppDir = Join-Path $env:ProgramFiles "ess-robber-intel"
$StateDir = Join-Path $env:ProgramData "ess-robber-intel"

if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
  Stop-Service $ServiceName -ErrorAction SilentlyContinue
  $nssm = Join-Path $AppDir "bin\nssm.exe"
  # A half-finished install may lack NSSM; sc.exe removes the service either way.
  if (Test-Path $nssm) { & $nssm remove $ServiceName confirm } else { & sc.exe delete $ServiceName }
  if ($LASTEXITCODE -ne 0) { throw "Removing $ServiceName exited with $LASTEXITCODE" }
}
if (Test-Path $AppDir) { Remove-Item -Recurse -Force $AppDir }
if ($RemoveData -and (Test-Path $StateDir)) { Remove-Item -Recurse -Force $StateDir }
Write-Host "Removed $ServiceName.$(if (-not $RemoveData) { " Data kept in $StateDir." })"
