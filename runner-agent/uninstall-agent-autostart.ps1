# uninstall-agent-autostart.ps1 — removes the TestFlow autostart task and stops
# the running agent. Run with:
#   powershell -ExecutionPolicy Bypass -File .\uninstall-agent-autostart.ps1
$ErrorActionPreference = 'SilentlyContinue'
$taskName = 'TestFlowAgent'

Stop-ScheduledTask -TaskName $taskName
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false

# Also stop the currently-running hidden agent, if any.
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'agent\.js' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}

Write-Host "Removed the '$taskName' autostart task and stopped the agent." -ForegroundColor Green
