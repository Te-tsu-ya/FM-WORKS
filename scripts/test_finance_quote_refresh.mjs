import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const calls=[],renders=[];
const rpc=(handlers={})=>new Proxy({}, {get(_o,key){
 if(key==='withSuccessHandler')return success=>rpc({...handlers,success});
 if(key==='withFailureHandler')return failure=>rpc({...handlers,failure});
 return (...args)=>calls.push({method:key,args,...handlers});
}});
const client=vm.createContext({console:{debug(){}},Date,Math,Map,Set,Array,Object,String,Number,JSON,
 state:{sessionToken:'SAME',page:'finance',data:{user:{employeeId:'ME'},permissions:{financeWorkspace:true}}},
 google:{script:{run:rpc()}},document:{getElementById:()=>null},window:{},
 renderPage(){},renderPageIfActive:p=>renders.push(p),showToast(){},
 cleanApiErrorMessage:e=>e.message,escapeHtml:v=>String(v??''),svg:()=>'',pageHead:()=>''});
for(const name of ['AppFinance','AppFinanceWorkspace','AppFinanceAdvisor','AppQuotes','AppDocuments'])
 vm.runInContext(fs.readFileSync('src/'+name+'.html','utf8').replace(/<\/?script>/g,''),client);
const js=code=>vm.runInContext(code,client),quote={vendors:[],quotes:[],relatedDocs:[]},finance={expenses:[],travels:[],receipts:[]};
// A new bootstrap can reset UI while keeping the authenticated session token.
for(const [load,reset,field,loading,data] of [
 ['loadQuoteWorkspace','resetQuoteUi','quoteUi.data','quoteUi.loading',quote],
 ['loadFinanceOverview','resetFinanceUi','financeUi.overview','financeUi.loading',finance],
 ['loadMyFinanceItems','resetFinanceUi','financeUi.mine','financeUi.ownLoading',finance],
 ['financeLoadInsights','resetFinanceUi','financeUi.insights','financeUi.insightLoading',{ok:true,records:[]}]
]){
 client[reset]();client[load]();const old=calls.at(-1);client[reset]();client[load]();const fresh=calls.at(-1);
 old.success({...data,marker:'OLD'});old.failure(Error('OLD FAILURE'));
 assert.equal(js(field),null,load+' rejects old same-session success');
 assert.equal(js(loading),true,load+' rejects old same-session failure');
 fresh.success({...data,marker:'FRESH'});assert.equal(js(field+'.marker'),'FRESH');
 const count=calls.length;client[load]();client[load]();assert.equal(calls.length,count,load+' reuses fresh cache');
}
// A forced refresh is coalesced before processing obsolete or malformed payloads.
for(const [load,field,flag,queued,data] of [
 ['loadFinanceOverview','financeUi.overview','financeUi.loading','financeUi.refreshNeeded',finance],
 ['loadMyFinanceItems','financeUi.mine','financeUi.ownLoading','financeUi.ownRefreshNeeded',finance]
]){
 js(field+'='+JSON.stringify({...data,marker:'FRESH'}));
 client[load]({force:true});const old=calls.at(-1),count=calls.length;
 client[load]({force:true});client[load]({force:true});assert.equal(calls.length,count);
 old.success(null);assert.equal(calls.length,count+1,load+' retries pending force even after malformed payload');
 assert.equal(js(field+'.marker'),'FRESH','confirmed data preserved during refresh');
 assert.equal(js(flag),true);assert.equal(js(queued),false);calls.at(-1).success({...data,marker:'UPDATED'});
 client[load]({force:true});const failed=calls.at(-1);client[load]({force:true});failed.failure(Error('temporary'));
 assert.equal(calls.at(-1).method,failed.method);assert.notEqual(calls.at(-1),failed);calls.at(-1).success(data);
}
client.financeLoadInsights(true);const insight=calls.at(-1),count=calls.length;
client.financeLoadInsights(true);client.financeLoadInsights(true);assert.equal(calls.length,count);
insight.success({ok:true,marker:'STALE'});assert.equal(calls.length,count+1,'analysis retains pending force');
assert.equal(js('financeUi.insights.marker'),'FRESH');calls.at(-1).success({ok:true,marker:'LATEST'});
const warm=calls.length;client.financeInsightsYear(js('financeUi.insightYear'));assert.equal(calls.length,warm,'same year selection keeps cached analysis');
client.financeLoadInsights(true);const a=calls.at(-1);client.financeInsightsYear(js('financeUi.insightYear')+1);const b=calls.at(-1);
a.failure(Error('old year'));a.success({ok:true,marker:'OLD YEAR'});assert.equal(js('financeUi.insightLoading'),true);b.success({ok:true,marker:'NEW YEAR'});

