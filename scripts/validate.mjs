import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd());
const required = [
  'src/appsscript.json','src/Code.gs','src/Auth.gs','src/Worklog.gs','src/Requests.gs','src/Monthly.gs','src/Employees.gs','src/Search.gs','src/Notifications.gs','src/Maintenance.gs','src/Holidays.gs','src/Projects.gs','src/Index.html','src/Styles.html','src/App.html',
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
for (const label of ['ホーム','勤怠','工数','予定表','会社カレンダー','申請','社員','月次','管理']) {
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
for (const serverFile of ['Code.gs','Auth.gs','Worklog.gs','Requests.gs','Monthly.gs','Employees.gs','Search.gs','Notifications.gs','Maintenance.gs','Holidays.gs','Projects.gs']) {
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
  "cfg.prototypeMode?escapeHtml(cfg.prototypePin||'000000')"
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
for (const requiredHandler of ['syncRequestDates','openMobileDrawer','runConfirmAction','runReasonAction','closeMonthly','reopenMonthly']) {
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
for (const file of ['Code.gs','Auth.gs','Worklog.gs','Requests.gs','Monthly.gs','Employees.gs','Search.gs','Notifications.gs','Maintenance.gs','Holidays.gs']) {
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

const manifest = JSON.parse(fs.readFileSync(path.join(root,'src/appsscript.json'),'utf8'));
if (authCode.includes('prototypeMode: true')) {
  for (const prototypeAuthMarker of [
    "prototypePin: '000000'",
    "prototypeEmployeeIds: ['FM0001','FM0002','FM0003','FM0004','FM0005']",
    'function isPrototypeLogin_(',
    'function setPrototypeMode(sessionToken, enabled)',
    "saveSettings_({PROTOTYPE_MODE:'FALSE'})",
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
  'getRange(rowNumber, 1, 1, 10).getValues()[0]',
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
