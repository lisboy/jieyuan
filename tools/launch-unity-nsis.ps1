# ASCII only. One elevation prompt, then run the NSIS install attempts and echo the log tail.
$t = 'D:\GameSoftWare\kpgame\tools\install-unity-nsis.ps1'
$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$t)
Write-Output ('elevated runner exit=' + $p.ExitCode)
Get-Content 'D:\GameSoftWare\kpgame\target\unity-nsis.log' | Select-Object -Last 40
