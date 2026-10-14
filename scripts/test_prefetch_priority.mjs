import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync('src/AppCore.html','utf8');
const start=src.indexOf('function prefetchRouteOnIntent(');
const end=src.indexOf('function startMenuPrefetch()',start);
assert.ok(start>=0&&end>start);
let queued=null,delay=null;const calls=[];
const state={data:{user:{employeeId:'U'}},sessionToken:'session',busy:false};
const ctx=vm.createContext({state,pendingLoads:new Set(),routePrefetchTimer:0,
 clearTimeout(){},setTimeout(fn,ms){queued=fn;delay=ms;return 1;},
 loadSchedule:()=>calls.push('schedule'),loadWorklogs:()=>calls.push('worklog'),
 loadRequests:()=>calls.push('requests'),somuLoad:()=>calls.push('office')});
vm.runInContext(src.slice(start,end),ctx);
for(const p of ['requests','office'])ctx.queueRoutePrefetch(p);
assert.equal(queued,null,'heavy ledgers are never prefetched on hover');
ctx.queueRoutePrefetch('schedule');
assert.equal(delay,450);queued();assert.deepEqual(calls,['schedule']);
ctx.queueRoutePrefetch('worklog');queued();assert.deepEqual(calls,['schedule','worklog']);
state.busy=true;ctx.queueRoutePrefetch('schedule');queued();
assert.deepEqual(calls,['schedule','worklog'],'busy pages cannot be displaced');
console.log('PASS hover prefetch only bounded windows, no heavy ledgers, no busy-page competition');
