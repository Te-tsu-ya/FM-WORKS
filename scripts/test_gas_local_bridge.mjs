import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  RELEASE_BRANCH, KNOWN_DEPLOYMENT_ID, INITIAL_EXPECTED_VERSION, INITIAL_BASELINE_COMMIT, checkClaspProject, claspInvocation,
  preferredClaspInvocation, isWindowsFailFastExit,
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
assert.equal(windowsInvocation.windowsVerbatimArguments,true,
  'Windows cmd.exe must receive command arguments without Node re-quoting');
const windowsList=claspInvocation(['list-deployments'],'win32',{ComSpec:'C:\\Windows\\System32\\cmd.exe'});
assert.deepEqual(windowsList.args,['/d','/s','/c','"clasp.cmd list-deployments"']);
assert.equal(windowsList.windowsVerbatimArguments,true);

assert.equal(isWindowsFailFastExit(3221226505,'win32'),true);
assert.equal(isWindowsFailFastExit(-1073740791,'win32'),true);
assert.equal(isWindowsFailFastExit(3221226505,'linux'),false);
assert.equal(isWindowsFailFastExit(1,'win32'),false);
// Simulate a standard global npm installation with spaces in its directory.
// The publisher should use the official JS entry point, without cmd.exe.
// If an earlier PATH directory shadows clasp.cmd, keep that earlier shim.
const claspInstallTmp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-direct-clasp-'));
try{
  const bin=path.join(claspInstallTmp,'npm global with spaces');
  const pkg=path.join(bin,'node_modules','@google','clasp');
  fs.mkdirSync(path.join(pkg,'build','src'),{recursive:true});
  fs.writeFileSync(path.join(bin,'clasp.cmd'),'@echo off\r\n');
  fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({
    name:'@google/clasp',bin:{clasp:'build/src/index.js'}}));
  fs.writeFileSync(path.join(pkg,'build','src','index.js'),
    'console.log(JSON.stringify(process.argv.slice(2)));\n');
  const argv=['create-deployment','--deploymentId',KNOWN_DEPLOYMENT_ID,
    '--description','FM WORKS test'];
  const direct=preferredClaspInvocation(argv,'win32',{PATH:bin,ComSpec:'cmd.exe'});
  assert.equal(direct.transport,'node-direct');
  assert.equal(direct.command,process.execPath);
  const child=spawnSync(direct.command,direct.args,{encoding:'utf8',timeout:15000});
  assert.equal(child.status,0,String(child.stderr||child.error?.message||''));
  assert.deepEqual(JSON.parse(String(child.stdout).trim()),argv);
  const shadow=path.join(claspInstallTmp,'earlier fake');
  fs.mkdirSync(shadow);fs.writeFileSync(path.join(shadow,'clasp.cmd'),'@echo off\r\n');
  assert.equal(preferredClaspInvocation(['pull'],'win32',{
    PATH:shadow+';'+bin,ComSpec:'cmd.exe'}).transport,'cmd-shim');
  assert.equal(preferredClaspInvocation(['pull'],'linux',{PATH:bin}).transport,'native-clasp');
}finally{fs.rmSync(claspInstallTmp,{recursive:true,force:true});}

const bridgeProgram=fs.readFileSync(new URL('./gas_local_bridge.mjs',import.meta.url),'utf8');
assert.match(bridgeProgram,/last-clasp-failure\.json/);
assert.match(bridgeProgram,/Ret[r]?ying this READ-ONLY command once/);
assert.match(bridgeProgram,/GAS source push and deployment were NOT STARTED/);
assert.match(bridgeProgram,/last-functional-report\.json/,
  'functional check report must survive temporary worktree removal');
assert.match(bridgeProgram,/Functional suite failed/,
  'failed checks must identify the blocked publication in the terminal');
assert.match(bridgeProgram,/--diagnose/,
  'read-only diagnosis must be invocable without a release-pointer update');
assert.match(bridgeProgram,/runFunctionalSuite\(tree,requested\)/,
  'publisher must persist functional test results');
assert.match(bridgeProgram,/windowsVerbatimArguments:resolved\.windowsVerbatimArguments === true/,
  'spawnSync must enable Windows verbatim mode for clasp');
assert.throws(()=>claspInvocation(['foo & del *'], 'win32'),/Unsafe clasp/);


