@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title FM WORKS - permanent GAS updater

rem Permanent updater. No GitHub Actions and no scheduled-task registration.
rem This script only publishes the existing owner-approved GAS deployment.
set "PUBLISH_DIR=%USERPROFILE%\FM-WORKS-PUBLISHER"
set "REPO_URL=https://github.com/Te-tsu-ya/FM-WORKS.git"

echo.
echo ==========================================================
echo  FM WORKS - permanent GitHub main to existing GAS updater
echo  Uses Git + Node + clasp, NOT GitHub Actions
echo ==========================================================
echo.

where git.exe >nul 2>nul
if errorlevel 1 goto :need_git
where node.exe >nul 2>nul
if errorlevel 1 goto :need_node
where clasp.cmd >nul 2>nul
if errorlevel 1 goto :need_clasp
node -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)"
if errorlevel 1 goto :need_node
call clasp.cmd update-deployment --help >nul 2>nul
if errorlevel 1 goto :need_clasp_v3

rem An installed scheduled task does NOT mean it is currently running.
rem The protected bridge itself holds an exclusive lock.
schtasks.exe /Query /TN "FM WORKS - GAS Publisher" >nul 2>nul
if not errorlevel 1 (
 echo INFO: An automatic publisher task is registered.
 echo Concurrent runs are blocked by the bridge lock. Do not delete the task.
)

if exist "%PUBLISH_DIR%\.git" goto :clone_ready
if exist "%PUBLISH_DIR%" (
 echo ERROR: A folder with this name exists but is not a Git clone.
 echo Folder: "%PUBLISH_DIR%"
 goto :failed
)
echo [1/5] First use - cloning the private FM WORKS repository...
git clone --branch main "%REPO_URL%" "%PUBLISH_DIR%"
if errorlevel 1 goto :failed

:clone_ready
set "ORIGIN_URL="
for /f "delims=" %%U in ('git -C "%PUBLISH_DIR%" remote get-url origin') do set "ORIGIN_URL=%%U"
if /I "%ORIGIN_URL%"=="https://github.com/Te-tsu-ya/FM-WORKS.git" goto :origin_verified
if /I "%ORIGIN_URL%"=="git@github.com:Te-tsu-ya/FM-WORKS.git" goto :origin_verified
if /I "%ORIGIN_URL%"=="ssh://git@github.com/Te-tsu-ya/FM-WORKS.git" goto :origin_verified
echo ERROR: GitHub origin does not match the approved FM WORKS repository.
goto :failed

:origin_verified
git -C "%PUBLISH_DIR%" diff --quiet
if errorlevel 1 goto :dirty
git -C "%PUBLISH_DIR%" diff --cached --quiet
if errorlevel 1 goto :dirty
echo [1/5] Updating the dedicated local GitHub checkout...
git -C "%PUBLISH_DIR%" switch main
if errorlevel 1 goto :failed
git -C "%PUBLISH_DIR%" pull --ff-only origin main
if errorlevel 1 goto :failed
if not exist "%PUBLISH_DIR%\scripts\gas_local_bridge.mjs" (
 echo ERROR: The protected GAS bridge is missing.
 goto :failed
)
findstr /C:"--preflight-main" "%PUBLISH_DIR%\scripts\gas_local_bridge.mjs" >nul
if errorlevel 1 (
 echo ERROR: This GitHub main does not contain the repaired release bridge.
 echo Merge the FM WORKS updater fix PR first. No GAS changes were made.
 goto :failed
)
if exist "%PUBLISH_DIR%\artifacts\gas-local-bridge\pending.json" (
 echo ERROR: An earlier attempt is pending. Check pending.json and GAS first.
 echo Do NOT delete pending.json until the remote source and version are checked.
 goto :failed
)
if not exist "%PUBLISH_DIR%\.clasp.json" goto :initial_setup
goto :credentials_ready

:initial_setup
echo.
echo ========== ONE-TIME EXISTING GOOGLE SCRIPT SETUP ==========
echo Before continuing, enable Apps Script API:
echo https://script.google.com/home/usersettings
echo The Script ID is from Apps Script PROJECT SETTINGS.
echo It is NOT the public /exec deployment ID.
set "SETUP_OK="
set /p "SETUP_OK=Login and connect the existing GAS Script ID? Type YES: "
if /I not "%SETUP_OK%"=="YES" goto :cancel
call clasp.cmd login
if errorlevel 1 goto :failed
pushd "%PUBLISH_DIR%"
node scripts\setup_gas_local_bridge.mjs --connect
set "SETUP_RC=%ERRORLEVEL%"
popd
if not "%SETUP_RC%"=="0" goto :failed

