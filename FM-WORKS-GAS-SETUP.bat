@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title FM WORKS - First-time GAS manual publisher setup

echo ======================================================
echo  FM WORKS - First-time local GAS setup (read-only)
echo ======================================================
echo.
where git.exe >nul 2>nul
if errorlevel 1 goto NO_GIT
where node.exe >nul 2>nul
if errorlevel 1 goto NO_NODE
where clasp.cmd >nul 2>nul
if errorlevel 1 goto NO_CLASP
node -e "if(Number(process.versions.node.split('.')[0]) < 20)process.exit(1)"
if errorlevel 1 goto OLD_NODE

set "REPO=%~dp0"
if exist "%REPO%scripts\setup_gas_local_bridge.mjs" goto REPO_FOUND
set "REPO=%USERPROFILE%\FM-WORKS-PUBLISHER\"
if exist "%REPO%scripts\setup_gas_local_bridge.mjs" goto REPO_FOUND

echo [INFO] Downloading the private repository. GitHub login may be required.
git clone --branch main --single-branch https://github.com/Te-tsu-ya/FM-WORKS.git "%REPO%"
if errorlevel 1 goto ERROR
if not exist "%REPO%scripts\setup_gas_local_bridge.mjs" goto ERROR

:REPO_FOUND
pushd "%REPO%"
if errorlevel 1 goto ERROR

for /f "delims=" %%A in ('git branch --show-current') do set "BRANCH=%%A"
if /i not "%BRANCH%"=="main" goto ERROR_POP
set "ORIGIN_OK=0"
for /f "delims=" %%A in ('git remote get-url origin') do set "ORIGIN_URL=%%A"
if /i "%ORIGIN_URL%"=="https://github.com/Te-tsu-ya/FM-WORKS.git" set "ORIGIN_OK=1"
if /i "%ORIGIN_URL%"=="https://github.com/Te-tsu-ya/FM-WORKS" set "ORIGIN_OK=1"
if /i "%ORIGIN_URL%"=="git@github.com:Te-tsu-ya/FM-WORKS.git" set "ORIGIN_OK=1"
if /i "%ORIGIN_URL%"=="ssh://git@github.com/Te-tsu-ya/FM-WORKS.git" set "ORIGIN_OK=1"
if not "%ORIGIN_OK%"=="1" goto ERROR_POP
set "DIRTY=0"
for /f "delims=" %%A in ('git status --porcelain') do set "DIRTY=1"
if "%DIRTY%"=="1" goto ERROR_POP
git fetch --no-tags origin main
if errorlevel 1 goto ERROR_POP
git merge --ff-only origin/main
if errorlevel 1 goto ERROR_POP
for /f "delims=" %%A in ('git rev-parse HEAD') do set "FM_WORKS_MANUAL_EXPECTED_SHA=%%A"

echo [1/4] Sign into the Google account that owns the existing FM WORKS GAS.
if exist ".clasp.json" goto ALREADY_CONNECTED
clasp login
if errorlevel 1 goto ERROR_POP

echo [2/4] Enter Script ID from Apps Script Project Settings.
echo [INFO] Script ID is NOT the deployment ID in your /exec URL.
node scripts\setup_gas_local_bridge.mjs --connect
if errorlevel 1 goto ERROR_POP
:ALREADY_CONNECTED

echo [3/4] Connect this publisher to the currently deployed, immutable GAS version.
if exist "artifacts\gas-local-bridge\state.json" goto HAVE_STATE
echo [IMPORTANT] You need the exact 40-character GitHub commit SHA that Work1
echo previously deployed to the existing GAS URL.
echo [IMPORTANT] This step only READS GAS and fails on any mismatch.
node scripts\gas_local_bridge.mjs --adopt-baseline-prompt
if errorlevel 1 goto ERROR_POP
:HAVE_STATE

echo [4/4] Checking current main and the existing GAS deployment (no publishing)...
node scripts\gas_local_bridge.mjs --preflight-main
if errorlevel 1 goto ERROR_POP

echo.
echo [SUCCESS] First-time setup finished. You can now run FM-WORKS-GAS-PUBLISH.bat.
popd
pause
exit /b 0

:NO_GIT
echo [STOP] Install Git for Windows first.
goto ERROR
:NO_NODE
echo [STOP] Install Node.js 20 or newer first.
goto ERROR
:NO_CLASP
echo [STOP] Run: npm install -g @google/clasp
goto ERROR
:OLD_NODE
echo [STOP] Node.js version 20 or newer is required.
goto ERROR
:ERROR_POP
popd
:ERROR
echo.
echo [FAILED] Setup is incomplete. No GAS code was published by this setup batch.
pause
exit /b 1
