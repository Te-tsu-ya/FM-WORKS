import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const quiet={log(){},warn(){},error(){},debug(){}};
const c=vm.createContext({console:quiet,Date,Map,Set,Number,Object,Array,JSON,String,Math});
for(const file of ['DataAccess.gs','Monthly.gs'])vm.runInContext(fs.readFileSync('src/'+file,'utf8'),c);
function sheet(rows){
 const stats={reads:0,cells:0,finds:0};
 const sh={getLastRow:()=>rows.length+1,getRange(r,col,h=1,w=1){return {
  getDisplayValues(){stats.reads++;stats.cells+=h*w;return rows.slice(r-2,r-2+h).map(v=>v.slice(col-1,col-1+w));},
  createTextFinder(pattern){stats.finds++;return {useRegularExpression(){return this},matchEntireCell(){return this},findAll(){return rows.flatMap((v,i)=>new RegExp(pattern).test(v[col-1])?[{getRow:()=>i+2}]:[]);}};}
 };},getRangeList(ranges){return {getRanges:()=>ranges.map(r=>{const m=/A(\d+):C(\d+)/.exec(r);return sh.getRange(+m[1],1,+m[2]-+m[1]+1,3);})};}};
 return {sh,stats};
}
let rows=Array.from({length:200},(_,i)=>['2026-10-14',i%2?'OTHER':'EMP',String(i)]),s=sheet(rows);
assert.equal(c.readRowsByDateRange_(s.sh,1,3,'2026-10-14','2026-10-14',2,['EMP']).length,100);
assert.deepEqual(s.stats,{reads:1,cells:600,finds:0},'small ledgers use one read and no index RPC');
s=sheet(rows);const small=c.readRowsByColumnValues_(s.sh,2,3,['EMP'],false,true);
assert.equal(small.length,100);assert.equal(small[0].rowNumber,2);assert.equal(small[1].rowNumber,4);assert.equal(s.stats.finds,0);
s=sheet(rows);assert.equal(c.readRowsByDateRange_(s.sh,1,3,'2026-10-14','2026-10-14',2,[]).length,0);assert.equal(s.stats.reads,0);
rows=Array.from({length:2000},(_,i)=>['2026-10-14',i%20===0&&i<1200?'EMP':'OTHER',String(i)]);s=sheet(rows);
const fragmented=c.readRowsByDateRange_(s.sh,1,3,'2026-10-14','2026-10-14',2,['EMP']);
assert.equal(fragmented.length,60);assert.equal(s.stats.reads,8,'60 disjoint records require only eight value reads');assert.ok(s.stats.cells<2000*3,'largest seven gaps stay unread');
s=sheet(rows);const numbered=c.readRowsByColumnValues_(s.sh,2,3,['EMP'],false,true);
assert.equal(numbered.length,60);assert.equal(s.stats.reads,8);assert.ok(numbered.every(x=>x.rowNumber===Number(x.values[2])+2),'window gaps never shift edit row numbers');
const nums=[2,5,9,20,21,35,50,70,100,101,180];
const windows=JSON.parse(JSON.stringify(c.indexedRowWindows_(nums)));
assert.ok(windows.length<=8);assert.ok(nums.every(n=>windows.some(w=>n>=w.start&&n<=w.end)));
const occupied=new Set(nums),gaps=nums.slice(1).map((n,i)=>n-nums[i]-1).filter(g=>g>0).sort((a,b)=>b-a);
assert.equal(windows.reduce((n,w)=>n+w.end-w.start+1,0),nums.at(-1)-nums[0]+1-gaps.slice(0,7).reduce((a,b)=>a+b,0),'bounded partition minimizes read cells');
// Exercise real cashflow UI against a deterministic RPC queue.
const calls=[];let renders=0;
const runner=(meta={})=>new Proxy({}, {get:(_o,k)=>k==='withSuccessHandler'?fn=>runner({...meta,ok:fn}):k==='withFailureHandler'?fn=>runner({...meta,fail:fn}):(...args)=>calls.push({method:k,args,...meta})});
const state={sessionToken:'A',page:'finance',data:{today:'2026-10-14',permissions:{cashFlowWorkspace:true,adminConsole:true}}};
const el={value:'2026',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},innerHTML:''};
const ui=vm.createContext({console:quiet,Date,Map,Set,Math,Object,Array,String,Number,JSON,RegExp,Error,
 state,financeUi:{demo:false,insightMode:false},google:{script:{run:runner()}},renderPageIfActive:()=>renders++,
 escapeHtml:v=>String(v??'').replaceAll('<','&lt;'),cleanApiErrorMessage:e=>e.message,
 showToast(){},openConfirmDialog:(_a,_b,_c,fn)=>fn(),document:{getElementById:()=>el},window:{addEventListener(){}},
 loadFinanceOverview:()=>calls.push({method:'financeOverview'}),financeIdentity:()=>state.sessionToken});
