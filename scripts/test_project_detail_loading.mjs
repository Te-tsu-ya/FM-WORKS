import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const backend=fs.readFileSync('src/ProjectHub.gs','utf8'),access=fs.readFileSync('src/DataAccess.gs','utf8');
const reads=[],cache=new Map();let finderEnabled=true,afterFind=null;
const row=(id,name,status='有効',minutes=30)=>[id,'2026-10-14','E1','架空社員',name,'開発','内容','09:00','09:30',String(minutes),'private note','timestamp',status];
let records=Array.from({length:6000},(_,i)=>row('F'+i,'Other'));
for(let i=100;i<106;i++)records[i]=row('T'+i,i%2?'　NAME.[A]　':'old name');
records[106]=row('DELETED','name.[a]','削除');records[107]=row('ZERO','name.[a]','有効',0);records[108]=row('COLLISION','shared alias');
const sheet={getLastRow:()=>records.length+1,getRange(r,c,n,w){return {
 getDisplayValues(){reads.push({r,c,n,w});return records.slice(r-2,r-2+n).map(item=>item.slice(c-1,c-1+w));},
 createTextFinder(pattern){if(!finderEnabled)throw Error('unavailable');let matchCase=false;return {
 useRegularExpression(){return this;},matchCase(value){matchCase=value;return this;},matchEntireCell(){return this;},
 findAll(){const regex=new RegExp(pattern,matchCase?'':'i'),hits=records.flatMap((item,i)=>regex.test(item[c-1])?[{getRow:()=>i+2}]:[]);if(afterFind){afterFind();afterFind=null;}return hits;}
 };}
 };}};
