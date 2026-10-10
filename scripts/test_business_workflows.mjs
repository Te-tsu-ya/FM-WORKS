import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const calls=[],renders=[],nodes={};
const node=id=>nodes[id]||(nodes[id]={value:'',disabled:false,textContent:'',hidden:false});
const runner=(meta={})=>new Proxy({}, {get(_,method){
  if(method==='withSuccessHandler')return success=>runner({...meta,success});
  if(method==='withFailureHandler')return failure=>runner({...meta,failure});
  return (...args)=>calls.push({method,args,...meta});
}});
const context=vm.createContext({
  state:{page:'quotes',sessionToken:'SYNTHETIC',data:{today:'2026-10-10',user:{employeeId:'QA',name:'架空社員'},permissions:{officeWorkspace:true,financeWorkspace:true}}},
  window:{},document:{getElementById:node},google:{script:{run:runner()}},
  renderPageIfActive:page=>renders.push(page),navigate:page=>vm.runInContext('state.page='+JSON.stringify(page),context),
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
assert.equal(calls.at(-1).method,'getSomuWorkspace');
assert.equal(calls.at(-1).args[2],true,'office asks for all seven ledgers in one round trip');
const beforeGrowth=calls.length;run("somuTab('contracts')");
assert.equal(calls.length,beforeGrowth,'switching while the combined load is pending does not start another RPC');
calls.at(-1).success({setupRequired:false,assets:[],loans:[],purchases:[],documents:[],growth:{ready:true,contracts:[],facilities:[],tickets:[]}});
run("somuUi.query='保守';somuUi.selected='SELECTED';somuTab('assets');somuTab('contracts')");
assert.equal(run('somuUi.query'),'保守');assert.equal(run('somuUi.selected'),'SELECTED');
assert.equal(calls.length,beforeGrowth,'all cached office tab switches have zero RPC');
run('somuReset()');assert.equal(run('somuTabState_.size'),0,'logout clears tab information');
console.log('PASS business workflows: five-minute return cache, draft preservation, issuance state, spreadsheet paste, finance resume, combined office read and zero-RPC tabs');
