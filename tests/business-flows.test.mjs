import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {TestD1} from './sql-fixture.mjs';
import {SqlRepository} from '../src/server/sql-repository.mjs';
import {definitions,seed} from '../src/generated/schema-meta.mjs';
import {createEngine} from '../src/generated/engine.mjs';
import {createServices} from '../src/server/runtime-services.mjs';

const fixture=async()=>{const db=new TestD1(),repository=await new SqlRepository(db,definitions,seed).load();return {db,repository,engine:createEngine(createServices(repository),{employeeId:'FM0001'},'TOKEN')};};
for(const [method,args,check] of [
 ['getHomeOverview',[],v=>assert.ok(v.month)],
 ['getRequestsBundle',[],v=>assert.equal(v.own.length,1)],
 ['getMonthlySummary',['2026-10'],v=>assert.equal(v.daily.length,31)],
 ['getQuoteWorkspace',[],v=>assert.equal(v.vendors.length,3)],
 ['getCompanyDocuments',[],v=>assert.equal(v.items.length,6)],
 ['getSomuGrowthData',[],v=>assert.equal(v.contracts.length,3)],
 ['getProjectHubDetail',['DEMO-P1'],v=>assert.ok(v.project)],
 ['getCashFlowAnalysisWorkspace',[2026],v=>assert.equal(v.accounts.length,3)],
 ['getNotifications',[],v=>assert.ok(Array.isArray(v.items))]
])test('SQL read flow: '+method,async()=>{const f=await fixture();try{check(f.engine.invoke(method,['TOKEN',...args]));}finally{f.db.close();}});

test('clock-in and worklog mutations persist across new SQL request contexts',async()=>{
 const f=await fixture();try{
  f.engine.invoke('recordPunch',['TOKEN','出勤','出社']);
  const saved=f.engine.invoke('saveWorklog',['TOKEN',{date:'2026-10-19',project:seed['プロジェクト'][0][1],category:'開発',description:'SQLの架空作業',start:'13:00',end:'14:00'}]);
  await f.repository.commit();
  const next=await new SqlRepository(f.db,definitions,seed).load();const engine=createEngine(createServices(next),{employeeId:'FM0001'},'TOKEN');
  assert.equal(engine.initial().attendance.state,'working');
  const rows=engine.invoke('getWorklogs',['TOKEN',{start:'2026-10-19',end:'2026-10-19'}]).items;assert.ok(rows.some(r=>r.id===saved.id&&r.minutes===60));
 }finally{f.db.close();}
});

test('schedule and leave request save into SQL without external service access',async()=>{
 const f=await fixture();try{
  const result=f.engine.invoke('saveSchedule',['TOKEN',{date:'2026-10-20',title:'SQL架空会議',start:'14:00',end:'15:00',employeeIds:['FM0001'],visibility:'参加者のみ',requestKey:'SQL-SCHEDULE-TEST-01'}]);assert.ok(result.ok);
  const request=f.engine.invoke('submitRequest',['TOKEN',{type:'有給',startDate:'2026-10-22',endDate:'2026-10-22',reason:'開発用の架空申請'}]);assert.ok(request.ok);
  await f.repository.commit();const r=await new SqlRepository(f.db,definitions,seed).load();assert.ok(r.tables.get('予定').rows.some(row=>row[7]==='SQL架空会議'));assert.ok(r.tables.get('申請').rows.some(row=>row[8]==='開発用の架空申請'));
 }finally{f.db.close();}
});

test('non-admin finance access is denied by original business rules on SQL',async()=>{
 const f=await fixture();try{const user=createEngine(createServices(f.repository),{employeeId:'FM0003'},'USER');assert.throws(()=>user.invoke('getCashFlowBankWorkspace',['USER',2026]),/管理者|権限/);}finally{f.db.close();}
});

test('published shell has valid scripts, Sites transport, no Google RPC dependency and current login',()=>{
 const module=fs.readFileSync('src/generated/shell.mjs','utf8');const html=JSON.parse(module.slice(module.indexOf('=')+1).trim().replace(/;$/,''));
 let count=0;for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){new vm.Script(script[1]);count++;}
 assert.ok(count>20);assert.ok(!html.includes('global.google'));assert.ok(!html.includes('google.script.run'));assert.ok(html.includes('global.FMApi&&global.FMApi.run'));assert.ok(html.includes('/api/rpc/'));assert.ok(html.includes('開発版をはじめる'));assert.ok(html.includes('すべて架空データ'));
});

