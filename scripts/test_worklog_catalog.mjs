import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync('src/AppOperations.html','utf8').replace(/^<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const requests=[],tickets=new Set();
const rpc=(meta={})=>new Proxy({}, {get(_o,k){
 if(k==='withSuccessHandler')return fn=>rpc({...meta,success:fn});
 if(k==='withFailureHandler')return fn=>rpc({...meta,failure:fn});
 return (...args)=>requests.push({method:k,args,...meta});
}});
const state={sessionToken:'S1',data:{today:'2026-10-14',user:{employeeId:'U1'},projects:[]},page:'worklog',
 worklog:{date:'2026-10-14',items:[],loading:false,error:''}};
const addDays=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const monthGridRange=s=>({start:s.slice(0,7)+'-01',end:s.slice(0,7)+'-28'});
const c=vm.createContext({state,google:{script:{run:rpc()}},Date,Map,Set,Array,Math,Number,String,JSON,Object,RegExp,
 addDays,monthGridRange,renderPageIfActive(){},markPageCache(){},handleApiError(){},
 beginPageLoad:(n,k)=>{const id=n+k;if(tickets.has(id))return null;tickets.add(id);return id;},
 endPageLoad:id=>tickets.delete(id),console});
vm.runInContext(code,c);
const run=text=>vm.runInContext(text,c);
run('loadWorklogs()');let request=requests.shift();
assert.equal(request.args[1].includeProjects,true);
request.success({items:[],projects:[],taskOptions:[]});
assert.equal(run('worklogCatalogFresh_()'),true,'empty arrays are valid loaded catalog');
state.worklog.date='2027-02-14';run('loadWorklogs()');request=requests.shift();
assert.equal(request.args[1].includeProjects,false,'second month only loads worklogs');
request.success({items:[],projects:[],taskOptions:[]});
run('invalidateWorklogCatalog_()');state.worklog.date='2027-06-14';run('loadWorklogs()');request=requests.shift();
assert.equal(request.args[1].includeProjects,true,'project write invalidates master');
request.success({items:[],projects:[],taskOptions:[]});
state.sessionToken='S2';state.data.user.employeeId='U2';state.worklog.date='2027-10-14';state.data.projects=[];
run('loadWorklogs()');request=requests.shift();
assert.equal(request.args[1].includeProjects,true,'new session never reuses former user catalog');
// Simulate a project save while a catalog read is in flight.
const oldRead=request;
run('invalidateWorklogCatalog_()');
oldRead.success({items:[],projects:[{name:'obsolete'}],taskOptions:[{title:'obsolete'}]});
assert.equal(run('worklogCatalogFresh_()'),false,'pre-save response may not restore an obsolete master');
assert.equal(state.data.projects.length,0,'invalidated master cannot be applied from late response');
// A completed master must be stable when returning to an older day window.
run('worklogStoreWindow(worklogWindowIdentity(),{start:"2028-03-01",end:"2028-03-31"},{items:[],projects:[{name:"CURRENT"}],taskOptions:[]},true)');
run('worklogStoreWindow(worklogWindowIdentity(),{start:"2028-04-01",end:"2028-04-30"},{items:[],projects:[{name:"OLD"}],taskOptions:[]},true)');
run('worklogShowCachedDay("2028-03-14",worklogCachedWindow("2028-03-14"))');
assert.equal(state.data.projects[0].name,'OLD','day cache never resurrects older master');
console.log('PASS empty worklog catalogs, fast date navigation, invalidation and session separation');
