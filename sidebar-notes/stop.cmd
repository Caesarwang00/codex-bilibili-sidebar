@echo off
setlocal
set "SIDEBAR_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%SIDEBAR_NODE%" (
  "%SIDEBAR_NODE%" "%~dp0launch.mjs" stop
) else (
  node "%~dp0launch.mjs" stop
)
if errorlevel 1 pause
