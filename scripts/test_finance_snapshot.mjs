import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let serial=0,clock=0,dbId='DB-A',audit=true,hook=null;const cache=new Map(),sheets={},reads=[];
const cacheApi={get(key){const value=cache.get(key);return value&&value.until>clock?value.text:null;},
 getAll:keys=>Object.fromEntries(keys.map(key=>[key,cacheApi.get(key)]).filter(([,v])=>v!==null)),
 put:(key,text,ttl)=>cache.set(key,{text,until:clock+ttl*1000}),putAll:(values,ttl)=>Object.entries(values).forEach(([k,v])=>cacheApi.put(k,v,ttl)),remove:key=>cache.delete(key)};
class Sheet{
 constructor(header){this.rows=[header];}
 getLastRow(){return this.rows.length;}
 appendRow(row){this.rows.push(row);}
 getRange(r,c,n=1,w=1){const sheet=this;return {
 getDisplayValues(){reads.push({r,c,n,w});const values=Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>String(sheet.rows[r+i-1]?.[c+j-1]??'')));if(r>1&&hook){const fn=hook;hook=null;fn();}return values;},
 getValues(){return this.getDisplayValues();},
 setValues(values){values.forEach((row,i)=>{sheet.rows[r+i-1]||=[];row.forEach((v,j)=>sheet.rows[r+i-1][c+j-1]=v);});},
 createTextFinder(pattern){let regex=false,entire=false,matchCase=false;return {
 useRegularExpression(v){regex=v;return this;},matchEntireCell(v){entire=v;return this;},matchCase(value){matchCase=value;return this;},
 findAll(){return sheet.rows.flatMap((row,i)=>i>=r-1&&i<r-1+n&& (regex?new RegExp(pattern,matchCase?'':'i').test(String(row[c-1]||'')):entire?(matchCase?String(row[c-1]||'')===pattern:String(row[c-1]||'').toLowerCase()===pattern.toLowerCase()):String(row[c-1]||'').includes(pattern))?[{getRow:()=>i+1}]:[]);},
 findNext(){return this.findAll()[0]||null;}
 };}
 };}
 getRangeList(values){return {getRanges:()=>values.map(text=>{const m=text.match(/^A(\d+):([A-Z]+)(\d+)$/);let width=0;for(const ch of m[2])width=width*26+ch.charCodeAt(0)-64;return this.getRange(+m[1],1,+m[3]-m[1]+1,width);})};}
}
const people={ADMIN:{employeeId:'A',name:'架空経理',role:'ADMIN'},STAFF:{employeeId:'B',name:'架空社員',role:'USER',department:'開発'}};
const ctx=vm.createContext({console:{warn(){},log(){},error(){}},DB:{timeZone:'Asia/Tokyo'},getDb_:()=>({getSheetByName:name=>sheets[name]}),getDatabaseSpreadsheetId_:()=>dbId,
 CacheService:{getScriptCache:()=>cacheApi},Utilities:{getUuid:()=>String(++serial),formatDate:()=> '2026-10-14 12:00:00'},
 requireSession_:token=>{if(!people[token])throw Error('auth');return {employee:people[token]};},financeDepartmentAllowed_:()=>false,
 schemaHeaderIssues_:(actual,expected)=>actual.length===expected.length&&actual.every((v,i)=>v===expected[i])?[]:['bad header'],
 withScriptLock_:fn=>fn(),createId_:prefix=>prefix+'-'+(++serial),safeSheetText_:(v,max)=>String(v??'').trim().slice(0,max),normalizeDate_:v=>String(v),normalizeTime_:v=>String(v||''),auditJson_:JSON.stringify,appendAudit_:()=>audit});
