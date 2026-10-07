import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd());
const required = [
  'src/appsscript.json','src/Code.gs','src/Auth.gs','src/Worklog.gs','src/Requests.gs','src/Monthly.gs','src/Employees.gs','src/Search.gs','src/Notifications.gs','src/Maintenance.gs','src/Holidays.gs','src/Projects.gs','src/Docs.gs','src/GeneratedDocs.gs','src/Index.html','src/Styles.html','src/App.html','docs/REQUIREMENTS.md','docs/TECHNICAL_DESIGN.md',
  '.github/workflows/ci.yml','.github/workflows/deploy.yml','docs/SETUP.md'
];
let failed = false;
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full) || fs.statSync(full).size === 0) {
    console.error(`Missing or empty: ${file}`); failed = true;
  }
}
const app = fs.readFileSync(path.join(root,'src/App.html'),'utf8');
const styles = fs.readFileSync(path.join(root,'src/Styles.html'),'utf8');
for (const label of ['ホーム','勤怠','工数','予定表','会社カレンダー','申請','社員','月次','設定']) {
  if (!app.includes(label)) { console.error(`Navigation label missing: ${label}`); failed = true; }
}
try {
  const js = app.replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
  const temp = path.join(os.tmpdir(), 'fmworks-app-check.js');
  fs.writeFileSync(temp, js);
  execFileSync(process.execPath, ['--check', temp], { stdio: 'pipe' });
} catch (err) {
  console.error('Client JavaScript syntax error:');
  console.error(String(err.stderr || err.message || err));
  failed = true;
}
for (const serverFile of ['Code.gs','Auth.gs','Worklog.gs','Requests.gs','Monthly.gs','Employees.gs','Search.gs','Notifications.gs','Maintenance.gs','Holidays.gs','Projects.gs','Docs.gs','GeneratedDocs.gs']) {
  try {
    const server = fs.readFileSync(path.join(root,'src',serverFile),'utf8');
    new Function(server);
  } catch (err) {
    console.error(`Server JavaScript syntax error in ${serverFile}:`, err.message);
    failed = true;
  }
}
const serverCode = fs.readFileSync(path.join(root,'src/Code.gs'),'utf8');
const authCode = fs.readFileSync(path.join(root,'src/Auth.gs'),'utf8');
for (const requiredPermissionMarker of [
  "assertPermission_(employee, 'companyCalendarEdit')",
  "COMPANY_CALENDAR_EDIT_ROLES"
]) {
  if (!serverCode.includes(requiredPermissionMarker)) {
    console.error(`Permission enforcement missing: ${requiredPermissionMarker}`);
    failed = true;
  }
}
for (const requiredUiMarker of ['canEditCompanyCalendar', '閲覧専用']) {
  if (!app.includes(requiredUiMarker)) {
    console.error(`Read-only company calendar UI missing: ${requiredUiMarker}`);
    failed = true;
  }
}
for (const authMarker of [
  'function login(',
  'function requireSession_(',
  'function initializeFirstAdmin(',
  'function changeOwnPin(',
  'function adminSetTemporaryPin(',
  'computeHmacSha256Signature',
  'FM_WORKS_AUTH_PEPPER'
]) {
  if (!authCode.includes(authMarker)) {
    console.error(`Auth implementation missing: ${authMarker}`);
    failed = true;
  }
}
for (const protectedMarker of [
  'function recordPunch(sessionToken',
  'function getScheduleBundle(sessionToken',
  'function saveSchedule(sessionToken',
  'function getCompanyCalendar(sessionToken'
]) {
  if (!serverCode.includes(protectedMarker)) {
    console.error(`Protected API missing session argument: ${protectedMarker}`);
    failed = true;
  }
}
for (const uiMarker of ['renderLogin', 'performLogout', 'openChangePinModal', 'openPinHelpModal']) {
  if (!app.includes(uiMarker)) {
    console.error(`Login UI missing: ${uiMarker}`);
    failed = true;
  }
}
for (const dataMarker of ['loadWorklogs','loadRequests','loadMonthly','saveEmployeeFromModal']) {
  if (!app.includes(dataMarker)) {
    console.error(`Live module UI missing: ${dataMarker}`);
    failed = true;
  }
}
for (const performanceMarker of [
  'const PAGE_CACHE_TTL=',
  'function startMenuPrefetch()',
  'function cacheFresh(',
  'requestIdleCallback',
  'function loadHomeOverview(',
  'reloadRequested:false',
  "error:''",
  "getHomeOverview(state.sessionToken)",
  '.getRequestsBundle(state.sessionToken)',
  "invalidatePageCache('worklog','monthly')"
]) {
  if (!app.includes(performanceMarker)) {
    console.error(`Navigation performance optimization missing: ${performanceMarker}`);
    failed = true;
  }
}
const initialDataStart = serverCode.indexOf('function getInitialData(sessionToken)');
const initialDataEnd = serverCode.indexOf('\nfunction getHomeOverview(', initialDataStart);
const initialDataBlock = initialDataStart >= 0 && initialDataEnd > initialDataStart
  ? serverCode.slice(initialDataStart, initialDataEnd)
  : '';
