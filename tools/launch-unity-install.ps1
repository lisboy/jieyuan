# ASCII only. Single elevation entry point for the Unity install attempts.
$target = 'D:\GameSoftWare\kpgame\tools\install-unity-try.ps1'
$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$target)
Write-Output ('elevated runner exit=' + $p.ExitCode)
Get-Content 'D:\GameSoftWare\kpgame\target\unity-attempt.log' | Select-Object -Last 40
