import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './sql-fixture.mjs';
import {SqlRepository} from '../src/server/sql-repository.mjs';
import {definitions,seed} from '../src/generated/schema-meta.mjs';
import {createEngine} from '../src/generated/engine.mjs';
import {createServices} from '../src/server/runtime-services.mjs';
import {handleRpc} from '../src/server/api.mjs';

test('SQL schema, synthetic seed, durable reload and guarded atomic commit',async()=>{
 const db=new TestD1();try{
  const a=await new SqlRepository(db,definitions,seed).load();
  assert.equal(a.tables.get('社員マスタ').rows.length,6);
  const b=await new SqlRepository(db,definitions,seed).load();
  a.tables.get('総務書類').rows[1][1]='SQLに保存した架空文書';await a.commit();
  const c=await new SqlRepository(db,definitions,seed).load();assert.equal(c.tables.get('総務書類').rows[1][1],'SQLに保存した架空文書');
  b.tables.get('総務書類').rows[1][1]='古い画面の上書き';await assert.rejects(()=>b.commit(),/CONFLICT/);
  const d=await new SqlRepository(db,definitions,seed).load();assert.equal(d.tables.get('総務書類').rows[1][1],'SQLに保存した架空文書');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM transaction_guard').first()).count,0);
 }finally{db.close();}
});

test('business rules execute against SQL: initial, calendar, finance, projects, worklog, docs and Somu',async()=>{
 const db=new TestD1();try{
  const repository=await new SqlRepository(db,definitions,seed).load();const engine=createEngine(createServices(repository),{employeeId:'FM0001'},'TEST-TOKEN');
  const initial=engine.initial();assert.equal(initial.user.employeeId,'FM0001');assert.equal(initial.permissions.adminConsole,true);
  const calendar=engine.invoke('getCompanyCalendar',['TEST-TOKEN',2026]);assert.ok(calendar.workdays>200);
  assert.equal(engine.invoke('getFinanceOverview',['TEST-TOKEN',{}]).totals.receipt,300);
  assert.equal(engine.invoke('getProjectHubWorkspace',['TEST-TOKEN']).projects.length,6);
  assert.ok(engine.invoke('getWorklogs',['TEST-TOKEN',{start:'2026-10-01',end:'2026-10-31'}]).items.length);
  assert.ok(engine.invoke('getSomuWorkspace',['TEST-TOKEN']).assets.length>=20);
  const quote=engine.invoke('saveQuoteDraft',['TEST-TOKEN',{vendorCode:'FI-0001',quoteDate:'2026-10-18',subject:'SQL架空見積',lines:[{description:'設計',quantity:'1.003',unit:'時間',price:1000}],requestKey:'SITES-SQL-QUOTE-TEST-001'}]);
  await repository.commit();const reloaded=await new SqlRepository(db,definitions,seed).load();const second=createEngine(createServices(reloaded),{employeeId:'FM0001'},'TEST-TOKEN');assert.equal(second.invoke('getQuote',['TEST-TOKEN',quote.id]).header.subject,'SQL架空見積');
 }finally{db.close();}
});

test('HTTP sessions, role selection, logout, source-independent persistence and cross-origin denial',async()=>{
 const db=new TestD1();let token='',cookie='';
 const rpc=async(method,args=[],extra={})=>{
  const request=new Request('http://localhost/api/rpc/'+method,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},body:JSON.stringify({args})});
  return handleRpc(request,db,method);
 };
 try{
  assert.equal((await rpc('getFinanceOverview',['wrong'])).status,401);
  assert.equal((await (await rpc('getPublicAuthConfig')).json()).result.demoEmployees.length,5);
  const login=await rpc('login',['FM0001','000000',{},true]);assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];token=(await login.json()).result.sessionToken;
  assert.equal((await rpc('getInitialData',[token])).status,200);
  assert.equal((await rpc('getInitialData',['a different token'])).status,401);
  assert.equal((await rpc('getInitialData',[token],{Origin:'https://example.invalid'})).status,403);
  const save=await rpc('saveCompanyCalendarDay',[token,{date:'2026-10-19',type:'通常勤務',name:'架空の開発日',start:'09:00',end:'18:00',breakMinutes:60}]);assert.equal(save.status,200,await save.clone().text());
  const month=await (await rpc('getCompanyCalendar',[token,2026])).json();assert.equal(month.result.days.find(x=>x.date==='2026-10-19').name,'架空の開発日');
  assert.equal((await rpc('issueQuote',[token,'missing',1])).status,501);
  assert.equal((await rpc('logout',[token])).status,200);assert.equal((await rpc('getInitialData',[token])).status,401);
 }finally{db.close();}
});