:credentials_ready
rem The confirmed 2026-10-14 owner release is GAS @196 from main 600b992.
rem The bridge compares every source file to the real server before writing.
if not defined FM_WORKS_INITIAL_GAS_VERSION set "FM_WORKS_INITIAL_GAS_VERSION=196"
if not defined FM_WORKS_INITIAL_GAS_BASELINE_SHA set "FM_WORKS_INITIAL_GAS_BASELINE_SHA=600b99213a3de50234f09de673337d8a7cfe86ea"

echo [2/5] Reading latest main and the existing release pointer...
git -C "%PUBLISH_DIR%" fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main +refs/heads/deploy/gas-production:refs/remotes/origin/deploy/gas-production
if errorlevel 1 goto :failed
set "MAIN_SHA="
set "RELEASE_SHA="
for /f "delims=" %%H in ('git -C "%PUBLISH_DIR%" rev-parse refs/remotes/origin/main') do set "MAIN_SHA=%%H"
for /f "delims=" %%H in ('git -C "%PUBLISH_DIR%" rev-parse refs/remotes/origin/deploy/gas-production') do set "RELEASE_SHA=%%H"
if not defined MAIN_SHA goto :failed
if not defined RELEASE_SHA goto :failed
git -C "%PUBLISH_DIR%" merge-base --is-ancestor "%RELEASE_SHA%" "%MAIN_SHA%"
if errorlevel 1 (
 echo ERROR: The release pointer diverged from main.
 echo No GitHub or GAS changes were made.
 goto :failed
)

echo.
echo GitHub main: %MAIN_SHA%
echo Release request: %RELEASE_SHA%
echo [3/5] Checking the REAL existing GAS version and all source files...
echo This read-only preflight runs BEFORE any release request is pushed.
pushd "%PUBLISH_DIR%"
node scripts\gas_local_bridge.mjs --preflight-main
set "CHECK_RC=%ERRORLEVEL%"
popd
if not "%CHECK_RC%"=="0" (
 echo.
 echo STOPPED: Read-only preflight failed. No release request was pushed.
 echo Check the bridge message for the cause. Do not bypass file safety checks.
 goto :failed
)

echo.
echo [4/5] Confirming the manual release of this verified commit.
set "CONFIRM="
set /p "CONFIRM=Publish this GitHub main commit to the existing GAS URL? Type YES: "
if /I not "%CONFIRM%"=="YES" goto :cancel
if /I "%RELEASE_SHA%"=="%MAIN_SHA%" goto :approved_pointer
git -C "%PUBLISH_DIR%" push origin "%MAIN_SHA%:refs/heads/deploy/gas-production"
if errorlevel 1 goto :failed

:approved_pointer
echo [5/5] Local functional checks, clasp source push, existing URL update...
pushd "%PUBLISH_DIR%"
node scripts\gas_local_bridge.mjs --once
set "PUBLISH_RC=%ERRORLEVEL%"
popd
if not "%PUBLISH_RC%"=="0" goto :failed

echo.
echo Checking the GitHub receipt for the deployed source...
set "PUBLISHED_SHA="
for /f "tokens=1" %%H in ('git -C "%PUBLISH_DIR%" ls-remote origin refs/heads/deploy/gas-published') do set "PUBLISHED_SHA=%%H"
if /I not "%PUBLISHED_SHA%"=="%MAIN_SHA%" (
 echo WARNING: The published-source receipt does not match main.
 echo The GAS update may have succeeded, but confirmation is incomplete.
 echo Inspect the bridge state and GAS deployment version before retrying.
 goto :failed
)

echo.
echo SUCCESS: Existing FM WORKS GAS source and deployment were verified.
echo Browser login, DB reads/writes, and responsive UI still need real checks.
echo Existing URL:
echo https://script.google.com/macros/s/AKfycbw7oWIZkrOE-ClTVNeI0Kq4hzsZrYaKSC0CqNVsV4bwpufgBVR5-7MYxVEuj_51A9YgvQ/exec
goto :finished

:dirty
echo ERROR: Local tracked files were edited. Nothing was overwritten.
goto :failed
:need_git
echo ERROR: Install Git for Windows: https://git-scm.com/downloads/win
goto :failed
:need_node
echo ERROR: Node.js 20+ is needed: https://nodejs.org/
goto :failed
:need_clasp
echo ERROR: Install Google clasp: npm install -g @google/clasp@3.4.1
goto :failed
:need_clasp_v3
echo ERROR: clasp v3 with update-deployment is required.
echo Run in PowerShell: npm install -g @google/clasp@3.4.1
goto :failed
:cancel
echo CANCELED: Nothing was published by this invocation.
goto :finished
:failed
echo.
echo STOPPED: GAS deployment was not confirmed. Do NOT retry blindly after a push.
echo Keep OAuth tokens and employee data private if sharing error output.
pause
exit /b 1
:finished
echo.
pause
exit /b 0