if (!initialDataBlock) {
  console.error('Fast initial shell function could not be isolated.');
  failed = true;
} else {
  for (const forbiddenInitialCall of ['getMonthlySummary(', 'getRequests(']) {
    if (initialDataBlock.includes(forbiddenInitialCall)) {
      console.error('Initial shell must not block on heavy overview work: ' + forbiddenInitialCall);
      failed = true;
    }
  }
  if (!initialDataBlock.includes('includeEmployees: false')) {
    console.error('Initial schedule read must avoid re-reading the employee master.');
    failed = true;
  }
}
for (const performanceServerMarker of [
  'function getHomeOverview(sessionToken)',
  'getPendingRequestCount_(employee)',
  "params.includeEmployees === false ? [] : getEmployees_()"
]) {
  if (!(serverCode + fs.readFileSync(path.join(root,'src/Requests.gs'),'utf8')).includes(performanceServerMarker)) {
    console.error('v0.8.2 performance server marker missing: ' + performanceServerMarker);
    failed = true;
  }
}
for (const resilienceMarker of [
  'function liveWorkedText(',
  'function startLiveAttendanceTicker()',
  'function initGlobalKeyboardShortcuts()',
  'function homeOverviewError()',
  "loadHomeOverview({force:true})"
]) {
  if (!app.includes(resilienceMarker)) {
    console.error('v0.8.3 resilience/interaction marker missing: ' + resilienceMarker);
    failed = true;
  }
}
if (!serverCode.includes('serverTime: new Date().toISOString()')) {
  console.error('Punch response must refresh the live attendance time anchor.');
  failed = true;
}
if (!styles.includes('.home-overview-error')) {
  console.error('Home overview failure must have a persistent inline recovery state.');
  failed = true;
}

if (!app.includes("if(options.force)state.homeOverview.reloadRequested=true") ||
    !app.includes("if(rerun){") ||
    !app.includes("flushHomeOverviewCallbacks_")) {
  console.error('Home overview refresh must survive overlapping force reloads without stale overwrite.');
  failed = true;
}
if (!app.includes("state.adminTab==='operation'))loadMaintenance")) {
  console.error('Admin data load must not fetch maintenance outside the operation tab.');
  failed = true;
}
if (!app.includes("scheduleIdleTask(()=>loadNotifications(),900)") || !app.includes("scheduleIdleTask(()=>loadHomeOverview(),420)")) {
  console.error('Authenticated startup must stage noncritical calls after first paint.');
  failed = true;
}

