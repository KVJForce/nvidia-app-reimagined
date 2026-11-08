@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo.
echo Starting NVIDIA App - Reimagined locally...
echo.

:: Starta servern i ett eget fonster (stang det for att avsluta programmet)
start "NVIDIA App - Server" node server.js

:: Vanta pa att servern blir tillganglig (max ca 10 sekunder)
for /L %%i in (1,1,30) do (
    curl.exe -s -m 1 http://127.0.0.1:4173/ >nul 2>&1 && goto :ready
    timeout /t 1 >nul
)
:ready

:: Oppna i webblasarens app-lage (fristaende fonster utan adressfalt/flikar)
set BROWSER=
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" set BROWSER=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe

if defined BROWSER (
    start "" "%BROWSER%" --app=http://127.0.0.1:4173/
) else (
    start http://127.0.0.1:4173/
)

echo.
echo ---------------------------------------------------------------
echo NVIDIA App is running locally: http://127.0.0.1:4173
echo - Everything runs on your computer; nothing is sent online.
echo - Close the black server window to stop the program.
echo ---------------------------------------------------------------
echo.
pause
