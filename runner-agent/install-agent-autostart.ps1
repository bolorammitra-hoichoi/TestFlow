# install-agent-autostart.ps1 - registers the TestFlow runner agent to start
# automatically and silently at every logon, via Windows Task Scheduler.
#
# Why Task Scheduler at logon (not a true Windows Service): a real service runs
# in the isolated "session 0", which cannot reliably see USB/ADB devices - those
# are bound to your interactive logon session. Running at logon, as you, in your
# own session, is what lets the agent see your connected phone exactly like you
# do. It survives reboots (starts at next logon), needs no admin, shows no
# window, and auto-restarts if it crashes.
#
# Run this once:  powershell -ExecutionPolicy Bypass -File .\install-agent-autostart.ps1
# Undo with:      .\uninstall-agent-autostart.ps1

$ErrorActionPreference = 'Stop'
$taskName = 'TestFlowAgent'
$runnerDir = $PSScriptRoot
$vbsPath = Join-Path $runnerDir 'launch-hidden.vbs'
$user = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path (Join-Path $runnerDir '.env'))) {
  Write-Warning "No .env found in $runnerDir - the agent cannot log in. Create it from .env.example first."
}

# Replace any agent already running in an ad-hoc terminal / prior session, so we
# don't end up with two agents sharing the same identity both claiming runs.
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'agent\.js' } | ForEach-Object {
  Write-Host "Stopping existing agent process (PID $($_.ProcessId))..."
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbsPath`"" -WorkingDirectory $runnerDir

# Two independent triggers:
#  1. AtLogon  - starts the agent promptly after login/reboot.
#  2. Once + repeat every 2 min (base time in the past so it arms immediately on
#     registration, independent of logon) - this is the real crash-recovery
#     mechanism. With MultipleInstances=IgnoreNew below, each 2-min tick is
#     skipped while the agent is alive, but relaunches it within 2 min if it died.
# This deliberately does NOT rely on Task Scheduler's RestartCount "restart on
# failure" (that only fires if the task fails to *start*, not when the launched
# process later crashes - verified, it does nothing for a dead agent), nor on a
# repetition attached to the logon trigger (that only arms once the logon trigger
# actually fires, so a manually/again-started instance wouldn't be covered).
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$logonTrigger.Delay = 'PT30S'   # let USB/ADB settle ~30s after logon before first start

$repeatTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(-1)) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)

$settingsArgs = @{
  AllowStartIfOnBatteries    = $true
  DontStopIfGoingOnBatteries = $true
  ExecutionTimeLimit         = (New-TimeSpan -Seconds 0)
  MultipleInstances          = 'IgnoreNew'
}
$settings = New-ScheduledTaskSettingsSet @settingsArgs

$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

$registerArgs = @{
  TaskName    = $taskName
  Action      = $action
  Trigger     = @($logonTrigger, $repeatTrigger)
  Settings    = $settings
  Principal   = $principal
  Force       = $true
  Description = 'Runs the TestFlow QA runner agent silently at logon (and re-checks every 2 min) so connected devices appear on the TestFlow website.'
}
Register-ScheduledTask @registerArgs | Out-Null

Write-Host "Registered scheduled task '$taskName'." -ForegroundColor Green

Start-ScheduledTask -TaskName $taskName
Write-Host "Started it now. The agent is running hidden; output goes to $runnerDir\agent.log" -ForegroundColor Green
Write-Host "Check it's connected on the TestFlow site's Run Test page within ~15s."
