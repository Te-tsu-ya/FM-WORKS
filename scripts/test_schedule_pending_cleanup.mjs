import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync('src/AppOperations.html','utf8').replace(/^<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const incoming=[],pending=new Set();
const googleRun=(meta={})=>new Proxy({}, {get(_x,key){
 if(key==='withSuccessHandler')return f=>googleRun({...meta,success:f});
 if(key==='withFailureHandler')return f=>googleRun({...meta,failure:f});
 return (...args)=>incoming.push({name:key,args,...meta});
}});
const state={
 sessionToken:'S1',data:{today:'2026-10-14',user:{employeeId:'U1'},employees:[]},
 page:'schedule',
 schedule:{date:'2026-10-14',loadedKey:'',loadedIdentity:'',events:[],rawEvents:[],
  companyDays:[],employees:[],loading:false,refreshing:false,error:'',employeeId:'ALL',category:'ALL'}
};
const c=vm.createContext({state,google:{script:{run:googleRun()}},
 Date,Map,Set,Math,Number,String,Object,Array,console,
 monthGridRange:d=>({start:d.slice(0,7)+'-01',end:d.slice(0,7)+'-31'}),
 scheduleCacheKey:()=>state.schedule.date.slice(0,7)+'-01|'+state.schedule.date.slice(0,7)+'-31',
 renderPageIfActive(){},markPageCache(){},scheduleFocusDetail(){},
 beginPageLoad:(group,key)=>{const ticket=group+':'+key;pending.add(ticket);return ticket},
 endPageLoad:ticket=>pending.delete(ticket),
 sessionErrorMessage:err=>String(err&&err.message||err),handleApiError(){},showToast(){}});
vm.runInContext(src,c,{filename:'AppOperations.html'});
c.loadSchedule();
assert.equal(incoming.length,1);assert.equal(pending.size,1);
const old=incoming[0];
c.invalidateScheduleWindowCache();
assert.equal(pending.size,0,'invalidating a route releases old loading reservations');
assert.equal(vm.runInContext('scheduleWindowRequests.size',c),0);
old.success({events:[{id:'OLD'}],companyDays:[]});
assert.equal(state.schedule.events.length,0,'late result cannot restore stale events');
state.schedule.date='2026-11-14';
c.loadSchedule();
assert.equal(incoming.length,2);
assert.equal(pending.size,1,'new generation is free to issue a fresh request');
incoming[1].success({events:[{id:'NEW'}],companyDays:[]});
assert.equal(state.schedule.events[0].id,'NEW');
assert.equal(pending.size,0);
console.log('PASS schedule invalidation releases pending load, old responses ignored, current result applied');
