import { execSync } from 'node:child_process';

function exec(command) {
  return execSync(command, { encoding:'utf8' }).trim();
}

function safeRef(value) {
  return /^[0-9a-f]{40}$/i.test(String(value||'')) ? String(value) : '';
}

function resolveRange() {
  const before=safeRef(process.env.GITHUB_EVENT_BEFORE);
  const after=safeRef(process.env.GITHUB_SHA)||'HEAD';
  const baseRef=String(process.env.GITHUB_BASE_REF||'').trim();

  if(baseRef){
    try{
      const base=exec('git merge-base HEAD origin/'+baseRef);
      if(base)return {base,after:'HEAD'};
    }catch(_){}
  }
  if(before&&!/^0+$/.test(before))return {base:before,after};
  try{return {base:exec('git rev-parse HEAD^'),after:'HEAD'};}catch(_){return null;}
}

const range=resolveRange();
if(!range){
  console.log('Documentation sync check skipped: comparison commit unavailable.');
  process.exit(0);
}

let commits=[];
try{
  commits=exec('git rev-list --reverse '+range.base+'..'+range.after)
    .split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
}catch(_){
  console.log('Documentation sync check skipped: commit range unavailable.');
  process.exit(0);
}

if(!commits.length){
  console.log('No commits to inspect.');
  process.exit(0);
}

const required=['docs/REQUIREMENTS.md','docs/TECHNICAL_DESIGN.md'];
const failures=[];

for(const commit of commits){
  let parent='';
  try{parent=exec('git rev-parse '+commit+'^1');}catch(_){}
  let changed=[];
  try{
    const command=parent
      ? 'git diff --name-only '+parent+' '+commit
      : 'git diff-tree --root --no-commit-id --name-only -r '+commit;
    changed=exec(command).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  }catch(_){
    failures.push(commit.slice(0,12)+': changed files could not be inspected');
    continue;
  }

  const appChanged=changed.some(p=>p.startsWith('src/')&&p!=='src/GeneratedDocs.gs');
  if(!appChanged)continue;

  const missing=required.filter(p=>!changed.includes(p));
  if(missing.length){
    let subject='';
    try{subject=exec('git log -1 --format=%s '+commit);}catch(_){}
    failures.push(commit.slice(0,12)+' '+subject+' -> missing '+missing.join(', '));
  }
}

if(failures.length){
  console.error('Every commit that changes src/** must update both design documents in the same commit.');
  failures.forEach(x=>console.error(' - '+x));
  process.exit(1);
}

console.log('Per-commit documentation sync gate passed for '+commits.length+' commit(s).');
