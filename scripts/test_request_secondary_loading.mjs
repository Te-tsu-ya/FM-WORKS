import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const core=fs.readFileSync('src/AppCore.html','utf8');
const op=fs.readFileSync('src/AppOperations.html','utf8');
const start=core.indexOf('function loadPageData_(');
const end=core.indexOf('function navigate(',start);
assert.ok(start>=0&&end>start);
const source=core.slice(start,end);
const sent=[],idle=[];
const state={sessionToken:'S1',page:'requests',data:{user:{employeeId:'U1'}}};
let ready=false,fresh=false;
const c=vm.createContext({state,loadRequests:()=>{sent.push('REQUEST');},
 loadMyFinanceItems:()=>{sent.push('FINANCE');},
 queueRequestFinanceHistory_:()=>{sent.push('QUEUE');},
 requestsDataReady:()=>ready,cacheFresh:()=>fresh,requestsIdentity:()=>state.sessionToken+'|U1',
 Date,Number,Math,Object,Array,Set,Map,JSON,console});
vm.runInContext(source,c);
c.loadPageData_('requests');
assert.deepEqual(sent,['REQUEST'],'cold visit must not start finance concurrently');
sent.length=0;ready=true;fresh=true;
c.loadPageData_('requests');
assert.deepEqual(sent,['REQUEST','QUEUE'],'warm visit can schedule the secondary ledger');
const begin=op.indexOf('function queueRequestFinanceHistory_('),finish=op.indexOf('function loadRequests(',begin);
assert.ok(begin>=0&&finish>begin);
const requestFunctions=op.slice(op.indexOf('function requestsIdentity()'),op.indexOf('function requestsDataReady()'))+
 op.slice(begin,finish);
const callbackContext=vm.createContext({state,Date,Map,Set,Array,Math,Object,String,Number,
 scheduleIdleTask:fn=>idle.push(fn),
 loadMyFinanceItems:()=>sent.push('FINANCE')});
vm.runInContext(requestFunctions,callbackContext);
callbackContext.queueRequestFinanceHistory_();assert.equal(idle.length,1);
idle.pop()();assert.equal(sent.at(-1),'FINANCE');
sent.length=0;callbackContext.queueRequestFinanceHistory_();
state.sessionToken='S2';idle.pop()();
assert.deepEqual(sent,[],'session change skips stale scheduled secondary fetch');
state.sessionToken='S1';callbackContext.queueRequestFinanceHistory_();
state.page='home';idle.pop()();
assert.deepEqual(sent,[],'route change skips hidden secondary fetch');
assert.match(op,/if\(state\.page==='requests'\)queueRequestFinanceHistory_\(\)/);
console.log('PASS requests priority, lazy finance history, warm cache, session/route isolation');
