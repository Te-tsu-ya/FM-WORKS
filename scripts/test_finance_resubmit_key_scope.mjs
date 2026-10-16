import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// All data stays in memory. Load the actual GAS business function.
const source=fs.readFileSync('src/Finance.gs','utf8');
const start=source.indexOf('function resubmitFinanceRequest(');
assert.ok(start>=0,'finance resubmission API missing');
const end=source.indexOf('\nfunction ',start+12);
const sourceFunction=source.slice(start,end<0?source.length:end);
let writes=0,audits=0,lookups=0,lockCalls=0;
const employee={employeeId:'EMP-A',name:'Synthetic Employee'};
const keys=['id','employeeId','status','requestKey','amount'];
const returned='\u5dee\u623b\u3057',pending='\u627f\u8a8d\u5f85\u3061';
const rows=[
 {id:'TRP-A',employeeId:'EMP-A',status:returned,requestKey:'OLD_REQUEST_0001',amount:200},
 {id:'TRP-B',employeeId:'EMP-A',status:pending,requestKey:'USED_REQUEST_0002',amount:100}
];
const sheet={
 getLastRow:()=>rows.length+1,
 getRange:(number)=>({setValues:(values)=>{
   const row=Object.fromEntries(keys.map((key,i)=>[key,values[0][i]]));
   Object.assign(rows[number-2],row);writes++;
 }})
};
const context=vm.createContext({
 String,Object,Array,Number,Error,
 FINANCE_MODELS:{travel:{keys},expense:{keys}},
 requireSession_:token=>({employee:token==='OTHER'?
   {employeeId:'EMP-B',name:'Other Employee'}:employee}),
 financeExpensePayload_:p=>p,financeTravelPayload_:p=>p,
 financeRequestKey_:value=>String(value),
 withScriptLock_:fn=>{lockCalls++;return fn();},
 financeFindRow_:(kind,id)=>{const index=rows.findIndex(r=>r.id===id);
   assert.ok(index>=0);return {item:rows[index],sheet,rowNumber:index+2};},
 readRowsByColumnValues_:(sh,column,width,values)=>{
   assert.equal(sh,sheet);assert.equal(column,4);assert.equal(width,keys.length);
   lookups++;return rows.filter(row=>values.includes(row.requestKey))
     .map(row=>keys.map(key=>row[key]));
 },
 financeSameSubmittedRecord_:(kind,stored,submitted)=>stored.amount===submitted.amount,
 financeConfirmedRecord_:item=>({...item}),
 financeAuditConfirmedForRetry_:()=>true,
 financeNow_:()=> '2026-10-16 12:00:00',
 financeArray_:(kind,item)=>keys.map(key=>item[key]),
 financeInvalidateOverview_:()=>{},
 appendAudit_:()=>{audits++;return true;},
 auditJson_:JSON.stringify,financeAuditRequestNote_:key=>key
});
vm.runInContext(sourceFunction,context,{filename:'src/Finance.gs'});
const submit=(id,key,amount=200,kind='travel',token='OWNER')=>
 context.resubmitFinanceRequest(token,kind,id,{requestKey:key,amount});
assert.throws(()=>submit('TRP-A','USED_REQUEST_0002'),/\u9001\u4fe1\u8b58\u5225\u5b50/,
 'a key from another record must never be reused');
assert.equal(writes,0,'collision must not write');
assert.equal(audits,0,'collision must not claim a completed audit');
assert.throws(()=>submit('TRP-A','NEW_REQUEST_0003',200,'travel','OTHER'),/\u4ed6\u306e\u793e\u54e1/,
 'owner authorization precedes lookup');
assert.equal(writes,0);
const saved=submit('TRP-A','NEW_REQUEST_0003');
assert.equal(saved.ok,true);assert.equal(saved.duplicate,false);
assert.equal(writes,1);
assert.equal(rows[0].requestKey,'NEW_REQUEST_0003');
assert.equal(rows[1].requestKey,'USED_REQUEST_0002','the other record is not modified');
const retry=submit('TRP-A','NEW_REQUEST_0003');
assert.equal(retry.duplicate,true);
assert.equal(writes,1,'identical retry cannot write twice');
assert.throws(()=>submit('TRP-A','NEW_REQUEST_0003',201),/\u524d\u56de\u3068\u7570\u306a\u308b/);
assert.equal(writes,1,'changed retry cannot write');
rows.push({id:'TRP-C',employeeId:'EMP-A',status:pending,requestKey:'NEW_REQUEST_0003',amount:100});
assert.throws(()=>submit('TRP-A','NEW_REQUEST_0003'),/\u9001\u4fe1\u8b58\u5225\u5b50/,
 'a previously duplicated key must not be reported as an unambiguous retry');
assert.equal(writes,1);
rows.pop();
// A different returned report can still be resubmitted with its own new key.
rows[1].status=returned;
const independent=submit('TRP-B','INDEPENDENT_NEW_0004',100);
assert.equal(independent.ok,true);
assert.equal(rows[0].requestKey,'NEW_REQUEST_0003');
assert.equal(rows[1].requestKey,'INDEPENDENT_NEW_0004');
assert.equal(writes,2);
assert.ok(lookups>=6&&lockCalls>=7);
console.log('PASS finance resubmission: separate IDs and owners, duplicate key rejection, normal save, exact retry, changed retry and ambiguous legacy keys');