js("quoteUi.data={relatedDocs:[{id:'D1',updatedAt:'r1'}]}");client.documentOpenRecord('D1');const oldDoc=calls.at(-1);
client.resetDocumentUi();client.documentOpenRecord('D1');const freshDoc=calls.at(-1);
oldDoc.success({header:{id:'D1'},marker:'OLD'});oldDoc.failure(Error('OLD'));
assert.equal(js('docUi.selected'),null);assert.equal(js('docUi.loading'),true);freshDoc.success({header:{id:'D1'},marker:'NEW'});
const docCount=calls.length;client.documentOpenRecord('D1');assert.equal(calls.length,docCount,'same revision reuses document cache');
js("quoteUi.data.relatedDocs[0].updatedAt='r2'");client.documentOpenRecord('D1');const staleDoc=calls.at(-1);
js("quoteUi.data.relatedDocs[0].updatedAt='r3'");staleDoc.success({header:{id:'D1'},marker:'STALE REVISION'});
assert.equal(js('docUi.selected'),null,'detail response cannot override a newer list revision');
assert.equal(calls.length,docCount+2,'changed revision queues a fresh detail request');calls.at(-1).success({header:{id:'D1'},marker:'REVISION 3'});
assert.equal(js('docUi.selected.marker'),'REVISION 3');
js("quoteUi.data.relatedDocs[0].updatedAt='r4'");client.documentReconcileList_();
assert.equal(js('docUi.selected'),null,'refreshed list invalidates an already displayed older preview');
calls.at(-1).success({header:{id:'D1'},marker:'REVISION 4'});
const reconciled=calls.length;client.documentReconcileList_();assert.equal(calls.length,reconciled);
client.resetQuoteUi();client.quoteOpen('Q1');const oldOpen=calls.at(-1);
client.resetQuoteUi();client.quoteOpen('Q2');const freshOpen=calls.at(-1);
oldOpen.success({header:{id:'Q1',status:'下書き'},lines:[]});oldOpen.failure(Error('OLD'));
assert.equal(js('quoteUi.editor'),null);assert.equal(js('quoteUi.busy'),true);
freshOpen.success({header:{id:'Q2',status:'下書き'},lines:[]});
js("quoteUi.dirty=true;quoteUi.editor.subject='入力途中';quoteUi.mode='list'");
const draftCalls=calls.length;client.quoteOpen('Q3');
assert.equal(calls.length,draftCalls,'opening another quote cannot overwrite an unsaved draft');
assert.equal(js('quoteUi.editor.subject'),'入力途中');assert.equal(js('quoteUi.mode'),'edit');
client.resetDocumentUi();client.documentRetry('D1');const oldRetry=calls.at(-1);
client.resetDocumentUi();oldRetry.success({number:'OLD'});oldRetry.failure(Error('OLD'));
assert.equal(js('docUi.error'),'');assert.equal(calls.at(-1),oldRetry,'obsolete write callback cannot enqueue reads');
js('financeUi.refreshNeeded=true;financeUi.at=0');client.loadFinanceOverview({force:true});
const pendingFlag=calls.at(-1),pendingCount=calls.length;pendingFlag.success(finance);
assert.equal(calls.length,pendingCount,'idle invalidation flag is consumed by the first read');
client.resetFinanceUi();
js("financeBulkUi.rows=[{item:'前の入力'}];financeBulkUi.keys=['OLD-KEY'];financeBulkUi.locked=true");
client.financeBulkNext_();const oldBulk=calls.at(-1);
client.resetFinanceUi();js("financeBulkUi.rows=[{item:'新しい未保存入力'}];financeBulkUi.keys=['NEW-KEY']");
const bulkCount=calls.length;
oldBulk.success({ok:true,results:[{id:'OLD-SAVED'}]});oldBulk.failure(Error('OLD'));
assert.equal(calls.length,bulkCount,'old bulk success cannot start a write of the new draft');
assert.equal(js('financeBulkUi.index'),0);assert.equal(js('financeBulkUi.busy'),false);
assert.equal(js('financeBulkUi.rows[0].item'),'新しい未保存入力');
console.log('PASS finance/quote refresh: same-session reset, obsolete success/failure, warm reuse, queued force, malformed/network responses, year isolation and document revision');
