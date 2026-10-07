import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd());
const required = [
  'src/appsscript.json','src/Code.gs','src/Auth.gs','src/Worklog.gs','src/Requests.gs','src/Monthly.gs','src/Employees.gs','src/Index.html','src/Styles.html','src/App.html',
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
for (const serverFile of ['Code.gs','Auth.gs','Worklog.gs','Requests.gs','Monthly.gs','Employees.gs']) {
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
const manifest = JSON.parse(fs.readFileSync(path.join(root,'src/appsscript.json'),'utf8'));
if (manifest.runtimeVersion !== 'V8') { console.error('Apps Script runtime must be V8'); failed = true; }
if (!manifest.webapp || manifest.webapp.access !== 'MYSELF' || manifest.webapp.executeAs !== 'USER_DEPLOYING') {
  console.error('Apps Script webapp manifest configuration is missing or unsafe for current test mode');
  failed = true;
}
if (failed) process.exit(1);
console.log('FM WORKS scaffold validation passed.');
