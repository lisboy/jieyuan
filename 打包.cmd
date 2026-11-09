@echo off
rem ASCII-only wrapper: Chinese text lives in tools\package-ui.ps1 (UTF-8),
rem because cmd.exe parses .cmd byte-wise and multibyte text breaks parsing.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\package-ui.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
