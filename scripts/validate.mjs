import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd());
const required = [
  'src/appsscript.json','src/Code.gs','src/AnnualLeaveAutomation.gs','src/Auth.gs','src/Worklog.gs','src/Requests.gs','src/Monthly.gs','src/MonthlySnapshot.gs','src/LeaveLedger.gs','src/Labor.gs','src/Schema.gs','src/DataAccess.gs','src/Employees.gs','src/Search.gs','src/Notifications.gs','src/Maintenance.gs','src/Holidays.gs','src/Projects.gs','src/Docs.gs','src/GeneratedDocs.gs','src/Index.html','src/Styles.html','src/App.html','src/AppCore.html','src/AppHomePortal.html','src/AppOperations.html','src/AppPeopleMonthly.html','src/AppLeaveDemo.html','src/AppAdmin.html','src/AppShell.html','docs/REQUIREMENTS.md','docs/TECHNICAL_DESIGN.md',
  '.github/workflows/ci.yml','.github/workflows/deploy.yml','docs/SETUP.md','scripts/test_client_contract.mjs'
];
let failed = false;
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full) || fs.statSync(full).size === 0) {
    console.error(`Missing or empty: ${file}`); failed = true;
  }
}
const clientFiles=['AppCore.html','AppHomePortal.html','AppOperations.html','AppPeopleMonthly.html','AppLeaveDemo.html','AppAdmin.html','AppShell.html'];
const app = clientFiles.map(file=>fs.readFileSync(path.join(root,'src',file),'utf8')).join('\n');
const styles = fs.readFileSync(path.join(root,'src/Styles.html'),'utf8');
const indexText = fs.readFileSync(path.join(root,'src/Index.html'),'utf8');
for (const label of ['ホーム','勤怠','工数','予定表','会社カレンダー','申請','社員','月次','設定']) {
  if (!app.includes(label)) { console.error(`Navigation label missing: ${label}`); failed = true; }
}
try {
  const js = clientFiles.map(file=>fs.readFileSync(path.join(root,'src',file),'utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'')).join('\n');
  const temp = path.join(os.tmpdir(), 'fmworks-app-check.js');
  fs.writeFileSync(temp, js);
  execFileSync(process.execPath, ['--check', temp], { stdio: 'pipe' });
} catch (err) {
  console.error('Client JavaScript syntax error:');
  console.error(String(err.stderr || err.message || err));
  failed = true;
}
for (const serverFile of ['Code.gs','AnnualLeaveAutomation.gs','Auth.gs','Worklog.gs','Requests.gs','Monthly.gs','MonthlySnapshot.gs','LeaveLedger.gs','Labor.gs','Schema.gs','DataAccess.gs','Employees.gs','Search.gs','Notifications.gs','Maintenance.gs','Holidays.gs','Projects.gs','Docs.gs','GeneratedDocs.gs']) {
  try {
    const server = fs.readFileSync(path.join(root,'src',serverFile),'utf8');
    new Function(server);
  } catch (err) {
    console.error(`Server JavaScript syntax error in ${serverFile}:`, err.message);
    failed = true;
  }
}
const tinyFontMatches=[...styles.matchAll(/font-size\\s*:\\s*(\\d+(?:\\.\\d+)?)px/g)].filter(m=>Number(m[1])<11);
if(tinyFontMatches.length){
  console.error('Readable type gate failed: font-size below 11px remains: '+tinyFontMatches.slice(0,8).map(m=>m[0]).join(', '));
  failed=true;
}
for(const marker of [
  'function updateLiveWorkedNodes()',
  'data-live-worked',
  "content.classList.toggle('one-screen',state.page==='home'||state.page==='attendance'||state.page==='worklog')",
  'function trapModalFocus_(',
  "e.key==='Tab'&&trapModalFocus_(e)",
  "class='day-open'",
  "class='schedule-timed-event ${scheduleHighlightClass(e)}'"
]){
  if(!app.includes(marker)){console.error('Usability/a11y hardening marker missing: '+marker);failed=true;}
}
const tickerStart=app.indexOf('function startLiveAttendanceTicker()');
const tickerEnd=app.indexOf('\nfunction ',tickerStart+20);
const tickerBlock=tickerStart>=0?(tickerEnd>tickerStart?app.slice(tickerStart,tickerEnd):app.slice(tickerStart)):'';
if(!tickerBlock.includes('updateLiveWorkedNodes()')||tickerBlock.includes('renderPage()')){
  console.error('Live attendance ticker must update only live-worked DOM nodes.');
  failed=true;
}

const serverCode = fs.readFileSync(path.join(root,'src/Code.gs'),'utf8');
const authCode = fs.readFileSync(path.join(root,'src/Auth.gs'),'utf8');
const maintenanceCodeForUi = fs.readFileSync(path.join(root,'src/Maintenance.gs'),'utf8');
const createSessionStart=authCode.indexOf('function createSession_(');
const createSessionEnd=authCode.indexOf('\nfunction ',createSessionStart+10);
const createSessionBlock=createSessionStart>=0?(createSessionEnd>createSessionStart?authCode.slice(createSessionStart,createSessionEnd):authCode.slice(createSessionStart)):'';
if(createSessionBlock.includes('cleanupExpiredSessions_(')){
  console.error('Login path must not run session garbage collection.');
  failed=true;
}
if(!authCode.includes('function sessionRowsToDelete_(')||!authCode.includes('sheet.deleteRows(block.start,block.end-block.start+1)')){
  console.error('Batched session garbage collection is missing.');
  failed=true;
}
if(!maintenanceCodeForUi.includes('const cleanedSessions=cleanupExpiredSessions_();')){
  console.error('Scheduled maintenance must run session garbage collection.');
  failed=true;
}

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
const snapshotCodeText = fs.readFileSync(path.join(root,'src/MonthlySnapshot.gs'),'utf8');
const leaveLedgerCodeText = fs.readFileSync(path.join(root,'src/LeaveLedger.gs'),'utf8');
const laborCodeText = fs.readFileSync(path.join(root,'src/Labor.gs'),'utf8');
const schemaCodeText = fs.readFileSync(path.join(root,'src/Schema.gs'),'utf8');
const dataAccessCodeText = fs.readFileSync(path.join(root,'src/DataAccess.gs'),'utf8');
const monthlySnapshotMainCode = fs.readFileSync(path.join(root,'src/Monthly.gs'),'utf8');
const requestCodeText = fs.readFileSync(path.join(root,'src/Requests.gs'),'utf8');
const employeeCodeText = fs.readFileSync(path.join(root,'src/Employees.gs'),'utf8');
const maintenanceCodeText = fs.readFileSync(path.join(root,'src/Maintenance.gs'),'utf8');
const notificationCodeText = fs.readFileSync(path.join(root,'src/Notifications.gs'),'utf8');
const deployWorkflowText = fs.readFileSync(path.join(root,'.github/workflows/deploy.yml'),'utf8');
const ciWorkflowText = fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8');

for (const marker of [
  'const canApproveRequests = !!getPermissions_(employee).requestApprove',
  'const requestIds=canApproveRequests?',
  'readRowsByColumnValues_(requestSheet,3,19,requestIds)'
]) {
  if (!notificationCodeText.includes(marker)) {
    console.error('Manager approval notification scope missing: ' + marker);
    failed = true;
  }
}
for (const marker of [
  'function annualLeavePeriodEnd_(',
  'function annualLeaveQualifyingUsage_(',
  'function getAnnualLeaveFiveDayStatus_(',
  'function getLeaveLedger(sessionToken, employeeId)'
]) {
  if (!leaveLedgerCodeText.includes(marker)) {
    console.error('Annual leave five-day monitor missing: ' + marker);
    failed = true;
  }
}
for (const marker of [
  'openLeaveLedgerModal',
  'postLeaveLedgerEntry',
  '年次有給休暇管理簿'
]) {
  if (!app.includes(marker)) {
    console.error('Annual leave ledger UI missing: ' + marker);
    failed = true;
  }
}
if (!notificationCodeText.includes("type:'年休5日'")) {
  console.error('Annual leave five-day notification is missing.');
  failed = true;
}

for (const marker of [
  'function managerAssignmentCreatesCycle_(',
  'function assertManagerRoleChangeSafe_(',
  'function getActiveDirectReports_(',
  'assertManagerAssignmentAcyclic_(employeeId,managerId)'
]) {
  if (!employeeCodeText.includes(marker)) {
    console.error('Approval graph integrity guard missing: ' + marker);
    failed = true;
  }
}
for (const marker of [
  "calendar.some(d=>d.type==='法定休日')",
  'function compareBackupShape_(',
  'function verifyDatabaseBackupCopy_(',
  "lastBackupVerifiedProperty: 'FM_WORKS_LAST_BACKUP_VERIFIED'"
]) {
  if (!maintenanceCodeText.includes(marker)) {
    console.error('Production/backup integrity gate missing: ' + marker);
    failed = true;
  }
}
if (!deployWorkflowText.includes('node scripts/test_client_contract.mjs')) {
  console.error('Deploy workflow must run client contract tests before deployment.');
  failed = true;
}
for (const workflow of [deployWorkflowText,ciWorkflowText]) {
  if (!workflow.includes('actions/checkout@v5') || !workflow.includes('actions/setup-node@v6') || !workflow.includes("node-version: '24'")) {
    console.error('GitHub Actions workflow must use Node 24-compatible action/runtime versions.');
    failed = true;
  }
}
for (const unlabeledClose of [
  "<button class='icon-button' onclick='closeModal()'>×</button>",
  '<button class="icon-button" onclick="closeModal()">×</button>'
]) {
  if (app.includes(unlabeledClose)) {
    console.error('Modal close icon button is missing an accessible label.');
    failed = true;
  }
}

for (const marker of [
  "requestApprove: role === 'ADMIN' || role === 'MANAGER'",
  'function canManageEmployeeRecord_(',
  'managerId: r[23]',
  "const allowedRoles = ['USER','CALENDAR_EDITOR','MANAGER','ADMIN']"
]) {
  if (!(serverCode + employeeCodeText + authCode).includes(marker)) {
    console.error('Approval hierarchy marker missing: ' + marker);
    failed = true;
  }
}
if (!requestCodeText.includes('申請者本人は承認できません。別の承認者へ依頼してください。')) {
  console.error('Self-approval guard is missing.');
  failed = true;
}
const approveBlockStart=requestCodeText.indexOf('function approveRequest(');
const approveBlockEnd=requestCodeText.indexOf('\nfunction ',approveBlockStart+10);
const approveBlock=approveBlockStart>=0?(approveBlockEnd>approveBlockStart?requestCodeText.slice(approveBlockStart,approveBlockEnd):requestCodeText.slice(approveBlockStart)):'';
if (!approveBlock.includes('requireSession_(sessionToken)') || approveBlock.includes('requireAdminSession_(sessionToken)') || !approveBlock.includes('assertCanApproveRequest_')) {
  console.error('Approval API must use scoped approver authorization instead of ADMIN-only authorization.');
  failed = true;
}

for (const marker of [
  'monthlySnapshot',
  'monthlySnapshotDaily'
]) {
  if (!serverCode.includes(marker)) {
    console.error('Monthly snapshot DB mapping missing: ' + marker);
    failed = true;
  }
}
for (const marker of [
  'function persistMonthlyCloseSnapshots_(',
  'function getMonthlySnapshotSummaries_(',
  'function getMonthlySummaryForExport_(',
  'Utilities.DigestAlgorithm.SHA_256'
]) {
  if (!snapshotCodeText.includes(marker)) {
    console.error('Monthly close snapshot marker missing: ' + marker);
    failed = true;
  }
}
if (!monthlySnapshotMainCode.includes('persistMonthlyCloseSnapshots_(ym,summaries,admin)') ||
    !monthlySnapshotMainCode.includes('snapshotId') ||
    !monthlySnapshotMainCode.includes('給与対象の一括出力は月次締め後に実行してください。')) {
  console.error('Monthly close must persist immutable snapshots and exports must use closed data.');
  failed = true;
}

for (const marker of [
  'function getLeaveLedgerState_(',
  'function consumeLeaveBalance_(',
  'function restoreLeaveBalance_(',
  'function postLeaveLedgerEntry('
]) {
  if (!leaveLedgerCodeText.includes(marker)) {
    console.error('Leave ledger marker missing: ' + marker);
    failed = true;
  }
}
if (!requestCodeText.includes('function requestApprovedCancellation(') ||
    !requestCodeText.includes('function decideApprovedCancellation(') ||
    !requestCodeText.includes("status==='取消申請中'") && !app.includes("status==='取消申請中'")) {
  console.error('Approved request cancellation workflow is incomplete.');
  failed = true;
}
if (!authCode.includes('leaveBasisDate: r[24]') || !authCode.includes('hireDate: r[25]')) {
  console.error('Employee leave basis/hire dates are not persisted.');
  failed = true;
}

for (const marker of ['function getLaborRuleConfig_(','function saveLaborRuleConfig(','function applyLaborModelToMonthlyDaily_(','monthlyOvertimePrincipleMinutes:2700','nightStartMinutes:1320']) {
  if (!laborCodeText.includes(marker)) { console.error('Labor model marker missing: '+marker); failed=true; }
}
if (!serverCode.includes("'法定休日'") || !app.includes("'法定休日'")) { console.error('Statutory holiday calendar type missing.'); failed=true; }
if (!monthlySnapshotMainCode.includes('applyLaborModelToMonthlyDaily_') || !monthlySnapshotMainCode.includes('laborBlocked=summaries.filter')) { console.error('Monthly labor gate missing.'); failed=true; }
if (!app.includes('function laborRulePanel(') || !app.includes('function saveLaborRulesFromAdmin(')) { console.error('Labor UI missing.'); failed=true; }

if (!serverCode.includes('function auditJson_(') ||
    !serverCode.includes('before: auditBefore') ||
    !fs.readFileSync(path.join(root,'src/Worklog.gs'),'utf8').includes('before: auditBefore') ||
    !fs.readFileSync(path.join(root,'src/Projects.gs'),'utf8').includes('before = auditJson_') ||
    !fs.readFileSync(path.join(root,'src/Employees.gs'),'utf8').includes('before:existingEmployee ? auditJson_')) {
  console.error('Structured before/after audit evidence is incomplete for important update flows.');
  failed = true;
}

for (const marker of ['const DB_SCHEMA_VERSION = 9','function getDatabaseSchemaStatus_(','function migrateDatabaseToCurrent(','function ensureSchemaSheet_(']) {
  if (!schemaCodeText.includes(marker)) { console.error('Schema migration marker missing: '+marker); failed=true; }
}
if (!maintenanceCodeText.includes('DBスキーマ不整合') || !app.includes('function migrateDatabaseFromAdmin(')) {
  console.error('Schema status must block production readiness and be repairable from admin UI.');
  failed=true;
}

for (const marker of ['function readRowsByDateRange_(','function dateRangeRegex_(','function logPerformance_(','PERFORMANCE_BUDGETS']) {
  if (!dataAccessCodeText.includes(marker)) { console.error('Data access marker missing: '+marker); failed=true; }
}
if (!serverCode.includes('readRowsByDateRange_(sheet,4,12,startDate,endDate)') ||
    !serverCode.includes('readRowsByDateRange_(sheet,1,10,start,end)') ||
    !monthlySnapshotMainCode.includes('readRowsByDateRange_(worklogSheet,2,15,start,end)')) {
  console.error('Date-scoped reads are not wired into high-volume flows.');
  failed=true;
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
  'function recordWorkLocationChange(sessionToken',
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
const dataAccessText = fs.readFileSync(path.join(root,'src/DataAccess.gs'),'utf8');
const authPerfText = fs.readFileSync(path.join(root,'src/Auth.gs'),'utf8');
const worklogPerfText = fs.readFileSync(path.join(root,'src/Worklog.gs'),'utf8');
const monthlyPerfText = fs.readFileSync(path.join(root,'src/Monthly.gs'),'utf8');

for (const marker of [
  'function cacheJsonGet_(',
  'function cacheJsonPut_(',
  'CacheService.getScriptCache()',
  'function readRowsByColumnValues_('
]) {
  if (!dataAccessText.includes(marker)) {
    console.error('Server cache/index performance primitive missing: ' + marker);
    failed = true;
  }
}
const homeOverviewStart=serverCode.indexOf('function getHomeOverview(sessionToken)');
const homeOverviewEnd=serverCode.indexOf('\nfunction ',homeOverviewStart+20);
const homeOverviewBlock=homeOverviewStart>=0&&homeOverviewEnd>homeOverviewStart?serverCode.slice(homeOverviewStart,homeOverviewEnd):'';
if(homeOverviewBlock.includes('getMonthlySummary(')){
  console.error('Home overview must not invoke full monthly summary.');
  failed=true;
}
for (const marker of [
  'function buildInitialDataForEmployee_(',
  'function getHomeMonthStats_(',
  'function getScheduleBundleForViewer_(',
  'readRowsByDateRange_(sheet,2,18,start,end)',
  "cacheJsonPut_(cacheKey,employees,120)",
  'function getAttendanceContext_(',
  'buildAttendanceStateFromRows_(dateText,nextRows)'
]) {
  if (!serverCode.includes(marker)) {
    console.error('v0.10.5 response optimization missing: ' + marker);
    failed = true;
  }
}
for (const marker of [
  "const cacheKey='fm:settings:v2'",
  'cacheJsonGet_(cacheKey)',
  'createTextFinder(id).matchEntireCell(true).findNext()',
  'result.initialData = buildInitialDataForEmployee_(session.employee)'
]) {
  if (!authPerfText.includes(marker)) {
    console.error('Authentication fast-path missing: ' + marker);
    failed = true;
  }
}
if (!worklogPerfText.includes('projects:includeProjects?getProjectsInternal_(false):[]')) {
  console.error('Worklog must lazy-load projects with its own page bundle.');
  failed = true;
}
for (const marker of [
  'readRowsByDateRange_(sheet,1,16,start,end)',
  'readRowsByColumnValues_(sheet,3,19,[employeeId])'
]) {
  if (!monthlyPerfText.includes(marker)) {
    console.error('Monthly indexed-read optimization missing: ' + marker);
    failed = true;
  }
}
if (!app.includes('includeEmployees:false') || !app.includes('includeProjects:true')) {
  console.error('Client page bundles must avoid redundant master-data reads.');
  failed = true;
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
if (!app.includes("if(tab==='operation')loadMaintenance()")) {
  console.error('Operation tab must load maintenance directly.');
  failed = true;
}
const adminTabStart=app.indexOf('function setAdminTab(tab)');
const adminTabEnd=app.indexOf('\nfunction ',adminTabStart+20);
const adminTabBlock=adminTabStart>=0&&adminTabEnd>adminTabStart?app.slice(adminTabStart,adminTabEnd):'';
if(adminTabBlock.includes("if(tab==='operation'){loadAuthAdmin")){
  console.error('Operation tab must not fetch unrelated authentication/admin master data.');
  failed=true;
}
for (const marker of [
  "function authAdminScope_(",
  "function authAdminCacheName_(",
  "getAuthAdminData(state.sessionToken,scope)",
  "loadAuthAdmin({scope:'people'})",
  "loadAuthAdmin({scope:'projects'})"
]) {
  if(!app.includes(marker)){
    console.error('Scoped admin loading missing: '+marker);
    failed=true;
  }
}
if(!authCode.includes('function getAuthAdminData(sessionToken, scope)') ||
   !authCode.includes("['people','auth','projects']") ||
   !authCode.includes("if(mode==='projects')") ||
   !authCode.includes("if(mode==='auth')")){
  console.error('Server admin payload must be scoped to the active view.');
  failed=true;
}
for (const marker of [
  'function scheduleBackgroundTask(',
  'function prefetchRouteOnIntent(',
  'function queueRoutePrefetch(',
  'User intent gets priority over background GAS calls',
  'scheduleBackgroundTask(()=>loadNotifications(),2400)',
  'function mountAuthenticatedApp(',
  'result&&result.initialData||null'
]) {
  if (!app.includes(marker)) {
    console.error('Perceived-performance startup guard missing: ' + marker);
    failed = true;
  }
}
const prefetchStart=app.indexOf('function startMenuPrefetch()');
const prefetchEnd=app.indexOf('\nfunction ',prefetchStart+20);
const prefetchBlock=prefetchStart>=0&&prefetchEnd>prefetchStart?app.slice(prefetchStart,prefetchEnd):'';
for (const forbidden of ['loadSchedule({silent:true})','loadWorklogs({silent:true})','loadRequests({silent:true})','loadMonthly({silent:true})','loadCompanyCalendar(undefined,{silent:true})','loadAuthAdmin({silent:true})']) {
  if(prefetchBlock.includes(forbidden)){
    console.error('Eager multi-page prefetch must stay disabled: '+forbidden);
    failed=true;
  }
}

for (const attendanceMarker of [
  "function loadAttendancePreview(",
  "function attendanceTimeline(",
  "function attendanceMonthCalendar(",
  "function attendanceRecentHistory(",
  "function buildAttendanceSamplePreview(",
  "function attendanceDisplayPreview(",
  "function openAttendanceSampleDay(",
  "attendance-top-grid",
  "attendance-bottom-grid",
  "attendance-one-screen",
  "attendance-sample-badge"
]) {
  if (!(app + styles).includes(attendanceMarker)) {
    console.error('Attendance workspace redesign marker missing: ' + attendanceMarker);
    failed = true;
  }
}
for (const marker of [
  "LOCATION_CHANGE: '勤務場所変更'",
  'function recordWorkLocationChange(sessionToken, workLocation)',
  'function summarizeWorkLocations_(rows)',
  'function isTimePunchAction_(action)'
]) {
  if (!serverCode.includes(marker)) {
    console.error('v0.10.9 work-location transition marker missing: ' + marker);
    failed = true;
  }
}
if (!requestCodeText.includes('isTimePunchAction_(action)')) {
  console.error('Punch correction must exclude work-location transition events.');
  failed = true;
}
for (const marker of [
  'function getFontSizeMode()',
  'function setFontSizeMode(mode)',
  'function toggleFontSize()',
  'function changeWorkLocation(location)',
  "recordWorkLocationChange(state.sessionToken,location)"
]) {
  if (!app.includes(marker)) {
    console.error('v0.10.9 accessibility/location UI marker missing: ' + marker);
    failed = true;
  }
}
if (!indexText.includes('id="fontSizeToggleButton"') ||
    !styles.includes('html[data-font-size="large"]') ||
    !styles.includes('.attendance-timeline-row.location')) {
  console.error('Readable font mode or location-transition styling is missing.');
  failed = true;
}
for (const marker of [
  'function worklogDisplayData()',
  'function worklogTimelineSegments(display)',
  'function worklogTimelineHtml(display)',
  'function worklogQuickForm(display)',
  'function saveQuickWorklog()',
  'function worklogTableHtml(display)',
  '本日のタイムライン',
  'クイック入力',
  '本日の工数一覧'
]) {
  if (!app.includes(marker)) {
    console.error('v0.11.0 worklog hybrid marker missing: ' + marker);
    failed = true;
  }
}
for (const marker of [
  '.worklog-main-grid',
  '.worklog-timeline-track',
  '.worklog-quick-card',
  '.worklog-table-wrap',
  '.content.one-screen.worklog-one-screen'
]) {
  if (!styles.includes(marker)) {
    console.error('v0.11.0 worklog hybrid style missing: ' + marker);
    failed = true;
  }
}
if (!app.includes("display.sample&&!realProjects.length") ||
    !app.includes("admin&&ready&&date===state.data.today&&!realItems.length")) {
  console.error('Worklog QA sample must remain ADMIN-only and non-persistable without real projects.');
  failed = true;
}
for(const marker of [
  'function worklogWindowRange(date)',
  'function worklogCachedWindow(date)',
  'function worklogShowCachedDay(date,entry)',
  'function invalidateWorklogWindowCache()',
  'function loadWorklogs(options={})',
  'worklogActiveRequest',
  'worklogWindowGeneration',
  'start:range.start,end:range.end',
  'state.worklog.loadedDate=date'
]) {
  if(!app.includes(marker)){
    console.error('Worklog multi-day cache marker missing: ' + marker);
    failed=true;
  }
}
if(!app.includes("names.includes('worklog')&&typeof invalidateWorklogWindowCache==='function'") ||
   !styles.includes('.worklog-one-screen .worklog-quick-grid') ||
   !styles.includes('.worklog-one-screen .worklog-quick-save')){
  console.error('Worklog cache invalidation or accessible quick-save layout missing.');
  failed=true;
}
for(const marker of [
  'function jumpWorklogDate(date)',
  'function rememberWorklogQuickDraft()',
  'function restoreWorklogQuickDraft()',
  'function clearWorklogQuickDrafts()',
  "id='worklogDatePicker'",
  "id='wlQuickSaveButton'",
  'state.worklog.renderedDate=date'
]){
  if(!app.includes(marker)){console.error('v0.11.2 worklog date/draft marker missing: '+marker);failed=true;}
}
if(!styles.includes('.worklog-date-picker')||!app.includes('rememberWorklogQuickDraft();')||!app.includes('restoreWorklogQuickDraft();')){
  console.error('Worklog date picker styling or render preservation is missing.');failed=true;
}

if (!app.includes("const nestedRoutes=['monthly','companyCalendar','people']") ||
    !app.includes("(NAV.some(n=>n[0]===requested)||nestedRoutes.includes(requested))?requested:'home'")) {
  console.error('Nested workspace deep links must survive authenticated bootstrap.');
  failed = true;
}
for (const iaMarker of [
  "const NAV = [['home','ホーム','i-home'],['attendance','勤怠','i-clock'],['worklog','工数','i-chart'],['schedule','予定表','i-calendar'],['requests','申請','i-file'],['admin','管理','i-gear']]",
  "const MOBILE_NAV = ['home','attendance','worklog','schedule','requests']",
  "function primaryNavIdForPage(page)",
  "if(page==='monthly')return 'attendance'",
  "if(page==='companyCalendar')return 'schedule'",
  "if(page==='people')return 'admin'",
  "function attendanceWorkspaceTabs(activeId)",
  "function scheduleWorkspaceTabs(activeId)"
]) {
  if (!app.includes(iaMarker)) {
    console.error('Information architecture marker missing: ' + iaMarker);
    failed = true;
  }
}
const navDeclaration=(app.match(/const NAV = \[[^\n]+/)||[''])[0];
for (const forbiddenTopRoute of ["['companyCalendar','会社カレンダー'","['people','社員'","['monthly','月次'","['admin','設定'"]) {
  if (navDeclaration.includes(forbiddenTopRoute)) {
    console.error('Legacy top-level navigation must stay removed: ' + forbiddenTopRoute);
    failed = true;
  }
}
if (!app.includes("settingsTabs('people')") || !app.includes("id:'people',label:'社員・権限'")) {
  console.error('Employee administration must live under the 管理 workspace.');
  failed = true;
}
if (!styles.includes('.workspace-tabs') || !styles.includes('.nav-button[data-route="admin"]')) {
  console.error('New workspace navigation styles are missing.');
  failed = true;
}

if (!fs.readFileSync(path.join(root,'src/Requests.gs'),'utf8').includes('function getRequestsBundle(sessionToken)')) {
  console.error('Request page must use a single bundled server read.');
  failed = true;
}


for(const adminUiMarker of [
  'function createAdminUiState()',
  'function adminWorkspaceShell(active,content',
  'function adminOverviewStats()',
  'function adminPeopleFiltered()',
  'function adminPeopleRows()',
  'function adminEmployeeDetail()',
  'function selectAdminEmployee(employeeId)',
  'function filterAdminPeople(kind,value)',
  'function validateAdminWizardStep(step)',
  'function adminWizardShowStep(step)',
  'function adminWizardReviewHtml()',
  'function adminWizardNext()',
  'function adminWizardBack()',
  'function openEmployeeModal(employeeId)',
  "settingsTabs('people')",
  'if(state.page===\'admin\'&&state.adminTab===\'people\')',
  'state.adminUi=createAdminUiState();',
  'identity!==String(state.sessionToken||\'\')',
  'if(state.adminUi.saving)return'
]){
  if(!app.includes(adminUiMarker)){console.error('v0.11.6 admin UI marker missing: '+adminUiMarker);failed=true;}
}
for(const adminCssMarker of [
  '.admin-overview{display:grid',
  '.admin-workspace-body{display:grid',
  '.admin-people-split{display:grid',
  '.admin-employee-item.selected',
  '.admin-employee-modal',
  '.admin-wizard-progress',
  '.admin-wizard-error',
  '@media(max-width:880px)',
  'html[data-theme="dark"] .admin-employee-item.selected'
]){
  if(!styles.includes(adminCssMarker)){console.error('v0.11.6 admin responsive style missing: '+adminCssMarker);failed=true;}
}



const demoScript=fs.readFileSync(path.join(root,'src','AppLeaveDemo.html'),'utf8');
for(const marker of [
  'const LEAVE_DEMO_PEOPLE=[',
  'function leaveDemoGrants(hire,asOf=LEAVE_DEMO_AS_OF)',
  'function leaveDemoCompute(d=leaveDemoState)',
  'function leaveDemoOpen(id=',
  'function leaveDemoEditHire()',
  'function leaveDemoApplyRequest(days)',
  'function leaveDemoDayReserved(d=leaveDemoState,date=LEAVE_DEMO_AS_OF)',
  'function leaveDemoClose()',
  'function leaveDemoApprove()',
  'function leaveDemoWithdraw()',
  'function leaveDemoCancel()',
  'function resetLeaveDemoSession()',
  'DEMO · 架空データ',
  '実際の社員・申請・年休台帳には保存されません'
]){
  if(!demoScript.includes(marker)){console.error('v0.11.8 leave demo missing: '+marker);failed=true;}
}
if(demoScript.includes('google.script.run')||demoScript.includes('SpreadsheetApp')||
  demoScript.includes('localStorage')||demoScript.includes('sessionStorage')){
  console.error('Demo must not use GAS or persistent storage.');failed=true;
}
if(!indexText.includes("include_('AppLeaveDemo')")||
  !app.includes('leaveDemoOpen()')||!app.includes('resetLeaveDemoSession();')){
  console.error('v0.11.8 isolated demo integration missing.');failed=true;
}
for(const marker of [
  '.leave-demo-invite','.leave-demo-presets','.leave-demo-metrics',
  '.modal-card.leave-demo-modal','.leave-demo-five.caution',
  '@media(max-width:760px)'
]){
  if(!styles.includes(marker)){console.error('v0.11.8 responsive demo style missing: '+marker);failed=true;}
}

const annualAutomation=fs.readFileSync(path.join(root,'src','AnnualLeaveAutomation.gs'),'utf8');
for(const marker of [
  'function leaveDueAtIndex_(hire,index)',
  'function leaveEntitlement_(hire,asOf)',
  'function leaveAttendanceEvidence_(employee,part)',
  'function reconcileLeaveUnlocked_(employee,today)',
  'function maybeReconcileLeave_(employeeId,asOf)',
  'function annualLeaveDailyJob_()',
  'function installAnnualLeaveDailyJob(sessionToken)',
  "operation:'法定年休自動付与'"
]){
  if(!annualAutomation.includes(marker)){console.error('v0.11.7 annual leave engine marker missing: '+marker);failed=true;}
}
for(const marker of [
  'function requestAnnualLeaveNotice()',
  'function installLeaveDailyAutomation()',
  "autoLeaveEnabled:document.getElementById('empAutoLeave').checked",
  "requestAnnualLeaveNotice()",
  'function existingBeforeSaveLeaveBalance_()'
]){
  if(!app.includes(marker)){console.error('v0.11.7 annual leave UI marker missing: '+marker);failed=true;}
}
if(!styles.includes('.leave-compliance-banner')||
  !styles.includes('.leave-auto-setup-note')){
  console.error('v0.11.7 leave reminder styles missing.');failed=true;
}

for (const requestDashboardMarker of [
  'function createEmptyRequestsState()',
  'function requestsIdentity()',
  'function requestsDataReady()',
  'function requestOverview()',
  'function requestPendingTeam()',
  'function requestApprovalPanel()',
  'function requestHistoryPanel()',
  'function filteredOwnRequests()',
  'function searchRequestHistory(query)',
  'function updateRequestDraftSummary()',
  'function openRequestDetail(id,teamMode=false)',
  "class='request-overview",
  "class='request-form-steps'",
  'requestState.submitting=true',
  "if(requestState!==state.requests||identity!==requestsIdentity())return"
]){
  if(!app.includes(requestDashboardMarker)){console.error('v0.11.5 request dashboard missing: '+requestDashboardMarker);failed=true;}
}
for (const requestDashboardStyle of [
  '.request-overview{display:grid',
  '.request-action-layout{display:grid',
  '.request-dashboard .request-quick-grid',
  '.request-history-filters button.active',
  '.request-guided-modal',
  '@media(max-width:760px)'
]){
  if(!styles.includes(requestDashboardStyle)){console.error('v0.11.5 request responsive style missing: '+requestDashboardStyle);failed=true;}
}
if(!app.includes('state.requests=createEmptyRequestsState();')||
  !app.includes('delete pageCache.requests;')||
  !app.includes('requestState.submitting=false')){
  console.error('v0.11.5 request session reset or safe retry contract missing.');failed=true;
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
const punchStart=serverCode.indexOf('function recordPunch(sessionToken');
const punchEnd=serverCode.indexOf('\nfunction ',punchStart+20);
const punchBlock=punchStart>=0&&punchEnd>punchStart?serverCode.slice(punchStart,punchEnd):'';
if(punchBlock.includes('SpreadsheetApp.flush()')){
  console.error('Punch fast-path must not force SpreadsheetApp.flush().');
  failed=true;
}
if((punchBlock.match(/getAttendanceState_\(/g)||[]).length>0){
  console.error('Punch fast-path must not re-read attendance after writing.');
  failed=true;
}

if (serverCode.includes('return getInitialData(sessionToken);')) {
  console.error('Punch writes must not block on a full application reload.');
  failed = true;
}

for(const marker of [
  'function scheduleDetailPanel()',
  'function selectScheduleDay(date,eventId',
  'function selectScheduleEvent(id)',
  'function scheduleTimeboard(columns,bounds,kind)',
  'function scheduleTimelineLayout(events,bounds)',
  'function onScheduleDetailKeydown(e)',
  'function closeScheduleDetail()',
  "class='schedule-timeboard",
  "class='schedule-detail-panel",
  "class='schedule-sheet-backdrop",
  'scheduleLoaded()'
]){
  if(!app.includes(marker)){console.error('v0.11.3 hybrid schedule missing: '+marker);failed=true;}
}
if(!styles.includes('.schedule-layout{display:grid')||
  !styles.includes('@media(max-width:1320px)')||
  !styles.includes('.schedule-detail-panel.is-open')||
  !styles.includes('.schedule-day-dots')){
  console.error('v0.11.3 responsive hybrid schedule style missing.');failed=true;
}


// v0.11.4: calendar client cache, instant filters, employee highlighting and weekend contrast.
for(const name of [
  'function scheduleWindowIdentity()',
  'function scheduleFilterEvents(events,employeeId,category)',
  'function invalidateScheduleWindowCache()',
  'const scheduleWindowCache=new Map()',
  'const scheduleWindowRequests=new Map()',
  "employeeId:'ALL',category:'ALL',includeEmployees:false",
  'function toggleScheduleEmployeeHighlight(employeeId)',
  'function scheduleHighlightClass(e)',
  "class='person-chip schedule-person-button",
  'schedule-sunday',
  'schedule-saturday',
  'schedule-holiday'
]){
  if(!app.includes(name)){console.error('v0.11.4 calendar performance/UX marker missing: '+name);failed=true;}
}
if(styles.includes('.schedule-hybrid .schedule-is-emphasized{position:relative')||
   !styles.includes('.schedule-timed-event.schedule-is-emphasized{position:absolute')){
  console.error('Employee emphasis must preserve absolute timeline card positioning.');failed=true;
}
if(!styles.includes('.schedule-hybrid .month-day.schedule-holiday')||
   !styles.includes('schedule-person-button.is-emphasized')||
   !styles.includes('.schedule-hybrid .schedule-is-emphasized')){
  console.error('Calendar contrast and employee emphasis CSS missing.');failed=true;
}

for (const schedulePrivacyMarker of [
  'function normalizeScheduleVisibility_(',
  'function canViewScheduleRow_(',
  "['社内','参加者のみ','管理者のみ']",
  'canViewScheduleRow_(viewer,r)'
]) {
  if (!serverCode.includes(schedulePrivacyMarker)) {
    console.error('Schedule privacy enforcement missing: ' + schedulePrivacyMarker);
    failed = true;
  }
}
if (!fs.readFileSync(path.join(root,'src/Search.gs'),'utf8').includes('canViewScheduleRow_(session.employee,r)')) {
  console.error('Global search must respect schedule visibility.');
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
  "試作環境です。ログイン用PINは開発管理者から案内されたものを入力してください。",
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
  ['monthly attendance integrity', monthlyCode, ["r[12]!=='削除'", 'missingAllPunches', 'lateEarlyMinutes', 'absenceDays', 'summarizeWorkLocations_(rows)']],
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
for (const requiredHandler of ['syncRequestDates','openMobileDrawer','runConfirmAction','runReasonAction','closeMonthly','reopenMonthly','confirmMonthlyReviewFromPage','setAdminTab','toggleTheme','toggleFontSize','projectAdminSection','openProjectModal','saveProjectFromModal','loadHomeOverview']) {
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
  'function installDailyBackupTrigger(sessionToken)',
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
for (const backupTriggerMarker of [
  "backupTriggerHandler: 'scheduledDailyMaintenance_'",
  'function scheduledDailyMaintenance_()',
  'function installDailyBackupTrigger(sessionToken)',
  'ScriptApp.newTrigger(MAINTENANCE.backupTriggerHandler)',
  '.atHour(3)',
  'getProjectTriggers()'
]) {
  if (!maintenanceCode.includes(backupTriggerMarker)) {
    console.error('Scheduled backup implementation missing: ' + backupTriggerMarker);
    failed = true;
  }
}
if (requestCode.includes('setValue(true)') && requestCode.includes('修正対象')) {
  console.error('Punch correction must not mutate the original punch row.');
  failed = true;
}
for (const runtimeMarker of [
  'function normalizeRuntimeEnvironment_(',
  'function getRuntimeEnvironment_(',
  'FM_WORKS_ENVIRONMENT',
  'PRODUCTION環境では FM_WORKS_DB_ID',
  'PRODUCTION環境ではSTAGING既定DBを使用できません'
]) {
  if (!serverCode.includes(runtimeMarker)) {
    console.error('Runtime environment boundary missing: ' + runtimeMarker);
    failed = true;
  }
}
if (!maintenanceCode.includes("runtime.environment!=='PRODUCTION'")) {
  console.error('Production readiness must reject non-production runtime.');
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
  'projects: []'
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

if (!serverCode.includes("monthlyReview: '月次確認'")) {
  console.error("Monthly review integration missing: monthlyReview sheet mapping");
  failed = true;
}
if (!notificationCodeText.includes('getMonthlyReviewPrompt_(employee.employeeId)')) {
  console.error('Monthly review notification integration missing.');
  failed = true;
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

for (const laborHistoryMarker of [
  'annualOvertimePrincipleMinutes:21600',
  'specialAnnualOvertimeLimitMinutes:43200',
  'specialMultiMonthAverageLimitMinutes:4800',
  'specialExcessMonthLimit:6',
  'function normalizeLaborAgreementStartMonth_(',
  'function normalizeLaborSpecialClause_(',
  'function getClosedLaborHistory_(',
  'function evaluateGeneralLaborHistory_(',
  'LABOR_36_PERIOD_START_MONTH',
  'LABOR_SPECIAL_CLAUSE'
]) {
  if (!laborCodeText.includes(laborHistoryMarker)) {
    console.error('Labor history/general-rule monitoring missing: ' + laborHistoryMarker);
    failed = true;
  }
}
for (const laborUiMarker of ['laborAgreementStart','laborSpecialClause','36協定の起算月','特別条項']) {
  if (!app.includes(laborUiMarker)) {
    console.error('Labor configuration UI missing: ' + laborUiMarker);
    failed = true;
  }
}


const portalFile=fs.readFileSync(path.join(root,'src','AppHomePortal.html'),'utf8');
for (const homePortalMarker of [
  'function homePage()',
  'function homePortalGreeting()',
  'function homePortalStats()',
  'function homePortalPunch(a)',
  'function homePortalScheduleRows(events)',
  'function homePortalTaskRows(tasks)',
  'function homePortalPriorities(tasks)',
  'function homePortalShortcuts()',
  'home-portal-agenda-empty',
  'home-portal-all-clear',
  'state.schedule.selectedEventId=this.dataset.eventId||null',
  "['worklog','工数入力'",
  "['requests','休暇・申請'"
]) {
  if(!portalFile.includes(homePortalMarker)){console.error('v0.11.9 home portal missing: '+homePortalMarker);failed=true;}
}
if(!indexText.includes("include_('AppHomePortal')")||
  !serverCode.includes('pendingRequests: pendingRequests')||
  !app.includes("if(requestSession!==state.sessionToken||requestData!==state.data)return;")){
  console.error('v0.11.9 home data, session guard or route integration missing.');failed=true;
}
for(const homePortalStyle of [
  '.home-portal-header','.home-portal-stats','.home-portal-layout','.home-portal-agenda-empty',
  '.home-portal-task-row','.home-portal-shortcut','.home-portal-stat:focus-visible',
  '@media(max-width:1010px)','home-portal-priorities{grid-column:2;grid-row:1}',
  'html[data-theme="dark"] .home-portal-header'
]){
  if(!styles.includes(homePortalStyle)){console.error('v0.11.9 home responsive style missing: '+homePortalStyle);failed=true;}
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

if (!app.includes("content.classList.toggle('one-screen',state.page==='home'||state.page==='attendance'||state.page==='worklog')") ||
    !app.includes("content.classList.toggle('attendance-one-screen',state.page==='attendance')") ||
    !app.includes("content.classList.toggle('worklog-one-screen',state.page==='worklog')")) {
  console.error('Desktop one-screen mode must cover home, attendance, and worklog with page-specific host classes.');
  failed = true;
}
if (!styles.includes('@media(max-width:1140px){.content.one-screen:has(>.home-screen){height:auto;overflow:visible}')) {
  console.error('Home dashboard must fall back to normal scrolling before the desktop columns become too narrow.');
  failed = true;
}
if (!styles.includes('@media(max-height:760px) and (min-width:901px)')) {
  console.error('Home dashboard needs a compact desktop mode for shorter viewports.');
  failed = true;
}
if (!styles.includes('@media(min-width:1141px)') ||
    !styles.includes('.content.one-screen.attendance-one-screen') ||
    !styles.includes('@media(max-width:1140px)')) {
  console.error('Attendance dashboard needs desktop one-screen rules and a narrow-screen scroll fallback.');
  failed = true;
}
if (!app.includes("preview&&preview._sample") || !app.includes("permissions&&state.data.permissions.adminConsole")) {
  console.error('Attendance QA sample must be visibly marked and ADMIN-only.');
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
if (authCode.includes("prototypePin: '000000'")) {
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

for (const prototypeSafetyMarker of [
  'prototypeMode: false',
  'function prototypeSettingEnabled_(',
  'function prototypeModeEnabledForEnvironment_(',
  "normalizeRuntimeEnvironment_(environment)!=='PRODUCTION'",
  'function isPrototypeConfigured_(',
  "prototypeModeEnabledForEnvironment_('TRUE',getRuntimeEnvironment_())"
]) {
  if (!authCode.includes(prototypeSafetyMarker)) {
    console.error('Production prototype-auth safety missing: ' + prototypeSafetyMarker);
    failed = true;
  }
}
if (authCode.includes("prototypePin: isPrototypeMode_() ? AUTH.prototypePin : ''") || app.includes('cfg.prototypePin')) {
  console.error('Prototype PIN must not be returned to or rendered by the browser.');
  failed = true;
}
if (!maintenanceCode.includes('const prototypeMode=isPrototypeConfigured_();') || !maintenanceCode.includes('prototypeAccessEffective:prototypeAccessEffective')) {
  console.error('Production readiness must detect configured prototype mode separately from effective production access.');
  failed = true;
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
