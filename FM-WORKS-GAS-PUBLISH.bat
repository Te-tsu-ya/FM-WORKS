@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title FM WORKS - Publish latest GitHub main to existing GAS

echo ======================================================
echo  FM WORKS - Manual GAS publish (GitHub Actions: OFF)
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
if exist "%REPO%scripts\gas_local_bridge.mjs" goto REPO_FOUND
set "REPO=%USERPROFILE%\FM-WORKS-PUBLISHER\"
if exist "%REPO%scripts\gas_local_bridge.mjs" goto REPO_FOUND

echo [INFO] One-time GitHub download into "%REPO%".
echo [INFO] Your GitHub authentication may open in the browser.
git clone --branch main --single-branch https://github.com/Te-tsu-ya/FM-WORKS.git "%REPO%"
if errorlevel 1 goto ERROR
if not exist "%REPO%scripts\gas_local_bridge.mjs" goto ERROR

:REPO_FOUND
pushd "%REPO%"
if errorlevel 1 goto ERROR

for /f "delims=" %%A in ('git branch --show-current') do set "BRANCH=%%A"
if /i not "%BRANCH%"=="main" goto WRONG_BRANCH

set "ORIGIN_OK=0"
for /f "delims=" %%A in ('git remote get-url origin') do set "ORIGIN_URL=%%A"
if /i "%ORIGIN_URL%"=="https://github.com/Te-tsu-ya/FM-WORKS.git" set "ORIGIN_OK=1"
if /i "%ORIGIN_URL%"=="https://github.com/Te-tsu-ya/FM-WORKS" set "ORIGIN_OK=1"
if /i "%ORIGIN_URL%"=="git@github.com:Te-tsu-ya/FM-WORKS.git" set "ORIGIN_OK=1"
if /i "%ORIGIN_URL%"=="ssh://git@github.com/Te-tsu-ya/FM-WORKS.git" set "ORIGIN_OK=1"
if not "%ORIGIN_OK%"=="1" goto WRONG_ORIGIN

set "DIRTY=0"
for /f "delims=" %%A in ('git status --porcelain') do set "DIRTY=1"
if "%DIRTY%"=="1" goto DIRTY_REPO

echo [1/4] Fetching latest approved main (no GitHub Actions)...
git fetch --no-tags origin main
if errorlevel 1 goto ERROR_POP
git merge --ff-only origin/main
if errorlevel 1 goto ERROR_POP

for /f "delims=" %%A in ('git rev-parse HEAD') do set "FM_WORKS_MANUAL_EXPECTED_SHA=%%A"
set "SHA=%FM_WORKS_MANUAL_EXPECTED_SHA:~0,12%"
echo [INFO] Target GitHub commit: %SHA%

if not exist ".clasp.json" goto NEED_SETUP

echo [2/4] Read-only verification of existing GAS and deployment...
node scripts\gas_local_bridge.mjs --preflight-main
if errorlevel 1 goto PREFLIGHT_FAILED

echo [3/4] Existing GAS target verified. No new web-app URL will be created.
echo [WARNING] This publishes the latest main to your existing GAS /exec URL.
choice /C YN /N /M "Publish %SHA% now? [Y/N] "
if errorlevel 2 goto CANCEL

echo [4/4] Running local checks and updating existing GAS deployment...
node scripts\gas_local_bridge.mjs --deploy-main
if errorlevel 1 goto ERROR_POP

echo.
echo [SUCCESS] Local publisher completed. Verify the same GAS /exec URL in a browser.
echo [NOTICE] Publishing source is not the same as verifying login and DB operations.
goto DONE

:NEED_SETUP
echo.
echo [STOP] First-time Google clasp setup is not finished.
echo Run FM-WORKS-GAS-SETUP.bat once, then run this publisher again.
goto ERROR_POP

:PREFLIGHT_FAILED
echo.
echo [STOP] GAS preflight refused this release. Nothing was pushed by this batch.
echo Check your local baseline/Google login and any previous pending release.
echo Never bypass the remote source or deployment-version mismatch.
goto ERROR_POP

:WRONG_BRANCH
echo [STOP] This local checkout is not on main. No changes were made.
goto ERROR_POP

:WRONG_ORIGIN
echo [STOP] This checkout is not the expected Te-tsu-ya/FM-WORKS GitHub remote.
goto ERROR_POP

:DIRTY_REPO
echo [STOP] Local files differ from GitHub. Commit, stash or use a separate clean publisher clone.
goto ERROR_POP

:CANCEL
echo [CANCELLED] GAS was not changed.
popd
pause
exit /b 0

:NO_GIT
echo [STOP] Install Git for Windows and reopen this batch.
goto ERROR
:NO_NODE
echo [STOP] Install Node.js 20 or newer and reopen this batch.
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
echo [FAILED] GAS publication is not confirmed. Read the message above.
pause
exit /b 1
:DONE
popd
echo.
pause
exit /b 0
