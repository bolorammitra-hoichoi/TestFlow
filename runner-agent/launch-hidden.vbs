' launch-hidden.vbs — starts the TestFlow runner agent with NO console window
' and appends all its output to agent.log next to this script. Used by the
' Task Scheduler autostart task (see install-agent-autostart.ps1) so the agent
' runs silently in the background at logon instead of in a terminal window.
'
' Deriving the script's own folder means this works regardless of where the
' TestFlow repo lives on disk.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir
logPath = scriptDir & "\agent.log"
' window style 0 = hidden; True = wait, so this launcher stays alive as long as
' the agent does. Propagating the exit code (WScript.Quit) is what lets Task
' Scheduler's restart-on-failure actually kick in when the agent crashes — a
' fire-and-forget launch would exit instantly and be seen as "succeeded",
' leaving a dead agent with nothing to revive it.
exitCode = shell.Run("cmd /c node agent.js >> """ & logPath & """ 2>&1", 0, True)
WScript.Quit exitCode
