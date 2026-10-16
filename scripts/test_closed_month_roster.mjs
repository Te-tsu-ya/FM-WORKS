import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Synthetic employee and payroll snapshot records: no real GAS / DB writes.
const source=fs.readFileSync('src/Monthly.gs','utf8');
const from=source.indexOf('function createTeamMonthlyExport(');
assert.ok(from>=0,'team monthly export API missing');
const to=source.indexOf('\nfunction ',from+11);
const code=source.slice(from,to<0?source.length:to);
let payrollReads=0, snapshotReads=0, closes=0, tempCreates=0, tempTrash=0;
let exportedIds=[], detailedIds=[], scopeIds=null, mode='CLOSED', snapshotRows=[
 {employee:{employeeId:'FORMER',name:'Former Employee'},yearMonth:'2026-09'},
 {employee:{employeeId:'CURRENT',name:'Current Employee'},yearMonth:'2026-09'}
];
const fakeSummarySheet={setName(name){assert.equal(name,'集計一覧');}};
const context=vm.createContext({
 Date,String,Array,Number,Error,console,
 requireAdminSession_:token=>{if(token!=='ADMIN')throw Error('ADMIN_REQUIRED');return {employee:{role:'ADMIN'}};},
 normalizeYearMonth_:value=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))throw Error('対象月');return value;},
 getPayrollEmployees_:()=>{payrollReads++;return [{employeeId:'CURRENT'}, {employeeId:'NEW_HIRE'}];},
 getMonthlyCloseStatusInternal_:ym=>{closes++;return {closed:mode==='CLOSED',snapshotId:mode==='NO_ID'?'':'SNAPSHOT-001'};},
 getMonthlySnapshotSummaries_:(ym,id,ids)=>{snapshotReads++;scopeIds=ids;
   assert.equal(id,'SNAPSHOT-001');assert.equal(ym,'2026-09');
   return snapshotRows.filter(row=>!ids.length||ids.includes(row.employee.employeeId));},
 SpreadsheetApp:{create:()=>{tempCreates++;return{
    getId:()=> 'TMP-001', getSheets:()=>[fakeSummarySheet],
    insertSheet:name=>({name})};}, flush(){}},
 Utilities:{getUuid:()=> 'LOCAL-001',base64Encode:()=> 'AQID'},
 DriveApp:{getFileById:()=>({setTrashed(value){assert.equal(value,true);tempTrash++;}})},
 writeTeamSummarySheet_:(sheet,rows)=>{assert.equal(sheet,fakeSummarySheet);exportedIds=rows.map(row=>row.employee.employeeId);},
 safeSheetName_:value=>String(value).slice(0,90),
 writeMonthlyDetailSheet_:(sheet,row)=>{detailedIds.push(row.employee.employeeId);},
 exportSpreadsheetXlsx_:()=>({getBytes:()=>[1,2,3]}),
 buildTaxEmailText_:(rows,ym)=>rows.map(row=>row.employee.employeeId).join(',')+'/'+ym
});
vm.runInContext(code,context);
assert.throws(()=>context.createTeamMonthlyExport('STAFF','2026-09'),/ADMIN_REQUIRED/);
assert.throws(()=>context.createTeamMonthlyExport('ADMIN','2026-00'),/対象月/);
assert.equal(payrollReads,0,'invalid requests must not read the live employee master');
const output=context.createTeamMonthlyExport('ADMIN','2026-09');
assert.equal(output.filename,'FM_WORKS_給与提出_2026-09.xlsx');
assert.deepEqual(exportedIds,['FORMER','CURRENT'], 'archive membership must not change when the employee master is edited');
assert.deepEqual(detailedIds,['FORMER','CURRENT']);
assert.equal(output.emailText,'FORMER,CURRENT/2026-09');
assert.equal(payrollReads,0,'export should use only the closed snapshot roster');
assert.deepEqual(Array.from(scopeIds),[],'empty filter must request all closed snapshot employees');
assert.equal(tempCreates,1);assert.equal(tempTrash,1);
mode='OPEN';
assert.throws(()=>context.createTeamMonthlyExport('ADMIN','2026-09'),/月次締め後/);
mode='NO_ID';
assert.throws(()=>context.createTeamMonthlyExport('ADMIN','2026-09'),/月次締め後/);
mode='CLOSED';snapshotRows=[];
assert.throws(()=>context.createTeamMonthlyExport('ADMIN','2026-09'),/確定データが不足/);
assert.equal(tempCreates,1,'invalid closed snapshot must not create an export file');
assert.equal(tempTrash,1,'temporary files must be cleaned after successful export');
console.log('PASS closed-month payroll: frozen employee roster after new hire/retirement, admin-only, invalid-month and empty/corrupt snapshot guards');