test('admin documentation serves the canonical current files and denies ordinary employees',async()=>{
 const f=await fixture();try{
  const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
  assert.equal(f.engine.initial().app.version,version);
  for(const [type,file] of [['requirements','REQUIREMENTS.md'],['technical','TECHNICAL_DESIGN.md']]){
   const doc=f.engine.invoke('getSystemDocument',['TOKEN',type]);
   assert.equal(doc.version,version);
   assert.equal(doc.markdown,fs.readFileSync('docs/'+file,'utf8'));
  }
  const ordinary=createEngine(createServices(f.repository),{employeeId:'FM0003'},'USER');
  assert.throws(()=>ordinary.invoke('getSystemDocument',['USER','requirements']),/管理者/);
 }finally{f.db.close();}
});

test('legacy GAS HTML service is absent from the current Sites engine source',()=>{
 const source=fs.readFileSync('src/domain/core/Code.js','utf8');
 assert.doesNotMatch(source,/\bHtmlService\b/);
 assert.doesNotMatch(source,/\bfunction doGet\s*\(/);
 assert.doesNotMatch(source,/\bfunction include_\s*\(/);
});

test('Sites maintenance uses SQL tables and never claims unverified backup',async()=>{
 const f=await fixture();
 try{
  const info=f.engine.invoke('getSystemStatus',['TOKEN']);
  assert.equal(info.dbName,'Sites SQL / D1');
  assert.equal(info.backupVerified,false);
  assert.equal(info.readiness.ready,false);
  assert.ok(info.sheets['社員マスタ']>=5);
  assert.ok(Array.isArray(f.engine.invoke('getAuditLogs',['TOKEN',20])));
  const ordinary=createEngine(createServices(f.repository),{employeeId:'FM0003'},'USER');
  assert.throws(()=>ordinary.invoke('getSystemStatus',['USER']),/管理者/);
 }finally{f.db.close();}
});

test('company document schema upgrades are not performed through old GAS backups',()=>{
 const source=fs.readFileSync('src/domain/office/CompanyDocs.js','utf8');
 const html=fs.readFileSync('src/ui/modules/AppCompanyDocs.html','utf8');
 assert.doesNotMatch(source,/\bcreateDatabaseBackup_\b/);
 assert.doesNotMatch(source,/\binitializeCompanyDocuments\b/);
 assert.doesNotMatch(html,/\bcompanyDocsConfirmInitialize\b/);
 assert.doesNotMatch(html,/\bcompanyDocsInitialize\b/);
});

test('Sites UI source no longer uses GAS transport substitutions',()=>{
 for(const dir of ['src/ui/modules','src/ui/components']){
  for(const file of fs.readdirSync(dir).filter(name=>name.endsWith('.html'))){
   const source=fs.readFileSync(dir+'/'+file,'utf8');
   assert.doesNotMatch(source,/google\.script\.run/,file);
   assert.doesNotMatch(source,/global\.google&&global\.google/,file);
  }
 }
 const build=fs.readFileSync('scripts/prepare-app.mjs','utf8');
 assert.doesNotMatch(build,/replaceAll\('google\.script\.run'/);
});

test('small shared UI/document helpers are folded into active modules',()=>{
 const main=fs.readFileSync('src/domain/core/Maintenance.js','utf8');
 const bankStyles=fs.readFileSync('src/ui/styles/StylesCashFlowBankGrid.html','utf8');
 const index=fs.readFileSync('src/ui/Index.html','utf8');
 assert.match(main,/function getSystemDocument\(/);
 assert.match(bankStyles,/\.cfb-paste-panel/);
 assert.doesNotMatch(index,/StylesCashFlowPaste/);
});

test('Sites HTML uses build-only include markers, not GAS scriptlets',()=>{
 const index=fs.readFileSync('src/ui/Index.html','utf8');
 const matches=[...index.matchAll(/<!-- FM_INCLUDE:([A-Za-z0-9_/-]+) -->/g)];
 assert.ok(matches.length>35);
 assert.doesNotMatch(index,/<\?/);
 const shell=fs.readFileSync('src/generated/shell.mjs','utf8');
 assert.doesNotMatch(shell,/FM_INCLUDE:/);
});
