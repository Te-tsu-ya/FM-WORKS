import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const backend=fs.readFileSync('src/Somu.gs','utf8');
let allowed=true,bodyReads=[],finderColumns=[];
const sheets={};
const context=vm.createContext({requireSession_:()=>({employee:{}}),assertPermission_:()=>{if(!allowed)throw Error('denied');},getDb_:()=>({getSheetByName:name=>sheets[name]}),DB:{timeZone:'Asia/Tokyo'},DB_SCHEMA_SPECS:{},schemaHeaderIssues_:()=>[],Utilities:{formatDate:()=> '2026-10-14'}});
vm.runInContext(backend,context);
const models=vm.runInContext('SOMU_MODELS',context);
function makeSheet(kind,records){
 const model=models[kind],rows=[model.keys,...records.map(item=>model.keys.map(key=>item[key]??''))];
 const sheet={rows,getLastRow:()=>rows.length,getRange(r,c,n,w){return {
  getDisplayValues(){if(r>1)bodyReads.push({r,n,w});return Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>String(rows[r-1+i]?.[c-1+j]??'')));},
  createTextFinder(text){finderColumns.push({c,w});let regex=false,entire=false,matchCase=false;return {
   matchCase(v){matchCase=v;return this;},matchEntireCell(v){entire=v;return this;},useRegularExpression(v){regex=v;return this;},
   findAll(){const hits=[];for(let i=r-1;i<r-1+n;i++)for(let j=c-1;j<c-1+w;j++){
    const value=String(rows[i]?.[j]??''),a=matchCase?value:value.toLowerCase(),b=matchCase?text:text.toLowerCase();
    const hit=regex?new RegExp(entire?'^(?:'+text+')$':text,matchCase?'':'i').test(value):entire?a===b:a.includes(b);
    if(hit)hits.push({getRow:()=>i+1});
   }return hits;}
  };}
 };}};
 sheets[model.sheet]=sheet;context.DB_SCHEMA_SPECS[model.sheet]=model.keys;return sheet;
}
const asset=makeSheet('asset',Array.from({length:2000},(_,i)=>({id:'A'+i,code:'CODE'+i,name:i===2?'archive.[x]':'PC',status:i%2?'利用中':'廃止',quantity:3,revision:4,updatedAt:'2026-10-14'})));
const page=p=>context.getSomuRecordsPage('token',p);
const preview=context.somuRows_('asset',1500,asset);assert.equal(preview.items.length,60);assert.equal(preview.truncated,true);assert.equal(preview.total,2000);
let first=page({kind:'assets'});assert.equal(first.items.length,60);assert.equal(first.items[0].id,'A1999');
asset.rows.push(models.asset.keys.map(key=>key==='id'?'APPENDED':''));
let ids=first.items.map(x=>x.id),cursor=first.nextBefore;
while(cursor){const next=page({kind:'assets',before:cursor});ids.push(...next.items.map(x=>x.id));assert.ok(!next.hasMore||next.nextBefore<cursor);cursor=next.nextBefore;}
assert.equal(ids.length,2000);assert.equal(new Set(ids).size,2000);assert.equal(ids.at(-1),'A0');assert.ok(!ids.includes('APPENDED'));
assert.equal(page({kind:'assets',query:'archive.[x]'}).items[0].id,'A2','literal query reaches records outside first 1500');
assert.equal(page({kind:'assets',query:'archive.*'}).items.length,0,'regex metacharacters stay literal');
assert.ok(page({kind:'assets',filter:'closed'}).items.every(x=>x.status==='廃止'));
assert.ok(page({kind:'assets',filter:'open'}).items.every(x=>x.status!=='廃止'));
const purchase=makeSheet('purchase',[{id:'P1',name:'paper',status:'申請中',requestKey:'PRIVATE_KEY_ONLY',approvedBy:'PUBLIC_APPROVER'}]);
assert.equal(context.somuRows_('purchase',1500,purchase).items.length,1,'small snapshots remain complete');
finderColumns=[];assert.equal(page({kind:'purchases',query:'PRIVATE_KEY_ONLY'}).items.length,0);
assert.ok(finderColumns.every(x=>!(x.c<=16&&x.c+x.w>16)),'search excludes middle requestKey column');
let result=page({kind:'purchases',query:'PUBLIC_APPROVER'});assert.equal(result.items.length,1);assert.equal(result.items[0].requestKey,undefined);
makeSheet('loan',[{id:'L1',status:'貸出中',dueDate:'2026/10/13'},{id:'L2',status:'返却済',dueDate:'2026/10/01'},{id:'L3',status:'貸出中',dueDate:'2026/10/15'}]);
assert.deepEqual(Array.from(page({kind:'loans',filter:'overdue'}).items,x=>x.id),['L1']);
assert.throws(()=>page({kind:'assets',filter:'overdue'}));assert.throws(()=>page({kind:'assets',before:1.5}));assert.throws(()=>page({kind:'assets',query:'x'.repeat(121)}));
allowed=false;assert.throws(()=>page({kind:'assets'}),/denied/);allowed=true;
makeSheet('document',Array.from({length:18000},(_,i)=>({id:'D'+i,name:i%300===0?'sparse-target':'other',status:'有効'})));
bodyReads=[];result=page({kind:'documents',query:'sparse-target'});assert.ok(result.hasMore);assert.equal(result.items.length,8);assert.equal(bodyReads.length,8);assert.ok(bodyReads.every(x=>x.n<=120));
let collected=result.items.map(x=>x.id);cursor=result.nextBefore;
while(cursor){result=page({kind:'documents',query:'sparse-target',before:cursor});collected.push(...result.items.map(x=>x.id));cursor=result.nextBefore;}
assert.equal(collected.length,60);assert.equal(new Set(collected).size,60);
// Client: debounce, zero-RPC revisits, older-row edits and stale response rejection.
const calls=[],timers=new Map(),nodes={},modal={innerHTML:''};let serial=0;
const runner={withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(fn){this.failure=fn;return this;},getSomuRecordsPage(token,p){calls.push({token,p,success:this.success,failure:this.failure});},getSomuWorkspace(){}};
const client=vm.createContext({state:{page:'office',sessionToken:'token',data:{today:'2026-10-14',user:{employeeId:'E1'},permissions:{officeWorkspace:true}}},window:{},document:{getElementById:id=>nodes[id]||(nodes[id]={innerHTML:'',textContent:''})},google:{script:{run:runner}},setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),renderPageIfActive:()=>{},escapeHtml:s=>String(s??''),cleanApiErrorMessage:()=> 'retry',showToast:()=>{},ensureModal:()=>modal});
vm.runInContext(fs.readFileSync('src/AppSomu.html','utf8').replace(/<\/?script>/g,''),client);
const run=s=>vm.runInContext(s,client),flush=()=>{const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn());};
run("somuUi.loaded=true;somuUi.data={assets:[],loans:[],purchases:[],documents:[],truncatedKinds:{assets:true}};somuTab('assets');somuSearch('old');somuSearch('older')");
assert.equal(timers.size,1);flush();assert.equal(calls.length,1);assert.equal(calls[0].p.query,'older');
const reply=(items,more=false,before=0)=>({ok:true,kind:'assets',items,hasMore:more,nextBefore:before});
calls[0].success(reply([{id:'OLD',code:'OLD-PC',name:'Older PC',status:'利用中',revision:'9',updatedAt:'fresh',quantity:2}],true,100));
run("somuOpenForm('asset','OLD')");assert.equal(client.window.somuActiveForm.old.revision,'9');assert.equal(client.window.somuActiveForm.old.updatedAt,'fresh');assert.match(modal.innerHTML,/Older PC/);
run("somuOpenForm('loan','','OLD')");assert.match(modal.innerHTML,/value="OLD" selected/,'older asset can be borrowed');
run('somuMore()');flush();assert.equal(calls.at(-1).p.before,100);calls.at(-1).success(reply([{id:'OLDER'}]));
const count=calls.length;run('somuPrevious_()');flush();assert.equal(calls.length,count,'previous page is in-memory, zero RPC');assert.equal(run("somuRows('assets')[0].id"),'OLD');
run("somuSearch('slow')");flush();const old=calls.at(-1);run("somuSearch('new')");flush();calls.at(-1).success(reply([{id:'NEW'}]));old.success(reply([{id:'STALE'}]));assert.equal(run("somuRows('assets')[0].id"),'NEW');
run("somuSearch('force')");flush();const beforeForce=calls.at(-1);run('somuPageInvalidate_()');beforeForce.success(reply([{id:'DISCARDED'}]));assert.equal(run('somuPageCache_.size'),0);
run('somuPageEnsure_(0)');flush();calls.at(-1).failure(new Error('network'));assert.match(run('somuPagerMarkup_()'),/再試行/);const failedCount=calls.length;run("somuRecords_('assets')");flush();assert.equal(calls.length,failedCount,'failed render does not loop');
run('somuPageRetry_()');flush();calls.at(-1).success(reply([{id:'RETRY'}]));assert.equal(run("somuRows('assets')[0].id"),'RETRY');
run("somuSearch('logout')");flush();const loggedOut=calls.at(-1);run("somuReset();state.sessionToken='other'");loggedOut.success(reply([{id:'LEAK'}]));assert.equal(run('somuPageCache_.size'),0);
run("somuUi.data={assets:[{id:'LOCAL',name:'Local'}]};somuUi.tab='assets';somuSearch('Local')");flush();assert.equal(calls.at(-1),loggedOut,'small ledger has no search RPC');
console.log('PASS SOMU pagination: full ledgers, literal/private search, bounded reads, cursors, ACL, debounce/cache, old-record edit/loan, stale and failed replies');
