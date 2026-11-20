# Windows service

Runs the server as the Windows service `EssRobberIntel`, so it starts with Windows and keeps polling ESI when no one is logged in.

## Install or update

From a clean checkout of `main`, in a normal (non-elevated) PowerShell:

```powershell
git pull
powershell -ExecutionPolicy Bypass -File ops\windows-service\install.ps1
```

The script runs `npm ci` and `npm run build` as you, installs [NSSM](https://nssm.cc) with winget if it is missing, then asks for elevation (UAC) to deploy. Rerun it after each pull to redeploy; data is kept.

| What | Where |
|---|---|
| App (read-only to the service) | `C:\Program Files\ess-robber-intel` |
| Database | `C:\ProgramData\ess-robber-intel\data\ess-robber-intel.sqlite` |
| Server log (rotated at service start once over 10 MB) | `C:\ProgramData\ess-robber-intel\logs\server.log` |
| Last install log | `C:\ProgramData\ess-robber-intel\logs\install.log` |

- The UI is at http://127.0.0.1:3917. Change it with `-Port` and `-BindHost`. Binding beyond localhost exposes the UI to your network, since it has no login.
- The service runs as its own virtual account, `NT SERVICE\EssRobberIntel`, which can write only to the ProgramData folder.
- It starts automatically (delayed) and NSSM restarts it 10 s after a crash.
- Stopping sends Ctrl+C, so the server finishes a sync in progress (up to 10 s) before it exits.
- On the first install, `data\ess-robber-intel.sqlite` from the checkout is copied across. Stop any server running from the checkout first, or the copy may miss its last writes.

## Manage

```powershell
Get-Service EssRobberIntel
Restart-Service EssRobberIntel          # elevated
Get-Content C:\ProgramData\ess-robber-intel\logs\server.log -Tail 50 -Wait
```

## Uninstall

In an elevated PowerShell:

```powershell
ops\windows-service\uninstall.ps1              # keeps the database and logs
ops\windows-service\uninstall.ps1 -RemoveData  # deletes them too
```
