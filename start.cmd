@echo off
setlocal
set "SIDEBAR_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%SIDEBAR_NODE%" (
  "%SIDEBAR_NODE%" "%~dp0setup.mjs"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found. Ask Codex to follow INSTALL.md and locate its bundled Node runtime.
    pause
    exit /b 1
  )
  node "%~dp0setup.mjs"
)
if errorlevel 1 pause
