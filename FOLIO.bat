@echo off
setlocal
cd /d "%~dp0"
title Folio

cls
echo.
echo   FOLIO
echo   -----
echo.
echo   Preparing Folio...
echo.

where npm >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 goto :no_winget

  echo   Installing Node.js automatically...
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto :node_failed
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)

where pandoc >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 goto :no_winget

  echo   Installing Pandoc automatically...
  winget install --id JohnMacFarlane.Pandoc -e --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto :pandoc_failed
  set "PATH=%LOCALAPPDATA%\Pandoc;%ProgramFiles%\Pandoc;%PATH%"
)

if not exist "node_modules" (
  echo   Installing Folio components. This only happens the first time...
  call npm install
  if errorlevel 1 goto :npm_failed
)

cls
echo.
echo   FOLIO
 echo   -----
echo.
echo   Starting...
echo   Keep this window open while Folio is running.
echo.
call npm start
exit /b %errorlevel%

:no_winget
cls
echo.
echo   Folio needs Node.js and Pandoc, but Windows Package Manager ^(winget^) is not available.
echo   Install "App Installer" from Microsoft Store, then double-click FOLIO.bat again.
echo.
pause
exit /b 1

:node_failed
cls
echo.
echo   Node.js could not be installed automatically.
echo   Restart Windows and double-click FOLIO.bat again.
echo.
pause
exit /b 1

:pandoc_failed
cls
echo.
echo   Pandoc could not be installed automatically.
echo   Restart Windows and double-click FOLIO.bat again.
echo.
pause
exit /b 1

:npm_failed
cls
echo.
echo   Folio could not install its components.
echo   Check your internet connection and double-click FOLIO.bat again.
echo.
pause
exit /b 1
