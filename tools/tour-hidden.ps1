# tour-hidden.ps1 —— 在独立虚拟桌面上跑 -uitour 巡游：
# 游戏窗口开在另一个桌面里，既不可见也不抢焦点，不会把玩家正在玩的全屏应用切出去。
# 截图由游戏内 ScreenCapture 写盘（读的是后备缓冲，不依赖桌面可见）。
param(
    [string]$Exe = "D:\GameSoftWare\kpgame\unity\Builds\Windows\Shiyuan.exe",
    [int]$TimeoutSec = 120
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class VDesktop {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr devmode, uint flags, uint access, IntPtr attrs);
    [DllImport("user32.dll")]
    public static extern bool CloseDesktop(IntPtr h);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFOW {
        public uint cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcessW(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOW si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr h);
}
"@

$desktopName = "ShiyuanTour_$PID"
# DESKTOP_READOBJECTS|CREATEWINDOW|ENUMERATE|HOOKCONTROL|WRITEOBJECTS|SWITCHDESKTOP|JOURNAL* = 0x01FF
$hdesk = [VDesktop]::CreateDesktopW($desktopName, [IntPtr]::Zero, [IntPtr]::Zero, 0, 0x01FF, [IntPtr]::Zero)
if ($hdesk -eq [IntPtr]::Zero) { throw "CreateDesktop 失败: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }

try {
    $si = New-Object VDesktop+STARTUPINFOW
    $si.cb = [uint32][Runtime.InteropServices.Marshal]::SizeOf($si)
    $si.lpDesktop = "winsta0\$desktopName"
    $pi = New-Object VDesktop+PROCESS_INFORMATION
    $ok = [VDesktop]::CreateProcessW($Exe, "`"$Exe`" -uitour -screen-width 1920 -screen-height 1080",
        [IntPtr]::Zero, [IntPtr]::Zero, $false, 0, [IntPtr]::Zero, (Split-Path $Exe), [ref]$si, [ref]$pi)
    if (-not $ok) { throw "CreateProcess 失败: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }

    Write-Output "STARTED pid=$($pi.dwProcessId) desktop=$desktopName"
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 1500
        $code = 0
        if ([VDesktop]::WaitForSingleObject($pi.hProcess, 0) -eq 0) { Write-Output "EXITED code=$code"; break }
    }
    [VDesktop]::CloseHandle($pi.hThread) | Out-Null
    [VDesktop]::CloseHandle($pi.hProcess) | Out-Null
}
finally {
    [VDesktop]::CloseDesktop($hdesk) | Out-Null
}
