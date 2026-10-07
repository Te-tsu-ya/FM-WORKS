import { execSync } from 'node:child_process';

function safeRef(value) {
  return /^[0-9a-f]{40}$/i.test(String(value||'')) ? String(value) : '';
}

function changedFiles() {
  const before = safeRef(process.env.GITHUB_EVENT_BEFORE);
  const after = safeRef(process.env.GITHUB_SHA) || 'HEAD';
  const baseRef = String(process.env.GITHUB_BASE_REF || '').trim();

  let args = ['git','diff','--name-only','HEAD^','HEAD'];

  if (baseRef) {
    try {
      const mergeBase = execSync('git merge-base HEAD origin/' + baseRef, { encoding:'utf8' }).trim();
      if (mergeBase) args = ['git','diff','--name-only',mergeBase,'HEAD'];
    } catch (_) {}
  } else if (before && !/^0+$/.test(before)) {
    args = ['git','diff','--name-only',before,after];
  }

  try {
    const command = args.map(x => /\s/.test(x) ? JSON.stringify(x) : x).join(' ');
    return execSync(command, { encoding:'utf8' })
      .split(/\r?\n/)
      .map(x=>x.trim())
      .filter(Boolean);
  } catch (_) {
    console.log('Documentation sync check skipped: comparison commit unavailable.');
    return [];
  }
}

const changed = changedFiles();
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
