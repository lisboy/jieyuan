# ASCII only. Wait for the elevated installer worker to exit, then verify the editor binary and run a batchmode smoke test.
$ErrorActionPreference = 'Continue'
$log = 'D:\GameSoftWare\kpgame\target\unity-wait.log'
function Log($m) { Add-Content -Path $log -Value ((Get-Date -Format 'HH:mm:ss') + '  ' + $m) }
Set-Content -Path $log -Value 'begin'

$deadline = (Get-Date).AddMinutes(20)
while ((Get-Date) -lt $deadline) {
  $procs = @(Get-Process | Where-Object { $_.Name -like 'UnitySetup*' })
  if ($procs.Count -eq 0) { Log ('installer exited, pidCount 0'); break }
  Log ('waiting, still running: ' + (($procs | ForEach-Object { $_.Id }) -join ','))
  Start-Sleep -Seconds 20
}

$editor = 'D:\GameSoftWare\Unity\6000.3.27f1\Editor'
Log ('editor entries: ' + ((Get-ChildItem $editor -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ' | '))
$exe = Join-Path $editor 'Unity.exe'
if (Test-Path $exe) { Log ('Unity.exe OK, size ' + (Get-Item $exe).Length) } else { Log 'Unity.exe MISSING' }
Log ('version.txt: ' + (Get-Content (Join-Path $editor 'Data\version.txt') -ErrorAction SilentlyContinue))
