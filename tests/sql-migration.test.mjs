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

test('an employee removed after login cannot reuse the previous session',async()=>{
 const db=new TestD1();
 const rpc=(method,args,headers={})=>handleRpc(new Request('http://localhost/api/rpc/'+method,{
  method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({args})
 }),db,method);
 try{
  const login=await rpc('login',['FM0005']);assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const token=(await login.json()).result.sessionToken;
  await db.prepare('DELETE FROM employees WHERE employee_id = ?').bind('FM0005').run();
  for(const method of ['resumeSession','getInitialData'])assert.equal((await rpc(method,[token],{Cookie:cookie})).status,401);
 }finally{db.close();}
});

const inputOnlyDb={prepare(){throw Error('input rejection must precede SQL access')},batch(){throw Error('input rejection must precede SQL access')}};
const bodyRequest=(body,extra={})=>new Request('http://localhost/api/rpc/getInitialData',{
 method:'POST',headers:{'Content-Type':'application/json',...extra},body,...(body instanceof ReadableStream?{duplex:'half'}:{})
});
const limit=2*1024*1024;
test('RPC counts UTF-8 bytes, rejecting large Japanese input before SQL',async()=>{
 const body=JSON.stringify({args:['あ'.repeat(700000)]});
 assert.ok(body.length<limit);assert.ok(new TextEncoder().encode(body).length>limit);
 assert.equal((await handleRpc(bodyRequest(body),inputOnlyDb,'getInitialData')).status,413);
});

test('RPC permits exactly 2MiB and rejects the first excess byte',async()=>{
 const body='{"args":[]}'.padEnd(limit,' ');
 assert.equal((await handleRpc(bodyRequest(body),inputOnlyDb,'getInitialData')).status,401);
 assert.equal((await handleRpc(bodyRequest(body+' '),inputOnlyDb,'getInitialData')).status,413);
});

test('RPC enforces streamed byte limits even with a false small Content-Length',async()=>{
 let pulls=0,cancelled=false;
 const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(600000).fill(32))},cancel(){cancelled=true}});
 const response=await handleRpc(bodyRequest(stream,{'Content-Length':'1'}),inputOnlyDb,'getInitialData');
 assert.equal(response.status,413);assert.equal(cancelled,true);assert.ok(pulls<=5);
});

test('RPC rejects declared oversize before reading the request stream',async()=>{
 let cancelled=false;
 const stream=new ReadableStream({cancel(){cancelled=true}},{highWaterMark:0});
 const response=await handleRpc(bodyRequest(stream,{'Content-Length':String(limit+1)}),inputOnlyDb,'getInitialData');
 assert.equal(response.status,413);assert.equal(cancelled,true);
});

test('RPC decodes Japanese characters split between byte chunks',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({args:['日本語']}));let index=0;
 const stream=new ReadableStream({pull(c){if(index===bytes.length)c.close();else c.enqueue(bytes.slice(index,index+=1))}});
 assert.equal((await handleRpc(bodyRequest(stream),inputOnlyDb,'getInitialData')).status,401);
});

test('RPC rejects invalid UTF-8 and malformed JSON without returning submitted secrets',async()=>{
 const invalid=new Uint8Array([0x7b,0xff,0x7d]);
 assert.equal((await handleRpc(bodyRequest(invalid),inputOnlyDb,'getInitialData')).status,400);
 const secret='PRIVATE-SESSION-MUST-NOT-APPEAR';
 const malformed=await handleRpc(bodyRequest('{"args":["'+secret+'"}'),inputOnlyDb,'getInitialData');
 assert.equal(malformed.status,400);assert.doesNotMatch(await malformed.text(),new RegExp(secret));
});
