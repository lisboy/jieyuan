# ASCII only. Elevated: kill stale installer, locate disk usage, then silent-install with correct NSIS syntax.
$ErrorActionPreference = 'Continue'
$installer = 'D:\GameSoftWare\unity-downloads\UnitySetup64-6000.3.27f1.exe'
$want      = 'D:\GameSoftWare\Unity\6000.3.27f1'
$log       = 'D:\GameSoftWare\kpgame\target\unity-nsis.log'

function Log($m) { Add-Content -Path $log -Value ((Get-Date -Format 'HH:mm:ss') + '  ' + $m) }
Set-Content -Path $log -Value ('begin elevated=' + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

# 1. stale installer processes
Get-Process | Where-Object { $_.Name -like 'UnitySetup*' } | ForEach-Object {
  Log ('killing stale pid=' + $_.Id + ' name=' + $_.Name)
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# 2. where did the bytes go
function DirSize($p) {
  if (-not (Test-Path $p)) { return $null }
  $s = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $s) { $s = 0 }
  return [math]::Round($s / 1GB, 2)
}
foreach ($p in @($env:TEMP, 'C:\Program Files\Unity', 'C:\Program Files\Unity\Hub\Editor')) {
  Get-ChildItem $p -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'ns*' } | ForEach-Object {
    Log ('tmp  ' + $_.FullName + ' = ' + (DirSize $_.FullName) + ' GB')
  }
}
Log ('C:\Program Files\Unity = ' + (DirSize 'C:\Program Files\Unity') + ' GB')

# 3. correct NSIS silent install: /S first, /D=<path> MUST be last and unquoted
New-Item -ItemType Directory -Force -Path 'D:\GameSoftWare\Unity' | Out-Null
Log ('running: ' + $installer + ' /S /D=' + $want)
$p = Start-Process -FilePath $installer -ArgumentList @('/S', ('/D=' + $want)) -Wait -PassThru
Log ('exitcode=' + $p.ExitCode)

# 4. verify
Start-Sleep -Seconds 5
$hit = Get-ChildItem 'D:\GameSoftWare\Unity' -Recurse -Depth 4 -Filter 'Unity.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($hit) {
  Log ('SUCCESS ' + $hit.FullName)
  Log ('total install GB = ' + (DirSize 'D:\GameSoftWare\Unity'))
  exit 0
}
Log 'FAIL: no Unity.exe under D:\GameSoftWare\Unity'
foreach ($c in @('C:\Program Files\Unity\Hub\Editor', 'C:\Program Files\Unity')) {
  $h2 = Get-ChildItem $c -Recurse -Depth 4 -Filter 'Unity.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($h2) { Log ('it landed on C: ' + $h2.FullName) }
}
exit 2
