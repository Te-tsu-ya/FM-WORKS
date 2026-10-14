import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

// Synthetic workloads only. --baseline measures the local, unmodified snapshot.
const baseline=process.argv.includes('--baseline');
const source=name=>baseline?execFileSync('git',['show','HEAD:src/'+name],{encoding:'utf8'}):fs.readFileSync('src/'+name,'utf8');
class Sheet{
 constructor(rows){this.rows=rows;this.reads=[];}
 getLastRow(){return this.rows.length;}
 getRange(row,col,n=1,width=1){return {createTextFinder:pattern=>({useRegularExpression(){return this;},matchEntireCell(){return this;},findAll:()=>this.rows.flatMap((r,i)=>i>=row-1&&i<row-1+n&&new RegExp(pattern,'i').test(String(r[col-1]||''))?[{getRow:()=>i+1}]:[])}),getDisplayValues:()=>{
  this.reads.push({row,col,n,width});
  return Array.from({length:n},(_,i)=>Array.from({length:width},(_,j)=>String(this.rows[row+i-1]?.[col+j-1]??'')));
 }};}
 getRangeList(ranges){return {getRanges:()=>ranges.map(value=>{const m=value.match(/^A(\d+):M(\d+)$/);assert.ok(m);return this.getRange(Number(m[1]),1,Number(m[2])-Number(m[1])+1,13);})};}
}
const cache=new Map(),sheets={};let dbId='DB-A',generation=0;
const cacheApi={get:k=>cache.get(k)||null,getAll:keys=>Object.fromEntries(keys.filter(k=>cache.has(k)).map(k=>[k,cache.get(k)])),
 put:(k,v)=>{assert.ok(k.length<=250);assert.ok(Buffer.byteLength(v)<=100000);cache.set(k,v);},
 putAll:parts=>{for(const [k,v] of Object.entries(parts))cacheApi.put(k,v);},remove:k=>cache.delete(k)};
const people={A:{employeeId:'A',role:'ADMIN'},U:{employeeId:'U',role:'USER'},Z:{employeeId:'Z',role:'USER'}};
const projects=[{projectId:'P1',name:'案件一',status:'進行中'},{projectId:'P2',name:'案件二',status:'進行中'}];
const ctx=vm.createContext({console,Date,Map,Set,Math,JSON,Number,String,Object,Array,RegExp,Boolean,
 DB:{timeZone:'Asia/Tokyo'},getDb_:()=>({getSheetByName:n=>sheets[n]||null}),getDatabaseSpreadsheetId_:()=>dbId,
 getProjectsInternal_:()=>projects,getEmployees_:()=>Object.values(people),
 requireSession_:token=>({employee:people[token]}),requireAdminSession_:token=>{if(people[token].role!=='ADMIN')throw Error('ADMIN');return {employee:people[token]};},
 CacheService:{getScriptCache:()=>cacheApi},Utilities:{getUuid:()=>`generation-${++generation}`,formatDate:()=> '2026-10-11'}});
for(const name of ['Schema.gs','DataAccess.gs','ProjectHub.gs','ProjectAdvanced.gs','CashFlow.gs','CashFlowBank.gs'])vm.runInContext(source(name),ctx,{filename:name});
const specs=JSON.parse(JSON.stringify(vm.runInContext('DB_SCHEMA_SPECS',ctx)));
for(const [name,header] of Object.entries(specs))sheets[name]=new Sheet([header]);
delete sheets['見積ヘッダー'];
sheets['プロジェクト計画'].rows.push(['P1',480,'A','','','','','未登録','','[]',1]);
sheets['プロジェクト作業'].rows.push(['T1','P1','設計','U','2026-10-01','2026-10-15',480,50,'進行中','',1]);
sheets['プロジェクト工数対応'].rows.push(['W0','P1','T1'],['FOREIGN','P1','T1']);
sheets['プロジェクト原価'].rows.push(['C1','P1','2026-10-10','外注','確認用',1000,1,'有効']);
sheets['工数']=new Sheet([Array(15).fill('header'),...Array.from({length:1500},(_,i)=>[
 'W'+i,'2026-10-10','U','架空担当','案件一','設計','設計確認😀'.repeat(30),'09:00','09:30',30,'備考'.repeat(20),'2026-10-10','有効','','']),
 ['FOREIGN','2026-10-10','U','架空担当','案件二','設計','別の案件','09:00','10:00',999,'','','有効']]);
const readCounts=()=>({headers:Object.values(sheets).flatMap(s=>s.reads).filter(r=>r.row===1).length,
 worklogBodyCells:sheets['工数'].reads.filter(r=>r.row>=2&&r.width===13).reduce((sum,r)=>sum+r.n*r.width,0),
 worklogFullReads:sheets['工数'].reads.filter(r=>r.row===2&&r.width>1&&r.n>250).length});
