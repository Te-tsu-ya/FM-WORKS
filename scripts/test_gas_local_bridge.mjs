import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  RELEASE_BRANCH, KNOWN_DEPLOYMENT_ID, INITIAL_EXPECTED_VERSION, INITIAL_BASELINE_COMMIT, checkClaspProject,
  extractDeployment, verifyDeployResult, validateRequestedCommit, contentHashes,
  compareInventories, assertNoRemoteDrift, assertPublishedSnapshot, sameSourceSnapshot
} from './gas_local_bridge_core.mjs';

const old='a'.repeat(40),now='b'.repeat(40);
assert.equal(RELEASE_BRANCH,'deploy/gas-production');
assert.ok(KNOWN_DEPLOYMENT_ID.startsWith('AKfy'));
assert.equal(INITIAL_EXPECTED_VERSION,192);
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
 const origin=path.join(tmp,'remote.git'),work=path.join(tmp,'work'),fake=path.join(tmp,'fake-bin'),server=path.join(tmp,'fake-gas');
 fs.mkdirSync(fake);fs.mkdirSync(server);fs.mkdirSync(path.join(server,'source'));
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
 fs.writeFileSync(path.join(server,'version'),'192');
 const fakeBin=`#!/bin/sh
set -eu
case "$1" in
list-deployments) echo "- $FM_FAKE_DEPLOYMENT_ID @$(cat "$FM_FAKE_GAS/version") Web app" ;;
pull) cp "$FM_FAKE_GAS/source/"* . ;;
push) cp src/* "$FM_FAKE_GAS/source/" ;;
create-deployment)
  shift
  [ "$1" = "--deploymentId" ] || exit 4
  [ "$2" = "$FM_FAKE_DEPLOYMENT_ID" ] || exit 5
  old=$(cat "$FM_FAKE_GAS/version")
  next=$((old + 1))
  echo "$next" > "$FM_FAKE_GAS/version"
  echo "Deployed $FM_FAKE_DEPLOYMENT_ID @$next"
  ;;
*) exit 7 ;;
esac
`;
 fs.writeFileSync(path.join(fake,'clasp'),fakeBin,{mode:0o755});
 ok('git',['add','scripts','src','.gitignore'],work);ok('git',['commit','-m','[skip ci] initial bridge'],work);
 const initialBaseline=ok('git',['rev-parse','HEAD'],work).trim();
 fs.writeFileSync(path.join(work,'src/Code.gs'),"const APP={version:'0.25.5'};\n");
 ok('git',['add','src/Code.gs'],work);ok('git',['commit','-m','[skip ci] approved update'],work);
 ok('git',['branch','deploy/gas-production'],work);
 ok('git',['push','-u','origin','main','deploy/gas-production'],work);
 const env={PATH:fake+':'+process.env.PATH,FM_FAKE_GAS:server,FM_FAKE_DEPLOYMENT_ID:KNOWN_DEPLOYMENT_ID,FM_WORKS_INITIAL_GAS_BASELINE_SHA:initialBaseline};
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
 console.log('PASS local GAS bridge fake end-to-end: preflight read-only, one controlled deploy, idempotency, remote drift stops publication');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
