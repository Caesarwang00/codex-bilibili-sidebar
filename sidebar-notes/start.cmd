@echo off
setlocal
set "SIDEBAR_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%SIDEBAR_NODE%" (
  "%SIDEBAR_NODE%" "%~dp0launch.mjs"
) else (
  node "%~dp0launch.mjs"
)
if errorlevel 1 pause
