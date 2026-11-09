# ASCII only. Non-elevated launcher: requests one UAC prompt for unity-reinstall.ps1.
$ErrorActionPreference = 'Continue'
$script = 'D:\GameSoftWare\kpgame\tools\unity-reinstall.ps1'
$out = 'D:\GameSoftWare\kpgame\target\unity-launch.log'
Set-Content -Path $out -Value ('launching at ' + (Get-Date))
$p = Start-Process powershell -Verb RunAs -PassThru -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script
)
if ($p) { Add-Content -Path $out -Value ('spawned pid=' + $p.Id) } else { Add-Content -Path $out -Value 'spawn failed (UAC declined?)' }
