Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, int extra);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
}
"@
[W]::SetProcessDPIAware() | Out-Null

$dir = "D:/GameSoftWare/kpgame/target/shots"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$proc = Get-Process Shiyuan -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Output "NO_PROCESS"; exit 1 }
$hwnd = $proc.MainWindowHandle
[W]::ShowWindow($hwnd, 9) | Out-Null
[W]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 600

function Rect { $r = New-Object W+RECT; [W]::GetWindowRect($hwnd, [ref]$r) | Out-Null; return $r }
function ClientOrigin {
  $p = New-Object W+POINT; $p.X = 0; $p.Y = 0
  [W]::ClientToScreen($hwnd, [ref]$p) | Out-Null
  return $p
}

function Capture($name) {
  $r = Rect
  $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
  if ($w -le 0 -or $h -le 0) { Write-Output "BAD_RECT $name"; return }
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $ok = $false
  try {
    $hdc = $g.GetHdc()
    $ok = [W]::PrintWindow($hwnd, $hdc, 2)
    $g.ReleaseHdc($hdc)
  } catch { $ok = $false }
  if (-not $ok) {
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
  }
  $g.Dispose()
  $path = Join-Path $dir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "SHOT $path"
}

function ClickUi($ux, $uy) {
  $o = ClientOrigin
  $r = New-Object W+RECT; [W]::GetClientRect($hwnd, [ref]$r) | Out-Null
  $cw = $r.Right - $r.Left; $ch = $r.Bottom - $r.Top
  $sx = $cw / 1920.0; $sy = $ch / 1080.0
  $x = [int]($o.X + (960 + $ux) * $sx)
  $y = [int]($o.Y + (540 - $uy) * $sy)
  [W]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 120
  [W]::mouse_event(0x0002, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 60
  [W]::mouse_event(0x0004, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 450
}

Write-Output "HWND=$hwnd"
Start-Sleep -Milliseconds 1500
Capture "01-home.png"

# 缘阁 -> 抽卡
ClickUi -830 230
Start-Sleep -Milliseconds 700
Capture "02-gacha.png"

# 单抽 -> 缘签仪式
ClickUi -190 330
Start-Sleep -Milliseconds 900
Capture "03-ritual.png"
Start-Sleep -Milliseconds 900
Capture "04-ritual-sign.png"
Start-Sleep -Milliseconds 1200
Capture "05-results.png"

# 全部翻开
ClickUi -230 -484
Start-Sleep -Milliseconds 900
Capture "06-results-open.png"

# 确定
ClickUi 180 -484
Start-Sleep -Milliseconds 700

# 返回（gacha）
ClickUi -860 494
Start-Sleep -Milliseconds 700
Capture "07-home-back.png"

# 藏书院 -> 名册
ClickUi -520 230
Start-Sleep -Milliseconds 800
Capture "08-roster.png"

# 点第一张卡（网格第一格：grid 左上，坐标约 -750, 200）
ClickUi -750 200
Start-Sleep -Milliseconds 900
Capture "09-roster-detail.png"

# 返回
ClickUi -860 494
Start-Sleep -Milliseconds 700

# 演武场 -> 出征
ClickUi -210 230
Start-Sleep -Milliseconds 800
Capture "10-stages.png"

# 返回
ClickUi -860 494
Start-Sleep -Milliseconds 700

# 百宝囊 -> 行囊
ClickUi -700 18
Start-Sleep -Milliseconds 800
Capture "11-bag.png"
ClickUi -860 494
Start-Sleep -Milliseconds 600

# 坊市 -> 商城
ClickUi -390 18
Start-Sleep -Milliseconds 800
Capture "12-shop.png"

Write-Output "DONE"
