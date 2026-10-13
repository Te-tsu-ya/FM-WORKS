import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Run real checks in the GPT/local environment. Never dispatch GitHub jobs.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const args=process.argv.slice(2),functional=args.includes('--functional');
if(args.some(a=>a!=='--functional'))throw Error('Usage: node scripts/run_local_checks.mjs [--functional]');
const plan=JSON.parse(fs.readFileSync('scripts/local-checks.json','utf8'));
if(plan.policy!=='GPT_ONLY_NO_GITHUB_ACTIONS')throw Error('Invalid local verification policy.');
const timeZone=JSON.parse(fs.readFileSync('src/appsscript.json','utf8')).timeZone;
if(!timeZone)throw Error('Missing GAS time zone');
const report={timeZone,policy:plan.policy,startedAt:new Date().toISOString(),mode:functional?'functional':'full',complete:false,checks:[],sourceHashes:{}};
for(const file of fs.readdirSync('src').sort()){
 if(!/\.(gs|html|json)$/.test(file)||file==='GeneratedDocs.gs')continue;
 report.sourceHashes[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join('src',file))).digest('hex');
}
const commands=[...plan.functional,...plan.browser];
const extraInputs=['scripts/theme_styles.mjs'];
report.verificationHashes={};
for(const file of [...new Set(['AGENTS.md','scripts/local-checks.json','scripts/run_local_checks.mjs','docs/REQUIREMENTS.md','docs/TECHNICAL_DESIGN.md',...extraInputs,...commands.map(c=>c.slice(5))])]){
 if(!/^node scripts\/[A-Za-z0-9_/-]+\.mjs$/.test(commands.find(c=>c.slice(5)===file)||'')&&!['AGENTS.md','scripts/local-checks.json','scripts/run_local_checks.mjs','docs/REQUIREMENTS.md','docs/TECHNICAL_DESIGN.md',...extraInputs].includes(file))throw Error('Unsafe test input path.');
 report.verificationHashes[file]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
let failed=0,skipped=0;
for(const command of commands){
 const match=/^node (scripts\/[A-Za-z0-9_/-]+\.mjs)$/.exec(command);
 if(!match||match[1]==='scripts/run_local_checks.mjs')throw Error('Unsafe local test command: '+command);
 const file=match[1];
 if(functional&&plan.browser.includes(command)){
  report.checks.push({file,status:'SKIPPED',reason:'Browser checks excluded by --functional'});skipped++;continue;
 }
 const started=Date.now(),result=spawnSync(process.execPath,[file],{cwd:root,env:{...process.env,TZ:timeZone},encoding:'utf8',maxBuffer:12*1024*1024,timeout:180000});
 const passed=!result.error&&result.status===0;
 report.checks.push({file,status:passed?'PASS':'FAIL',exitCode:result.status,ms:Date.now()-started,
  ...(passed?{}:{details:String(result.error||result.stderr||result.stdout).slice(-6000)})});
 console.log((passed?'PASS ':'FAIL ')+file);
 if(!passed){failed++;console.error(report.checks.at(-1).details);}
}
report.finishedAt=new Date().toISOString();report.complete=failed===0&&skipped===0;
report.passed=report.checks.filter(c=>c.status==='PASS').length;report.failed=failed;report.skipped=skipped;
fs.mkdirSync('artifacts/local-verification',{recursive:true});
fs.writeFileSync('artifacts/local-verification/report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode:report.mode,complete:report.complete,passed:report.passed,failed,skipped}));
process.exitCode=failed?1:0;
