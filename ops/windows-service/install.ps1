<#
.SYNOPSIS
  Installs or updates the ESS Robber Intel server as a Windows service.

.DESCRIPTION
  Builds the current checkout (which must be main and clean unless -AllowAnyBranch is set),
  then elevates to deploy it. The app goes to Program Files and the database and logs to
  ProgramData. NSSM runs the app as the service's own virtual account,
  NT SERVICE\<ServiceName>, which can write only to the data and log folders.

  Run the script again after pulling main to redeploy. Data is kept.
  On the first install, an existing data\ess-robber-intel.sqlite in the checkout is copied
  across, so history is kept. Stop any server running from the checkout first.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File ops\windows-service\install.ps1
#>
[CmdletBinding()]
param(
  [string]$ServiceName = "EssRobberIntel",
  [int]$Port = 3917,
  [string]$BindHost = "127.0.0.1",
  [switch]$AllowAnyBranch,
  # Internal: set when the script relaunches itself elevated after building.
  [switch]$Deploy,
  [string]$NssmPath
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$AppDir = Join-Path $env:ProgramFiles "ess-robber-intel"
$StateDir = Join-Path $env:ProgramData "ess-robber-intel"
$DataDir = Join-Path $StateDir "data"
$LogDir = Join-Path $StateDir "logs"
$InstallLog = Join-Path $LogDir "install.log"
$DbName = "ess-robber-intel.sqlite"

function Invoke-Native([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') exited with $LASTEXITCODE" }
}

function Test-Admin {
  $id = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $id.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-NssmPath {
  # A shell opened before winget installed NSSM lacks its PATH entry, so also look where winget puts it.
  $cmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $packages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  $found = Get-ChildItem $packages -Filter nssm.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -eq "win64" } | Select-Object -First 1
  if ($found) { return $found.FullName }
  return $null
}

function Find-Nssm {
  $path = Get-NssmPath
  if ($path) { return $path }
  Write-Host "Installing NSSM with winget..."
  & winget install --id NSSM.NSSM -e --accept-source-agreements --accept-package-agreements --disable-interactivity
  $path = Get-NssmPath
  if (-not $path) { throw "winget did not install NSSM (exit code $LASTEXITCODE)." }
  return $path
}

# Phase 1, as the current user: check the checkout, build it, find NSSM, then elevate.
# Building here keeps node_modules and dist owned by the user, not by Administrators.
if (-not $Deploy) {
  Push-Location $RepoRoot
  try {
    if (-not $AllowAnyBranch) {
      $branch = (git rev-parse --abbrev-ref HEAD).Trim()
      if ($branch -ne "main") { throw "Checkout is on '$branch', not main. Pass -AllowAnyBranch to deploy it anyway." }
      if (git status --porcelain) { throw "Checkout has uncommitted changes. Commit or stash them, or pass -AllowAnyBranch." }
    }
    Invoke-Native npm @("ci")
    Invoke-Native npm @("run", "build")
  } finally {
    Pop-Location
  }
  # Resolve NSSM as the user: winget run elevated would install it into the admin's profile.
  $nssm = Find-Nssm
  $deployArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Deploy",
    "-ServiceName", $ServiceName, "-Port", $Port, "-BindHost", $BindHost, "-NssmPath", "`"$nssm`"")
  Write-Host "Elevating to install the service (accept the UAC prompt)..."
  $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList $deployArgs
  if ($p.ExitCode -ne 0) {
    if (Test-Path $InstallLog) { Get-Content $InstallLog -Tail 30 }
    throw "Elevated deploy failed with exit code $($p.ExitCode). Full log: $InstallLog"
  }
  Write-Host "Deployed commit $(git -C $RepoRoot rev-parse --short HEAD)."
  exit 0
}

# Phase 2, elevated: deploy and (re)configure the service.
if (-not (Test-Admin)) { throw "-Deploy must run elevated." }
New-Item -ItemType Directory -Force $AppDir, $DataDir, $LogDir | Out-Null
Start-Transcript -Path $InstallLog -Force | Out-Null
try {
  $node = (Get-Command node).Source
  # A per-user Node (nvm-windows, fnm, Volta) would let the user swap the service's binary.
  if (-not $node.StartsWith($env:ProgramFiles, [StringComparison]::OrdinalIgnoreCase)) {
    throw "node.exe at $node is not under $env:ProgramFiles. Install Node system-wide for the service."
  }
  $svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne "Stopped") {
    Write-Host "Stopping $ServiceName..."
    Stop-Service $ServiceName
  }

  # Deploy the build plus production dependencies. robocopy exit codes below 8 mean success.
  robocopy (Join-Path $RepoRoot "dist") (Join-Path $AppDir "dist") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy of dist failed with $LASTEXITCODE" }
  Copy-Item (Join-Path $RepoRoot "package.json"), (Join-Path $RepoRoot "package-lock.json") $AppDir -Force
  Push-Location $AppDir
  try { Invoke-Native npm @("ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund") } finally { Pop-Location }

  # A private copy of NSSM, so a winget upgrade or uninstall cannot break the service.
  $bin = Join-Path $AppDir "bin"
  New-Item -ItemType Directory -Force $bin | Out-Null
  $nssm = Join-Path $bin "nssm.exe"
  if (-not $svc -or -not (Test-Path $nssm)) { Copy-Item $NssmPath $nssm -Force }

  # First install: carry the checkout's history across, WAL files included.
  $db = Join-Path $DataDir $DbName
  $repoDb = Join-Path $RepoRoot "data\$DbName"
  if (-not (Test-Path $db) -and (Test-Path $repoDb)) {
    Write-Host "Copying existing database from $repoDb"
    foreach ($suffix in "", "-wal", "-shm") {
      if (Test-Path "$repoDb$suffix") { Copy-Item "$repoDb$suffix" "$db$suffix" }
    }
  }

  if (-not $svc) { Invoke-Native $nssm @("install", $ServiceName, $node) }
  $settings = @(
    @("Application", $node),
    @("AppParameters", "dist\server\main.js"),
    @("AppDirectory", $AppDir),
    @("DisplayName", "ESS Robber Intel"),
    @("Description", "ESS Robber Intel: hourly ESI poller and web UI on http://${BindHost}:$Port"),
    @("Start", "SERVICE_DELAYED_AUTO_START"),
    @("AppStdout", (Join-Path $LogDir "server.log")),
    @("AppStderr", (Join-Path $LogDir "server.log")),
    @("AppRotateFiles", "1"),
    # Rotate only at start: with online rotation NSSM hung in StopPending after the app exited.
    # The server logs about two lines an hour, so start-time rotation is plenty.
    @("AppRotateOnline", "0"),
    @("AppRotateBytes", "10485760"),
    # Ctrl+C reaches main.ts as SIGINT; allow longer than its 10 s shutdown grace.
    @("AppStopMethodConsole", "15000"),
    @("AppExit", "Default", "Restart"),
    @("AppRestartDelay", "10000")
  )
  foreach ($s in $settings) { Invoke-Native $nssm (@("set", $ServiceName) + $s) | Out-Null }
  Invoke-Native $nssm @("set", $ServiceName, "AppEnvironmentExtra",
    "PORT=$Port", "HOST=$BindHost", "DB_PATH=$db", "NODE_ENV=production") | Out-Null

  # Run as the service's virtual account. sc.exe, not NSSM, because it needs no password.
  $account = "NT SERVICE\$ServiceName"
  Invoke-Native sc.exe @("config", $ServiceName, "obj=", $account) | Out-Null
  # The account may write only its state; the app folder stays read-only to it.
  Invoke-Native icacls @($StateDir, "/grant", "${account}:(OI)(CI)M", "/T", "/Q") | Out-Null
  Invoke-Native icacls @($AppDir, "/grant", "${account}:(OI)(CI)RX", "/Q") | Out-Null

  Start-Service $ServiceName
  $probeHost = if ($BindHost -in "0.0.0.0", "::") { "127.0.0.1" } else { $BindHost }
  $healthUrl = "http://${probeHost}:$Port/api/health"
  $deadline = (Get-Date).AddSeconds(30)
  while ($true) {
    try {
      $null = Invoke-RestMethod $healthUrl -TimeoutSec 3
      break
    } catch {
      if ((Get-Date) -gt $deadline) { throw "Service started but $healthUrl did not answer within 30 s. See $LogDir\server.log" }
      Start-Sleep -Seconds 1
    }
  }
  Write-Host "Deployed. $ServiceName is running on http://${BindHost}:$Port"
} finally {
  Stop-Transcript | Out-Null
}
