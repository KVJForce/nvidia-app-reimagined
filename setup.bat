@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

set APP_NAME=NVIDIA App - Reimagined
set INSTALL_DIR=%LOCALAPPDATA%\NVIDIA App Reimagined
set DESKTOP=%USERPROFILE%\Desktop
set START_MENU=%APPDATA%\Microsoft\Windows\Start Menu\Programs
set SOURCE_DIR=%~dp0

echo ================================================
echo  Installerar %APP_NAME%
echo ================================================
echo.

:: Kolla om Node.js finns installerat
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [VARNING] Node.js hittades inte pa denna dator.
    echo Appen behöver Node.js for att kunna köras.
    echo.
    echo Installera Node.js fran: https://nodejs.org/
    echo (Välj LTS-versionen.)
    echo.
    echo nar Node.js är installerat, kör detta skript igen.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js hittades.

:: Skapa installationsmapp
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    echo [OK] Skapade installationsmapp: %INSTALL_DIR%
) else (
    echo [INFO] Installationsmapp finns redan: %INSTALL_DIR%
)

:: Kopiera alla filer
echo.
echo Kopierar filer...
xcopy "%SOURCE_DIR%*" "%INSTALL_DIR%\" /E /H /K /O /X /Y >nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Filer kopierade.
) else (
    echo [FEL] Kunde inte kopiera filer.
    pause
    exit /b 1
)

:: Skapa genväg på skrivbordet
echo.
echo Skapar genväg på skrivbordet...
powershell -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%DESKTOP%\%APP_NAME.lnk'); $shortcut.TargetPath = '%INSTALL_DIR%\Starta som program.bat'; $shortcut.WorkingDirectory = '%INSTALL_DIR%'; $shortcut.Description = 'Startar %APP_NAME% lokalt på din dator'; $shortcut.IconLocation = '%INSTALL_DIR%\public\app-icon.ico,0'; $shortcut.Save()"
if %ERRORLEVEL% equ 0 (
    echo [OK] Genväg skapad på skrivbordet.
) else (
    echo [VARNING] Kunde inte skapa genväg med ikon, försöker utan...
    powershell -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%DESKTOP%\%APP_NAME.lnk'); $shortcut.TargetPath = '%INSTALL_DIR%\Starta som program.bat'; $shortcut.WorkingDirectory = '%INSTALL_DIR%'; $shortcut.Description = 'Startar %APP_NAME% lokalt på din dator'; $shortcut.Save()"
)

:: Skapa genväg i startmenyn
if not exist "%START_MENU%" mkdir "%START_MENU%"
powershell -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%START_MENU%\%APP_NAME.lnk'); $shortcut.TargetPath = '%INSTALL_DIR%\Starta som program.bat'; $shortcut.WorkingDirectory = '%INSTALL_DIR%'; $shortcut.Description = 'Startar %APP_NAME% lokalt på din dator'; $shortcut.IconLocation = '%INSTALL_DIR%\public\app-icon.ico,0'; $shortcut.Save()" >nul 2>&1

echo.
echo ================================================
echo  Installation klar!
echo ================================================
echo.
echo Appen är installerad på: %INSTALL_DIR%
echo Dubbelklicka på genvägen "%APP_NAME%" på skrivbordet
echo för att starta programmet.
echo.
echo Allt körs lokalt på din dator. Ingenting skickas ut på internet.
echo.
pause