for(const file of ['AppCashFlow','AppCashFlowBank','AppCashFlowAnalysis','AppCashFlowLedger'])vm.runInContext(fs.readFileSync('src/'+file+'.html','utf8').replace(/<\/?script>/g,''),ui);
const js=s=>vm.runInContext(s,ui);js('cashFlowUi.open=true;cashFlowUi.year=2026;cfbUi.tab="analysis"');
ui.cfaLoad_(false);ui.cfaLoad_(false);assert.equal(calls.length,1,'navigation while loading never schedules another workspace read');
calls.shift().fail(Error('OFFLINE'));const before=calls.length;assert.match(ui.cfaPage_(),/接続を再試行/);ui.cfaPage_();assert.equal(calls.length,before,'rendering failure never retries automatically');
const workspace={ok:true,year:2026,months:['2026-10'],accounts:[],rules:[],scenarios:[],checks:[]};
ui.cfaLoad_(true);calls.shift().ok(workspace);assert.equal(calls[0].method,'getCashFlowAnalysisMonth');calls.shift().ok({ok:true,rows:[],total:0});
ui.cfaLoad_(false);assert.equal(calls.length,0,'fresh workspace and selected month reuse memory');
js('cfaUi.workspaceAt=Date.now()-300001');ui.cfaLoad_(false);assert.equal(calls.length,1);calls.shift().ok(workspace);assert.equal(calls.length,1);calls.shift().ok({ok:true,rows:[],total:0});
js('cfbUi.loaded={ok:true,accounts:[{id:"BANK",active:true}]};cfbUi.year=2026;cfbUi.at=Date.now();cfbUi.tab="ledger"');
ui.cfbLoad_(false);assert.equal(calls[0].method,'getCashFlowLedgerRows','a warm bank snapshot still loads the selected ledger');calls.shift().ok({ok:true,rows:[],total:0});ui.cfbLoad_(false);assert.equal(calls.length,0,'a quick revisit is fully cached');
js('cfbUi.tab="analysis"');ui.cfaLoadMonth_(true);const old=calls.shift();ui.cfbLoadAfterWrite_();assert.equal(calls[0].method,'getCashFlowBankWorkspace');old.ok({ok:true,rows:[{id:'OLD'}]});assert.equal(js('cfaUi.rows.length'),0,'pre-write response never overwrites post-write analysis');
calls.shift().ok({ok:true,accounts:[],closing:{}});assert.equal(calls[0].method,'getCashFlowAnalysisWorkspace');calls.shift().ok(workspace);calls.shift().ok({ok:true,rows:[],total:0});assert.equal(calls.length,0);
js('cfaUi.busy=true');ui.cfaReadError_(Error('OLD READ FAILURE'));assert.equal(js('cfaUi.busy'),true,'read failures never clear a save lock');ui.cashFlowChangeYear_(2027);assert.equal(js('cashFlowUi.year'),2026,'analysis save blocks year switch');ui.cfbSection_('reports');assert.equal(js('cfbUi.tab'),'analysis');ui.cashFlowClose_();assert.equal(js('cashFlowUi.open'),true);
js('cfaUi.busy=false;cfaUi.scenarioDraft={name:"未保存"}');let discard=null;ui.openConfirmDialog=(_a,_b,_c,fn)=>discard=fn;
ui.cashFlowChangeYear_(2027);assert.equal(js('cashFlowUi.year'),2026,'draft year is retained until discard confirmation');assert.equal(typeof discard,'function');
ui.cfbSection_('reports');assert.equal(js('cfbUi.tab'),'analysis','cancelled section switch retains the editor');
ui.cashFlowClose_();assert.equal(js('cashFlowUi.open'),true,'closing never silently discards an analysis draft');
discard();assert.equal(js('cashFlowUi.open'),false);assert.equal(calls.at(-1).method,'financeOverview','closing cashflow refreshes finance under its own TTL');
console.log('PASS adaptive reads and cashflow lifecycle: small single batch, eight minimal windows, exact owners/physical rows, zero duplicate or automatic-error retry, TTL, post-write stale guards and save locks');
