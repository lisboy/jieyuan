# ASCII only. Elevated: kill stalled installer worker, wipe partial install, re-run single instance,
# wait on the actual worker (not the parent stub), verify Unity.exe, then batchmode smoke test.
$ErrorActionPreference = 'Continue'
$installer = 'D:\GameSoftWare\unity-downloads\UnitySetup64-6000.3.27f1.exe'
$root      = 'D:\GameSoftWare\Unity\6000.3.27f1'
$log       = 'D:\GameSoftWare\kpgame\target\unity-reinstall.log'
function Log($m) { Add-Content -Path $log -Value ((Get-Date -Format 'HH:mm:ss') + '  ' + $m) }
Set-Content -Path $log -Value ('begin elevated=' + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

# 1. kill every installer process (the stalled worker holds the NSIS mutex)
Get-Process | Where-Object { $_.Name -like 'UnitySetup*' } | ForEach-Object { Log ('kill pid=' + $_.Id); Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

# 2. wipe only the partial editor output we created
if (Test-Path $root) { Log ('removing partial ' + $root); Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }

# 3. single instance, silent, install dir as last unquoted arg
Log 'start install'
$p = Start-Process -FilePath $installer -ArgumentList @('/S', ('/D=' + $root)) -PassThru
$deadline = (Get-Date).AddMinutes(25)
$lastSize = -1; $stallRounds = 0
while ((Get-Date) -lt $deadline) {
  # The stub returned by Start-Process can exit while UnitySetup64 workers keep writing,
  # so poll on the worker set + output size, never on the stub.
  $workers = @(Get-Process | Where-Object { $_.Name -like 'UnitySetup*' })
  $sz = 0
  if (Test-Path $root) { $sz = (Get-ChildItem $root -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum }
  $szGB = [math]::Round($sz / 1GB, 2)
  if ($szGB -eq $lastSize) { $stallRounds++ } else { $stallRounds = 0; Log ('progress GB=' + $szGB + ' workers=' + $workers.Count) }
  $lastSize = $szGB
  if ($workers.Count -eq 0 -and $szGB -gt 0) { Log 'no worker left, install finished'; break }
  if ($stallRounds -ge 12) { Log 'STALL 4min without growth, aborting wait'; break }
  Start-Sleep -Seconds 20
}

# 4. verify
$exe = Join-Path $root 'Editor\Unity.exe'
if (Test-Path $exe) {
  Log ('Unity.exe OK size=' + (Get-Item $exe).Length)
  $v = Get-Content (Join-Path $root 'Editor\Data\version.txt') -ErrorAction SilentlyContinue
  Log ('version.txt=' + $v)
} else {
  Log 'Unity.exe MISSING'
  Log ('editor dir entries: ' + ((Get-ChildItem (Join-Path $root 'Editor') -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) -join ','))
  exit 2
}

# 5. batchmode smoke test - this also reveals licensing state
$proj = 'D:\GameSoftWare\kpgame\unity'
if (Test-Path $proj) { Remove-Item $proj -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $proj | Out-Null
$log2 = 'D:\GameSoftWare\kpgame\target\unity-create.log'
$q = Start-Process -FilePath $exe -ArgumentList @('-batchmode','-quit','-nographics','-logFile',$log2) -Wait -PassThru
Log ('batchmode exit=' + $q.ExitCode)
if (Test-Path $log2) {
  $t = Get-Content $log2 | Select-Object -Last 25
  foreach ($line in $t) { Log ('LOG| ' + $line) }
}
exit 0
