@echo off
chcp 65001 >nul
cd /d "%~dp0"

setlocal enabledelayedexpansion

:: Starta servern dold i bakgrunden (inget synligt kommandotolksfonster)
powershell -WindowStyle Hidden -Command "Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden" >nul 2>&1

:: Vanta pa att servern svarar (max 15 sekunder)
set READY=0
for /L %%i in (1,1,30) do (
    curl.exe -s -m 1 http://127.0.0.1:4173/ >nul 2>&1
    if !ERRORLEVEL! equ 0 set READY=1 & goto :browser
    timeout /t 1 >nul
)

:browser

:: Hitta en webblasare som starjer app-lage
set BROWSER=
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set BROWSER="%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set BROWSER="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" set BROWSER="%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set BROWSER="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set BROWSER="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if not "%BROWSER%"=="" (
    start "" %BROWSER% --app=http://127.0.0.1:4173/
) else (
    start http://127.0.0.1:4173/
)

exit
