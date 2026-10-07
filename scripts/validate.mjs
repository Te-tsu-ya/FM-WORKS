import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd());
const required = [
  'src/appsscript.json','src/Code.gs','src/Index.html','src/Styles.html','src/App.html',
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
try {
  const server = fs.readFileSync(path.join(root,'src/Code.gs'),'utf8');
  new Function(server);
} catch (err) {
  console.error('Server JavaScript syntax error:', err.message);
  failed = true;
}
const manifest = JSON.parse(fs.readFileSync(path.join(root,'src/appsscript.json'),'utf8'));
if (manifest.runtimeVersion !== 'V8') { console.error('Apps Script runtime must be V8'); failed = true; }
if (!manifest.webapp || manifest.webapp.access !== 'MYSELF' || manifest.webapp.executeAs !== 'USER_DEPLOYING') {
  console.error('Apps Script webapp manifest configuration is missing or unsafe for current test mode');
  failed = true;
}
if (failed) process.exit(1);
console.log('FM WORKS scaffold validation passed.');
