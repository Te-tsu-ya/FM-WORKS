import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Sheet{
 constructor(headers){this.rows=[headers];this.writes=0;}
 getLastRow(){return this.rows.length;}
 getRange(row,col,n=1,width=1){const s=this;return{
  getDisplayValues(){return Array.from({length:n},(_,i)=>Array.from({length:width},(_,j)=>String(s.rows[row+i-1]?.[col+j-1]??'')));},
  setValues(rows){s.writes++;rows.forEach((values,i)=>{while(s.rows.length<row+i)s.rows.push([]);values.forEach((v,j)=>s.rows[row+i-1][col+j-1]=v);});}
 };}
 appendRow(values){this.writes++;this.rows.push([...values]);}
}
const sheets=new Map(),audit=[];let failAudit=false,flushed=0;
const ctx=vm.createContext({Date,Math,JSON,Number,String,Array,Set,Map,console:{warn(){}},DB:{timeZone:'Asia/Tokyo'},
 getDb_:()=>({getSheetByName:name=>sheets.get(name)||null}),
 requireAdminSession_:t=>{if(t!=='ADMIN')throw Error('管理者のみ');return {employee:{employeeId:'A',name:'架空管理者'}};},
 withScriptLock_:fn=>fn(),SpreadsheetApp:{flush(){flushed++;}},Utilities:{formatDate:()=> '2026-10-11 09:00:00'},
 appendAudit_:a=>{if(failAudit)throw Error('audit failed');audit.push(a);},auditJson_:x=>JSON.stringify(x)
});
vm.runInContext(fs.readFileSync('src/Schema.gs','utf8'),ctx);
vm.runInContext(fs.readFileSync('src/CashFlow.gs','utf8'),ctx);
const run=expr=>vm.runInContext(expr,ctx);
assert.equal(run('DB_SCHEMA_VERSION'),17);
assert.equal(run('cashFlowMonths_(2026)')[0],'2025-12');
assert.equal(run('cashFlowMonths_(2026)')[11],'2026-11');
assert.equal(run('cashFlowMonths_(2027)')[0],'2026-12');
assert.throws(()=>ctx.getCashFlowYear('FINANCE',2026),/管理者/);
assert.throws(()=>ctx.saveCashFlowYear('FINANCE',{}),/管理者/);
assert.equal(ctx.getCashFlowYear('ADMIN',2026).setupRequired,true);
const headers=JSON.parse(JSON.stringify(run("DB_SCHEMA_SPECS['資金繰り年間']")));
const sheet=new Sheet(headers);sheets.set('資金繰り年間',sheet);
const blank=ctx.getCashFlowYear('ADMIN',2026);
assert.equal(blank.record.exists,false);assert.equal(blank.record.months.length,12);
const months=JSON.parse(JSON.stringify(blank.record.months));
months[0].planIn=100;months[0].planOut=30;months[0].actualIn=80;months[0].actualOut=20;
months[0].note='<img src=x onerror=alert(1)>';
months[1].planIn=200;months[1].planOut=80;
const payload={fiscalYear:2026,openingBalance:1000,months,revision:0,requestKey:'CF-TEST-RETRY-00001'};
assert.throws(()=>ctx.saveCashFlowYear('ADMIN',{...payload,months:months.slice(1)}),/12か月/);
assert.throws(()=>ctx.saveCashFlowYear('ADMIN',{...payload,months:months.map((m,i)=>i===0?{...m,month:'2026-01'}:m)}),/並び/);
assert.throws(()=>ctx.saveCashFlowYear('ADMIN',{...payload,months:months.map((m,i)=>i===0?{...m,planIn:-1}:m)}),/整数/);
assert.throws(()=>ctx.saveCashFlowYear('ADMIN',{...payload,months:months.map((m,i)=>i===0?{...m,note:'a'.repeat(301)}:m)}),/300文字/);
assert.throws(()=>ctx.saveCashFlowYear('ADMIN',{...payload,openingBalance:'1e3'}),/整数/);
assert.equal(sheet.writes,0);
assert.equal(ctx.saveCashFlowYear('ADMIN',payload).revision,1);
assert.equal(sheet.writes,1);assert.equal(flushed,1);assert.equal(audit.length,1);
const current=ctx.getCashFlowYear('ADMIN',2026);
assert.equal(current.record.months[0].note,months[0].note);
assert.equal(current.summary.months[0].planEnd,1070);
assert.equal(current.summary.months[0].actualEnd,1060);
assert.equal(current.summary.months[0].forecastEnd,1060);
assert.equal(current.summary.months[1].planEnd,1190);
assert.equal(current.summary.months[1].forecastEnd,1180);
assert.equal(current.summary.months[2].forecastEnd,null);
assert.equal(current.summary.forecastYearEnd,null);
assert.equal(current.summary.counts.actual,1);
assert.equal(ctx.saveCashFlowYear('ADMIN',payload).duplicate,true);
assert.equal(sheet.writes,1);
assert.throws(()=>ctx.saveCashFlowYear('ADMIN',{...payload,openingBalance:1001}),/識別子/);
assert.throws(()=>ctx.saveCashFlowYear('ADMIN',{...payload,openingBalance:1001,requestKey:'CF-TEST-UPDATE-0001'}),/別の人/);
failAudit=true;
const revised={...payload,openingBalance:1001,revision:1,requestKey:'CF-TEST-UPDATE-0001'};
const result=ctx.saveCashFlowYear('ADMIN',revised);
assert.equal(result.revision,2);assert.equal(result.auditRecorded,false);
assert.equal(ctx.saveCashFlowYear('ADMIN',revised).auditRecorded,null);
failAudit=false;
const y27=JSON.parse(JSON.stringify(ctx.getCashFlowYear('ADMIN',2027).record.months));
y27.forEach(m=>{m.planIn=0;m.planOut=10;});
ctx.saveCashFlowYear('ADMIN',{fiscalYear:2027,openingBalance:50,months:y27,revision:0,requestKey:'CF-TEST-YEAR-2027-01'});
assert.equal(ctx.getCashFlowYear('ADMIN',2027).summary.firstShortage,'2027-05');
assert.equal(ctx.getCashFlowYear('ADMIN',2027).summary.forecastYearEnd,-70);
assert.deepEqual(JSON.parse(JSON.stringify(ctx.getCashFlowYear('ADMIN',2027).availableYears)),[2027,2026]);
assert.throws(()=>ctx.getCashFlowYear('ADMIN',2026.5),/年度/);
sheet.rows[0][0]='壊れたヘッダー';assert.throws(()=>ctx.getCashFlowYear('ADMIN',2026),/列名/);
console.log('PASS cashflow: fiscal period, ADMIN-only, safe save/retry, conflicts, audit warning, missing-month and cash-deficit calculations');