const resetReads=()=>Object.values(sheets).forEach(s=>s.reads=[]);
ctx.getProjectHubWorkspace('A');resetReads();
const advanced=ctx.getProjectAdvanced('A','P1'),counts=readCounts();
resetReads();ctx.getProjectHubWorkspace('U');const warm=readCounts();
const bank=ctx.getCashFlowBankWorkspace('A',2026),bankHeaders=readCounts().headers-warm.headers;
console.log(JSON.stringify({mode:baseline?'baseline':'fixed',advanced:counts,warmProject: warm,bankHeaders}));
if(baseline)process.exit(0);
assert.equal(advanced.taskEffort[0].actualMinutes,30,'a cross-project worklog link cannot inflate task effort');
assert.equal(counts.headers,10,'each project schema checked once within this request');
assert.equal(counts.worklogFullReads,0,'task effort reads matching IDs, not a full detail snapshot');
assert.equal(counts.worklogBodyCells,26,'two linked IDs need exactly two body rows');
resetReads();ctx.getProjectAdvanced('A','P1');assert.equal(readCounts().worklogFullReads,0,'repeated task effort never fetches the full worklog table');
assert.equal(warm.worklogFullReads,0,'Japanese workload above 100 KB stays cached');
assert.equal(bankHeaders,5,'each bank/year schema is checked once');
assert.throws(()=>ctx.getProjectAdvanced('Z','P1'),/権限/,'cached worklogs never bypass live membership checks');
assert.equal(Object.hasOwn(ctx.getProjectAdvanced('U','P1'),'costs'),false,'staff never receive cached financial data');
const part=[...cache.keys()].find(k=>k.includes(':generation-'));
assert.ok(part);cache.delete(part);resetReads();
assert.equal(ctx.getProjectHubWorkspace('A').projects[0].actualMinutes,45000,'an evicted chunk triggers a complete source read');
assert.equal(readCounts().worklogFullReads,1);
ctx.cacheJsonPut_('scope',{db:'A'},20);dbId='DB-B';
assert.equal(ctx.cacheJsonGet_('scope'),null,'DB changes cannot expose another DB snapshot');
ctx.cacheJsonPut_('scope',{db:'B'},20);dbId='DB-A';assert.equal(ctx.cacheJsonGet_('scope').db,'A');
assert.equal(ctx.cacheJsonPut_('oversized','日'.repeat(40000),20),false,'Japanese size is measured in UTF-8 bytes');
resetReads();ctx.projectHubInvalidateWorklogs_();ctx.getProjectHubWorkspace('A');assert.equal(readCounts().worklogFullReads,1,'confirmed writes invalidate the complete snapshot');
resetReads();ctx.getProjectHubWorkspace('A',true);assert.equal(readCounts().worklogFullReads,1,'explicit refresh reads source data');

// Full client controllers, controlled asynchronous RPC completion.
const calls=[];const runner=(meta={})=>new Proxy({}, {get(_o,key){
 if(key==='withSuccessHandler')return fn=>runner({...meta,success:fn});
 if(key==='withFailureHandler')return fn=>runner({...meta,failure:fn});
 return (...args)=>calls.push({method:String(key),args,...meta});
}});
let confirm=null;
const client=vm.createContext({console,Date,Map,Set,Math,JSON,Number,String,Object,Array,RegExp,Boolean,
 google:{script:{run:runner()}},window:{addEventListener(){}},document:{getElementById:()=>null},
 financeUi:{demo:false},renderPage(){},showToast(){},openConfirmDialog:(_t,_m,_l,fn)=>{confirm=fn;}});
for(const name of ['AppCore','AppProjectHub','AppProjectAdvanced','AppCashFlow','AppCashFlowBank','AppCashFlowPaste'])
 vm.runInContext(source(name+'.html').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),client,{filename:name});
