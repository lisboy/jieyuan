@echo off
setlocal
chcp 65001 >nul
title 拾缘 - 停止服务

echo 正在停止拾缘服务 ...
rem 先关 start.bat 打开的服务窗口（连同窗口里的 guard/serve）
taskkill /FI "WINDOWTITLE eq *shiyuan-serve*" /T /F >nul 2>&1

rem 统一由 Node 脚本收尾：先停 serve-guard，再停 serve 与残留战斗引擎
node "%~dp0tools\stop-server.mjs" 5174

pause
exit /b %errorlevel%
