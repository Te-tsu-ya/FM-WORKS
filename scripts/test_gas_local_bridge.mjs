import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  RELEASE_BRANCH, KNOWN_DEPLOYMENT_ID, INITIAL_EXPECTED_VERSION, INITIAL_BASELINE_COMMIT, checkClaspProject, claspInvocation,
  extractDeployment, verifyDeployResult, validateRequestedCommit, contentHashes,
  compareInventories, assertNoRemoteDrift, assertPublishedSnapshot, sameSourceSnapshot
} from './gas_local_bridge_core.mjs';

const old='a'.repeat(40),now='b'.repeat(40);
assert.equal(RELEASE_BRANCH,'deploy/gas-production');
assert.ok(KNOWN_DEPLOYMENT_ID.startsWith('AKfy'));
assert.equal(INITIAL_EXPECTED_VERSION,192);
assert.deepEqual(claspInvocation(['list-deployments'], 'linux'), {command:'clasp',args:['list-deployments']});
const windowsInvocation=claspInvocation(['create-deployment','--deploymentId',KNOWN_DEPLOYMENT_ID,'--description','FM WORKS abcd'], 'win32', {ComSpec:'C:\\Windows\\System32\\cmd.exe'});
assert.equal(windowsInvocation.args[0],'/d');
assert.equal(windowsInvocation.args[2],'/c');
assert.match(windowsInvocation.args[3],/clasp\.cmd create-deployment/);
assert.match(windowsInvocation.args[3],/"FM WORKS abcd"/);
assert.throws(()=>claspInvocation(['foo & del *'], 'win32'),/Unsafe clasp/);

// Windows registration is intentionally opt-in and runs a read-only preflight first.
const winInstall=fs.readFileSync(new URL('./Install-GasLocalBridgeWindows.ps1',import.meta.url),'utf8');
const winRunner=fs.readFileSync(new URL('./Run-GasLocalBridgeWindows.ps1',import.meta.url),'utf8');
const setup=fs.readFileSync(new URL('./setup_gas_local_bridge.mjs',import.meta.url),'utf8');
for(const marker of ['New-ScheduledTaskTrigger','-RepetitionInterval','New-TimeSpan -Minutes 5','Register-ScheduledTask','-LogonType Interactive','--preflight','-MultipleInstances IgnoreNew'])
  assert.ok(winInstall.includes(marker),'missing Windows task safety control: '+marker);
for(const marker of ['--once','windows-task.log','clasp.cmd'])
  assert.ok(winRunner.includes(marker),'missing Windows task runner requirement: '+marker);
for(const marker of ['--install-windows','--status-windows','--remove-windows'])
  assert.ok(setup.includes(marker),'setup CLI does not expose Windows operation: '+marker);
assert.ok(!winInstall.includes('Register-ScheduledTask -Force'),'Windows installation must not overwrite an existing task');


assert.match(INITIAL_BASELINE_COMMIT,/^[a-f0-9]{40}$/);
assert.deepEqual(checkClaspProject({scriptId:'S'.repeat(48),rootDir:'src/'}),{scriptId:'S'.repeat(48),rootDir:'src'});
assert.throws(()=>checkClaspProject({scriptId:'S'.repeat(48),rootDir:'elsewhere'}),/rootDir/);
assert.throws(()=>checkClaspProject({scriptId:'',rootDir:'src'}),/Script ID/);
assert.equal(extractDeployment(' - '+KNOWN_DEPLOYMENT_ID+' @192\n'),192);
assert.equal(verifyDeployResult('Deployed '+KNOWN_DEPLOYMENT_ID+' @193'),193);
assert.throws(()=>extractDeployment(' - SOME_OTHER_ID @192\n'),/not found/);
assert.throws(()=>extractDeployment(KNOWN_DEPLOYMENT_ID+' @192\n'+KNOWN_DEPLOYMENT_ID+' @191'),/single/);
assert.throws(()=>extractDeployment(KNOWN_DEPLOYMENT_ID+' unknown'),/@version/);
assert.throws(()=>verifyDeployResult('Made another deployment @194'),/existing/);
assert.throws(()=>verifyDeployResult(KNOWN_DEPLOYMENT_ID+' no version'),/@version/);
assert.equal(validateRequestedCommit({mainSha:now,requestedSha:now,previouslyPublishedSha:old}),true);
assert.equal(validateRequestedCommit({mainSha:now,requestedSha:now,previouslyPublishedSha:now}),false);
assert.throws(()=>validateRequestedCommit({mainSha:now,requestedSha:old}),/older snapshot/);
assert.throws(()=>validateRequestedCommit({mainSha:'bad',requestedSha:now}),/invalid/);
const original=contentHashes({'Code.gs':'function foo(){}\r\n','Styles.html':'<style>a</style>','appsscript.json':'{"a":1,"b":2}'});
const same=contentHashes({'Code.gs':'function foo(){}\n','Styles.html':'<style>a</style>\n','appsscript.json':'{"b":2,"a":1}'});
assert.deepEqual(original,same,'CRLF/final line and JSON key ordering are irrelevant');
assert.throws(()=>contentHashes({'../not-allowed.js':'bad'}),/Unsupported/);
assert.deepEqual(compareInventories(original,{'Code.gs':original['Code.gs']}),{newFiles:['appsscript.json','Styles.html']});
assert.throws(()=>compareInventories(original,{...original,'Extra.gs':'dead'}),/would delete/);
assert.doesNotThrow(()=>assertNoRemoteDrift(original,same));
assert.throws(()=>assertNoRemoteDrift(original,{...same,'Code.gs':'changed'}),/outside approved/);
assert.doesNotThrow(()=>assertPublishedSnapshot(original,same));
assert.equal(sameSourceSnapshot(original,same),true);
assert.equal(sameSourceSnapshot(original,{...same,'Code.gs':'changed'}),false);
assert.throws(()=>assertPublishedSnapshot(original,{...same,'Code.gs':'changed'}),/differs/);
assert.throws(()=>assertPublishedSnapshot(original,{'Code.gs':same['Code.gs']}),/differs/);
console.log('PASS local GAS bridge core: target pinning, immutable deployment verification, release SHA protection, source inventory, drift and post-push snapshot safeguards');


