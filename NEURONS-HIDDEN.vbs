' Starts the neuron service with no console window (used at Windows startup).
' Safe to run twice: the service refuses to start a second copy.
Set sh = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run "cmd /c (if not exist dashboard\logs mkdir dashboard\logs) & node neuro\keepalive.mjs >> dashboard\logs\neurons.log 2>&1", 0, False
