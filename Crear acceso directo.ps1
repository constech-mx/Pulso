$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Pulso.lnk"
$launcher = Join-Path $root "Iniciar Pulso.vbs"
$icon = Join-Path $root "assets\icon.ico"

if (-not (Test-Path $launcher)) {
    throw "No se encontro el lanzador: $launcher"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Pulso - panel de proyectos y pendientes"
if (Test-Path $icon) {
    $shortcut.IconLocation = $icon
}
$shortcut.Save()

Write-Host ""
Write-Host "Acceso directo creado en el escritorio:" -ForegroundColor Green
Write-Host "  $shortcutPath"
Write-Host ""
Write-Host "Doble clic en 'Pulso' para abrir el panel y el widget."
