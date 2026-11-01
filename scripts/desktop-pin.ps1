param(
    [Parameter(Mandatory = $true)][long]$Hwnd,
    [ValidateSet("pin", "unpin")][string]$Action = "pin"
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class PulsoDesktopPin
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowTitle);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    [DllImport("user32.dll")]
    public static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr child);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int index);

    [DllImport("user32.dll")]
    public static extern int SetWindowLong(IntPtr hWnd, int index, int value);

    public static IntPtr FindDesktopHost()
    {
        // En Windows 11 el escritorio visible suele ser Progman. El widget se
        // convierte en su hijo superior: queda sobre el fondo y los iconos, pero
        // detrás de cualquier ventana de aplicación.
        IntPtr progman = FindWindow("Progman", null);
        if (progman != IntPtr.Zero) return progman;

        IntPtr worker = FindWindow("WorkerW", null);
        if (worker != IntPtr.Zero) return worker;

        return IntPtr.Zero;
    }
}
"@

$handle = [IntPtr]::new($Hwnd)
$GWL_STYLE = -16
$GWL_EXSTYLE = -20
$WS_CHILD = 0x40000000
$WS_POPUP = 0x80000000
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$WS_MINIMIZEBOX = 0x00020000
$WS_MAXIMIZEBOX = 0x00010000
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_APPWINDOW = 0x00040000

if ($Action -eq "pin") {
    $desktop = [PulsoDesktopPin]::FindDesktopHost()
    if ($desktop -eq [IntPtr]::Zero) {
        Write-Output '{"ok":false,"error":"No se encontro la ventana del escritorio."}'
        exit 0
    }

    $style = [PulsoDesktopPin]::GetWindowLong($handle, $GWL_STYLE)
    $style = (($style -band (-bnot $WS_POPUP)) -bor $WS_CHILD)
    $style = $style -band (-bnot $WS_CAPTION)
    $style = $style -band (-bnot $WS_THICKFRAME)
    $style = $style -band (-bnot $WS_MINIMIZEBOX)
    $style = $style -band (-bnot $WS_MAXIMIZEBOX)
    [PulsoDesktopPin]::SetWindowLong($handle, $GWL_STYLE, $style) | Out-Null

    $exStyle = [PulsoDesktopPin]::GetWindowLong($handle, $GWL_EXSTYLE)
    $exStyle = (($exStyle -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW))
    [PulsoDesktopPin]::SetWindowLong($handle, $GWL_EXSTYLE, $exStyle) | Out-Null

    [PulsoDesktopPin]::SetParent($handle, $desktop) | Out-Null
    [PulsoDesktopPin]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, 0, 0, 0x0073) | Out-Null
    [PulsoDesktopPin]::ShowWindow($handle, 4) | Out-Null

    $actual = [PulsoDesktopPin]::GetParent($handle)
    $ok = $actual -eq $desktop
    $parentText = $desktop.ToInt64().ToString()
    $actualText = $actual.ToInt64().ToString()
    if ($ok) {
        Write-Output ('{"ok":true,"action":"pin","parent":"' + $parentText + '"}')
    } else {
        Write-Output ('{"ok":false,"action":"pin","error":"SetParent no se aplico.","parent":"' + $parentText + '","actual":"' + $actualText + '"}')
    }
    exit 0
}

$style = [PulsoDesktopPin]::GetWindowLong($handle, $GWL_STYLE)
$style = (($style -band (-bnot $WS_CHILD)) -bor $WS_POPUP)
[PulsoDesktopPin]::SetWindowLong($handle, $GWL_STYLE, $style) | Out-Null

$exStyle = [PulsoDesktopPin]::GetWindowLong($handle, $GWL_EXSTYLE)
$exStyle = $exStyle -band (-bnot $WS_EX_TOOLWINDOW)
[PulsoDesktopPin]::SetWindowLong($handle, $GWL_EXSTYLE, $exStyle) | Out-Null

[PulsoDesktopPin]::SetParent($handle, [IntPtr]::Zero) | Out-Null
[PulsoDesktopPin]::SetWindowPos($handle, [IntPtr]::new(0), 0, 0, 0, 0, 0x0073) | Out-Null
[PulsoDesktopPin]::ShowWindow($handle, 4) | Out-Null

$actual = [PulsoDesktopPin]::GetParent($handle)
Write-Output ('{"ok":' + $(if ($actual -eq [IntPtr]::Zero) { 'true' } else { 'false' }) + ',"action":"unpin","parent":"' + $actual.ToInt64() + '"}')
