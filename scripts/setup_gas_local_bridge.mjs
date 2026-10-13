#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {checkClaspProject} from './gas_local_bridge_core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const action=process.argv[2];
const filename=path.join(root,'.clasp.json');
const escapeXml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
if (process.argv.length!==3 || !['--connect','--install-macos','--install-windows','--status-windows','--remove-windows'].includes(action)) {
  console.error('Usage: node scripts/setup_gas_local_bridge.mjs --connect|--install-macos|--install-windows|--status-windows|--remove-windows');process.exit(2);
}
if(action==='--connect'){
  if(fs.existsSync(filename)){console.error('.clasp.json already exists. Refusing to replace your current project connection.');process.exit(1);}
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{
    const id=(await rl.question('Existing FM WORKS Apps Script PROJECT Script ID (not the /exec URL ID): ')).trim();
    const config=checkClaspProject({scriptId:id,rootDir:'src'});
    fs.writeFileSync(filename,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log('Local .clasp.json created and gitignored. Run clasp login, then node scripts/gas_local_bridge.mjs --preflight.');
  } finally {rl.close();}
}
if(action==='--install-macos'){
  if(process.platform!=='darwin')throw Error('This installer is for macOS. On Windows use Task Scheduler with --once every 5 minutes.');
  if(!fs.existsSync(filename))throw Error('Run --connect and clasp login first.');
  checkClaspProject(JSON.parse(fs.readFileSync(filename,'utf8')));
  const check=spawnSync(process.execPath,['scripts/gas_local_bridge.mjs','--preflight'],{cwd:root,encoding:'utf8',maxBuffer:1024*1024,timeout:300000});
  if(check.status!==0)throw Error('Preflight failed. Fix credentials / correct GAS target before enabling background publisher.');
  const program=path.join(root,'scripts/gas_local_bridge.mjs');
  const logs=path.join(root,'artifacts/gas-local-bridge');fs.mkdirSync(logs,{recursive:true,mode:0o700});
  const dest=path.join(os.homedir(),'Library/LaunchAgents/jp.fusionmind.fmworks-gas.plist');
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  if(fs.existsSync(dest))throw Error('LaunchAgent file already exists. Inspect existing setup instead of replacing.');
  const xml=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>jp.fusionmind.fmworks-gas</string>
<key>ProgramArguments</key><array><string>${escapeXml(process.execPath)}</string><string>${escapeXml(program)}</string><string>--once</string></array>
<key>WorkingDirectory</key><string>${escapeXml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escapeXml(process.env.PATH||'/usr/local/bin:/usr/bin:/bin')}</string></dict>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>300</integer>
<key>StandardOutPath</key><string>${escapeXml(path.join(logs,'launchd.out.log'))}</string>
<key>StandardErrorPath</key><string>${escapeXml(path.join(logs,'launchd.err.log'))}</string>
</dict></plist>\n`;
  fs.writeFileSync(dest,xml,{flag:'wx',mode:0o600});
  console.log('LaunchAgent prepared at '+dest);
  console.log('To enable: launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/jp.fusionmind.fmworks-gas.plist"');
  console.log('To stop:   launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/jp.fusionmind.fmworks-gas.plist"');
  console.log('This uses local Mac resources and consumes no GitHub Actions minutes.');
}

if (['--install-windows','--status-windows','--remove-windows'].includes(action)) {
  if (process.platform !== 'win32') throw Error('Windows Task Scheduler setup must run on Windows.');
  const modes={'--install-windows':'Install','--status-windows':'Status','--remove-windows':'Remove'};
  const script=path.join(root,'scripts','Install-GasLocalBridgeWindows.ps1');
  const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Mode',modes[action]],{
    cwd:root,stdio:'inherit',windowsHide:false,timeout:600000
  });
  if (result.error || result.status !== 0) throw Error('Windows setup failed; inspect the preceding PowerShell message.');
}