const projects=[{projectId:'P1',name:'Name.[A]'},{projectId:'P2',name:'Other'}],plans=[{projectId:'P1',aliases:'["old name","shared alias"]'},{projectId:'P2',aliases:'["shared alias"]'}];
const ctx=vm.createContext({getDb_:()=>({getSheetByName:()=>sheet}),cacheJsonGetLarge_:key=>cache.get(key)||null,cacheJsonPutLarge_:(key,rows)=>cache.set(key,rows),cacheRemove_:key=>cache.delete(key)});
vm.runInContext(access.slice(access.indexOf('function contiguousRowBlocks_('),access.indexOf('function columnLetter_('))+backend,ctx);
const detail=(force=false)=>ctx.projectHubDetailWorklogRows_(force,'P1',projects,plans);
let found=detail();assert.equal(found.length,8);assert.ok(!found.some(r=>r[0]==='COLLISION'));assert.equal(reads.length,1);assert.equal(reads[0].n*reads[0].w,8*13,'only eight selected body rows, not 6000×13');
assert.equal(ctx.projectHubMetrics_({status:'進行中'},{},[],found.filter(r=>r[12]!=='削除'&&Number(r[9])>0).map(r=>r.slice(1,13)),'2026-10-14').actualMinutes,180);
reads.length=0;afterFind=()=>{records[100]=row('CHANGED','Other');};found=detail(true);assert.ok(!found.some(r=>r[0]==='CHANGED'),'live project recheck rejects a moved index hit');
records[100]=row('T100','old name');finderEnabled=false;reads.length=0;assert.equal(detail(true).length,8);assert.deepEqual(reads.map(r=>r.w),[1,13],'finder fallback reads one metadata column, then scoped body');finderEnabled=true;
cache.set('fm:projectHub:worklog:v2',records);reads.length=0;assert.equal(detail().length,8);assert.equal(reads.length,0,'reuse full snapshot without an extra Sheets read');detail(true);assert.ok(reads.length>0,'force never uses a warm snapshot');ctx.projectHubInvalidateWorklogs_();assert.equal(cache.size,0);
reads.length=0;assert.equal(ctx.projectHubDetailWorklogRows_(true,'MISSING',projects,plans).length,0);assert.equal(reads.length,0);
records=Array.from({length:6000},(_,i)=>row('B'+i,i%2?'Other':'name.[a]'));reads.length=0;found=detail(true);assert.equal(found.length,3000);assert.deepEqual(reads.map(r=>r.w),[13],'widely scattered hits prefer one full batch over many wide windows');
// Use the production ID reader for advanced task effort, not a broad snapshot.
ctx.PERFORMANCE_BUDGETS={indexedRead:800};ctx.logPerformance_=()=>{};
ctx.regexEscape_=value=>String(value).replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');
sheet.getRangeList=values=>({getRanges:()=>values.map(text=>{const m=text.match(/^A(\d+):M(\d+)$/);assert.ok(m);return sheet.getRange(+m[1],1,+m[2]-m[1]+1,13);})});
vm.runInContext(access.slice(access.indexOf('function readRowsByColumnValues_('),access.indexOf('function logPerformance_(')),ctx);
reads.length=0;assert.equal(ctx.projectHubWorklogRowsByIds_(['B0','B5999']).length,2);assert.equal(reads.length,0,'ID scope reuses existing complete snapshot');
ctx.projectHubInvalidateWorklogs_();reads.length=0;const byId=ctx.projectHubWorklogRowsByIds_(['B0','B5999','B0']);
assert.deepEqual(Array.from(byId,r=>r[0]),['B0','B5999']);assert.equal(reads.reduce((sum,r)=>sum+r.n*r.w,0),26,'6000 rows are narrowed to two physical ID rows');
reads.length=0;assert.equal(ctx.projectHubWorklogRowsByIds_([]).length,0);assert.equal(reads.length,0);
// Ticket identity releases a new request immediately and prevents an old callback
// from deleting the new request or overwriting a different selected project.
const calls=[],runner=(meta={})=>new Proxy({}, {get(_o,key){if(key==='withSuccessHandler')return fn=>runner({...meta,success:fn});if(key==='withFailureHandler')return fn=>runner({...meta,failure:fn});return (...args)=>calls.push({method:String(key),args,...meta});}});
const client=vm.createContext({state:{page:'projects',sessionToken:'S1',data:{user:{employeeId:'E1'},permissions:{}}},google:{script:{run:runner()}},document:{getElementById:()=>null},renderPageIfActive:()=>{},showToast:()=>{},escapeHtml:s=>String(s??''),cleanApiErrorMessage:e=>e.message});
vm.runInContext(fs.readFileSync('src/AppProjectHub.html','utf8').replace(/<\/?script>/g,''),client);
const run=s=>vm.runInContext(s,client),reply=(id,marker)=>({project:{projectId:id},metrics:{},tasks:[],resources:[],updates:[],worklogs:[],marker});
run("projectHubUi.selected='P1';projectHubLoadDetail_('P1')");const old=calls.at(-1);run("projectHubInvalidate_();projectHubLoadDetail_('P1')");const fresh=calls.at(-1);assert.notEqual(old,fresh,'invalidated pending read no longer blocks a new generation');
old.success(reply('P1','old'));assert.equal(run("projectHubUi.pending.has('P1')"),true,'old completion cannot unlock replacement');assert.equal(run('projectHubUi.details.size'),0);
fresh.success(reply('P1','new'));assert.equal(run("projectHubUi.details.get('P1').data.marker"),'new');assert.equal(run('projectHubUi.pending.size'),0);
run("projectHubTab_('tasks');projectHubTab_('effort');projectHubTab_('resources')");assert.equal(calls.length,2,'cached tabs have zero RPC');
run("projectHubLoadDetail_('P1',true)");const forced=calls.at(-1);run("projectHubLoadDetail_('P1',true)");assert.equal(calls.at(-1),forced,'force reads coalesce while same request is pending');forced.success(reply('P2','wrong'));assert.equal(run("projectHubUi.details.get('P1').data.marker"),'new','wrong-project response never replaces cached detail');assert.match(run('projectHubUi.error'),/形式/);
run('projectHubRetryDetail_()');calls.at(-1).success(reply('P1','retry'));assert.equal(run('projectHubUi.error'),'');
run("projectHubLoadDetail_('P1',true)");const elsewhere=calls.at(-1);run("projectHubUi.selected='P2';projectHubUi.error='P2 error'");elsewhere.failure(Error('P1 error'));assert.equal(run('projectHubUi.error'),'P2 error','unselected-project errors do not mask current context');
run("projectHubUi.selected='P1';projectHubLoadDetail_('P1',true)");const logout=calls.at(-1);run("resetProjectHubUi();state.sessionToken='S2'");logout.success(reply('P1','leak'));assert.equal(run('projectHubUi.details.size'),0);
run("projectHubUi.selected='P1';projectHubLoadDetail_('P1')");calls.at(-1).success(null);assert.equal(run('projectHubUi.details.size'),0);assert.match(run('projectHubUi.error'),/形式/);
console.log('PASS project detail loading: 6000-row scoped reads, aliases/collisions/live recheck, narrow fallback, warm/force/adaptive batching, pending generations, cached tabs, malformed replies and session isolation');
