import { execSync } from 'node:child_process';

let changed = [];
try {
  changed = execSync('git diff --name-only HEAD^ HEAD', { encoding: 'utf8' })
    .split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
} catch (_) {
  console.log('Documentation sync check skipped: previous commit unavailable.');
  process.exit(0);
}
const appChanged = changed.some(p => p.startsWith('src/') && p !== 'src/GeneratedDocs.gs');
if (!appChanged) {
  console.log('No application source change; documentation sync gate not required.');
  process.exit(0);
}
const required = ['docs/REQUIREMENTS.md','docs/TECHNICAL_DESIGN.md'];
const missing = required.filter(p => !changed.includes(p));
if (missing.length) {
  console.error('Application source changed without updating both design documents: ' + missing.join(', '));
  process.exit(1);
}
console.log('Documentation sync gate passed.');
