@echo off
rem 全角色 CV 重构：跑到全量完成（断点续跑、自愈）。供计划任务/后台调用。
cd /d D:\GameSoftWare\kpgame
if not exist target\cv-run mkdir target\cv-run
echo [%date% %time%] cv-auto start >> target\cv-run\stdout.log
D:\DevelopSoftware\miniconda\python.exe tools\cv-presets.py --phase auto >> target\cv-run\stdout.log 2>&1
echo [%date% %time%] cv-auto exit=%ERRORLEVEL% >> target\cv-run\stdout.log
