import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const calls=[];let confirm=null,downloads=0,renders=0,dialogs=[];
const runner=(meta={})=>new Proxy({}, {get(_target,key){
 if(key==='withSuccessHandler')return cb=>runner({...meta,success:cb});
 if(key==='withFailureHandler')return cb=>runner({...meta,failure:cb});
 return (...args)=>calls.push({method:String(key),args,meta});
}});
const escapeHtml=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={sessionToken:'ADMIN',page:'finance',data:{today:'2026-10-11',permissions:{cashFlowWorkspace:true,adminConsole:true}}};
const months=Array.from({length:12},(_,i)=>i?'2026-'+String(i).padStart(2,'0'):'2025-12');
const account={id:'AC-1',bank:'架空銀行',name:'運転資金口座',active:true};
const plan={id:'PL-1',title:'保守料',active:true,amount:100,direction:'IN',startMonth:'2025-12',endMonth:'2026-11',frequency:'MONTHLY'};
const bank={accounts:[account],plans:[plan],transactions:[],bankSummaries:[],monthly:months.map(month=>({month,scheduledIn:100,scheduledOut:0,actualIn:0,actualOut:0,importedCount:0})),closing:{through:'',revision:0}};
const finance={record:{openingBalance:1000,months:months.map(month=>({month,planIn:null,planOut:null,actualIn:null,actualOut:null,note:''}))}};
const w={ok:true,setupRequired:false,year:2026,months,accounts:[account],rules:[],scenarios:[],
 transactionsCount:1,unreviewedCount:1,checks:[{accountId:'AC-1',accountName:'運転資金口座',month:'2026-10',
 actualIn:120,actualOut:20,latestBalance:1100,revision:0,verified:false,importedCount:1,note:''}]};
const tx={planLink:{status:'NONE',revision:0},planMatch:{status:'POSSIBLE',total:1,candidates:[{planId:'PL-1',title:'<img src=x onerror=alert(2)>',plannedDate:'2026-10-10',amount:120,gapDays:0,descriptionMatch:false}]},id:'TX-1',accountId:'AC-1',date:'2026-10-10',description:'<img src=x onerror=alert(1)>',
 incoming:120,outgoing:0,category:'未分類',tags:'',note:'',revision:0,reviewed:false,suggested:false,transfer:false};
const p={ok:true,setupRequired:false,scenarioId:'',scenarioName:'通常計画',yearEnd:2200,
 plannedIn:1200,plannedOut:0,firstShort:'',warnings:['未確定の分類1件'],rows:months.map(month=>({month,plannedIn:100,plannedOut:0,actualIn:null,actualOut:null,forecastEnd:1100,difference:0,source:'予定'}))};
const document={
 getElementById(id){return {value:id.includes('balance')?'1100':'銀行のWeb画面と照合しました'};},
 body:{appendChild(){}},createElement:()=>({click(){downloads++;},remove(){},set href(v){this._href=v},set download(v){this._download=v}})
};
const ctx=vm.createContext({state,financeUi:{demo:false},cashFlowUi:{open:true,year:2026,data:finance},google:{script:{run:runner()}},console,
 cashFlowAllowed_:()=>state.data.permissions.cashFlowWorkspace,renderPageIfActive:()=>renders++,
 cleanApiErrorMessage:e=>e.message,escapeHtml,document,Blob,Uint8Array,URL:{createObjectURL:()=>'blob:fake',revokeObjectURL(){}},
 atob:s=>Buffer.from(s,'base64').toString('binary'),setTimeout:()=>0,
 Date,Number,String,Array,Math,Set,Map,JSON,Error,RegExp,Promise,
 pageHead:(a,b)=>a+b,cashFlowYen_:v=>String(v),cashFlowChartHtml_:()=>'<svg></svg>',
 cashFlowDiscard_:fn=>fn(),cashFlowLoad_:()=>{},cashFlowClose_:()=>{},cashFlowChangeYear_:()=>{},
 openConfirmDialog:(title,message,_label,cb)=>{dialogs.push({title,message});confirm=cb;},showToast(){}});
