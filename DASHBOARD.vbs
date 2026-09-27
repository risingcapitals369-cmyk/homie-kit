' Opens the Homie dashboard with no console window.
' If it's already running, this just opens the page.
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run "node dashboard\server.mjs", 0, False