// Synthetic integration: bare local Git remote + fake clasp. No GitHub or Google request.
const self=path.dirname(fileURLToPath(import.meta.url));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-bridge-test-'));
function cmd(bin,args,cwd,env={}) {
 const {FM_FAKE_INPUT, ...actualEnv}=env;
 const r=spawnSync(bin,args,{cwd,env:{...process.env,...actualEnv},input:FM_FAKE_INPUT,
   encoding:'utf8',maxBuffer:3*1024*1024,timeout:60000});
 return {code:r.status,stdout:r.stdout||'',stderr:r.stderr||'',error:r.error};
}
function ok(bin,args,cwd,env={}) {
 const r=cmd(bin,args,cwd,env);
 assert.equal(r.code,0,`${bin} ${args.join(' ')}: ${r.stderr.slice(-800)}`);
 return r.stdout;
}
try {
 const origin=path.join(tmp,'remote with spaces.git'),work=path.join(tmp,'work with spaces'),fake=path.join(tmp,'fake bin'),server=path.join(tmp,'fake gas');
 fs.mkdirSync(fake);fs.mkdirSync(server);fs.mkdirSync(path.join(server,'source'));fs.mkdirSync(path.join(server,'immutable'));
 ok('git',['init','--bare','--initial-branch=main',origin],tmp);
 fs.mkdirSync(work);ok('git',['init','--initial-branch=main'],work);
 ok('git',['config','user.email','local@example.invalid'],work);
 ok('git',['config','user.name','Test'],work);
 ok('git',['remote','add','origin',origin],work);
 fs.mkdirSync(path.join(work,'scripts'));fs.mkdirSync(path.join(work,'src'));
 for(const name of ['gas_local_bridge_core.mjs','gas_local_bridge.mjs'])
  fs.copyFileSync(path.join(self,name),path.join(work,'scripts',name));
 fs.writeFileSync(path.join(work,'scripts/run_local_checks.mjs'),"console.log('PASS simulated checks');\n");
 fs.writeFileSync(path.join(work,'.gitignore'),'.clasp.json\nartifacts/\n');
 fs.writeFileSync(path.join(work,'src/Code.gs'),"const APP={version:'0.25.4'};\n");
 fs.writeFileSync(path.join(work,'src/Styles.html'),'<style>.sidebar{background:white}</style>\n');
 fs.writeFileSync(path.join(work,'src/appsscript.json'),'{"timeZone":"Asia/Tokyo"}\n');
 fs.writeFileSync(path.join(work,'.clasp.json'),JSON.stringify({scriptId:'S'.repeat(50),rootDir:'src'}));
 for(const file of fs.readdirSync(path.join(work,'src')))
  fs.copyFileSync(path.join(work,'src',file),path.join(server,'source',file));
 fs.writeFileSync(path.join(server,'source/Code.gs'),"const APP={version:'0.25.4'};\n");
 for(const name of fs.readdirSync(path.join(server,'source')))
  fs.copyFileSync(path.join(server,'source',name),path.join(server,'immutable',name));
 fs.writeFileSync(path.join(server,'version'),'192');
 const fakeCli=`import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),server=process.env.FM_FAKE_GAS,dep=process.env.FM_FAKE_DEPLOYMENT_ID;
const dir=path.join(server,'source');
if(args[0]==='list-deployments'){
 console.log('- '+dep+' @'+fs.readFileSync(path.join(server,'version'),'utf8').trim()+' Web app');
}else if(args[0]==='pull'){
 const isVersioned=args[1]==='--versionNumber';
 if(isVersioned && Number(args[2])!==Number(fs.readFileSync(path.join(server,'version'),'utf8')))process.exit(8);
 const remote=isVersioned?path.join(server,'immutable'):dir;
 for(const name of fs.readdirSync(remote))fs.copyFileSync(path.join(remote,name),path.join(process.cwd(),name));
}else if(args[0]==='push'){
 const source=path.join(process.cwd(),'src');
 if(!fs.existsSync(source))process.exit(7);
 fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
 for(const name of fs.readdirSync(source))if(/\.(?:gs|html|json)$/.test(name))fs.copyFileSync(path.join(source,name),path.join(dir,name));
}else if(args[0]==='create-deployment'){
 if(args[1]!=='--deploymentId'||args[2]!==dep)process.exit(4);
 const immutable=path.join(server,'immutable');
 fs.rmSync(immutable,{recursive:true,force:true});fs.mkdirSync(immutable,{recursive:true});
 for(const name of fs.readdirSync(dir))fs.copyFileSync(path.join(dir,name),path.join(immutable,name));
 const n=Number(fs.readFileSync(path.join(server,'version'),'utf8'))+1;
 fs.writeFileSync(path.join(server,'version'),String(n));console.log('Deployed '+dep+' @'+n);
}else process.exit(7);
`;
 fs.writeFileSync(path.join(fake,'fake-clasp.mjs'),fakeCli);
 fs.writeFileSync(path.join(fake,'clasp'),'#!/bin/sh\nexec node "$(dirname "$0")/fake-clasp.mjs" "$@"\n',{mode:0o755});
 fs.writeFileSync(path.join(fake,'clasp.cmd'),'@echo off\r\nnode "%~dp0fake-clasp.mjs" %*\r\n');
 ok('git',['add','scripts','src','.gitignore'],work);ok('git',['commit','-m','[skip ci] initial bridge'],work);
 const initialBaseline=ok('git',['rev-parse','HEAD'],work).trim();
 fs.writeFileSync(path.join(work,'src/Code.gs'),"const APP={version:'0.25.5'};\n");
 ok('git',['add','src/Code.gs'],work);ok('git',['commit','-m','[skip ci] approved update'],work);
 ok('git',['branch','deploy/gas-production'],work);
 ok('git',['push','-u','origin','main','deploy/gas-production'],work);
 const env={PATH:fake+path.delimiter+process.env.PATH,FM_FAKE_GAS:server,FM_FAKE_DEPLOYMENT_ID:KNOWN_DEPLOYMENT_ID,FM_WORKS_INITIAL_GAS_BASELINE_SHA:initialBaseline};
 let r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--preflight'],work,env);
 assert.equal(r.code,0,'preflight: '+r.stderr);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8'),'192','preflight never deploys');
 // The first-ever release also refuses unpublished manual changes to GAS HEAD.
 fs.writeFileSync(path.join(server,'source/Code.gs'),'function unexpectedManualEdit(){}\n');
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--once'],work,env);
 assert.notEqual(r.code,0,'initial baseline drift must block release');
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8'),'192','unapproved first deployment is unchanged');
 fs.writeFileSync(path.join(server,'source/Code.gs'),"const APP={version:'0.25.4'};\n");
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--once'],work,env);
 assert.equal(r.code,0,'first publish: '+r.stderr);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8').trim(),'193','existing deployment updated once');
 const st=JSON.parse(fs.readFileSync(path.join(work,'artifacts/gas-local-bridge/state.json'),'utf8'));
 assert.equal(st.version,193);
 assert.equal(st.status,'DEPLOYED_SOURCE_VERIFIED_BROWSER_PENDING');
 assert.equal(ok('git',['rev-parse','refs/remotes/origin/main'],work).trim().length,40);
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--once'],work,env);
 assert.equal(r.code,0,'idle run: '+r.stderr);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8').trim(),'193','idempotent release');
 assert.equal(ok('git',['ls-remote','origin','refs/heads/deploy/gas-published'],work).split('\t')[0].length,40,'GitHub published receipt exists');
 // Documentation-only release does not issue another GAS version.
 fs.writeFileSync(path.join(work,'README.md'),'documentation only\n');
 ok('git',['add','README.md'],work);ok('git',['commit','-m','[skip ci] docs only'],work);
 ok('git',['branch','-f','deploy/gas-production','main'],work);
 ok('git',['push','origin','main','deploy/gas-production'],work);
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--once'],work,env);
 assert.equal(r.code,0,'docs-only release: '+r.stderr);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8').trim(),'193','docs-only change does not create new GAS version');
 const publishedReceipt=ok('git',['ls-remote','origin','refs/heads/deploy/gas-published'],work).split('\t')[0];
 const latestMain=ok('git',['rev-parse','main'],work).trim();
 assert.equal(publishedReceipt,latestMain,'receipt matches latest source-identical approval');
 // An out-of-band GAS edit is a blocking regression, not silently overwritten.
 fs.writeFileSync(path.join(server,'source/Code.gs'),'function changedOutsideGitHub(){}\n');
 fs.writeFileSync(path.join(work,'src/Code.gs'),"const APP={version:'0.25.6'};\n");
 ok('git',['add','src/Code.gs'],work);ok('git',['commit','-m','[skip ci] next release'],work);
 ok('git',['branch','-f','deploy/gas-production','main'],work);
 ok('git',['push','origin','main','deploy/gas-production'],work);
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--once'],work,env);
 assert.notEqual(r.code,0,'unexpected external GAS edit must fail');
 assert.match(r.stderr,/outside approved publisher/);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8').trim(),'193','drift does not deploy');

 // Manual Windows batch: use main even when the approval pointer is stale.
 fs.writeFileSync(path.join(server,'source/Code.gs'),"const APP={version:'0.25.5'};\n");
 fs.writeFileSync(path.join(work,'src/Code.gs'),"const APP={version:'0.25.7'};\n");
 ok('git',['add','src/Code.gs'],work);ok('git',['commit','-m','[skip ci] manual main release'],work);
 ok('git',['push','origin','main'],work);
 const manualSha=ok('git',['rev-parse','main'],work).trim();
 const correctEnv={...env,FM_WORKS_MANUAL_EXPECTED_SHA:manualSha};
 const wrongEnv={...env,FM_WORKS_MANUAL_EXPECTED_SHA:'f'.repeat(40)};
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--preflight-main'],work,correctEnv);
 assert.equal(r.code,0,'manual main preflight: '+r.stderr);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8').trim(),'193','manual preflight read only');
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--deploy-main'],work,wrongEnv);
 assert.notEqual(r.code,0,'unconfirmed main SHA blocked');
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8').trim(),'193');
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--deploy-main'],work,correctEnv);
 assert.equal(r.code,0,'manual main publish: '+r.stderr);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8').trim(),'194');
 const manualReceipt=ok('git',['ls-remote','origin','refs/heads/deploy/gas-published'],work).split('\t')[0];
 assert.equal(manualReceipt,manualSha,'manual release records exact published SHA');
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--deploy-main'],work,correctEnv);
 assert.equal(r.code,0,'same main commit idempotent');
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8').trim(),'194');
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--once'],work,env);
 assert.notEqual(r.code,0,'stale approval pointer must not be deployed');
 const statusFile=path.join(work,'artifacts/gas-local-bridge/state.json');
 fs.rmSync(statusFile);
 fs.writeFileSync(path.join(server,'source/Code.gs'),'function unknownEditorChange(){}\n');
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--adopt-baseline-prompt'],work,
   {...env,FM_FAKE_INPUT:manualSha+'\n'});
 assert.notEqual(r.code,0,'bootstrap refuses unpublished GAS HEAD edits');
 assert.equal(fs.existsSync(statusFile),false);
 fs.writeFileSync(path.join(server,'source/Code.gs'),"const APP={version:'0.25.7'};\n");
 r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--adopt-baseline-prompt'],work,
   {...env,FM_FAKE_INPUT:manualSha+'\n'});
 assert.equal(r.code,0,'read-only immutable GAS bootstrap: '+r.stderr);
 const adopted=JSON.parse(fs.readFileSync(statusFile,'utf8'));
 assert.equal(adopted.commit,manualSha);
 assert.equal(adopted.version,194);
 assert.match(adopted.status,/ADOPTED_EXISTING_DEPLOYMENT/);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8').trim(),'194');
 console.log('PASS manual GAS main release: pinned SHA, adopted baseline, remote drift refusal, same URL, idempotent');

 console.log('PASS local GAS bridge fake end-to-end: preflight read-only, one controlled deploy, idempotency, remote drift stops publication (portable Node/clasp fake)');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
