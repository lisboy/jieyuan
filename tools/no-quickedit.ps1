# 关闭当前控制台的「快速编辑」模式（QuickEdit）。
#
# 背景：Windows 控制台一旦被鼠标点中进入「选择」状态（窗口标题会出现“选择”前缀），
# 系统会挂起所有输出。Node 的 console.log 在 Windows 上是同步写控制台，写不进去就会
# 把整个事件循环卡死——端口还在监听、请求却永远不返回，玩家看到的就是“卡死/操作不了”。
# 本脚本把当前控制台切到扩展模式并清掉 ENABLE_QUICK_EDIT_MODE，避免误点冻住服务。
# 没有控制台（如作为后台服务启动）或系统策略限制时静默退出，不影响正常启动。

$ErrorActionPreference = 'SilentlyContinue'

$sig = @'
using System;
using System.Runtime.InteropServices;
public class ShiyuanConsoleMode {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GetStdHandle(int nStdHandle);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
}
'@

try {
  Add-Type -TypeDefinition $sig -ErrorAction Stop
  $h = [ShiyuanConsoleMode]::GetStdHandle(-10)   # STD_INPUT_HANDLE
  if ($h -eq [IntPtr]::Zero -or $h -eq [IntPtr](-1)) { exit 0 }
  [uint32]$mode = 0
  if (-not [ShiyuanConsoleMode]::GetConsoleMode($h, [ref]$mode)) { exit 0 }
  # ENABLE_EXTENDED_FLAGS 0x0080；清除 ENABLE_QUICK_EDIT_MODE 0x0040
  $newMode = [uint32](($mode -bor 0x0080) -band (-bnot 0x0040))
  [void][ShiyuanConsoleMode]::SetConsoleMode($h, $newMode)
  exit 0
} catch { exit 0 }
