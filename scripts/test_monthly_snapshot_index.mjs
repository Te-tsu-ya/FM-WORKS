import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Synthetic closed-month snapshots; validate shape and index usage with no GAS writes.
const source=fs.readFileSync('src/MonthlySnapshot.gs','utf8');
const extract=name=>{
 const first=source.indexOf('function '+name+'(');
 assert.ok(first>=0,'missing monthly snapshot function '+name);
 const next=source.indexOf('\nfunction ',first+10);
 return source.slice(first,next<0?source.length:next);
};
const snapshot='MC-202610-TEST';
const makeSummary=(id,ym,employee)=>{
 const r=Array(24).fill('');
 r[0]=id;r[1]=ym;r[2]=employee;r[3]='架空'+employee;
 r[6]='20';r[8]='9600';r[17]='synthetic-hash';r[23]='CONFIGURED';return r;
};
const makeDaily=(id,ym,employee,day)=>{
 const r=Array(24).fill('');
 r[0]=id;r[1]=ym;r[2]=employee;r[3]='2026-10-'+day;
 r[4]='平日';r[5]='TRUE';r[6]='09:00';r[7]='18:00';r[8]='480';
 return r;
};
const summaryRows=[makeSummary(snapshot,'2026-10','A'),makeSummary(snapshot,'2026-10','B'),
 makeSummary('MC-OLDER','2026-10','A'),makeSummary(snapshot,'2026-09','Z'),makeSummary(snapshot,'2026-10','C')];
const dailyRows=[makeDaily(snapshot,'2026-10','A','10'),makeDaily(snapshot,'2026-10','A','09'),
 makeDaily(snapshot,'2026-10','B','10'),makeDaily('MC-OLDER','2026-10','A','08'),
 makeDaily(snapshot,'2026-09','A','11'),makeDaily(snapshot,'2026-10','C','14')];
let fullScans=0, closes=0, indexCalls=[];
const sheet=rows=>({rows,getLastRow(){return rows.length+1;},getRange(){fullScans++;throw Error('Unexpected unbounded ledger scan');}});
const summary=sheet(summaryRows),daily=sheet(dailyRows);
const context=vm.createContext({
 String,Number,Array,Object,Math,Date,JSON,Map,Set,
 DB:{sheets:{monthlySnapshot:'SNAPSHOT_SUMMARY',monthlySnapshotDaily:'SNAPSHOT_DAILY'}},
 normalizeYearMonth_:value=>String(value),
 getDb_:()=>({getSheetByName:name=>name==='SNAPSHOT_SUMMARY'?summary:name==='SNAPSHOT_DAILY'?daily:null}),
 requiredBreakMinutes_:()=>45,
 getMonthlyCloseStatusInternal_:ym=>{closes++;return{yearMonth:ym,closed:true,snapshotId:snapshot};},
 readRowsByColumnValues_:(sh,column,width,values)=>{
  indexCalls.push({sheet:sh===summary?'summary':'daily',column,width,ids:Array.from(values)});
  assert.equal(column,1);assert.equal(width,24);
  return sh.rows.filter(r=>values.includes(r[0]));
 }
});
vm.runInContext(['getMonthlySnapshotSummaries_','getMonthlySnapshotSummary_'].map(extract).join('\n'),context);
const all=context.getMonthlySnapshotSummaries_('2026-10',snapshot,['A','B']);
assert.equal(all.length,2);assert.deepEqual(Array.from(all.map(x=>x.employee.employeeId)),['A','B']);
assert.deepEqual(Array.from(all[0].daily.map(x=>x.date)),['2026-10-09','2026-10-10']);
assert.equal(all[1].daily.length,1);
assert.equal(all[0].closeStatus,all[1].closeStatus,'one close state reused per response');
assert.equal(closes,1,'do not re-read month close for each employee');
assert.equal(indexCalls.length,2,'summary and daily indexed reads only');
assert.ok(indexCalls.every(x=>x.ids.length===1&&x.ids[0]===snapshot));
assert.equal(fullScans,0,'historical monthly snapshots must not be bulk loaded');
const a=context.getMonthlySnapshotSummary_('2026-10','A',snapshot);
assert.equal(a.employee.employeeId,'A');assert.equal(a.daily.length,2);
assert.equal(closes,2);
const missing=context.getMonthlySnapshotSummaries_('2026-10','DOES-NOT-EXIST',['A']);
assert.equal(missing.length,0);assert.equal(closes,2,'no close-state lookup when summary absent');
console.log('PASS month-end snapshots: scoped index reads, employee/year isolation, one close lookup');

