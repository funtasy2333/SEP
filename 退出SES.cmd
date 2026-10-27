@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ses-windows.ps1" stop
set "SES_RESULT=%ERRORLEVEL%"
if not "%SES_NO_PAUSE%"=="1" pause
exit /b %SES_RESULT%
