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
