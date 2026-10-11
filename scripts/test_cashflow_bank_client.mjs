import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const calls=[];
const runner=(meta={})=>new Proxy({}, {get(_o,key){
 if(key==='withSuccessHandler')return f=>runner({...meta,success:f});
 if(key==='withFailureHandler')return f=>runner({...meta,failure:f});
 return (...args)=>{calls.push({method:String(key),args,meta});};
}});
const escapeHtml=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={sessionToken:'ADMIN-TOKEN',page:'finance',data:{today:'2026-10-11',permissions:{adminConsole:true,cashFlowWorkspace:true},user:{employeeId:'A'}}};
const months=Array.from({length:12},(_,i)=>({month:i?'2026-'+String(i).padStart(2,'0'):'2025-12',
  planIn:null,planOut:null,actualIn:null,actualOut:null,note:''}));
const cashFlowUi={open:true,year:2026,data:{record:{openingBalance:1000,months}},draft:null,dirty:false};
const emptyMonthly=months.map(row=>({month:row.month,scheduledIn:0,scheduledOut:100,actualIn:0,actualOut:0,
 transferIn:0,transferOut:0,importedCount:0,scheduledCount:1}));
const loaded={ok:true,setupRequired:false,year:2026,monthly:emptyMonthly,
 accounts:[{id:'A1',bank:'架空銀行',name:'普通預金',branch:'本店',last4:'1234',active:true,revision:1}],
 plans:[{id:'P1',title:'毎月の家賃',active:true,direction:'OUT',amount:100,frequency:'MONTHLY',accountId:'A1',startMonth:'2025-12',day:25}],
 bankSummaries:[{accountId:'A1',name:'普通預金',bank:'架空銀行',incoming:0,outgoing:0,importedCount:0,latestBalance:null}],
 transactions:[],closing:{through:'',revision:0},importedCount:0};
const status=[];
let renders=0,confirmAction=null;
const ctx=vm.createContext({state,financeUi:{demo:false},cashFlowUi,google:{script:{run:runner()}},
 cashFlowAllowed_:()=>state.data.permissions.cashFlowWorkspace,cashFlowDiscard_:fn=>fn(),
 renderPageIfActive:()=>renders++,cleanApiErrorMessage:e=>e.message,escapeHtml,
 pageHead:(a,b)=>a+' '+b,cashFlowLoad_:()=>{},cashFlowYen_:v=>v===null?'—':String(v)+'円',
 cashFlowChartHtml_:()=>'<svg></svg>',cashFlowClose_:()=>{},
 cfbPastePanel_:()=>'',cfbCSVPage_:()=>'', // The standalone VM does not load the separate bank-import HTML module.
 cashFlowChangeYear_:()=>{},openConfirmDialog:(_t,_m,_label,cb)=>{confirmAction=cb;},
 showToast:m=>status.push(m),document:{getElementById:()=>null},
 window:{},TextDecoder,Date,JSON,Array,String,Number,Math,Set,Map,RegExp,Promise,Error,console});