if (!fs.readFileSync(path.join(root,'src/Requests.gs'),'utf8').includes('function getRequestsBundle(sessionToken)')) {
  console.error('Request page must use a single bundled server read.');
  failed = true;
}
for (const requestUxMarker of [
  'const REQUEST_UI=',
  "id='requestFormError'",
  'function showRequestError(',
  'function refreshRequestPreview(',
  '何を申請しますか？',
  '申請可能残'
]) {
  if (!app.includes(requestUxMarker)) {
    console.error(`Request UX regression: ${requestUxMarker}`);
    failed = true;
  }
}
for (const requestServerMarker of [
  'function getLeaveRequestContext_(',
  'function previewRequest(sessionToken, payload)',
  'availableLeaveDays',
  '承認待ちを含む申請可能残数'
]) {
  if (!fs.readFileSync(path.join(root,'src/Requests.gs'),'utf8').includes(requestServerMarker)) {
    console.error(`Request leave-balance control missing: ${requestServerMarker}`);
    failed = true;
  }
}
if (!styles.includes('z-index:140')) {
  console.error('Global toast must stay visible above modal backdrops.');
  failed = true;
}
if (!styles.includes('.request-form-error.show{display:grid}')) {
  console.error('Request errors must render inside the request modal.');
  failed = true;
}
if (serverCode.includes('return getInitialData(sessionToken);')) {
  console.error('Punch writes must not block on a full application reload.');
  failed = true;
}
for (const scheduleIdentityMarker of [
  'function eventPeopleLabel(',
  'function schedulePeopleLegend(',
  "class='schedule-event-owner'",
  "class='person-avatar'",
  '社員名を予定カードに直接表示'
]) {
  if (!app.includes(scheduleIdentityMarker)) {
    console.error(`Schedule owner identity UI missing: ${scheduleIdentityMarker}`);
    failed = true;
  }
}
for (const registeredCalendarMarker of [
  'function getCompanyCalendarYears_()',
  'availableYears: availableYears',
  'nextCreatableYear: nextCreatableYear'
]) {
  if (!serverCode.includes(registeredCalendarMarker)) {
    console.error(`Registered-year calendar control missing: ${registeredCalendarMarker}`);
    failed = true;
  }
}
for (const registeredCalendarUiMarker of [
  'function companyYearToolbar()',
  '未作成の年度は「作成」を実行するまで表示されません。',
  'function generateCompanyCalendarYear(targetYear)'
]) {
  if (!app.includes(registeredCalendarUiMarker)) {
    console.error(`Company calendar registered-year UI missing: ${registeredCalendarUiMarker}`);
    failed = true;
  }
}

for (const uiMarker of ['performGlobalSearch','toggleNotificationMenu','renderLogin','openPinHelpModal']) {
  if (!app.includes(uiMarker)) {
    console.error(`Required interactive UI missing: ${uiMarker}`);
    failed = true;
  }
}

for (const compactLoginMarker of [
  "document.body.classList.add('login-mode')",
  "document.body.classList.remove('login-mode')",
  "prototypeMode?'試作版ログイン'",
  "cfg.prototypeMode?escapeHtml(cfg.prototypePin||'000000')",
  "function getStoredSessionToken()",
  "localStorage.getItem('fmworks.session')",
  "この端末でログイン状態を保持する（30日）"
]) {
  if (!app.includes(compactLoginMarker)) {
    console.error(`Compact prototype login UI missing: ${compactLoginMarker}`);
    failed = true;
  }
}
for (const compactLoginStyleMarker of [
  '.login-mode{overflow:hidden!important',
  '.login-shell{height:100svh;min-height:0',
  'height:min(590px,calc(100svh - 24px))',
  '@media(max-height:560px) and (max-width:900px)'
]) {
  if (!styles.includes(compactLoginStyleMarker)) {
    console.error(`Single-viewport login style missing: ${compactLoginStyleMarker}`);
    failed = true;
  }
}
const searchCode = fs.readFileSync(path.join(root,'src/Search.gs'),'utf8');
const notificationCode = fs.readFileSync(path.join(root,'src/Notifications.gs'),'utf8');
if (!searchCode.includes('requireSession_(') || !notificationCode.includes('requireSession_(')) {
  console.error('Search/notification APIs must require an authenticated session');
  failed = true;
}
const worklogCode = fs.readFileSync(path.join(root,'src/Worklog.gs'),'utf8');
const requestCode = fs.readFileSync(path.join(root,'src/Requests.gs'),'utf8');
const employeeCode = fs.readFileSync(path.join(root,'src/Employees.gs'),'utf8');
const monthlyCode = fs.readFileSync(path.join(root,'src/Monthly.gs'),'utf8');

