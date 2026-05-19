Set shell = CreateObject("WScript.Shell")
appPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run Chr(34) & appPath & "\start_knp_signature_windows.bat" & Chr(34) & " bridge-only", 0, False
