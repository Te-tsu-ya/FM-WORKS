import { execFileSync } from 'node:child_process';

function git(...args) {
  return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
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
      const base=git('merge-base','HEAD','origin/'+baseRef);
      if(base)return {base,after:'HEAD'};
    }catch(_){}
  }
  if(before&&!/^0+$/.test(before))return {base:before,after};
  try{return {base:git('rev-parse','HEAD^'),after:'HEAD'};}catch(_){return null;}
}

const required=['docs/REQUIREMENTS.md','docs/TECHNICAL_DESIGN.md'];
// GPT/local execution must verify pending edits too, even in a shallow snapshot.
let worktree=[];
try{
  worktree=[...new Set((git('diff','--name-only','HEAD')+'\n'+git('ls-files','--others','--exclude-standard'))
    .split(/\r?\n/).map(x=>x.trim()).filter(Boolean))];
}catch(_){console.error('Cannot verify documentation without a Git working tree.');process.exit(1);}
if(worktree.some(p=>p.startsWith('src/')&&p!=='src/GeneratedDocs.gs')){
  const missing=required.filter(p=>!worktree.includes(p));
  if(missing.length){console.error('Pending src changes must update both design documents: '+missing.join(', '));process.exit(1);}
}
console.log('Working-tree documentation sync gate passed.');
const range=resolveRange();
if(!range){
  console.log('Committed history unavailable; working-tree documentation gate completed.');
  process.exit(0);
}

let commits=[];
try{
  commits=git('rev-list','--reverse',range.base+'..'+range.after)
    .split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
}catch(_){
  console.log('Documentation sync check skipped: commit range unavailable.');
  process.exit(0);
}

if(!commits.length){
  console.log('No commits to inspect.');
  process.exit(0);
}

const failures=[];

for(const commit of commits){
  let parent='';
  try{parent=git('rev-parse',commit+'^1');}catch(_){}
  let changed=[];
  try{
    const output=parent
      ? git('diff','--name-only',parent,commit)
      : git('diff-tree','--root','--no-commit-id','--name-only','-r',commit);
    changed=output.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  }catch(_){
    failures.push(commit.slice(0,12)+': changed files could not be inspected');
    continue;
  }

  const appChanged=changed.some(p=>p.startsWith('src/')&&p!=='src/GeneratedDocs.gs');
  if(!appChanged)continue;

  const missing=required.filter(p=>!changed.includes(p));
  if(missing.length){
    let subject='';
    try{subject=git('log','-1','--format=%s',commit);}catch(_){}
    failures.push(commit.slice(0,12)+' '+subject+' -> missing '+missing.join(', '));
  }
}

if(failures.length){
  console.error('Every commit that changes src/** must update both design documents in the same commit.');
  failures.forEach(x=>console.error(' - '+x));
  process.exit(1);
}

console.log('Per-commit documentation sync gate passed for '+commits.length+' commit(s).');
