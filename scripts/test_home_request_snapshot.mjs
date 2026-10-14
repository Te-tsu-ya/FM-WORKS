
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const c=vm.createContext({console,Date,Math,Map,Set,JSON,Array,Object,String,Number,RegExp,Error});
vm.runInContext(fs.readFileSync('src/Requests.gs','utf8'),c);
const row=(id,owner,type,status,start='2026-10-10',end=start)=>{const r=Array(19).fill('');r[0]=id;r[2]=owner;r[4]=type;r[5]=start;r[6]=end;r[9]=status;return r;};
let rows=[
 row('OWN-A','U','有給','承認済'),row('OWN-P','U','有給','承認待ち'),
 row('TEAM-P','M','欠勤','承認待ち'),row('TEAM-A','M','有給','承認済'),
 row('LATE','U','有給','承認済','2026-09-10'),row('CANCEL','U','有給','取消申請中')
],reads=0,lastScope=[];
c.getDb_=()=>({getSheetByName:()=>({getLastRow:()=>rows.length+1})});
c.getPermissions_=e=>({requestApprove:e.role!=='USER'});
c.getManagedEmployeeIds_=()=>new Set(['M']);
c.readRowsByColumnValues_=(_sheet,col,width,ids)=>{
 reads++;lastScope=Array.from(ids);assert.equal(col,3);assert.equal(width,19);
 return rows.filter(r=>ids.includes(r[2]));
};
const own=c.getHomeRequestSnapshot_({employeeId:'U',role:'USER'},'2026-10-01','2026-10-14');
assert.equal(reads,1);assert.deepEqual(Array.from(own.approved,x=>x.id),['OWN-A','CANCEL']);
assert.equal(own.pendingCount,1);assert.deepEqual(lastScope,['U']);
reads=0;
const mgr=c.getHomeRequestSnapshot_({employeeId:'U',role:'MANAGER'},'2026-10-01','2026-10-14');
assert.equal(reads,1);assert.deepEqual(Array.from(mgr.approved,x=>x.id),['OWN-A','CANCEL']);
assert.equal(mgr.pendingCount,1);assert.deepEqual(lastScope,['U','M']);
rows=[];reads=0;
const empty=c.getHomeRequestSnapshot_({employeeId:'U',role:'USER'},'2026-10-01','2026-10-14');
assert.equal(empty.approved.length,0);assert.equal(empty.pendingCount,0);assert.equal(reads,0);
assert.ok(fs.readFileSync('src/Code.gs','utf8').includes('getHomeMonthStats_(employee,today,requestSnapshot.approved)'));
assert.ok(fs.readFileSync('src/Code.gs','utf8').includes('requestSnapshot.pendingCount'));
console.log('PASS single home request read, empty/employee/manager/leave boundaries');