for(const file of ['Schema.gs','DataAccess.gs','Finance.gs','FinanceBulk.gs'])vm.runInContext(fs.readFileSync('src/'+file,'utf8'),ctx,{filename:file});
const models=vm.runInContext('FINANCE_MODELS',ctx),schema=vm.runInContext('DB_SCHEMA_SPECS',ctx);
for(const [kind,model] of Object.entries(models)){
 const sheet=sheets[model.sheet]=new Sheet(Array.from(schema[model.sheet]));
 for(let i=0;i<(kind==='receipt'?600:400);i++)sheet.appendRow(model.keys.map(key=>({id:kind+i,createdAt:'2026-10-01',employeeId:'B',employeeName:'架空社員',usedOn:'2026-10-01',startsOn:'2026-10-01',vendor:'架空販売店',destination:'架空出張先',note:'確認用の架空記録'.repeat(20),amount:100,spentAmount:100,status:i%2?'精算済':'承認待ち',requestKey:'SEED-key-'+kind+'-'+i})[key]??''));
}
const overview=p=>ctx.getFinanceOverview('ADMIN',p),body=()=>reads.filter(r=>r.r>1&&r.w>1),warm=()=>{reads.length=0;overview();assert.equal(body().length,0);},key='fm:db:DB-A:fm:finance:overview:v1';
let first=overview({limit:160});assert.equal(body().length,3);assert.equal(first.totals.expense,400);assert.equal(first.expenses.length,160);assert.equal(first.totals.expenseHidden,240);
assert.ok(JSON.parse(cacheApi.get(key)).count>1,'UTF-8 financial snapshot is safely chunked');
reads.length=0;const more=overview({limit:320});assert.equal(body().length,0,'more rows use same snapshot');assert.equal(reads.filter(r=>r.r===1).length,3,'warm cache still verifies all live headers');assert.equal(more.expenses.length,320);assert.equal(more.totals.expense,first.totals.expense);
assert.throws(()=>ctx.getFinanceOverview('STAFF'),/権限/);const savedHeader=sheets[models.expense.sheet].rows[0][0];sheets[models.expense.sheet].rows[0][0]='wrong';assert.equal(overview().setupRequired,true);sheets[models.expense.sheet].rows[0][0]=savedHeader;
reads.length=0;overview({forceFresh:true});assert.equal(body().length,3,'explicit update bypasses server snapshot');
clock+=21000;reads.length=0;overview();assert.equal(body().length,3,'cache expiry reads source');warm();
const expense={usedOn:'2026-10-14',vendor:'架空商店',item:'事務用品',category:'消耗品',amount:'2500',purpose:'確認用',paymentMethod:'立替',requestKey:'EXP-key-0000000001'};
reads.length=0;let result=ctx.submitFinanceExpense('STAFF',expense);assert.equal(result.ok,true);assert.equal(reads.some(r=>r.r===2&&r.w===1&&r.n>250),false,'single save does not download the entire request-key column');
let current=overview();assert.equal(current.totals.expense,401);warm();ctx.reviewFinanceRequest('ADMIN','expense',result.id,'APPROVE','');current=overview();assert.equal(current.totals.expenseToSettle,1);warm();ctx.settleFinanceRequest('ADMIN','expense',result.id,'2026-10-14','2026-10-14');assert.equal(overview().totals.expenseToSettle,0);warm();
const returned=ctx.submitFinanceExpense('STAFF',{...expense,requestKey:'EXP-key-0000000002'});overview();warm();ctx.reviewFinanceRequest('ADMIN','expense',returned.id,'RETURN','修正してください');overview();warm();ctx.resubmitFinanceRequest('STAFF','expense',returned.id,{...expense,requestKey:'EXP-key-0000000003'});assert.ok(overview().expenses.some(x=>x.id===returned.id&&x.status==='承認待ち'));warm();
const travel=ctx.submitFinanceTravel('STAFF',{startsOn:'2026-10-14',endsOn:'2026-10-14',destination:'架空出張先',purpose:'確認',outcome:'確認完了',spentAmount:'500',requestKey:'TRAVEL-key-0000001'});assert.equal(travel.ok,true);assert.equal(overview().totals.travel,401);warm();
const receipt={usedOn:'2026-10-14',category:'消耗品',vendor:'架空商店',item:'事務用品',amount:'500',payer:'架空経理',paymentMethod:'会社カード',paid:'済',requestKey:'RECEIPT-key-0000001'};
ctx.saveFinanceReceipt('ADMIN',receipt);assert.equal(overview().totals.receipt,601);warm();reads.length=0;ctx.saveFinanceReceiptsBulk('ADMIN',{rows:[{...receipt,requestKey:'BULK-key-0000000001'},{...receipt,requestKey:'BULK-key-0000000002'}]});assert.equal(reads.some(r=>r.r===2&&r.w===1&&r.n>250),false,'bulk new keys use finder, not complete key-column transfer');assert.equal(overview().totals.receipt,603);warm();
audit=false;const auditFail=ctx.submitFinanceExpense('STAFF',{...expense,requestKey:'EXP-key-0000000004'});assert.equal(auditFail.auditRecorded,false);assert.equal(overview().totals.expense,403,'audit failure does not keep pre-save snapshot');audit=true;
ctx.financeInvalidateOverview_();hook=()=>ctx.financeInvalidateOverview_();overview();assert.equal(ctx.cacheJsonGetLarge_('fm:finance:overview:v1'),null,'old in-flight generation never republishes after a save');overview();warm();
const manifest=JSON.parse(cacheApi.get(key));cacheApi.remove(key+':'+manifest.generation+':0');reads.length=0;overview();assert.equal(body().length,3,'missing cache chunk reads complete source');
cacheApi.remove('fm:db:DB-A:fm:finance:overview-generation:v1');reads.length=0;overview();assert.equal(body().length,3,'evicted generation cannot authorize a stale snapshot');
dbId='DB-B';reads.length=0;overview();assert.equal(body().length,3,'database switch never reuses another database cache');
assert.ok([...overview().expenses,...overview().travels,...overview().receipts].every(x=>!Object.hasOwn(x,'requestKey')));
const expenseSheet=sheets[models.expense.sheet];
for(const [id,requestKey] of [['LOWER','case-key-000000001'],['UPPER','CASE-key-000000001']])expenseSheet.appendRow(models.expense.keys.map(field=>({...expense,id,requestKey,employeeId:'B',employeeName:'架空社員',createdAt:'2026-10-14',status:'承認待ち'})[field]??''));
const beforeRetry=expenseSheet.rows.length;const exactRetry=ctx.submitFinanceExpense('STAFF',{...expense,requestKey:'CASE-key-000000001'});assert.equal(exactRetry.duplicate,true);assert.equal(exactRetry.id,'UPPER');assert.equal(expenseSheet.rows.length,beforeRetry,'case-only predecessor cannot cause a duplicate save');
console.log('PASS finance snapshot: shared UTF-8 chunks, warm/limit/force/TTL/ACL/schema, all write invalidations, failed audit, old generation, eviction/DB isolation and indexed save retry checks');
