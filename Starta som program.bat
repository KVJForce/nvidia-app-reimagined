@echo off
chcp 65001 >nul
cd /d "%~dp0"

:: Starta servern dold i bakgrunden (inget synligt kommandotolksfonster)
powershell -WindowStyle Hidden -Command "Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

:: Ge servern ett par sekunder att starta innan webblasen oppnas
timeout /t 5 >nul

:: Oppna appen i webblasarens app-lage (ett eget fonster utan adressfalt/flikar)
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

:: Stang startfönstret nar appen har startats
exit
