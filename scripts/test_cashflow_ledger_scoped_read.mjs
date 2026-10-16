import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const CFP={
 tx:{keys:['id','accountId','date','incoming','outgoing','description','balance','externalId','occurrence','fingerprint','transfer','sourceFile','importedAt','editorId','revision']},
 plan:{keys:['id','title','direction','amount','accountId','category','frequency','startMonth','endMonth','day','active','note','revision','updatedAt','editorId','requestKey']}
};
const CFA={note:{keys:['transactionId','category','tags','note','revision','updatedAt','editorId','requestKey']}};
const row=(model,obj)=>model.keys.map(k=>obj[k]??'');
const fixtures={
 tx:[
  row(CFP.tx,{id:'TX-A',accountId:'A',date:'2026-10-10',incoming:100,outgoing:0,description:'口座A入金',balance:1100}),
  row(CFP.tx,{id:'TX-B',accountId:'B',date:'2026-10-13',incoming:900,outgoing:0,description:'他口座取引',balance:900}),
  row(CFP.tx,{id:'TX-A2',accountId:'A',date:'2026-11-01',incoming:0,outgoing:50,description:'口座A出金',balance:1050})
 ],
 plan:[
  row(CFP.plan,{id:'P-A',accountId:'A',title:'口座A定期支払',direction:'OUT',amount:20,frequency:'MONTHLY',startMonth:'2026-10',endMonth:'2026-11',day:'12',active:'TRUE'}),
  row(CFP.plan,{id:'P-B',accountId:'B',title:'他口座予定',direction:'IN',amount:30,frequency:'MONTHLY',startMonth:'2026-10',endMonth:'2026-11',day:'12',active:'TRUE'})
 ],
 note:[
  row(CFA.note,{transactionId:'TX-A',category:'受取',note:'当該口座メモ'}),
  row(CFA.note,{transactionId:'TX-B',category:'他行',note:'他の口座メモ'})
 ]
};
const queries=[];
const ctx=vm.createContext({
 CFP,CFA,Date,Number,Array,Math,Set,Map,String,
 requireAdminSession_:token=>{if(token!=='ADMIN')throw Error('管理者権限が必要です。');},
 cashFlowYear_:value=>Number(value),
 cashFlowMonths_:year=>['2025-12',...Array.from({length:11},(_,i)=>year+'-'+String(i+1).padStart(2,'0'))],
 cfpRows_:kind=>{if(kind!=='account')throw Error('Unexpected unscoped cfpRows_('+kind+')');return {rows:[{id:'A'},{id:'B'}]};},
 cfpSheet_:kind=>({kind}),cfaSheet_:kind=>({kind}),
 readRowsByColumnValues_:(sheet,column,width,values,caseInsensitive,withRowNumbers)=>{
  assert.equal(caseInsensitive,false);assert.equal(withRowNumbers,true);
  const wanted=new Set(values);
  queries.push({kind:sheet.kind,column,values:[...values]});
  return fixtures[sheet.kind].map((values,i)=>({rowNumber:i+2,values}))
   .filter(hit=>wanted.has(hit.values[column-1]));
 },
 cfpPlannedMonth_:(plan,month)=>plan.active==='TRUE'&&month>=plan.startMonth&&month<=plan.endMonth&&
  (plan.frequency==='MONTHLY'||plan.frequency==='ONCE'&&month===plan.startMonth)
});
vm.runInContext(fs.readFileSync('src/CashFlowLedger.gs','utf8'),ctx,{filename:'CashFlowLedger.gs'});
assert.throws(()=>ctx.getCashFlowLedgerRows('STAFF',{year:2026,accountId:'A'}),/管理者権限/);
const report=ctx.getCashFlowLedgerRows('ADMIN',{year:2026,accountId:'A',kind:'ALL',offset:0});
assert.equal(report.ok,true);
assert.equal(report.rows.length,4,'two actual entries and two scheduled occurrences are shown');
assert.equal(report.total,4);
assert.equal(report.totals.actualIn,100);assert.equal(report.totals.actualOut,50);
assert.equal(report.totals.plannedOut,40);assert.equal(report.totals.plannedIn,0);
assert.equal(report.balanceAnchor.balance,1050);
assert.equal(report.rows.find(r=>r.id==='TX-A')?.note,'当該口座メモ');
assert.ok(!report.rows.some(r=>r.description==='他口座取引'||r.description==='他口座予定'));
assert.deepEqual(Array.from(queries,x=>x.kind).sort(),['note','plan','tx']);
assert.deepEqual(Array.from(queries[0].values),['A']);
assert.deepEqual(Array.from(queries[1].values),['TX-A','TX-A2']);
assert.deepEqual(Array.from(queries[2].values),['A']);
const actual=ctx.getCashFlowLedgerRows('ADMIN',{year:2026,accountId:'A',kind:'ACTUAL'});
assert.equal(actual.total,2);assert.equal(actual.rows.length,2);
assert.throws(()=>ctx.getCashFlowLedgerRows('ADMIN',{year:2026,accountId:'A',kind:'BAD'}),/表示区分/);
console.log('PASS cashflow ledger scoped reads');