for (const [label, source, requiredMarkers] of [
  ['request concurrency', requestCode, ['withScriptLock_', "['APPROVE','REJECT']"]],
  ['worklog audit preservation', worklogCode, ["r[12] !== '削除'", "'削除', nowText", 'withScriptLock_']],
  ['employee concurrency', employeeCode, ['withScriptLock_', '標準勤務終了時刻は開始時刻より後']],
  ['monthly attendance integrity', monthlyCode, ["r[12]!=='削除'", 'missingAllPunches', 'lateEarlyMinutes', 'absenceDays']],
  ['request integrity', requestCode, ['assertNoLeaveConflict_', 'preparePunchCorrection_', 'validatePunchSequence_', 'assertMonthRangeOpen_']],
  ['worklog overlap protection', worklogCode, ['assertNoWorklogOverlap_', 'assertMonthOpenForDate_']],
  ['punch correction resolution', serverCode, ['getActivePunchRows_', 'superseded.has', 'validatePunchSequence_']],
  ['schedule permissions', serverCode, ['canEditLegacyOwn', 'canEdit: viewer.role', 'withScriptLock_', 'const oldSource = old[16]']]
]) {
  for (const item of requiredMarkers) {
    if (!source.includes(item)) {
      console.error(`Regression guard failed (${label}): ${item}`);
      failed = true;
    }
  }
}

