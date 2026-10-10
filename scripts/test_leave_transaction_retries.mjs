import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Failure-injection tests run only against synthetic in-memory rows, never production DB.
let request=[],statusFailure=false,masterFailure=false,masterBalance=10;
let ledger=[],punches=[],idCounter=0;const audits=[];
const employee={employeeId:'FM0002',name:'架空社員B',role:'USER',active:true,
 rowNumber:2,leaveBalanceConfigured:true,leaveBalance:10,leaveBasisDate:'2026-01-01'};
const approver={employeeId:'ADMIN',name:'架空管理者',role:'ADMIN'};
const buildRequest=(id,type,date,status='承認待ち')=>{
 const row=Array(19).fill('');
 row[0]=id;row[2]=employee.employeeId;row[3]=employee.name;
 row[4]=type;row[5]=date;row[6]=date;row[9]=status;return row;
};
const requestSheet={
 getLastRow:()=>2,
 getRange(row,col,height=1,width=1){
  assert.equal(row,2);
  const data=()=>Array.from({length:height},()=>request.slice(col-1,col-1+width));
  return {
   getDisplayValues:data,
   createTextFinder:needle=>({
    matchEntireCell(){return this;},
    findNext(){return request[0]===String(needle)?{getRow:()=>2}:null;}
   }),
   setValues:values=>{
    if(col===10&&width===4&&statusFailure){statusFailure=false;throw Error('forced request status write failure');}
    assert.equal(values.length,height);
    values[0].forEach((value,i)=>{request[col-1+i]=value;});
   },
   setValue:value=>{
    if(col===10&&statusFailure){statusFailure=false;throw Error('forced request status write failure');}
    request[col-1]=value;
   }
  };
 }
};
const ledgerSheet={
 getLastRow:()=>ledger.length+1,
 appendRow:row=>{ledger.push(row.slice());}
};
const employeeSheet={
 getRange(row,col){
  assert.equal(row,2);assert.equal(col,11);
  return {setValue(value){
   if(masterFailure){masterFailure=false;throw Error('forced employee master write failure');}
   masterBalance=Number(value);
   employee.leaveBalance=Number(value);
   employee.leaveBalanceConfigured=true;
  }};
 }
};
const punchSheet={
 getLastRow:()=>punches.length+1,
 appendRow:row=>{punches.push(row.slice());}
};
const db={
 getSheetByName(name){
  if(name==='申請')return requestSheet;
  if(name==='有給台帳')return ledgerSheet;
  if(name==='社員マスタ')return employeeSheet;
  if(name==='打刻ログ')return punchSheet;
  throw Error('unexpected sheet: '+name);
 }
};
const readRowsByColumnValues_=(sheet,column,width,ids)=>{
 if(sheet===ledgerSheet){
  assert.equal(column,2);
  return ledger.filter(row=>ids.includes(row[1])).map(row=>row.slice(0,width));
 }
 if(sheet===requestSheet){
  assert.equal(column,3);
  return ids.includes(request[2])?[request.slice(0,width)]:[];
 }
 throw Error('unexpected indexed sheet');
};
const ctx=vm.createContext({
 console,Date,Number,String,Math,Set,Map,Array,Object,JSON,
 DB:{timeZone:'Asia/Tokyo',sheets:{leaveLedger:'有給台帳',employees:'社員マスタ',punches:'打刻ログ'}},
 getDb_:()=>db,readRowsByColumnValues_,
 readRowsByDateRange_:(sheet,column,width,start,end)=>{
  assert.equal(sheet,punchSheet);
  assert.equal(column,4);assert.equal(width,12);
  return punches.filter(row=>row[3]>=start&&row[3]<=end).map(row=>row.slice());
 },
 getActivePunchRows_:()=>[],
 requireSession_:()=>({employee:approver}),
 withScriptLock_:fn=>fn(),
 getEmployee_:id=>{assert.equal(id,'FM0002');return employee;},
 reconcileLeaveUnlocked_:()=>({granted:false}),
 assertMonthRangeOpen_:()=>{},
 Utilities:{formatDate:()=> '2026-10-10'},
 SpreadsheetApp:{flush(){}},
 appendAudit_:event=>audits.push(event),
 createId_:prefix=>prefix+'-SYN-'+(++idCounter),
 safeSheetText_:(value,max)=>String(value??'').trim().slice(0,max),
 toTimestamp_:()=> '2026-10-10 11:00:00',
 normalizeDate_:value=>String(value),
 normalizeTime_:value=>String(value),
 isTimePunchAction_:value=>value==='出勤',
 validatePunchSequence_:()=>{}
});
vm.runInContext(fs.readFileSync('src/LeaveLedger.gs','utf8'),ctx,{filename:'LeaveLedger.gs'});
vm.runInContext(fs.readFileSync('src/Requests.gs','utf8'),ctx,{filename:'Requests.gs'});
// Use controlled rule/authorization fixtures; all persistence and retry functions remain actual code.
vm.runInContext('assertCanApproveRequest_=()=>{};calculateLeaveDaysForRequest_=()=>1;',ctx);
const approve=vm.runInContext('approveRequest',ctx);
const cancel=vm.runInContext('decideApprovedCancellation',ctx);
const postingCount=(type,id)=>ledger.filter(r=>r[5]===type&&r[8]===id).length;

