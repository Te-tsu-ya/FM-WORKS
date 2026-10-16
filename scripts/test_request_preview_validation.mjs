import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the actual previewRequest function in a synthetic GAS context.
// Never access live Sheets, authentication, or Google services.
const src = fs.readFileSync('src/Requests.gs','utf8');
const begin = src.indexOf('function previewRequest(');
const finish = src.indexOf('\nfunction submitRequest(',begin);
assert.ok(begin>=0,'previewRequest exists');
assert.ok(finish>begin,'previewRequest function ends before submitRequest');
const code = src.slice(begin,finish);
const calls={reconcile:0,context:0,calendar:0};
const ctx=vm.createContext({
 REQUEST_TYPES:['有給','午前半休','午後半休','1/4日有給','欠勤','打刻修正','在宅勤務','残業','休日出勤'],
 requireSession_:()=>({employee:{employeeId:'E-TEST'}}),
 maybeReconcileLeave_:()=>{calls.reconcile++},
 normalizeDate_:x=>String(x),
 getLeaveRequestContext_:()=>{calls.context++;return {leaveBalanceConfigured:true,leaveBalance:10,pendingLeaveDays:1,availableLeaveDays:9}},
 calculateLeaveDaysForRequest_:(type,start,end)=>{calls.calendar++;if(start==='2026-10-18')return 0;return type==='1/4日有給'?0.25:type==='午前半休'||type==='午後半休'?0.5:start===end?1:2},
 Math,String,Array,Error
});
vm.runInContext(code,ctx,{filename:'Requests.gs'});
const preview=p=>ctx.previewRequest('TOKEN',p);
for(const type of ['午前半休','午後半休','1/4日有給','打刻修正']){
 assert.throws(()=>preview({type,startDate:'2026-10-19',endDate:'2026-10-20'}),/1日単位/,type);
}
assert.throws(()=>preview({type:'有給',startDate:'2026-10-20',endDate:'2026-10-19'}),/開始日以降/);
assert.deepEqual(calls,{reconcile:0,context:0,calendar:0},'invalid periods must not query or mutate leave');
assert.throws(()=>preview({type:'有給',startDate:'2026-10-18'}),/有給を消化しません/);
const half=preview({type:'午前半休',startDate:'2026-10-19'});
assert.equal(half.requestedDays,0.5);assert.equal(half.projectedBalance,8.5);assert.equal(half.sufficient,true);
const full=preview({type:'有給',startDate:'2026-10-19',endDate:'2026-10-20'});
assert.equal(full.requestedDays,2);assert.equal(full.projectedBalance,7);
assert.equal(calls.context,3);
console.log('PASS request preview: invalid periods, non-working day and valid balances');
