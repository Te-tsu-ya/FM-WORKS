import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-doc-gate-'));
const script=path.resolve('scripts/check_docs_sync.mjs');
try{
 const git=(...args)=>execFileSync('git',args,{cwd:temp,stdio:'ignore'});
 git('init');git('config','user.name','FM WORKS');git('config','user.email','local@example.invalid');
 fs.mkdirSync(path.join(temp,'src'));fs.mkdirSync(path.join(temp,'docs'));
 for(const [p,text] of Object.entries({'src/Code.gs':'const VERSION=1;\n','docs/REQUIREMENTS.md':'one\n','docs/TECHNICAL_DESIGN.md':'one\n'}))fs.writeFileSync(path.join(temp,p),text);
 git('add','.');git('commit','-m','baseline');
 const check=()=>spawnSync(process.execPath,[script],{cwd:temp,encoding:'utf8'});
 assert.equal(check().status,0,'single-commit baseline still has an executable worktree check');
 fs.writeFileSync(path.join(temp,'src/Code.gs'),'const VERSION=2;\n');
 assert.notEqual(check().status,0,'uncommitted source changes require both docs');
 fs.writeFileSync(path.join(temp,'docs/REQUIREMENTS.md'),'two\n');assert.notEqual(check().status,0,'one doc is insufficient');
 fs.writeFileSync(path.join(temp,'docs/TECHNICAL_DESIGN.md'),'two\n');assert.equal(check().status,0);
 git('add','.');git('commit','-m','source and docs');assert.equal(check().status,0,'committed source and docs are checked too');
 fs.writeFileSync(path.join(temp,'src/New.gs'),'function newFeature(){}\n');assert.notEqual(check().status,0,'untracked source files must not bypass the gate');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log('PASS local documentation gate: shallow snapshot, working tree, missing docs, committed edits and untracked source');