const definedClientFunctions = new Set([...app.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
const allowedHandlerGlobals = new Set(['if','navigator']);
const handlerPattern = /(?:onclick|onchange|onsubmit)=["']([A-Za-z_$][\w$]*)\s*\(/g;
for (const match of app.matchAll(handlerPattern)) {
  const name = match[1];
  if (!allowedHandlerGlobals.has(name) && !definedClientFunctions.has(name)) {
    console.error(`Undefined UI event handler: ${name}`);
    failed = true;
  }
}
for (const requiredHandler of ['syncRequestDates','openMobileDrawer','runConfirmAction','runReasonAction','closeMonthly','reopenMonthly','confirmMonthlyReviewFromPage','setAdminTab','toggleTheme','projectAdminSection','openProjectModal','saveProjectFromModal','loadHomeOverview']) {
  if (!definedClientFunctions.has(requiredHandler)) {
    console.error(`Required client function missing: ${requiredHandler}`);
    failed = true;
  }
}

for (const forbidden of ['confirm(', 'prompt(', 'demoAction', 'TODO', 'FIXME']) {
  if (app.includes(forbidden)) {
    console.error(`Forbidden production UI marker found: ${forbidden}`);
    failed = true;
  }
}
if (serverCode.includes("const source = old[16] || ''")) {
  console.error('Schedule edit regression: block-scoped source shadow would break existing schedule updates.');
  failed = true;
}
if (worklogCode.includes('deleteRow(')) {
  console.error('Worklog must use soft-delete, not deleteRow().');
  failed = true;
}
const maintenanceCode = fs.readFileSync(path.join(root,'src/Maintenance.gs'),'utf8');
for (const requiredMaintenanceMarker of [
  'function getSystemStatus(sessionToken)',
  'function getAuditLogs(sessionToken',
  'function createManualBackup(sessionToken)',
  'function setDailyBackupEnabled(sessionToken',
  "autoBackupProperty: 'FM_WORKS_AUTO_BACKUP'",
  'function ensureDailyBackup(sessionToken)',
  'function getProductionReadiness_()',
  'backupRetentionDays: 90',
  'requireAdminSession_(sessionToken)'
]) {
  if (!maintenanceCode.includes(requiredMaintenanceMarker)) {
    console.error(`Maintenance implementation missing: ${requiredMaintenanceMarker}`);
    failed = true;
  }
}
for (const uiMarker of ['loadMaintenance','createBackupNow','toggleDailyBackup','openMobileDrawer','switchToProductionMode']) {
  if (!app.includes(uiMarker)) {
    console.error(`Production administration UI missing: ${uiMarker}`);
    failed = true;
  }
}
const holidayCode = fs.readFileSync(path.join(root,'src/Holidays.gs'),'utf8');
for (const holidayMarker of [
  "2027-03-22':'振替休日'",
  "2027-09-23':'秋分の日'",
  'function generateStandardCompanyCalendarYear(sessionToken',
  'requiresCompanyReview: true'
]) {
  if (!holidayCode.includes(holidayMarker)) {
    console.error(`Holiday calendar implementation missing: ${holidayMarker}`);
    failed = true;
  }
}
if (maintenanceCode.includes('ScriptApp.newTrigger') || maintenanceCode.includes('getProjectTriggers')) {
  console.error('Maintenance must not require installable-trigger authorization in zero-touch deployment.');
  failed = true;
}
if (requestCode.includes('setValue(true)') && requestCode.includes('修正対象')) {
  console.error('Punch correction must not mutate the original punch row.');
  failed = true;
}
if (!app.includes('generateCompanyCalendarYear')) {
  console.error('Company calendar generation UI missing');
  failed = true;
}
const employeeCodeAll = fs.readFileSync(path.join(root,'src/Employees.gs'),'utf8');
const authCodeAll = fs.readFileSync(path.join(root,'src/Auth.gs'),'utf8');
const monthlyCodeAll = fs.readFileSync(path.join(root,'src/Monthly.gs'),'utf8');
const requestCodeAll = fs.readFileSync(path.join(root,'src/Requests.gs'),'utf8');
const codeAll = fs.readFileSync(path.join(root,'src/Code.gs'),'utf8');

for (const markerText of [
  'createTeamMonthlyExport',
  'getPayrollEmployees_',
  '給与集計対象',
  'assertMonthlyReadyForExport_',
  'inferLegacyLeaveLabel_',
  "1/4日有給"
]) {
  if (!(monthlyCodeAll + requestCodeAll + app + authCodeAll + codeAll).includes(markerText)) {
    console.error(`Payroll/leave production feature missing: ${markerText}`);
    failed = true;
  }
}
if (!employeeCodeAll.includes('payrollIncluded') || !authCodeAll.includes('payrollIncluded') || !codeAll.includes('payrollIncluded')) {
  console.error('Payroll inclusion is not propagated through employee data.');
  failed = true;
}
if (!app.includes('step="0.25"') || !app.includes('empPayroll')) {
  console.error('Employee UI must preserve quarter-day leave and payroll scope.');
  failed = true;
}
if (!monthlyCodeAll.includes('function createMonthlyExport(sessionToken') ||
    !monthlyCodeAll.slice(monthlyCodeAll.indexOf('function createMonthlyExport'), monthlyCodeAll.indexOf('function createTeamMonthlyExport')).includes('requireSession_(sessionToken)')) {
  console.error('Single monthly export must authenticate at its entrypoint.');
  failed = true;
}

const publicAuthWhitelist = new Set(['getPublicAuthConfig','initializeFirstAdmin','login','logout','requestPinHelp']);
for (const file of ['Code.gs','Auth.gs','Worklog.gs','Requests.gs','Monthly.gs','Employees.gs','Search.gs','Notifications.gs','Maintenance.gs','Holidays.gs','Docs.gs']) {
  const source = fs.readFileSync(path.join(root,'src',file),'utf8');
  const matches = [...source.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/gm)];
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1];
    if (name.endsWith('_') || name === 'doGet' || publicAuthWhitelist.has(name)) continue;
    const body = source.slice(matches[i].index, i + 1 < matches.length ? matches[i + 1].index : source.length);
    if (!/require(Session|AdminSession)_\(/.test(body)) {
      console.error(`Public server function lacks explicit authentication: ${file} / ${name}`);
      failed = true;
    }
  }
}
const projectsCode = fs.readFileSync(path.join(root,'src/Projects.gs'),'utf8');
for (const projectMarker of [
  'function getProjectsInternal_(',
  'function saveProject(sessionToken',
  'PROJECT_STATUS',
  'nextProjectId_'
]) {
  if (!projectsCode.includes(projectMarker)) {
    console.error(`Project master implementation missing: ${projectMarker}`);
    failed = true;
  }
}
for (const integrationMarker of [
  "projects: 'プロジェクト'",
  "monthlyClose: '月次締め'",
  "monthlyReview: '月次確認'",
  'projects: getProjectsInternal_(false)'
]) {
  if (!serverCode.includes(integrationMarker)) {
    console.error(`Project master integration missing: ${integrationMarker}`);
    failed = true;
  }
}
for (const worklogMarker of ['getProjectByName_', "status !== '進行中'"]) {
  if (!worklogCode.includes(worklogMarker)) {
    console.error(`Worklog project validation missing: ${worklogMarker}`);
    failed = true;
  }
}
for (const operationalMonthlyMarker of [
  'function requiredBreakMinutes_(',
  'function calculateBreakMinutesForRows_(',
  'worklogMismatchDays',
  '休憩不足',
  'function closeMonthlyPeriod(sessionToken',
  'function reopenMonthlyPeriod(sessionToken',
  'function assertMonthOpenForDate_(',
  'closeStatus:getMonthlyCloseStatusInternal_(ym)'
]) {
  if (!monthlyCode.includes(operationalMonthlyMarker)) {
    console.error(`Operational monthly control missing: ${operationalMonthlyMarker}`);
    failed = true;
  }
}
for (const monthlyMarker of ['function createTeamMonthlyExport(', 'function getPayrollEmployees_(', 'assertMonthlyReadyForExport_']) {
  if (!monthlyCode.includes(monthlyMarker)) {
    console.error(`Payroll team export missing: ${monthlyMarker}`);
    failed = true;
  }
}
if (!requestCode.includes("'1/4日有給'") || !employeeCode.includes('Math.round(parsedLeave * 4) / 4')) {
  console.error('Quarter-day paid leave support is incomplete.');
  failed = true;
}
const demoIdentitySources = [
  ['UI', app],
  ['README', fs.readFileSync(path.join(root,'README.md'),'utf8')],
  ['SETUP', fs.readFileSync(path.join(root,'docs/SETUP.md'),'utf8')],
  ['Code.gs', fs.readFileSync(path.join(root,'src/Code.gs'),'utf8')],
  ['Auth.gs', authCode],
  ['Worklog.gs', worklogCode],
  ['Requests.gs', requestCode],
  ['Employees.gs', employeeCode],
  ['Projects.gs', fs.readFileSync(path.join(root,'src/Projects.gs'),'utf8')]
];
const forbiddenRealDemoTerms = [
  '会津屋','ラクッショ','キキラク','CoDoNa',
  '坂井','池田','金子','五十嵐','達哉','弘典','裕也','舩山',
  '丸栄','MARUEI','INSIGHT LAB','イデアル','旅人屋','まいぷれ'
];
for (const forbiddenRealData of forbiddenRealDemoTerms) {
  for (const [label, source] of demoIdentitySources) {
    if (source.includes(forbiddenRealData)) {
      console.error(`Real demo-identifying term remains in ${label}: ${forbiddenRealData}`);
      failed = true;
    }
  }
}
const readmeDemoSource = demoIdentitySources.find(([label]) => label === 'README')[1];
for (const requiredFictionalDemoTerm of [
  '青木 悠真','森川 彩乃','神谷 直人','小林 美月','中村 健太',
  'Project Atlas','Project Nova','Project Orion','Project Bloom','Project Vega','Project Aurora','Internal Works'
]) {
  if (!readmeDemoSource.includes(requiredFictionalDemoTerm)) {
    console.error(`Fictional demo identity/project documentation missing: ${requiredFictionalDemoTerm}`);
    failed = true;
  }
}
for (const [label, source] of [
  ['employees', employeeCode],
  ['worklogs', worklogCode],
  ['requests', requestCode],
  ['projects', projectsCode],
  ['auth', authCode]
]) {
  if (!source.includes('safeSheetText_(')) {
    console.error(`Spreadsheet text sanitization missing from ${label}`);
    failed = true;
  }
}

const docsCode = fs.readFileSync(path.join(root,'src/Docs.gs'),'utf8');
const requirementsDoc = fs.readFileSync(path.join(root,'docs/REQUIREMENTS.md'),'utf8');
const technicalDoc = fs.readFileSync(path.join(root,'docs/TECHNICAL_DESIGN.md'),'utf8');
const appVersion = (serverCode.match(/version:\s*'([^']+)'/) || [,''])[1];

for (const [label, doc] of [['要件定義書',requirementsDoc],['技術設計書',technicalDoc]]) {
  if (!doc.includes('**文書版:** ' + appVersion)) {
    console.error(label + ' version must match APP.version ' + appVersion);
    failed = true;
  }
}

for (const marker of [
  "monthlyReview: '月次確認'",
  'getMonthlyReviewPrompt_(employee.employeeId)'
]) {
  if (!serverCode.includes(marker)) {
    console.error('Monthly review integration missing: ' + marker);
    failed = true;
  }
}

for (const marker of [
  'function confirmMonthlyReview(sessionToken',
  'function getMonthlyReviewPrompt_(',
  'function getMonthlyReviewHistoryInternal_(',
  'function getLatestMonthlyDataUpdateMap_(',
  'function yearMonthsBetween_(',
  'pendingCount:outstanding.length',
  'isBacklog:isBacklog',
  'reviewStatus:ym<systemToday.slice(0,7)?getMonthlyReviewStatusInternal_(ym,targetId):null'
]) {
  if (!monthlyCode.includes(marker)) {
    console.error('Monthly review implementation missing: ' + marker);
    failed = true;
  }
}

for (const marker of [
  'function globalActionBanners()',
  'function syncGlobalActionBanner()',
  'function loadHomeOverview(',
  'function homeMetricInline(',
  'function homeScheduleRows(',
  'function homeTaskRows(',
  "const backlog=!!r.isBacklog",
  'function monthlyCalendarView(',
  'function confirmMonthlyReviewFromPage()',
  'function loadSystemDocument(',
  'function projectAdminSection()',
  'function openProjectModal(',
  'function saveProjectFromModal(',
  '要件定義書',
  '技術設計書',
  'function toggleTheme()'
]) {
  if (!app.includes(marker)) {
    console.error('Required v0.8 UI missing: ' + marker);
    failed = true;
  }
}

for (const marker of [
  'html[data-theme="dark"]',
  '.global-caution',
  '.monthly-calendar',
  '.settings-tabs',
  '.home-commandbar',
  '.home-dashboard',
  '.home-panel-scroll',
  'cursor:pointer'
]) {
  if (!styles.includes(marker)) {
    console.error('Required v0.8 style missing: ' + marker);
    failed = true;
  }
}

if (!app.includes("loadSystemDocument('${type}',{force:true})")) {
  console.error('Design document reload button must bypass the client cache.');
  failed = true;
}
if (!app.includes("本人確認が${review.stale?'再度必要です':'未完了です'}")) {
  console.error('Admin monthly view must expose the selected employee review status.');
  failed = true;
}

if (!app.includes("content.classList.toggle('one-screen',['home','monthly','admin'].includes(state.page))")) {
  console.error('Desktop home must opt into the one-screen layout.');
  failed = true;
}
if (!styles.includes('@media(max-width:900px){.home-screen{height:auto}')) {
  console.error('Home dashboard must fall back to normal scrolling on tablet/mobile.');
  failed = true;
}
if (!styles.includes('@media(max-height:760px) and (min-width:901px)')) {
  console.error('Home dashboard needs a compact desktop mode for shorter viewports.');
  failed = true;
}
for (const homeFlowMarker of [
  'homePunchHistory(a)',
  "navigate('attendance')",
  "navigate('schedule')",
  "navigate('worklog')",
  "navigate('requests')",
  "navigate('monthly')"
]) {
  if (!app.includes(homeFlowMarker)) {
    console.error('Single-screen home lost a required workflow: ' + homeFlowMarker);
    failed = true;
  }
}

if (!docsCode.includes('requireAdminSession_(sessionToken)')) {
  console.error('Design documents must be ADMIN-only.');
  failed = true;
}
if (!requirementsDoc.includes('文書同期ルール') || !technicalDoc.includes('文書同期CI')) {
  console.error('Design document synchronization policy missing.');
  failed = true;
}

const manifest = JSON.parse(fs.readFileSync(path.join(root,'src/appsscript.json'),'utf8'));
if (authCode.includes('prototypeMode: true')) {
  for (const prototypeAuthMarker of [
    "prototypePin: '000000'",
    "prototypeEmployeeIds: ['FM0001','FM0002','FM0003','FM0004','FM0005']",
    'function isPrototypeLogin_(',
    'function setPrototypeMode(sessionToken, enabled)',
    "saveSettings_({PROTOTYPE_MODE:'FALSE'})",
    'rememberSessionHours',
    'rememberIdleMinutes',
    'createSession_(record, clientInfo, keepSignedIn)',
    'mustChangePin: prototypeAccess ? false : record.mustChangePin'
  ]) {
    if (!authCode.includes(prototypeAuthMarker)) {
      console.error(`Prototype authentication guard missing: ${prototypeAuthMarker}`);
      failed = true;
    }
  }
  if (!manifest.webapp || manifest.webapp.access !== 'MYSELF') {
    console.error('Prototype PIN must never be enabled when the web app is accessible beyond MYSELF.');
    failed = true;
  }
}
for (const sessionMarker of [
  'getRange(rowNumber, 1, 1, 11).getValues()[0]',
  'value instanceof Date',
  '(\\d{1,2}):(\\d{1,2})'
]) {
  if (!authCode.includes(sessionMarker)) {
    console.error(`Robust session timestamp handling missing: ${sessionMarker}`);
    failed = true;
  }
}
if (!manifest.webapp || manifest.webapp.access !== 'MYSELF') {
  console.error('Pre-release safety gate: web app access must remain MYSELF until human acceptance testing is explicitly started.');
  failed = true;
}
if (manifest.webapp.executeAs !== 'USER_DEPLOYING') {
  console.error('Web app must execute as USER_DEPLOYING.');
  failed = true;
}
if (manifest.runtimeVersion !== 'V8') { console.error('Apps Script runtime must be V8'); failed = true; }
if (!manifest.webapp || manifest.webapp.access !== 'MYSELF' || manifest.webapp.executeAs !== 'USER_DEPLOYING') {
  console.error('Apps Script webapp manifest configuration is missing or unsafe for current test mode');
  failed = true;
}
if (failed) process.exit(1);
console.log('FM WORKS scaffold validation passed.');
