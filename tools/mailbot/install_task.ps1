# Registers the Windows Task Scheduler task "linebot-finance mailbot".
# Trigger: at logon of the current user, delayed 10 minutes. Runs only when logged on.
# Usage: powershell -ExecutionPolicy Bypass -File tools\mailbot\install_task.ps1
$ErrorActionPreference = 'Stop'

$taskName = 'linebot-finance mailbot'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runPy    = Join-Path $repoRoot 'tools\mailbot\run.py'
$workDir  = Join-Path $repoRoot 'local\mailbot'

if (-not (Test-Path $runPy)) { throw "run.py not found: $runPy" }
if (-not (Test-Path $workDir)) { New-Item -ItemType Directory -Path $workDir | Out-Null }

$python = (Get-Command python.exe -ErrorAction Stop).Source
$user   = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action  = New-ScheduledTaskAction -Execute $python -Argument ('"{0}"' -f $runPy) -WorkingDirectory $workDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$trigger.Delay = 'PT10M'
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'Gmail statement import (linebot-finance mailbot)' -Force | Out-Null

Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State, Description
Write-Host "Python      : $python"
Write-Host "Script      : $runPy"
Write-Host "WorkingDir  : $workDir"
Write-Host ""
Write-Host "Run now     : Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Remove      : Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
Write-Host "             (or run tools\mailbot\uninstall_task.ps1)"