const source=fs.readFileSync('src/AppCashFlowBank.html','utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
vm.runInContext(source,ctx);
const js=e=>vm.runInContext(e,ctx);
assert.ok(source.includes("FMRotaryRPC():google.script.run"),'real GAS RPC uses rotary integration');
assert.equal(js('cfbUi.active'),true);
ctx.cfbLoad_(true);
assert.equal(calls.at(-1).method,'getCashFlowBankWorkspace');
assert.equal(calls.at(-1).args[0],'ADMIN-TOKEN');
assert.equal(calls.at(-1).args[1],2026);
calls.at(-1).meta.success(loaded);
assert.equal(js('cfbUi.loaded.accounts.length'),1);
let f=ctx.cfbForecast_();
assert.equal(ctx.cfbActualCell_(f.rows[0],'IN'),'未取込・未照合');
assert.equal(ctx.cfbActualCell_({...f.rows[0],importedCount:2,actualIn:450},'IN'),'取込途中 450円');
assert.equal(ctx.cfbActualCell_({...f.rows[0],source:'確定実績',actualIn:0},'IN'),'0円');
assert.ok(ctx.cfbPreviewTable_(f).includes('未取込・未照合'));

assert.equal(f.rows.length,12);
assert.equal(f.rows[0].planOut,100);
assert.equal(f.rows[0].forecastEnd,900);
assert.equal(f.yearEnd,-200);
assert.equal(f.firstShort,'2026-10');
loaded.bankSummaries[0]={...loaded.bankSummaries[0],statementIn:300,statementOut:280,transferIn:100,transferOut:200,incoming:200,outgoing:80};
loaded.transferReview={total:4,candidateCount:1,attentionCount:2,missingCount:1,ambiguousCount:1,invalidCount:0,
 confirmed:false,windowDays:3,
 candidates:[{outId:'T1',inId:'T2',fromAccountId:'A1',toAccountId:'B2',amount:25000,fromDate:'2026-06-10',toDate:'2026-06-11'}],
 attention:[{transactionId:'T3',accountId:'A1',date:'2026-06-12',amount:999,direction:'OUT',reason:'<svg onload=alert(1)>'}]};
const preview=ctx.cfbPage_();
assert.ok(preview.includes('金融機関・明細取込'));
assert.ok(preview.includes('銀行明細 入金 300円'));
assert.ok(preview.includes('うち内部振替 入金 100円 ／ 出金 200円'));
assert.ok(preview.includes('対外収支 入金 200円 ／ 出金 80円'));
assert.ok(preview.includes('口座間振替に 2件の要確認明細'),'overview warns about unpaired movements');
ctx.cfbSection_('banks');
const transferPanel=ctx.cfbPage_();
assert.ok(transferPanel.includes('口座間振替の両側確認（候補）'));
assert.ok(transferPanel.includes('組み合わせ候補 1組'));
assert.ok(transferPanel.includes('候補・未確認'));
assert.ok(transferPanel.includes('25,000円'));
assert.ok(transferPanel.includes('&lt;svg onload=alert(1)&gt;'),'untrusted transfer warning must be escaped');
assert.ok(!transferPanel.includes('<svg onload=alert(1)>'));
ctx.cfbSection_('overview');
assert.ok(preview.includes('毎月の入出金予定'));
assert.ok(preview.includes('年間の予定出金'));
assert.ok(!preview.includes('銀行へ直接ログイン'));
emptyMonthly[4].actualIn=500;
emptyMonthly[4].actualOut=250;
emptyMonthly[4].importedCount=2;
assert.equal(ctx.cfbForecast_().rows[4].forecastEnd,500,'provisional CSV actual must not replace planned forecast');
loaded.closing.through='2026-04';
f=ctx.cfbForecast_();
assert.equal(f.rows[4].source,'確定実績');
emptyMonthly[4].reconciled=false;
assert.equal(ctx.cfbForecast_().rows[4].source,'要照合','unreconciled prior close is not a finalized actual');
assert.equal(ctx.cfbForecast_().rows[4].forecastEnd,null,'unknown bank actual must not be replaced by zero');
emptyMonthly[4].reconciled=true;
assert.equal(f.rows[4].actualIn,500);
assert.equal(f.rows[4].forecastEnd,850,'four prior planned outflows of 100, followed by 500 minus 250 actual');
months[0].actualIn=900;months[0].actualOut=100;emptyMonthly[0].reconciled=true;
assert.equal(ctx.cfbForecast_().rows[0].actualIn,0,'zero-transaction month must override legacy manual actual');
assert.equal(ctx.cfbForecast_().rows[0].actualOut,0);
months[0].actualIn=null;months[0].actualOut=null;emptyMonthly[0].reconciled=undefined;
ctx.cfbSection_('schedules');
assert.ok(ctx.cfbPage_().includes('毎月の家賃'));
ctx.cfbNewPlan_();
assert.ok(ctx.cfbPlanForm_().includes('1回の金額'));
ctx.cfbFormValue_('plan','title','通信費');
ctx.cfbFormValue_('plan','amount','25000');
ctx.cfbSavePlan_();
assert.equal(calls.at(-1).method,'saveCashFlowScheduledItem');
assert.equal(calls.at(-1).args[1].title,'通信費');
const planRequestKey=calls.at(-1).args[1].requestKey;
ctx.cfbFormValue_('plan','title','書込中の変更は禁止');
assert.equal(js('cfbUi.planForm.title'),'通信費','draft cannot change while request is pending');
calls.at(-1).meta.success({ok:false});
assert.ok(js('cfbUi.planForm')!==null,'unknown plan response preserves draft');
assert.equal(js('cfbUi.planForm.requestKey'),planRequestKey);
assert.match(String(js('cfbUi.error')),/保存結果を確認/);
ctx.cfbSavePlan_();
assert.equal(calls.at(-1).args[1].requestKey,planRequestKey,'plan retry must reuse request key');
calls.at(-1).meta.failure(Error('temporary network failure'));
assert.ok(js('cfbUi.planForm')!==null,'failed plan save keeps draft');
const csv='取引日,摘要,入金額,出金額,残高\r\n2026/04/10,"架空,保守",12000,,400000\r\n2026/04/11,通信費,,5000,395000\r\n';
const parsed=ctx.cfbParseCSV_(csv);
assert.equal(parsed.length,3);
assert.equal(parsed[1][1],'架空,保守');
const map=ctx.cfbGuessCSV_(parsed[0]);
assert.equal(map.date,0);assert.equal(map.incoming,2);assert.equal(map.outgoing,3);assert.equal(map.description,1);
js('cfbUi.csvRows='+JSON.stringify(parsed)+';cfbUi.csvMap='+JSON.stringify(map)+';cfbUi.csvAccountId="A1";cfbUi.csvName="example.csv";');
ctx.cfbPreviewCSV_();
assert.equal(js('cfbUi.preview.length'),2);
assert.equal(js('cfbUi.preview[0].incoming'),12000);
assert.equal(js('cfbUi.preview[1].outgoing'),5000);
assert.equal(ctx.cfbCSVNumber_('1,250円','金額'),1250);
assert.throws(()=>ctx.cfbParseCSV_('日付,メモ\n"不正な未終了の引用符'),/引用符/);
ctx.cfbBeginImport_();
assert.equal(calls.at(-1).method,'importCashFlowBankRows');
assert.equal(calls.at(-1).args[1].rows.length,2);
assert.equal(calls.at(-1).args[1].accountId,'A1');
calls.at(-1).meta.success({ok:true,added:2,skipped:0,auditRecorded:true});
assert.equal(js('cfbUi.importAdded'),2);
assert.equal(js('cfbUi.importing'),false);
assert.equal(calls.at(-1).method,'getCashFlowBankWorkspace','successful import refreshes source');
js('cfbUi.loaded='+JSON.stringify(loaded)+';cfbUi.tab="banks";');
ctx.cfbNewAccount_();
assert.ok(ctx.cfbAccountForm_().includes('金融機関名'));
ctx.cfbFormValue_('account','bank','信用金庫');
ctx.cfbFormValue_('account','name','事業口座');
ctx.cfbSaveAccount_();
assert.equal(calls.at(-1).method,'saveCashFlowBankAccount');
assert.equal(calls.at(-1).args[1].name,'事業口座');
const accountRequestKey=calls.at(-1).args[1].requestKey;
ctx.cfbFormValue_('account','name','通信中に変更されない');
assert.equal(js('cfbUi.accountForm.name'),'事業口座');
calls.at(-1).meta.success({ok:false});
assert.ok(js('cfbUi.accountForm')!==null,'unknown response cannot discard bank-account draft');
ctx.cfbSaveAccount_();
assert.equal(calls.at(-1).args[1].requestKey,accountRequestKey,'account retry must reuse request key');
calls.at(-1).meta.failure(Error('failed save'));
assert.ok(js('cfbUi.accountForm')!==null,'failed account save keeps draft');
ctx.cfbCloseMonth_('2026-04');
ctx.cfbSaveClose_();
assert.equal(typeof confirmAction,'function');confirmAction();
const closeRequestKey=calls.at(-1).args[1].requestKey;
assert.equal(calls.at(-1).method,'saveCashFlowClosedThrough');
ctx.cfbCloseMonth_('2026-05');
assert.equal(js('cfbUi.closeMonth'),'2026-04','close month cannot change while saving');
calls.at(-1).meta.success(null);
assert.equal(js('cfbUi.closeKey'),closeRequestKey,'close retry keeps original key');
assert.match(String(js('cfbUi.error')),/保存結果を確認/);
ctx.cfbSaveClose_();confirmAction();
assert.equal(calls.at(-1).args[1].requestKey,closeRequestKey);
calls.at(-1).meta.failure(Error('temporary close failure'));
ctx.cfbToggleTransfer_('MOCK-TRANSFER',true,1);confirmAction();
assert.equal(calls.at(-1).method,'setCashFlowTransfer');
calls.at(-1).meta.success({ok:false});
assert.match(String(js('cfbUi.error')),/内部振替区分の保存結果を確認/);

 // Resume an interrupted multi-chunk import without replaying already acknowledged rows.
 js('cfbUi.loaded='+JSON.stringify(loaded)+';cfbUi.csvAccountId="A1";cfbUi.csvName="retry.csv";');
 const bankRows=Array.from({length:202},(_,i)=>({date:'2026-04-10',description:'架空'+i,
 incoming:i+1,outgoing:0,balance:10000+i,externalId:'N'+i,occurrence:1,transfer:false}));
 js('cfbUi.preview='+JSON.stringify(bankRows)+';');
 ctx.cfbBeginImport_();let chunk=calls.at(-1);assert.equal(chunk.args[1].rows.length,200);
 chunk.meta.success({ok:true,added:200,skipped:0});chunk=calls.at(-1);
 assert.equal(chunk.args[1].rows.length,2);const retryKey=chunk.args[1].requestKey;
 chunk.meta.failure(Error('lost response'));assert.equal(js('cfbUi.importIndex'),200);
 js('cfbUi.csvAccountId="WRONG";');ctx.cfbBeginImport_();
 chunk=calls.at(-1);assert.equal(chunk.args[1].accountId,'A1');
 assert.equal(chunk.args[1].requestKey,retryKey);
 chunk.meta.success({ok:true,added:0,skipped:2});
 assert.equal(js('cfbUi.importPending'),null);assert.equal(js('cfbUi.importIndex'),202);
 js('cfbUi.loaded='+JSON.stringify(loaded)+';cfbUi.csvAccountId="A1";cfbUi.csvName="bad.csv";cfbUi.preview='+JSON.stringify(bankRows.slice(0,1))+';');
 ctx.cfbBeginImport_();const badResponse=calls.at(-1);
 badResponse.meta.success({ok:true,added:0,skipped:0});
 assert.equal(js('cfbUi.importIndex'),0,'invalid response cannot advance checkpoint');
 assert.equal(js('cfbUi.importing'),false);
 ctx.cfbBeginImport_();chunk=calls.at(-1);
 assert.equal(chunk.args[1].requestKey,badResponse.args[1].requestKey);
 chunk.meta.success({ok:true,added:1,skipped:0});assert.equal(js('cfbUi.importPending'),null);

 
 // UI must not infer zero cashflow just because a one-time payment exists elsewhere in the year.
 js('cfbUi.loaded='+JSON.stringify({...loaded,plans:[{...loaded.plans[0],frequency:'ONCE',startMonth:'2026-10',endMonth:'2026-10'}],
  monthly:emptyMonthly.map(x=>({...x,scheduledCount:x.month==='2026-10'?1:0,scheduledOut:x.month==='2026-10'?100:0}))})+';');
 const unknownPreview=ctx.cfbForecast_();
 assert.equal(unknownPreview.rows[0].planIn,null);
 assert.equal(unknownPreview.rows[0].source,'未入力');
 assert.equal(unknownPreview.yearEnd,null);
 js('cfbUi.loaded='+JSON.stringify(loaded)+';');

 const before=calls.length;state.data.permissions.cashFlowWorkspace=false;
ctx.cfbLoad_(true);assert.equal(calls.length,before,'unauthorized users never request bank data');
ctx.cfbReset_();
const lateRead=ctx.cfbChooseFile_({files:[{name:'late.csv',size:512,arrayBuffer:()=>Promise.resolve(new TextEncoder().encode(csv).buffer)}]});
ctx.cfbReset_();
await lateRead;
assert.equal(js('cfbUi.csvRows'),null,'a completed file-read from the prior session cannot repopulate financial data');
state.data.permissions.cashFlowWorkspace=true;
js('cfbUi.loaded={ok:true,setupRequired:true};cfbUi.busy=false;');
ctx.cfbSetup_();
assert.equal(typeof confirmAction,'function','explicit administrator confirmation required before DB migration');
confirmAction();
assert.equal(calls.at(-1).method,'migrateDatabaseToCurrent','setup triggers guarded backup and migration');
assert.equal(js('cfbUi.busy'),true);
calls.at(-1).meta.failure(Error('backup failed'));
assert.equal(js('cfbUi.busy'),false);
assert.equal(js('cfbUi.csvRows'),null);
assert.equal(js('cfbUi.loaded.setupRequired'),true,'failed DB setup does not invent a ready state');
ctx.cfbReset_();
assert.equal(js('cfbUi.loaded'),null,'logout still clears confidential state');
assert.ok(renders>2);
console.log('PASS cashflow bank client: fiscal forecast, committed vs provisional bank actuals, recurring plans, CSV decode/mapping/preview/import, failure retention, ACL, logout clearance');
