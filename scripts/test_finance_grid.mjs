import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync('src/'+name+'.html','utf8')
 .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
let keys=0,writes=[],lastConfirm=null,copied='';
const elements={
 'fg-default-payer':{value:'架空社員'},
 'fg-default-payment':{value:'法人カード'}
};
const state={sessionToken:'ADMIN_TEST',page:'finance',data:{
 permissions:{financeWorkspace:true,adminConsole:true,cashFlowWorkspace:true},user:{employeeId:'A'}}};
const financeUi={demo:false,tab:'expense',insightMode:false,overview:{expenses:[],receipts:[],
 totals:{expensePending:0,travelPending:0,expenseToSettle:0,travelToSettle:0}}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const run={
 withSuccessHandler(f){this.success=f;return this;},
 withFailureHandler(f){this.failure=f;return this;},
 saveFinanceReceiptsBulk(token,payload){
  assert.equal(token,'ADMIN_TEST');
  writes.push(payload.rows.map(row=>({...row})));
  this.success({ok:true,results:payload.rows.map((_,i)=>({id:'R-'+i})),auditRecorded:true});
 }
};
const ctx=vm.createContext({console,Date,Math,Number,Array,Set,Map,Object,JSON,String,RegExp,Error,
 state,financeUi,financeAccessAllowed:()=>true,cashFlowAllowed_:()=>true,
 cashFlowUi:{open:false},cfbUi:{tab:'overview'},
 financeDisplayedOverview_:()=>financeUi.overview,
 escapeHtml:esc,financeNewKey:()=> 'KEY_'+String(++keys).padStart(12,'0'),
 financeIdentity:()=>state.sessionToken,financeLegacyPage:()=>'<div>existing ledger</div>',
 financeInsightsPage:()=>'<div>insights</div>',cashFlowPage_:()=>'<div>forecast</div>',
 loadFinanceOverview:()=>{},renderPageIfActive:()=>{},showToast:()=>{},
 pageHead:()=>'',navigate:()=>{},financeJumpTo:()=>{},
 financeToggleDemo:()=>{},cashFlowOpenDemo_:()=>{},
 document:{getElementById:id=>elements[id]||null,querySelector:()=>null},
 google:{script:{run}},
 navigator:{clipboard:{writeText:s=>{copied=s;return Promise.resolve();}}},
 openConfirmDialog:(title,description,label,action)=>{lastConfirm={title,description,label,action};}
});
vm.runInContext(read('AppFinanceWorkspace'),ctx);
vm.runInContext(read('AppFinanceGrid'),ctx);
const val=expression=>vm.runInContext(expression,ctx);
assert.match(ctx.financeGridPage_(),/fg-grid/,'grid rendered immediately');
assert.equal(val('financeBulkUi.rows.length'),12,'12 blank rows by default');
assert.equal(ctx.financeGridStats_().entered,0,'empty rows do not count');
assert.equal(ctx.financeGridPage_().split('data-fin-cell=').length-1,12*11,
 'every visible cell should be editable before import');
const input='2026/10/09\t架空文具店\tコピー用紙\t2,200\n2026/10/10\t架空鉄道\t運賃\t1450';
assert.equal(ctx.financeGridApplyPaste_(input,0,0).rows,2);
assert.equal(val('financeBulkUi.rows[0].amount'),'2200');
assert.equal(val('financeBulkUi.rows[1].usedOn'),'2026-10-10');
assert.equal(ctx.financeGridStats_().entered,2);
assert.equal(ctx.financeGridStats_().invalid,2,'payer and payment method still required');
assert.throws(()=>ctx.financeGridApplyPaste_('A\tB\tC\tD\tE\tF\tG\tH\tI\tJ\tK\tL',0,0),/列数/);
assert.equal(val('financeBulkUi.rows[0].vendor'),'架空文具店','invalid paste must not alter state');
assert.throws(()=>ctx.financeGridApplyPaste_('10\t20',499,10),/最大列数/);
ctx.financeGridApplyDefaults_();
assert.equal(val('financeBulkUi.rows[0].payer'),'架空社員');
assert.equal(val('financeBulkUi.rows[1].paymentMethod'),'法人カード');
assert.equal(ctx.financeGridStats_().invalid,0);
const former=val('financeBulkUi.keys[0]');
ctx.financeGridAdd_(10);
assert.equal(val('financeBulkUi.rows.length'),22);
ctx.financeGridSelect_(0,true);
ctx.financeGridCopySelected_();
assert.ok(copied.includes('架空文具店')&&copied.includes('金額 (円)'),'selected row must copy TSV');
ctx.financeGridDuplicate_();
assert.equal(ctx.financeGridStats_().entered,3,'duplicate row inserted');
assert.notEqual(val('financeBulkUi.keys[1]'),former,'duplicate must have new request key');
ctx.financeGridSelect_(1,true);
ctx.financeGridDeleteSelected_();
assert.ok(lastConfirm&&/削除/.test(lastConfirm.title),'nonempty delete needs confirmation');
lastConfirm.action();
assert.equal(ctx.financeGridStats_().entered,2);
assert.equal(val('financeBulkUi.keys[0]'),former,'other row idempotency key preserved');
ctx.financeBulkStart_();
assert.equal(val('financeBulkUi.rows.length'),2,'grid must not add blanks while locked or after save RPC');
assert.equal(writes.length,1,'two valid rows must save in one RPC');
assert.equal(writes[0].length,2,'blank rows excluded from save');
assert.equal(writes[0][0].requestKey,former);
assert.equal(val('financeBulkUi.complete'),true);
assert.equal(val('financeBulkUi.rows.length'),2,'saved snapshot contains only filled rows');
assert.match(ctx.financeGridPage_(),/登録を確認済み/);
ctx.financeBulkReset_();
assert.equal(ctx.financeGridStats_().entered,0,'new entry should start blank');
assert.equal(val('financeBulkUi.rows.length'),0,'reset discards committed snapshot');
assert.match(ctx.financeGridPage_(),/fg-grid/);
assert.equal(val('financeBulkUi.rows.length'),12,'reset reinitializes blank grid');
ctx.financeGridApplyPaste_('2026/10/10\t架空文具店\t事務用品\t2800',0,0);
vm.runInContext("financeWorkspaceMode='bulk';",ctx);
lastConfirm=null;ctx.financeWorkspaceGo_('overview');
assert.ok(lastConfirm&&/未保存/.test(lastConfirm.title),'leaving draft warns user');
assert.equal(val("financeWorkspaceMode"),'bulk','must not leave before confirmation');
lastConfirm.action();assert.equal(val('financeWorkspaceMode'),'overview');
assert.ok(!/localStorage|sessionStorage/.test(read('AppFinanceGrid')),
 'financial draft must not be stored in persistent browser storage');
console.log('PASS finance grid: initial rows, direct TSV paste, limit, defaults, duplicate/delete/copy, blank exclusion, protected save, reset and unsaved navigation');