vm.runInContext(fs.readFileSync('scripts/fixtures/AppCashFlowDemo.html','utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),client,{filename:'cashflow-test-fixture'});
const js=code=>vm.runInContext(code,client);
js("renderPageIfActive=()=>{};state.sessionToken='SESSION-A';state.data={today:'2026-10-11',user:{employeeId:'A'},permissions:{adminConsole:true,cashFlowWorkspace:true}};state.page='projects';projectHubUi.selected='P1';projectHubUi.tab='advanced';");
client.projectAdvancedLoad_();const first=calls.at(-1);client.projectAdvancedLoad_();assert.equal(calls.at(-1),first,'duplicate requests coalesce');
js("projectHubUi.selected='P2'");client.projectAdvancedLoad_();const second=calls.at(-1);
assert.equal(second.args[1],'P2','a new project is not blocked by another pending read');
first.success({marker:'old'});assert.equal(js('projectAdvancedUi.data'),null,'old project success ignored');
first.failure(Error('old error'));assert.equal(js('projectAdvancedUi.error'),'','old project failure ignored');
second.success({marker:'current'});const n=calls.length;client.projectAdvancedLoad_();assert.equal(calls.length,n,'cached project tabs have no extra RPC');
client.invalidateBusinessViewsAfterWrite('saveWorklog',{ok:true});assert.equal(js('projectAdvancedUi.data'),null,'worklog changes invalidate advanced task totals');
client.projectAdvancedLoad_();const pending=calls.at(-1);
client.invalidateBusinessViewsAfterWrite('saveProjectDependencies',{ok:true});pending.success({marker:'obsolete'});
assert.equal(js('projectAdvancedUi.data'),null,'a pre-save response cannot restore an invalidated snapshot');
assert.equal(calls.length,n+2,'queued refresh issues a single replacement read');calls.at(-1).success({marker:'new'});
const current=js('projectAdvancedUi');client.resetProjectHubUi();pending.failure(Error('late failure'));assert.notEqual(js('projectAdvancedUi'),current);

js("state.page='finance'");client.cashFlowOpen_();
const completeYear=(year=2026)=>({ok:true,fiscalYear:year,record:{openingBalance:1000,revision:1,months:Array.from({length:12},(_,i)=>({month:i?year+'-'+String(i).padStart(2,'0'):(year-1)+'-12',planIn:null,planOut:null,actualIn:null,actualOut:null,note:''}))}});
const completeBank=year=>({ok:true,year,accounts:[],plans:[],transactions:[],closing:{through:''},monthly:[]});
const initialCalls=calls.slice(-2);assert.deepEqual(initialCalls.map(c=>c.method),['getCashFlowYear','getCashFlowBankWorkspace']);
initialCalls[0].success(completeYear());initialCalls[1].success(completeBank(2026));
const opened=calls.length;client.cashFlowClose_();client.cashFlowOpen_();assert.equal(calls.length,opened,'reopening saved annual/bank data costs zero RPC');
client.cfbSection_('schedules');client.cfbSection_('banks');assert.equal(calls.length,opened,'bank tabs cost zero RPC');
js('cashFlowUi.draft.openingBalance=9999;cashFlowUi.dirty=true');client.cashFlowClose_();assert.equal(js('cashFlowUi.open'),true);confirm();client.cashFlowOpen_();
assert.equal(js('cashFlowUi.draft.openingBalance'),1000,'discarding an edit cannot pollute the saved snapshot');assert.equal(calls.length,opened);
js('cashFlowUi.at=1;cfbUi.at=1');client.cashFlowOpen_();assert.equal(calls.length,opened+2,'expired snapshots refresh both data sources');
const expired=calls.slice(-2);client.cashFlowChangeYear_(2027);const yearCalls=calls.slice(-2);
assert.deepEqual(yearCalls.map(c=>c.args[1]),[2027,2027],'year change replaces pending requests for both sources');
expired[0].success(completeYear());expired[1].success(completeBank(2026));assert.equal(js('cfbUi.loaded'),null,'previous year cannot overwrite current year');
yearCalls[0].success(completeYear(2027));yearCalls[1].success(completeBank(2027));
client.cashFlowReload_();const refresh=calls.slice(-2);client.cashFlowReload_();assert.equal(calls.at(-1),refresh.at(-1),'forced refresh coalesces in flight');
refresh[0].success(refresh[0].method==='getCashFlowYear'?completeYear(2027):completeBank(2027));
refresh[1].success(refresh[1].method==='getCashFlowYear'?completeYear(2027):completeBank(2027));
const latest=calls.slice(-2);for(const call of latest)call.success(call.method==='getCashFlowYear'?completeYear(2027):completeBank(2027));
client.cashFlowOpenDemo_();const demoCalls=calls.length;client.cashFlowClose_();assert.equal(js('cashFlowUi.data'),null,'sample data is never reused as real data');
client.cashFlowOpen_();assert.equal(calls.length,demoCalls+2);const loggedOut=calls.slice(-2);
client.resetCashFlowUi();js("state.sessionToken='SESSION-B'");loggedOut[0].success(completeYear(2027));loggedOut[1].success(completeBank(2027));
assert.equal(js('cashFlowUi.data'),null);assert.equal(js('cfbUi.loaded'),null,'logout clears financial cache and rejects old callbacks');
console.log('PASS workspace loading: bounded UTF-8 cache, DB isolation, eviction recovery, shared worklogs, one schema check, ACL, saved-data reopen, async invalidation, year/session isolation and sample separation');