for(const file of ['AppCashFlowBank.html','AppCashFlowAnalysis.html'])
 vm.runInContext(fs.readFileSync('src/'+file,'utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),ctx,{filename:file});
const read=code=>vm.runInContext(code,ctx);
read('cfbUi.loaded='+JSON.stringify(bank)+';cfbUi.tab="analysis";');
ctx.cfaLoad_(true);assert.equal(calls.at(-1).method,'getCashFlowAnalysisWorkspace');
calls.at(-1).meta.success(w);assert.equal(calls.at(-1).method,'getCashFlowAnalysisMonth');
calls.at(-1).meta.success({ok:true,month:'2026-10',page:0,total:1,linkReady:true,rows:[tx]});
const html=ctx.cfaPage_();
assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'),'malicious bank description must be escaped');
assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
assert.ok(html.includes('銀行口座別の月末残高を照合する'));
assert.ok(html.includes('候補1件・未確定'),'tentative plan matching must be visible');
assert.ok(html.includes('架空銀行 / 運転資金口座'),'bank identity must be visible with cashflow suggestions');
assert.ok(html.includes('口座未指定'),'unscoped plan must be identified rather than presumed account-matched');

assert.ok(html.includes('この予定を照合承認'),'candidate must require a human click');
ctx.cfaPlanAction_('APPROVE','TX-1','PL-1','2026-10-10');
assert.equal(typeof confirm,'function','plan approval requires explicit confirmation');
confirm();
let planCall=calls.at(-1);
assert.equal(planCall.method,'saveCashFlowPlanLink');
assert.equal(planCall.args[1].planId,'PL-1');
const planKey=planCall.args[1].requestKey;
planCall.meta.failure(Error('temporary network loss'));
ctx.cfaPlanAction_('APPROVE','TX-1','PL-1','2026-10-10');
confirm();
planCall=calls.at(-1);
assert.equal(planCall.args[1].requestKey,planKey,'lost acknowledgement must reuse idempotency key');
planCall.meta.failure(Error('offline'));
read('cfaUi.planPending=null;');
const activeLink={status:'APPROVED',revision:1,title:'架空保守予定',plannedDate:'2026-10-10',
 editorId:'A',updatedAt:'2026-10-11'};
assert.ok(ctx.cfaPlanMatchHtml_(tx.planMatch,'TX-1',activeLink,true).includes('照合承認済み・会計未確定'));
const conflictHtml=ctx.cfaPlanMatchHtml_(tx.planMatch,'TX-1',{status:'CONFLICT',revision:1},true);
assert.match(conflictHtml,/照合履歴が重複/);
assert.doesNotMatch(conflictHtml,/onclick=/,'corrupt history cannot expose approve/unlink actions');
assert.ok(ctx.cfaPlanMatchHtml_(tx.planMatch,'TX-1',{...activeLink,status:'STALE'},true).includes('要再確認'));
assert.ok(!ctx.cfaPlanMatchHtml_(tx.planMatch,'TX-1',{status:'NONE'},false).includes('この予定を照合承認'));

assert.ok(html.includes('&lt;img src=x onerror=alert(2)&gt;'),'untrusted scheduled title must be escaped');
assert.ok(!html.includes('<img src=x onerror=alert(2)>'));
const ambiguousHtml=ctx.cfaPlanMatchHtml_({status:'AMBIGUOUS',total:4,candidates:[{planId:'A',title:'安全な候補',plannedDate:'2026-10-10',amount:120,gapDays:0,descriptionMatch:true}]});
assert.ok(ambiguousHtml.includes('候補4件・要確認'));
assert.ok(ambiguousHtml.includes('他にも候補があります'));
assert.ok(ctx.cfaPlanMatchHtml_({status:'TRANSFER',total:0,candidates:[]}).includes('振替・対象外'));

 assert.ok(html.includes('銀行別の明細合計は自社口座間振替を含みます'),'bank vs company totals need an explicit explanation');
ctx.cfaLoadMonth_(true);const staleMonth=calls.at(-1);
ctx.cfaChangeMonth_('2026-09');assert.equal(calls.at(-1).args[1].month,'2026-09');
staleMonth.meta.success({ok:true,month:'2026-10',total:1,rows:[tx]});
calls.at(-1).meta.success({ok:true,month:'2026-09',total:0,rows:[]});
assert.equal(read('cfaUi.month'),'2026-09');
ctx.cfaChangeMonth_('2026-10');assert.equal(calls.at(-1).args[1].month,'2026-10');
calls.at(-1).meta.success({ok:true,month:'2026-10',total:1,rows:[tx]});
assert.equal(read('cfaUi.rows[0].id'),'TX-1');

assert.ok(ctx.cfaAnalysisPage_().includes('説明待ちのみ表示'));
ctx.cfaToggleReviewOnly_(true);
assert.equal(calls.at(-1).method,'getCashFlowAnalysisMonth');
assert.equal(calls.at(-1).args[1].onlyUnreviewed,true);
assert.equal(calls.at(-1).args[1].page,0);
calls.at(-1).meta.success({ok:true,month:'2026-10',total:1,rows:[tx]});
ctx.cfaToggleReviewOnly_(false);
assert.equal(calls.at(-1).args[1].onlyUnreviewed,false);
calls.at(-1).meta.success({ok:true,month:'2026-10',total:1,rows:[tx]});

ctx.cfaOpenEditor_('TX-1');ctx.cfaEditorField_('category','売上入金');
ctx.cfaEditorField_('tags','保守,完了');ctx.cfaEditorField_('note','請求確認済み');
ctx.cfaSaveAnnotation_();assert.equal(calls.at(-1).method,'saveCashFlowAnnotation');
assert.equal(calls.at(-1).args[1].transactionId,'TX-1');
assert.equal(calls.at(-1).args[1].note,'請求確認済み');
calls.at(-1).meta.failure(new Error('temporary error'));
assert.ok(read('cfaUi.editor'), 'error preserves unsaved annotation');
read('cfaUi.editor=null;');
ctx.cfaReconcile_(0);assert.equal(typeof confirm,'function','bank reconciliation requires explicit confirmation');
confirm();assert.equal(calls.at(-1).method,'saveCashFlowBankReconciliation');
assert.equal(calls.at(-1).args[1].closingBalance,'1100');
calls.at(-1).meta.failure(new Error('test failure'));
read('cfaUi.busy=false;');
ctx.cfaRuleNew_();ctx.cfaRuleChange_('keyword','ABC');ctx.cfaRuleChange_('category','売上');
ctx.cfaSaveRule_();assert.equal(calls.at(-1).method,'saveCashFlowRule');
assert.equal(calls.at(-1).args[1].keyword,'ABC');
calls.at(-1).meta.failure(new Error('test failure'));
read('cfaUi.busy=false;');
ctx.cfaScenarioNew_();ctx.cfaScenarioName_('入金遅延');
ctx.cfaScenarioAdd_('SHIFT');ctx.cfaScenarioField_(0,'month','2026-10');ctx.cfaScenarioField_(0,'planId','PL-1');
ctx.cfaScenarioSave_();assert.equal(calls.at(-1).method,'saveCashFlowScenario');
assert.equal(calls.at(-1).args[1].changes[0].monthsDelta,1);
calls.at(-1).meta.failure(new Error('test failure'));
read('cfaUi.busy=false;cfaUi.scenarioDraft=null;cfaUi.projection='+JSON.stringify(p));
ctx.cfaLoadProjection_(true);const staleProjection=calls.at(-1);
ctx.cfaScenarioSelect_('SC1');assert.equal(calls.at(-1).args[1].scenarioId,'SC1');
staleProjection.meta.success(p);
calls.at(-1).meta.success({...p,scenarioId:'SC1'});
assert.equal(read('cfaUi.projection.scenarioId'),'SC1');
ctx.cfaScenarioSelect_('');calls.at(-1).meta.success(p);
assert.ok(ctx.cfaReportsPage_().includes('年間資金繰りをExcel出力'));

assert.ok(ctx.cfaReportsPage_().includes('取引説明をCSV出力'));
ctx.cfaDownloadTaxCsv_();
assert.equal(calls.at(-1).method,'exportCashFlowTaxAdvisorCsv');
assert.equal(calls.at(-1).args[1].includeMemo,false);
calls.at(-1).meta.success({ok:true,base64:Buffer.from('csv test').toString('base64'),
 filename:'tax.csv',mimeType:'text/csv;charset=utf-8',count:2,attentionCount:1});
assert.equal(downloads,1);
read('cfaUi.taxIncludeMemo=true;');ctx.cfaDownloadTaxCsv_();
assert.equal(calls.at(-1).args[1].includeMemo,true);
calls.at(-1).meta.failure(Error('offline'));
read('cfaUi.taxIncludeMemo=false;cfaUi.exporting=false;');

ctx.cfaDownloadReport_('XLSX');assert.equal(calls.at(-1).method,'exportCashFlowReport');
assert.equal(calls.at(-1).args[1].format,'XLSX');
calls.at(-1).meta.success({ok:true,base64:Buffer.from('PK mocked spreadsheet bytes').toString('base64'),
 filename:'mock.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',status:'要確認',warnings:[]});
assert.equal(downloads,2);

 // Loss-of-acknowledgment must preserve the draft and its request identity.
 read('cfaUi.editor={id:"TX-1",category:"売上",tags:"請求",note:"確認済",revision:0,requestKey:""};');
 ctx.cfaSaveAnnotation_();let retryCall=calls.at(-1),retryKey=retryCall.args[1].requestKey;
 retryCall.meta.failure(Error('lost response'));
 ctx.cfaSaveAnnotation_();retryCall=calls.at(-1);
 assert.equal(retryCall.args[1].requestKey,retryKey,'annotation retries reuse the key');
 retryCall.meta.failure(Error('offline'));
 ctx.cfaEditorField_('note','別の確認内容');ctx.cfaSaveAnnotation_();
 assert.notEqual(calls.at(-1).args[1].requestKey,retryKey,'changed annotation requires a new key');
 calls.at(-1).meta.failure(Error('offline'));
 ctx.cfaRuleNew_();ctx.cfaRuleChange_('keyword','会費');ctx.cfaRuleChange_('category','売上');
 ctx.cfaSaveRule_();retryCall=calls.at(-1);retryKey=retryCall.args[1].requestKey;
 retryCall.meta.failure(Error('lost response'));
 ctx.cfaSaveRule_();retryCall=calls.at(-1);
 assert.equal(retryCall.args[1].requestKey,retryKey,'rule retries reuse the key');
 retryCall.meta.failure(Error('offline'));
 ctx.cfaRuleChange_('category','その他収入');ctx.cfaSaveRule_();
 assert.notEqual(calls.at(-1).args[1].requestKey,retryKey);
 calls.at(-1).meta.failure(Error('offline'));
 ctx.cfaScenarioNew_();ctx.cfaScenarioName_('変更条件');
 ctx.cfaScenarioSave_();retryCall=calls.at(-1);retryKey=retryCall.args[1].requestKey;
 retryCall.meta.failure(Error('lost response'));
 ctx.cfaScenarioSave_();retryCall=calls.at(-1);
 assert.equal(retryCall.args[1].requestKey,retryKey,'scenario retries reuse the key');
 retryCall.meta.failure(Error('offline'));
 ctx.cfaScenarioName_('新しい条件');ctx.cfaScenarioSave_();
 assert.notEqual(calls.at(-1).args[1].requestKey,retryKey);
 calls.at(-1).meta.failure(Error('offline'));
 ctx.cfaReconcile_(0);confirm();retryCall=calls.at(-1);retryKey=retryCall.args[1].requestKey;
 retryCall.meta.failure(Error('lost response'));
 assert.ok(ctx.cfaAnalysisPage_().includes('銀行のWeb画面と照合しました'),'reconciliation draft survives failure');
 ctx.cfaReconcile_(0);confirm();
 assert.equal(calls.at(-1).args[1].requestKey,retryKey,'reconciliation retries reuse the key');
 calls.at(-1).meta.failure(Error('offline'));

ctx.cfbReset_();assert.equal(read('cfaUi.workspace'),null);assert.equal(read('cfaUi.projection'),null);
state.data.permissions.cashFlowWorkspace=false;const n=calls.length;
ctx.cfaLoad_(true);assert.equal(calls.length,n);
assert.ok(renders>4);
console.log('PASS cashflow client: sanitized bank rows, annotation retry preservation, confirmed reconciliation, priority rules, scenario builder, secure report download and logout isolation');
