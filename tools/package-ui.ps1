# package-ui.ps1 —— 双击「打包.cmd」时跑的交互式打包脚本
# 批处理只负责转发到这里（.cmd 按字节解析，放中文会断行，所以中文都写在这边）。
# 用法：双击 打包.cmd ；或命令行 powershell -File tools\package-ui.ps1 [--skip-core]

param(
  [switch]$SkipCore
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

# 让控制台按 UTF-8 显示，中文不乱码
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Write-Head($text) {
  Write-Host ''
  Write-Host '==========================================' -ForegroundColor DarkCyan
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host '==========================================' -ForegroundColor DarkCyan
}
function Ok($t)   { Write-Host "   [OK] $t"   -ForegroundColor Green }
function Miss($t) { Write-Host "   [缺失] $t" -ForegroundColor Red }
function Info($t) { Write-Host "   $t"        -ForegroundColor Gray }

Write-Head '拾缘 · 一键打包发布包'

# ---------- 环境检查 ----------
$missing = @()

Write-Host '[检查] Node.js ...' -NoNewline
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host ''
  Miss '未找到 Node.js'
  Info '需要 Node.js 18 或更高版本：https://nodejs.org/'
  $missing += 'Node.js'
} else {
  $nv = (& node -v) 2>$null
  Write-Host ''
  Ok "Node.js $nv"
  $major = [int]($nv.TrimStart('v').Split('.')[0])
  if ($major -lt 18) {
    Miss "Node.js 版本过低（需要 >= 18，当前 $nv）"
    $missing += 'Node.js(版本)'
  }
}

Write-Host '[检查] npm ...' -NoNewline
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Miss '未找到 npm（通常随 Node.js 一起安装，重装 Node.js 即可）'
  $missing += 'npm'
} else {
  Write-Host ''
  Ok 'npm 可用'
}

Write-Host '[检查] .NET SDK ...' -NoNewline
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
  Write-Host ''
  Miss '未找到 .NET SDK'
  Info '打包要编译 C# 战斗引擎，请安装 .NET 8 SDK：https://dotnet.microsoft.com/download'
  if (-not $SkipCore) { $missing += '.NET SDK' }
  else { Info '（已加 --skip-core，复用现有编译产物，可继续）' }
} else {
  $dv = (& dotnet --version) 2>$null
  Write-Host ''
  Ok ".NET SDK $dv"
}

if ($missing.Count -gt 0) {
  Write-Host ''
  Write-Host '------------------------------------------' -ForegroundColor DarkYellow
  Write-Host '  环境不完整，无法打包。' -ForegroundColor Yellow
  Write-Host ("  缺少：" + ($missing -join '、')) -ForegroundColor Yellow
  Write-Host '  按上面提示装好后再双击本文件。' -ForegroundColor Yellow
  Write-Host '------------------------------------------' -ForegroundColor DarkYellow
  Write-Host ''
  exit 1
}

# ---------- 依赖检查 ----------
if (-not (Test-Path (Join-Path $root 'node_modules\mysql2'))) {
  Write-Host ''
  Write-Host '[依赖] 首次运行，正在安装 npm 依赖 ...' -ForegroundColor Cyan
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Miss '依赖安装失败，请检查网络或 npm 源配置。'
    exit 1
  }
  Ok '依赖已安装'
}

# ---------- 打包 ----------
$argsList = @('tools/package.mjs', '--zip')
if ($SkipCore) { $argsList += '--skip-core' }

Write-Host ''
Write-Host '[打包] 构建内容 -> 校验 -> 编译引擎 -> 组装 -> 压缩' -ForegroundColor Cyan
if ($SkipCore) { Info '本次跳过 C# 编译（--skip-core）' }
Write-Host ''

& node @argsList
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '------------------------------------------' -ForegroundColor DarkRed
  Write-Host '  打包失败，请查看上面的输出定位原因。' -ForegroundColor Red
  Write-Host '------------------------------------------' -ForegroundColor DarkRed
  exit $LASTEXITCODE
}

Write-Host ''
Write-Head '打包完成'
$releaseDir = Join-Path $root 'release'
if (Test-Path $releaseDir) {
  $size = (Get-ChildItem $releaseDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
  Ok ("发布包目录：release\  ({0:N1} MB)" -f $size)
  Info '启动：release\start.cmd    停止：release\stop.cmd    重启：release\restart.cmd'
}
Get-ChildItem $root -Filter 'release-*.zip' | ForEach-Object {
  Ok ("压缩包：{0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB))
}
Write-Host ''
exit 0
