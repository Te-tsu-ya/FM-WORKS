#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {
  RELEASE_BRANCH, KNOWN_DEPLOYMENT_ID, INITIAL_EXPECTED_VERSION, INITIAL_BASELINE_COMMIT, ACCEPTED_SOURCE,
  checkClaspProject, claspInvocation, extractDeployment, verifyDeployResult, validateRequestedCommit,
  contentHashes, compareInventories, assertNoRemoteDrift, assertPublishedSnapshot, sameSourceSnapshot
} from './gas_local_bridge_core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts/gas-local-bridge');
const statePath = path.join(output, 'state.json');
const pendingPath = path.join(output, 'pending.json');
const modes = new Set(['--once', '--watch', '--preflight']);
const args = process.argv.slice(2);
if (args.length !== 1 || !modes.has(args[0])) {
  console.error('Usage: node scripts/gas_local_bridge.mjs --preflight|--once|--watch');
  process.exit(2);
}
const mode = args[0];
fs.mkdirSync(output, {recursive:true, mode:0o700});
const lockPath = path.join(output, 'bridge.lock');
const stamp = () => new Date().toISOString();
const log = message => console.log('[' + stamp() + '] ' + message);
const errorLog = message => console.error('[' + stamp() + '] ' + message);
function run(command, argv, cwd, timeout=120000) {
  const resolved=command==='clasp' ? claspInvocation(argv) : {command,args:argv};
  const result = spawnSync(resolved.command, resolved.args, {cwd, encoding:'utf8', timeout, maxBuffer:8*1024*1024,
    windowsHide:true, windowsVerbatimArguments:resolved.windowsVerbatimArguments === true,
    env:{...process.env, GIT_TERMINAL_PROMPT:'0'}});
  if (result.error || result.status !== 0) {
    // Do not echo full stdout/stderr: OAuth/token-bearing external messages may occur.
    throw Error(command + ' command failed (' + (result.error?.code || result.status) + '). Check credentials and local logs.');
  }
  return String(result.stdout || '');
}
function readState() {return fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath,'utf8')) : null;}
function persist(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  fs.renameSync(tmp,file);
}
function localFiles(directory) {
  const files={};
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    if (!entry.isFile() || !ACCEPTED_SOURCE.test(entry.name)) continue;
    files[entry.name]=fs.readFileSync(path.join(directory,entry.name),'utf8');
  }
  const missing=['appsscript.json','Code.gs','Styles.html'].filter(name=>!(name in files));
  if (missing.length) {
    const visible=fs.readdirSync(directory,{withFileTypes:true}).filter(x=>x.isFile()&&!x.name.startsWith('.')).map(x=>x.name).sort();
    const renamed=missing.filter(x=>x.endsWith('.gs')&&visible.includes(x.replace(/\.gs$/,'.js')));
    const hint=renamed.length ? ' clasp returned .js in place of .gs: '+renamed.map(x=>x.replace(/\.gs$/,'.js')).join(', ')+'.' : '';
    throw Error('Required Apps Script sources missing: '+missing.join(', ')+
      '. Found '+visible.length+' file(s); sample: '+visible.slice(0,12).join(', ')+'.'+hint+
      ' Refusing to overwrite GAS.');
  }
  return files;
}
function gitSourceHashes(commitSha) {
  const names=run('git',['ls-tree','--name-only',commitSha+':src'],root).split(/\r?\n/).filter(name=>ACCEPTED_SOURCE.test(name));
  const files={};
  for(const name of names)files[name]=run('git',['show',commitSha+':src/'+name],root,180000);
  return contentHashes(files);
}
function currentConfig() {
  const file=path.join(root,'.clasp.json');
  if (!fs.existsSync(file)) throw Error('Missing local .clasp.json. Run one-time authenticated setup first.');
  return checkClaspProject(JSON.parse(fs.readFileSync(file,'utf8')));
}
function requireDeployment(worktree) {
  const listed=run('clasp',['list-deployments'],worktree);
  return extractDeployment(listed);
}
function pullSnapshot(baseDir, scriptId) {
  fs.mkdirSync(baseDir,{recursive:true});
  // clasp defaults to writing Script files with .js extension when pulling.
  // Our GitHub source inventory uses .gs; pin the preferred extension so
  // read-only remote snapshots compare against the same filenames.
  const pullConfig={scriptId,rootDir:'.',scriptExtensions:['.gs','.js'],htmlExtensions:['.html']};
  fs.writeFileSync(path.join(baseDir,'.clasp.json'),JSON.stringify(pullConfig)+'\n',{mode:0o600});
  run('clasp',['pull'],baseDir,180000);
  return contentHashes(localFiles(baseDir));
}
function cycle({preflight=false}={}) {
  const cfg=currentConfig();
  const oldState=readState();
  if (fs.existsSync(pendingPath))
    throw Error('A previous release may have been interrupted. Inspect pending.json and GAS before clearing it.');
  // This is NOT GitHub Actions; git fetch uses local Git authentication.
  run('git',['fetch','--no-tags','origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/'+RELEASE_BRANCH+':refs/remotes/origin/'+RELEASE_BRANCH],root,180000);
  const main=run('git',['rev-parse','refs/remotes/origin/main'],root).trim();
  const requested=run('git',['rev-parse','refs/remotes/origin/'+RELEASE_BRANCH],root).trim();
  const necessary=validateRequestedCommit({mainSha:main,requestedSha:requested,previouslyPublishedSha:oldState?.commit});
  if (!necessary && !preflight) {log('No new approved GAS release request.');return;}
  const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-gas-release-'));
  const tree=path.join(sandbox,'source');
  let worktreeAdded=false, pushStarted=false;
  try {
    run('git',['worktree','add','--detach',tree,requested],root,180000);
    worktreeAdded=true;
    fs.writeFileSync(path.join(tree,'.clasp.json'),JSON.stringify(cfg)+'\n',{mode:0o600});
    const candidate=contentHashes(localFiles(path.join(tree,'src')));
    const currentVersion=requireDeployment(tree);
    const initialVersion=Number(process.env.FM_WORKS_INITIAL_GAS_VERSION || INITIAL_EXPECTED_VERSION);
    if (!Number.isSafeInteger(initialVersion) || initialVersion < 1) throw Error('Invalid expected initial GAS version.');
    if (!oldState && currentVersion !== initialVersion)
      throw Error('Initial GAS version is not the expected @'+initialVersion+'. Inspect release history first.');
    if (oldState && currentVersion !== oldState.version)
      throw Error('Remote deployment version changed outside this bridge.');
    const remoteBefore=pullSnapshot(path.join(sandbox,'remote-before'),cfg.scriptId);
    compareInventories(candidate,remoteBefore);
    if (!oldState) {
      const initialCommit=process.env.FM_WORKS_INITIAL_GAS_BASELINE_SHA || INITIAL_BASELINE_COMMIT;
      if (!/^[a-f0-9]{40}$/i.test(initialCommit)) throw Error('Invalid recorded initial GAS source baseline commit.');
      const baseline=gitSourceHashes(initialCommit);
      assertPublishedSnapshot(baseline,remoteBefore);
    }
    assertNoRemoteDrift(oldState?.remoteHashes,remoteBefore);
    log('Verified release ref, existing GAS target @'+currentVersion+' and remote file inventory.');
    if (preflight) {log('Preflight only: no source push or deployment.');return;}
    if (oldState && sameSourceSnapshot(candidate,oldState.remoteHashes)) {
      persist(statePath,{...oldState,commit:requested,updatedAt:stamp(),status:'NO_SOURCE_CHANGE_PREVIOUS_DEPLOYMENT_RETAINED'});
      try {run('git',['push','origin',requested+':refs/heads/deploy/gas-published'],root,180000);}
      catch(e){errorLog('Could not advance source-identical GitHub receipt; local state was updated.');}
      log('Only non-GAS files changed. Existing deployment retained without consuming Google quota.');
      return;
    }
    log('Running local functional suite (no GitHub Actions).');
    run(process.execPath,['scripts/run_local_checks.mjs','--functional'],tree,1800000);
    // Tests may run for minutes. Abort if anyone changed remote code during verification.
    const justBeforePush=pullSnapshot(path.join(sandbox,'remote-just-before-push'),cfg.scriptId);
    assertNoRemoteDrift(remoteBefore,justBeforePush);
    // Persist intent before changing remote source. A crash never silently retries.
    persist(pendingPath,{requestedCommit:requested,previousVersion:currentVersion,startedAt:stamp(),phase:'before-source-push'});
    pushStarted=true;
    run('clasp',['push','--force'],tree,300000);
    persist(pendingPath,{requestedCommit:requested,previousVersion:currentVersion,startedAt:stamp(),phase:'source-pushed-deployment-unknown'});
    const deployed=run('clasp',['create-deployment','--deploymentId',KNOWN_DEPLOYMENT_ID,
      '--description','FM WORKS '+requested.slice(0,12)],tree,180000);
    const newVersion=verifyDeployResult(deployed);
    if (newVersion <= currentVersion) throw Error('Deployment version did not advance.');
    const currentAfter=requireDeployment(tree);
    if (currentAfter !== newVersion) throw Error('Deployment list does not confirm updated immutable version.');
    const remoteAfter=pullSnapshot(path.join(sandbox,'remote-after'),cfg.scriptId);
    assertPublishedSnapshot(candidate,remoteAfter);
    persist(statePath,{commit:requested,version:newVersion,remoteHashes:remoteAfter,updatedAt:stamp(),
      status:'DEPLOYED_SOURCE_VERIFIED_BROWSER_PENDING'});
    fs.rmSync(pendingPath,{force:true});
    // A fast-forward Git branch records which exact commit was actually deployed.
    // This is a normal git push, NOT GitHub Actions; browser acceptance is still separate.
    try {
      run('git',['push','origin',requested+':refs/heads/deploy/gas-published'],root,180000);
      log('Published-commit receipt updated on GitHub (browser acceptance still pending).');
    } catch(e) {errorLog('GitHub receipt branch could not be updated; GAS release state remains recorded locally.');}
    log('GAS existing deployment updated to @'+newVersion+' and source verified. Browser/login test remains separate.');
  } catch (error) {
    if (pushStarted) errorLog('Remote source or deployment may have changed. Pending record retained; inspect before retry.');
    throw error;
  } finally {
    if (worktreeAdded) {
      try {run('git',['worktree','remove','--force',tree],root,180000);} catch(e) {errorLog('Could not remove temporary Git worktree.');}
    }
    fs.rmSync(sandbox,{recursive:true,force:true});
  }
}
let lockFd;
try {lockFd=fs.openSync(lockPath,'wx',0o600);}catch(e){throw Error('Bridge is already running. Remove stale lock only after checking the process.');}
process.on('exit',()=>{try{fs.closeSync(lockFd);fs.unlinkSync(lockPath);}catch{}});
if (mode==='--watch') {
  log('Watching approved release pointer every 5 minutes; PC must stay awake.');
  for (;;) {
    try{cycle();}catch(e){errorLog(String(e.message||e));}
    await sleep(5*60*1000);
  }
} else {
  try{cycle({preflight:mode==='--preflight'});}catch(e){errorLog(String(e.message||e));process.exitCode=1;}
}
