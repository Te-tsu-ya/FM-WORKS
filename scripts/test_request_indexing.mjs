import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Synthetic sheets: the real FM WORKS DB is never opened or modified.
const calls=[],rows=[],observedMonths=[];
let closed=false, snapshotWrites=0,fullReadAttempts=0;
const reqRow=(id,employeeId,type,startDate,endDate,status)=>{
  const r=Array(19).fill('');
  r[0]=id;r[2]=employeeId;r[4]=type;r[5]=startDate;r[6]=endDate;r[9]=status;
  return r;
};
const requestSheet={
  getLastRow:()=>rows.length+1,
  getRange:()=>{fullReadAttempts++;throw Error('Whole application sheet must not be loaded');}
};
const monthlyCloseSheet={
  getLastRow:()=>1,
  getRange(row,col,height,width){
    assert.equal(row,2);assert.equal(col,1);
    return {setValues(values){assert.equal(values[0][1],'CLOSED');closed=true;}};
  }
};
const getDb_=()=>({getSheetByName:name=>name==='申請'?requestSheet:
  name==='月次締め'?monthlyCloseSheet:null});
const readRowsByColumnValues_=(sheet,column,width,employeeIds)=>{
  assert.equal(sheet,requestSheet);
  assert.equal(column,3);
  assert.ok(width===19||width===14);
  calls.push({column,width,ids:[...employeeIds]});
  return rows.filter(r=>employeeIds.includes(r[2])).map(r=>r.slice(0,width));
};
const normalizeDate_=s=>{
  const value=String(s);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('invalid date');
  return value;
};
const ctx=vm.createContext({
  console,Date,Map,Set,Math,Number,String,JSON,Object,Array,
  getDb_,readRowsByColumnValues_,normalizeDate_,
  DB:{timeZone:'Asia/Tokyo',sheets:{monthlyClose:'月次締め'}},
  Utilities:{formatDate:()=> '2099-01'},
  withScriptLock_:fn=>fn(),
  requireAdminSession_:()=>({employee:{employeeId:'ADMIN',name:'管理者'}}),
  getPayrollEmployees_:()=>[{employeeId:'FM010'}],
  SpreadsheetApp:{flush(){}},
  appendAudit_:()=>{},
  toTimestamp_:()=> '2026-10-10 11:00:00'
});
vm.runInContext(fs.readFileSync('src/Requests.gs','utf8'),ctx,{filename:'src/Requests.gs'});
vm.runInContext(fs.readFileSync('src/Monthly.gs','utf8'),ctx,{filename:'src/Monthly.gs'});
const conflict=vm.runInContext('assertNoLeaveConflict_',ctx);
const assertOpen=vm.runInContext('assertMonthRangeOpen_',ctx);
const closeMonth=vm.runInContext('closeMonthlyPeriod',ctx);

// Other employees are never part of the current employee's conflict decision.
rows.push(reqRow('O1','FM999','有給','2026-10-10','2026-10-10','承認待ち'));
assert.doesNotThrow(()=>conflict('FM010','有給','2026-10-10','2026-10-10','',false));
assert.deepEqual(calls.at(-1),{column:3,width:19,ids:['FM010']});
rows.push(reqRow('A1','FM010','午前半休','2026-10-10','2026-10-10','承認待ち'));
assert.throws(()=>conflict('FM010','午前半休','2026-10-10','2026-10-10','',false),/すでに存在/);
assert.doesNotThrow(()=>conflict('FM010','午前半休','2026-10-10','2026-10-10','A1',false));
assert.doesNotThrow(()=>conflict('FM010','午後半休','2026-10-10','2026-10-10','',false));
assert.throws(()=>conflict('FM010','有給','2026-10-10','2026-10-10','',false),/すでに存在/);
assert.doesNotThrow(()=>conflict('FM010','午前半休','2026-10-10','2026-10-10','',true));
rows[1][9]='承認済';
assert.throws(()=>conflict('FM010','午前半休','2026-10-10','2026-10-10','',true),/すでに存在/);
rows[1][9]='取消';
assert.doesNotThrow(()=>conflict('FM010','午前半休','2026-10-10','2026-10-10','',false));
assert.equal(fullReadAttempts,0,'conflict checks must not use whole table reads');

// A reversed range must fail before any month-by-month scan starts.
ctx.getMonthlyCloseStatusInternal_=month=>{observedMonths.push(month);return {yearMonth:month,closed};};
assert.throws(()=>assertOpen('2026-11-01','2026-10-31','申請を登録'),/開始日と終了日/);
assert.throws(()=>assertOpen('2026-11-18','2026-11-04','申請を登録'),/開始日と終了日/);
assert.equal(observedMonths.length,0,'reverse dates must not begin monthly reads');
assert.doesNotThrow(()=>assertOpen('2026-09-15','2026-11-02','申請を登録'));
assert.deepEqual(observedMonths,['2026-09','2026-10','2026-11']);
observedMonths.length=0;

// Monthly closing considers only payroll staff; unrelated staff cannot block closure.
ctx.getMonthlySummary=(_token,_ym,id)=>({
  employee:{name:id},labor:{ruleStatus:'CONFIGURED'},
  totals:{missingPunchDays:0,worklogMismatchDays:0}
});
ctx.getPayrollEmployees_=()=>[{employeeId:'FM010'}];
ctx.persistMonthlyCloseSnapshots_=()=>{snapshotWrites++;return 'SNAPSHOT-1';};
rows.length=0;
rows.push(reqRow('OTHER','FM999','有給','2020-01-20','2020-01-20','承認待ち'));
const first=closeMonth('ADMIN','2020-01');
assert.equal(first.closed,true,'unrelated employee does not block monthly close');
assert.equal(snapshotWrites,1);
assert.deepEqual(calls.at(-1),{column:3,width:14,ids:['FM010']});
closed=false;
rows.push(reqRow('OWN','FM010','有給','2020-01-15','2020-01-15','承認待ち'));
assert.throws(()=>closeMonth('ADMIN','2020-01'),/承認待ち申請が1件/);
assert.equal(snapshotWrites,1,'blocked close must not persist a snapshot');
assert.equal(closed,false);
rows[1][9]='承認済';
const second=closeMonth('ADMIN','2020-01');
assert.equal(second.closed,true);
assert.equal(snapshotWrites,2);
assert.equal(fullReadAttempts,0,'monthly close must not scan every employee application row');
console.log('PASS: indexed leave conflict, month-close staff isolation and immediate inverted-range rejection');
