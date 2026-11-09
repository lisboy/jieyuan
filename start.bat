@echo off
setlocal
chcp 65001 >nul
title 拾缘 - 启动服务
cd /d "%~dp0"

rem 若 5174 端口已被占用则不重复启动，避免僵尸进程
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 goto :already

if not exist "node_modules" goto :install
goto :checkdata

:install
echo 首次运行，正在安装依赖 ...
call npm install
if errorlevel 1 goto :installfail

:checkdata
if exist "data" goto :launch
echo data 目录缺失，正在构建内容 ...
call npm run build
if errorlevel 1 goto :buildfail

:launch
echo 正在启动拾缘服务 ...
start "shiyuan-serve" cmd /k "title 拾缘服务 shiyuan-serve & chcp 65001 >nul & powershell -NoProfile -ExecutionPolicy Bypass -File tools\no-quickedit.ps1 >nul 2>&1 & node tools\serve-guard.mjs --port 5174"

set /a tries=0

:wait
ping -n 2 127.0.0.1 >nul
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 goto :ok
set /a tries+=1
if %tries% lss 20 goto :wait
echo [警告] 服务未能在预期时间内监听 5174 端口，请查看服务窗口中的报错信息
pause
exit /b 1

:ok
echo [完成] 服务已启动：http://localhost:5174
echo 服务运行在独立窗口中，运行 stop.bat 或关闭该窗口即可停止
pause
exit /b 0

:already
echo [提示] 服务已在运行：http://localhost:5174
echo 如需重启，请先运行 stop.bat
pause
exit /b 0

:installfail
echo [错误] 依赖安装失败，请检查 Node.js 环境后重试
pause
exit /b 1

:buildfail
echo [错误] 内容构建失败，请检查 content/ 配置
pause
exit /b 1
