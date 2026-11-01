Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
electron = root & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(electron) Then
  MsgBox "Falta Electron en node_modules." & vbCrLf & vbCrLf & _
         "Abre una terminal en:" & vbCrLf & root & vbCrLf & vbCrLf & _
         "y ejecuta:  npm install", 16, "Pulso"
  WScript.Quit 1
End If

sh.CurrentDirectory = root
sh.Run """" & electron & """ """ & root & """", 0, False
