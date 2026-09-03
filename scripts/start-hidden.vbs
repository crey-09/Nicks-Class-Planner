' Starts Nick Manager without a console window. Used by the login task.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
If Not fso.FolderExists(root & "\data") Then fso.CreateFolder(root & "\data")
sh.CurrentDirectory = root
sh.Run "cmd /c set NICK_PORT=3000 && node server\dist\server\src\index.js >> data\server.log 2>&1", 0, False
