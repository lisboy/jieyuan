# ASCII only. Run elevated once; try several silent-install argument forms until Unity.exe appears.
$ErrorActionPreference = 'Continue'
$installer = 'D:\GameSoftWare\unity-downloads\UnitySetup64-6000.3.27f1.exe'
$wantRoot  = 'D:\GameSoftWare\Unity\6000.3.27f1'
$log       = 'D:\GameSoftWare\kpgame\target\unity-attempt.log'
$ver       = '6000.3.27f1'

function Log($m) { Add-Content -Path $log -Value ((Get-Date -Format 'HH:mm:ss') + '  ' + $m) }
function UnityExe($root) {
  $c = @()
  $c += (Join-Path $root 'Editor\Unity.exe')
  $c += (Join-Path $root ('Hub\Editor\' + $ver + '\Editor\Unity.exe'))
  $c += (Join-Path $root ($ver + '\Editor\Unity.exe'))
  foreach ($p in $c) { if (Test-Path $p) { return $p } }
  return $null
}

Set-Content -Path $log -Value ('begin elevated=' + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

$found = UnityExe $wantRoot
if ($found) { Log ('already installed at ' + $found); exit 0 }

$forms = @(
  @{ n = 'burn-quiet-installdir'; a = @('/quiet', ('--installdir=' + $wantRoot)) },
  @{ n = 'nsis-slash-S-slash-D';  a = @('/S', ('/D=' + $wantRoot)) },
  @{ n = 'burn-passive-installdir'; a = @('/passive', ('--installdir=' + $wantRoot)) },
  @{ n = 'burn-quiet-default';    a = @('/quiet') }
)

$probeDirs = @($wantRoot, 'C:\Program Files\Unity', 'D:\Program Files\Unity', 'C:\Program Files\Unity\Hub\Editor', 'D:\Unity')

foreach ($f in $forms) {
  Log ('--- attempt ' + $f.n + ' args=' + ($f.a -join ' '))
  $before = @()
  foreach ($d in $probeDirs) { if (Test-Path $d) { $before += (Get-ChildItem $d -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) } }
  $p = Start-Process -FilePath $installer -ArgumentList $f.a -Wait -PassThru
  Log ('    exitcode=' + $p.ExitCode)
  Start-Sleep -Seconds 3
  foreach ($d in $probeDirs) {
    if (Test-Path $d) {
      $now = Get-ChildItem $d -Recurse -Depth 3 -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'Unity.exe' }
      foreach ($e in $now) { Log ('    FOUND ' + $e.FullName) }
    }
  }
  $hit = UnityExe $wantRoot
  if (-not $hit) { foreach ($d in $probeDirs) { $h2 = UnityExe $d; if ($h2) { $hit = $h2 } } }
  if ($hit) { Log ('SUCCESS at ' + $hit); exit 0 }
  Log '    no Unity.exe after this form'
}
Log 'ALL FORMS FAILED'
exit 4
