import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const calls=[],renders=[],scheduled=[],nodes={};
const node=id=>nodes[id]||(nodes[id]={value:'',disabled:false,textContent:'',hidden:false});
const runner=(meta={})=>new Proxy({}, {get(_,method){
  if(method==='withSuccessHandler')return success=>runner({...meta,success});
  if(method==='withFailureHandler')return failure=>runner({...meta,failure});
  return (...args)=>calls.push({method,args,...meta});
}});
const context=vm.createContext({
  state:{page:'quotes',sessionToken:'SYNTHETIC',data:{today:'2026-10-10',user:{employeeId:'QA',name:'架空社員'},permissions:{officeWorkspace:true,financeWorkspace:true}}},
  window:{},document:{getElementById:node},google:{script:{run:runner()}},
  renderPageIfActive:page=>renders.push(page),
  scheduleBackgroundTask:task=>scheduled.push(task),
  navigate:page=>vm.runInContext('state.page='+JSON.stringify(page),context),
  cleanApiErrorMessage:error=>error.message,escapeHtml:value=>String(value??''),
  showToast(){},closeModal(){},svg(){return ''},console,Date,Map,Set,Math,Number,String,Object,Array,JSON
});
for(const name of ['AppQuotes','AppFinance','AppFinanceAdvisor','AppSomu','AppSomuGrowth']){
  const source=fs.readFileSync('src/'+name+'.html','utf8').replace(/^<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
  vm.runInContext(source,context,{filename:name});
}
const run=code=>vm.runInContext(code,context);

run('loadQuoteWorkspace()');
calls.at(-1).success({vendors:[],quotes:[],relatedDocs:[],sequencesReady:[]});
run('quoteUi.at=Date.now()-90000;loadQuoteWorkspace()');
assert.equal(calls.length,1,'returning after 90 seconds does not refetch quotes');
run("quoteUi.editor=quoteEmptyEditor_();quoteUi.editor.subject='日本語入力中';quoteUi.mode='edit';quoteUi.dirty=true;quoteUi.at=0;loadQuoteWorkspace()");
const before=renders.length;
calls.at(-1).success({vendors:[],quotes:[],relatedDocs:[],sequencesReady:[]});
assert.equal(renders.slice(before).filter(page=>page==='quotes').length,0,'delayed read never replaces an active quote editor');
assert.equal(run('quoteUi.editor.subject'),'日本語入力中');
node('quoteIssueButton').disabled=false;
run("quoteUi.editor.id='Q';quoteUi.editor.vendorCode='AA-0001';quoteUi.data.sequencesReady=['AA-0001'];quoteUi.dirty=false;quoteUpdateField('subject','変更')");
assert.equal(node('quoteIssueButton').disabled,true,'any changed header requires saving before issuance');
const rows=run('quoteParsePaste_("保守費\\t2\\t月\\t30,000\\n値引き\\t1\\t式\\t-1000")');
assert.equal(rows[0].price,30000);assert.equal(rows[1].price,-1000);
assert.throws(()=>run('quoteParsePaste_("品名\\t0\\t式\\t100")'));
assert.throws(()=>run('quoteParsePaste_("品名\\t1\\t式")'));

run("state.page='financeEntry';financeActiveForm={kind:'expense',key:'DRAFT',source:{},changed:false}");
for(const [key,value] of Object.entries({vendor:'架空文具店',item:'用紙',amount:'1200',purpose:'事務用品'}))node('fin-'+key).value=value;
run('financeMarkEntryDirty()');
assert.equal(run('financeActiveForm.source.vendor'),'架空文具店');
assert.equal(run('financeActiveForm.source.amount'),'1200');
run("state.page='requests';openFinanceForm('travel')");
assert.equal(run('state.page'),'financeEntry','unfinished finance input is resumed');
assert.equal(run('financeActiveForm.kind'),'expense','new action does not overwrite a different unfinished form');
run("financeActiveForm={kind:'travel',source:{},changed:false};state.page='financeEntry'");
node('financeOneWayKm').value='120';node('financeLodgingActual').value='8000';
run('financeMarkEntryDirty()');
assert.equal(run('financeActiveForm.source.financeOneWayKm'),'120','travel calculation inputs survive a redraw');
run('financeExplainTravel()');
const estimate=calls.at(-1);node('financeOneWayKm').value='200';run('financeMarkEntryDirty()');
estimate.success({total:12000});
assert.equal(run('financeUi.travelEstimate'),null,'old calculation cannot be applied after changing the distance');
run("financeUi.insights={ok:true};financeUi.insightLoadedYear=financeUi.insightYear;financeUi.insightAt=Date.now()-90000");
const beforeInsights=calls.length;run('financeLoadInsights()');
assert.equal(calls.length,beforeInsights,'returning to expense analysis reuses the result');

run("state.page='office';somuLoad(false)");
const baseOfficeCall=calls.at(-1);
assert.equal(baseOfficeCall.method,'getSomuWorkspace');
assert.equal(baseOfficeCall.args[2],false,'office loads four base ledgers before optional growth');
const beforeGrowth=calls.length;run("somuTab('contracts')");
assert.equal(calls.length,beforeGrowth,'growth tab waits while base workspace is loading');
baseOfficeCall.success({setupRequired:false,assets:[],loans:[],purchases:[],documents:[]});
assert.equal(calls.length,beforeGrowth,'base paint must not wait for optional growth RPC');
assert.equal(scheduled.length,1,'optional growth fetch is deferred until base has rendered');
scheduled.shift()();
assert.equal(calls.at(-1).method,'getSomuGrowthData','growth is fetched in an independent RPC');
calls.at(-1).success({ready:true,contracts:[],facilities:[],tickets:[]});
const afterGrowth=calls.length;
run("somuUi.query='保守';somuUi.selected='SELECTED';somuTab('assets');somuTab('contracts')");
assert.equal(run('somuUi.query'),'保守');assert.equal(run('somuUi.selected'),'SELECTED');
assert.equal(calls.length,afterGrowth,'loaded growth and base tab switches have zero RPC');
run('somuReset()');assert.equal(run('somuTabState_.size'),0,'logout clears tab information');
console.log('PASS business workflows: return cache, drafts, finance resume, progressive office read and zero-RPC tabs');

// A force refresh after migration must survive older in-flight maintenance reads.
vm.runInContext(fs.readFileSync('src/AppAdmin.html','utf8').replace(/^<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),context,{filename:'AppAdmin'});
const pendingMaintenance=new Set();let maintenanceCache=true;
Object.assign(context,{
 cacheFresh:()=>maintenanceCache,cacheHas:()=>maintenanceCache,
 beginPageLoad:(name,key)=>{const ticket=name+':'+key;if(pendingMaintenance.has(ticket))return null;pendingMaintenance.add(ticket);return ticket;},
 endPageLoad:ticket=>pendingMaintenance.delete(ticket),markPageCache:()=>{maintenanceCache=true;},handleApiError(){},
 openConfirmDialog:(_title,_body,_label,confirm)=>confirm()
});
run("state.page='admin';state.data.permissions.adminConsole=true;state.maintenance={status:{schemaStatus:{version:12}},audit:[],loading:false}");
let maintenanceStart=calls.length;run('loadMaintenance()');
assert.equal(calls.length,maintenanceStart,'ordinary return still reuses maintenance cache');
run('loadMaintenance({force:true})');
assert.equal(calls.length,maintenanceStart+2,'explicit refresh always reads latest status and audit');
const oldMaintenance=calls.slice(-2);
run('loadMaintenance({force:true})');
assert.equal(calls.length,maintenanceStart+2,'forced update waits for the active read rather than duplicating it');
oldMaintenance[0].success({schemaStatus:{version:12}});
oldMaintenance[1].success([]);
assert.equal(calls.length,maintenanceStart+4,'queued force starts a fresh pair after the old read');
const latestMaintenance=calls.slice(-2);
latestMaintenance[0].success({schemaStatus:{version:14}});latestMaintenance[1].success([{operation:'DB更新'}]);
assert.equal(run('state.maintenance.status.schemaStatus.version'),14,'migration result replaces the pre-migration version');
assert.equal(run('state.maintenance.audit[0].operation'),'DB更新');
run('loadMaintenance({force:true})');const obsoleteMaintenance=calls.slice(-2);
run("state.sessionToken='NEW-SESSION';state.maintenance={status:{schemaStatus:{version:99}},audit:[],loading:false}");pendingMaintenance.clear();
obsoleteMaintenance[0].success({schemaStatus:{version:12}});obsoleteMaintenance[1].success([]);
assert.equal(run('state.maintenance.status.schemaStatus.version'),99,'previous login callbacks cannot overwrite new session status');
run('migrateDatabaseFromAdmin()');const migration=calls.at(-1);maintenanceStart=calls.length;
migration.success({changed:true});assert.equal(calls.length,maintenanceStart+2,'migration confirmation forces fresh status even if cache is still fresh');
console.log('PASS maintenance refresh: cache reuse, explicit force, queued refresh, DB migration and session isolation');
