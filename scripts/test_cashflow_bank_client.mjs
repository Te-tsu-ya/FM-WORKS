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
 cashFlowAllowed_:()=>state.data.permissions.cashFlowWorkspace,
 renderPageIfActive:()=>renders++,cleanApiErrorMessage:e=>e.message,escapeHtml,
 pageHead:(a,b)=>a+' '+b,cashFlowLoad_:()=>{},cashFlowYen_:v=>v===null?'—':String(v)+'円',
 cashFlowChartHtml_:()=>'<svg></svg>',cashFlowClose_:()=>{},
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
assert.equal(f.rows.length,12);
assert.equal(f.rows[0].planOut,100);
assert.equal(f.rows[0].forecastEnd,900);
assert.equal(f.yearEnd,-200);
assert.equal(f.firstShort,'2026-10');
const preview=ctx.cfbPage_();
assert.ok(preview.includes('金融機関・明細取込'));
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
assert.equal(f.rows[4].actualIn,500);
assert.equal(f.rows[4].forecastEnd,850,'four prior planned outflows of 100, followed by 500 minus 250 actual');
ctx.cfbSection_('schedules');
assert.ok(ctx.cfbPage_().includes('毎月の家賃'));
ctx.cfbNewPlan_();
assert.ok(ctx.cfbPlanForm_().includes('1回の金額'));
ctx.cfbFormValue_('plan','title','通信費');
ctx.cfbFormValue_('plan','amount','25000');
ctx.cfbSavePlan_();
assert.equal(calls.at(-1).method,'saveCashFlowScheduledItem');
assert.equal(calls.at(-1).args[1].title,'通信費');
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
calls.at(-1).meta.failure(Error('failed save'));
assert.ok(js('cfbUi.accountForm')!==null,'failed account save keeps draft');
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