request=buildRequest('REQ-1','有給','2026-10-12');
masterFailure=true;
assert.throws(()=>approve('ADMIN','REQ-1','APPROVE',''),/forced employee master write failure/);
assert.equal(request[9],'承認待ち','failed employee-master write must not mark approved');
assert.equal(postingCount('USE','REQ-1'),1,'first attempt has one ledger posting');
assert.equal(masterBalance,10,'master was not saved');
assert.throws(()=>approve('ADMIN','REQ-1','REJECT','差戻し'),/途中まで/,'partial approval cannot switch to rejection');
assert.throws(()=>vm.runInContext('cancelRequest',ctx)('ADMIN','REQ-1'),/途中まで/,'partial approval cannot be cancelled as a pending request');
assert.equal(approve('ADMIN','REQ-1','APPROVE','').ok,true);
assert.equal(request[9],'承認済');
assert.equal(masterBalance,9,'retry repairs employee master from ledger');
assert.equal(postingCount('USE','REQ-1'),1,'retry must not double consume');
assert.throws(()=>approve('ADMIN','REQ-1','APPROVE',''),/すでに処理されています/);

request=buildRequest('REQ-2','有給','2026-10-13');
statusFailure=true;
assert.throws(()=>approve('ADMIN','REQ-2','APPROVE',''),/forced request status write failure/);
assert.equal(request[9],'承認待ち');
assert.equal(postingCount('USE','REQ-2'),1);
assert.equal(masterBalance,8);
assert.equal(approve('ADMIN','REQ-2','APPROVE','').ok,true);
assert.equal(request[9],'承認済');
assert.equal(masterBalance,8);
assert.equal(postingCount('USE','REQ-2'),1);

request[9]='取消申請中';
statusFailure=true;
assert.throws(()=>cancel('ADMIN','REQ-2','APPROVE',''),/forced request status write failure/);
assert.equal(request[9],'取消申請中');
assert.equal(postingCount('RESTORE','REQ-2'),1);
assert.equal(masterBalance,9);
assert.throws(()=>cancel('ADMIN','REQ-2','REJECT','却下'),/返却が途中まで/,'partial cancellation cannot switch to rejection');
assert.equal(cancel('ADMIN','REQ-2','APPROVE','').status,'取消済');
assert.equal(postingCount('RESTORE','REQ-2'),1);
assert.equal(masterBalance,9,'cancel retry must not double restore');

request=buildRequest('REQ-3','打刻修正','2026-10-14');
request[7]=JSON.stringify({originalPunchId:'',action:'出勤',time:'09:00',workLocation:'出社'});
statusFailure=true;
assert.throws(()=>approve('ADMIN','REQ-3','APPROVE',''),/forced request status write failure/);
assert.equal(request[9],'承認待ち');
assert.equal(punches.length,1,'corrected punch was appended once');
assert.throws(()=>approve('ADMIN','REQ-3','REJECT','差戻し'),/途中まで/);
assert.equal(approve('ADMIN','REQ-3','APPROVE','').ok,true);
assert.equal(request[9],'承認済');
assert.equal(punches.length,1,'punch correction retry must not create a duplicate row');
assert.equal(punches[0][10],'申請承認による修正 REQ-3');

const useRows=ledger.filter(row=>row[5]==='USE');
assert.equal(useRows.length,2);
assert.ok(audits.some(x=>x.operation==='申請承認'));
console.log('PASS: leave approval/cancellation and punch correction are retry-safe after injected sheet failures');
