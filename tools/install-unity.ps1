# ASCII only. Silent install of Unity editor bundle. Logs to file because console is GBK.
$ErrorActionPreference = 'Stop'
$installer = 'D:\GameSoftWare\unity-downloads\UnitySetup64-6000.3.27f1.exe'
$target    = 'D:\GameSoftWare\Unity\6000.3.27f1'
$log       = 'D:\GameSoftWare\kpgame\target\unity-install.log'

Set-Content -Path $log -Value ("start " + (Get-Date -Format 's'))
if (-not (Test-Path $installer)) { Add-Content $log 'FAIL installer missing'; exit 1 }

New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null

$cliArgs = @('/S', ("-P=" + $target))
Add-Content $log ("args: " + ($cliArgs -join ' '))

# The bundle manifest requires admin; request elevation explicitly so -Wait keeps a handle.
$p = Start-Process -FilePath $installer -ArgumentList $cliArgs -Verb RunAs -Wait -PassThru
if ($null -eq $p) { Add-Content $log 'FAIL no process handle (prompt declined?)'; exit 3 }
Add-Content $log ("exitcode: " + $p.ExitCode)

$exe = Join-Path $target 'Editor\Unity.exe'
if (Test-Path $exe) {
  Add-Content $log ('OK Unity.exe found, size ' + (Get-Item $exe).Length)
} else {
  Add-Content $log 'MISSING Editor\Unity.exe'
  if (Test-Path $target) {
    Get-ChildItem $target | ForEach-Object { Add-Content $log ('entry: ' + $_.Name) }
  } else {
    Add-Content $log 'target dir not created at all'
  }
  exit 2
}
Add-Content $log 'done'