// Windows-only smoke test: invoke a FAKE clasp.cmd through the real cmd.exe.
// Never connects to Google or GitHub. Regression for the Windows exit-code-1 bug.
if (process.platform === 'win32') {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-win-clasp-launch-'));
  try {
    fs.writeFileSync(path.join(folder,'clasp.cmd'),'@echo off\r\nnode "%~dp0echo-args.cjs" %*\r\n');
    fs.writeFileSync(path.join(folder,'echo-args.cjs'),'console.log(JSON.stringify(process.argv.slice(2)));\n');
    const env={...process.env,PATH:folder+path.delimiter+(process.env.PATH||'')};
    const cases=[
      ['list-deployments'],
      ['create-deployment','--deploymentId',KNOWN_DEPLOYMENT_ID,'--description','FM WORKS windows-probe']
    ];
    for (const argv of cases) {
      const invocation=claspInvocation(argv,'win32',env);
      const result=spawnSync(invocation.command,invocation.args,{
        cwd:folder,env,encoding:'utf8',windowsHide:true,
        windowsVerbatimArguments:invocation.windowsVerbatimArguments,timeout:15000
      });
      assert.equal(result.status,0,'Windows clasp.cmd command failed: '+String(result.stderr||result.error?.message||''));
      assert.deepEqual(JSON.parse(String(result.stdout||'').trim()),argv,
        'cmd.exe must preserve clasp argument boundaries and spaced descriptions');
    }
    console.log('PASS Windows cmd.exe /S /C + clasp.cmd: dummy list and spaced deployment arguments');
  } finally {fs.rmSync(folder,{recursive:true,force:true});}
}

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
 const r=spawnSync(bin,args,{cwd,env:{...process.env,...env},encoding:'utf8',maxBuffer:3*1024*1024,timeout:60000});
 return {code:r.status,stdout:r.stdout||'',stderr:r.stderr||'',error:r.error};
}
function ok(bin,args,cwd,env={}) {
 const r=cmd(bin,args,cwd,env);
 assert.equal(r.code,0,`${bin} ${args.join(' ')}: ${r.stderr.slice(-800)}`);
 return r.stdout;
}
try {
 const origin=path.join(tmp,'remote with spaces.git'),work=path.join(tmp,'work with spaces'),fake=path.join(tmp,'fake bin'),server=path.join(tmp,'fake gas');
 fs.mkdirSync(fake);fs.mkdirSync(server);fs.mkdirSync(path.join(server,'source'));
 ok('git',['init','--bare','--initial-branch=main',origin],tmp);
 fs.mkdirSync(work);ok('git',['init','--initial-branch=main'],work);
 ok('git',['config','user.email','local@example.invalid'],work);
 ok('git',['config','user.name','Test'],work);
 ok('git',['remote','add','origin',origin],work);
 fs.mkdirSync(path.join(work,'scripts'));fs.mkdirSync(path.join(work,'src'));
 for(const name of ['gas_local_bridge_core.mjs','gas_local_bridge.mjs'])
  fs.copyFileSync(path.join(self,name),path.join(work,'scripts',name));
 fs.writeFileSync(path.join(work,'scripts/run_local_checks.mjs'),
  "import fs from 'node:fs';\n"+
  "fs.mkdirSync('artifacts/local-verification',{recursive:true});\n"+
  "const fail=process.env.FM_SIMULATE_FUNCTIONAL_FAILURE==='1';\n"+
  "fs.writeFileSync('artifacts/local-verification/report.json',JSON.stringify({mode:'functional',passed:fail?0:1,failed:fail?1:0,skipped:0,checks:[{file:'scripts/simulated.mjs',status:fail?'FAIL':'PASS',details:fail?'Intentional local fixture error':''}]}));\n"+
  "if(fail){console.error('FAIL scripts/simulated.mjs');process.exit(1);}\n"+
  "console.log('PASS simulated checks');\n");
 fs.writeFileSync(path.join(work,'.gitignore'),'.clasp.json\nartifacts/\n');
 fs.writeFileSync(path.join(work,'src/Code.gs'),"const APP={version:'0.25.4'};\n");
 fs.writeFileSync(path.join(work,'src/Styles.html'),'<style>.sidebar{background:white}</style>\n');
 fs.writeFileSync(path.join(work,'src/appsscript.json'),'{"timeZone":"Asia/Tokyo"}\n');
 fs.writeFileSync(path.join(work,'.clasp.json'),JSON.stringify({scriptId:'S'.repeat(50),rootDir:'src'}));
 for(const file of fs.readdirSync(path.join(work,'src')))
  fs.copyFileSync(path.join(work,'src',file),path.join(server,'source',file));
 fs.writeFileSync(path.join(server,'source/Code.gs'),"const APP={version:'0.25.4'};\n");
 fs.writeFileSync(path.join(server,'version'),'192');
 const fakeCli=`import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),server=process.env.FM_FAKE_GAS,dep=process.env.FM_FAKE_DEPLOYMENT_ID;
const dir=path.join(server,'source');
if(args[0]==='list-deployments'){
 console.log('- '+dep+' @'+fs.readFileSync(path.join(server,'version'),'utf8').trim()+' Web app');
}else if(args[0]==='pull'){
 const config=JSON.parse(fs.readFileSync(path.join(process.cwd(),'.clasp.json'),'utf8'));
 const extension=config.scriptExtensions?.[0]||'.js';
 for(const name of fs.readdirSync(dir)) {
  const target=name.endsWith('.gs')?name.slice(0,-3)+extension:name;
  fs.copyFileSync(path.join(dir,name),path.join(process.cwd(),target));
 }
}else if(args[0]==='push'){
 const source=path.join(process.cwd(),'src');
 if(!fs.existsSync(source))process.exit(7);
 fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
 for(const name of fs.readdirSync(source))if(/\.(?:gs|html|json)$/.test(name))fs.copyFileSync(path.join(source,name),path.join(dir,name));
}else if(args[0]==='create-deployment'){
 if(args[1]!=='--deploymentId'||args[2]!==dep)process.exit(4);
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
 // The BAT pins the real GAS baseline to @196; this fake fixture always starts at @192.
 // Explicitly isolate the synthetic baseline from any inherited production environment.
 const env={PATH:fake+path.delimiter+process.env.PATH,
   FM_FAKE_GAS:server,FM_FAKE_DEPLOYMENT_ID:KNOWN_DEPLOYMENT_ID,
   FM_WORKS_INITIAL_GAS_VERSION:String(INITIAL_EXPECTED_VERSION),
   FM_WORKS_INITIAL_GAS_BASELINE_SHA:initialBaseline};
 assert.equal({...process.env,FM_WORKS_INITIAL_GAS_VERSION:'196',...env}.FM_WORKS_INITIAL_GAS_VERSION,
   String(INITIAL_EXPECTED_VERSION),'fake baseline must override external production baseline');
 let r=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--preflight'],work,env);
 assert.equal(r.code,0,'preflight: '+r.stderr);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8'),'192','preflight never deploys');
 let diagnosed=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--diagnose'],work,env);
 assert.equal(diagnosed.code,0,'diagnose: '+diagnosed.stderr);
 assert.match(diagnosed.stdout,/no GAS push or deployment was performed/);
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8'),'192','diagnostics never deploy');
 // A failing local suite must report its precise test, preserve evidence and never push GAS.
 const broken=cmd(process.execPath,['scripts/gas_local_bridge.mjs','--diagnose'],work,{...env,FM_SIMULATE_FUNCTIONAL_FAILURE:'1'});
 assert.notEqual(broken.code,0,'synthetic local test failure blocks release');
 assert.match(broken.stderr,/Functional suite failed: scripts\/simulated\.mjs/);
 const savedReport=path.join(work,'artifacts/gas-local-bridge/last-functional-report.json');
 assert.equal(JSON.parse(fs.readFileSync(savedReport,'utf8')).failed,1,'failure evidence survives worktree cleanup');
 assert.equal(fs.readFileSync(path.join(server,'version'),'utf8'),'192','failed checks may not deploy GAS');
 assert.equal(fs.existsSync(path.join(work,'artifacts/gas-local-bridge/pending.json')),false,
   'functional suite failure does not begin a source push');
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
 console.log('PASS local GAS bridge fake end-to-end: preflight read-only, one controlled deploy, idempotency, remote drift stops publication (portable Node/clasp fake)');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