test('rejected RPCs and logout avoid full SQL snapshots',async()=>{
 const db=new TestD1();
 const originalBatch=db.batch.bind(db);
 let snapshots=0;
 db.batch=async statements=>{if(statements.some(s=>s.sql.includes(' AS domain, row_no,')))snapshots++;return originalBatch(statements);};
 const rpc=async(method,args=[],headers={})=>handleRpc(new Request('http://localhost/api/rpc/'+method,{
  method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({args})
 }),db,method);
 try{
  assert.equal((await rpc('getFinanceOverview',['invalid'])).status,401);
  assert.equal((await rpc('unsupportedMethod',['invalid'])).status,401);
  assert.equal(snapshots,0,'no 54-table snapshot without a valid session');
  assert.equal((await rpc('getPublicAuthConfig')).status,200);
  const login=await rpc('login',['FM0001','000000',{},true]);
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const token=(await login.json()).result.sessionToken;
  const baseline=snapshots;
  assert.equal((await rpc('getFinanceOverview',['wrong'],{Cookie:cookie})).status,401);
  assert.equal((await rpc('unsupportedMethod',[token],{Cookie:cookie})).status,501);
  assert.equal(snapshots,baseline,'invalid requests never reload business tables');
  assert.equal((await rpc('logout',[token],{Cookie:cookie})).status,200);
  assert.equal(snapshots,baseline,'logout only removes SQL session');
 }finally{db.close();}
});

test('Sites time formatter supports single-digit H and m in Asia/Tokyo',()=>{
 const u=createServices({getDb:()=>null}).Utilities;
 const at=new Date('2026-10-18T00:05:00.000Z');
 assert.equal(u.formatDate(at,'Asia/Tokyo','H'),'9');
 assert.equal(u.formatDate(at,'Asia/Tokyo','m'),'5');
 assert.equal(u.formatDate(at,'Asia/Tokyo','HH:mm'),'09:05');
 assert.equal(u.formatDate(at,'Asia/Tokyo','yyyy-MM-dd'),'2026-10-18');
});

// The generated SQL engine and visible UI must use the same version as the package.
test('prototype version matches package before generation',async()=>{
 const {createDemoRuntime}=await import('../scripts/seed-builder.mjs');
 const {runInContext}=await import('node:vm');
 const {readFileSync}=await import('node:fs');
 const packageVersion=JSON.parse(readFileSync('package.json','utf8')).version;
 const version=runInContext('APP.version',createDemoRuntime().context);
 assert.equal(version,packageVersion);
});

test('public demo directory selects active employees without reading all business tables',async()=>{
 const db=new TestD1();let snapshots=0;
 const batch=db.batch.bind(db);
 db.batch=async statements=>{
  if(statements.some(item=>item.sql.includes(' AS domain, row_no,')))snapshots++;
  return batch(statements);
 };
 const config=()=>handleRpc(new Request('http://localhost/api/rpc/getPublicAuthConfig',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({args:[]})
 }),db,'getPublicAuthConfig');
 try{
  const first=await config();assert.equal(first.status,200);
  const employees=(await first.json()).result.demoEmployees;
  assert.equal(employees.length,5);
  assert.ok(employees.some(e=>e.employeeId==='FM0001'&&e.role==='ADMIN'));
  assert.equal(snapshots,0,'opening the login screen must not read all 54 business tables');
  await db.prepare('UPDATE employees SET status = ? WHERE employee_id = ?').bind('退職','FM0005').run();
  const again=await config();assert.equal(again.status,200);
  const next=(await again.json()).result.demoEmployees;
  assert.equal(next.length,4);
  assert.ok(next.every(e=>e.employeeId!=='FM0005'));
  assert.equal(snapshots,0,'reloading login choices remains independent of all business tables');
 }finally{db.close();}
});

test('an employee disabled after login cannot resume the previous session',async()=>{
 const db=new TestD1();let token='',cookie='';
 const rpc=(method,args)=>handleRpc(new Request('http://localhost/api/rpc/'+method,{
  method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({args})
 }),db,method);
 try{
  const login=await rpc('login',['FM0001','000000',{},true]);assert.equal(login.status,200);
  cookie=login.headers.get('set-cookie').split(';')[0];
  token=(await login.json()).result.sessionToken;
  assert.equal((await rpc('resumeSession',[token])).status,200);
  await db.prepare('UPDATE employees SET status = ? WHERE employee_id = ?').bind('退職','FM0001').run();
  const denied=await rpc('resumeSession',[token]);
  assert.equal(denied.status,401,'a retired employee must not see cached initial state');
  assert.equal((await rpc('getInitialData',[token])).status,401);
 }finally{db.close();}
});
