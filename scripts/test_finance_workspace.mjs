import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/Finance.gs','utf8');
const bulk=fs.readFileSync('src/FinanceBulk.gs','utf8');
const client=fs.readFileSync('src/AppFinanceWorkspace.html','utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
class Sheet{
 constructor(){this.rows=[['id','createdAt','creatorId','creatorName','usedOn','category','vendor','invoiceNo','item','amount','note','payer','paymentMethod','paid','receiptRef','updatedAt','requestKey']];this.writes=0;}
 getLastRow(){return this.rows.length;}
 getRange(r,c,n=1,w=1){return {
  getDisplayValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>String(this.rows[r+i-1]?.[c+j-1]??''))),
  setValues:rows=>{this.writes++;rows.forEach((row,i)=>{const index=r+i-1;this.rows[index]=this.rows[index]||[];row.forEach((v,j)=>this.rows[index][c+j-1]=v);});}
 };}
}
const sheet=new Sheet(),users={ADMIN:{employeeId:'A',name:'架空管理者',role:'ADMIN',department:'経理'},
 STAFF:{employeeId:'B',name:'架空社員',role:'USER',department:'開発'}};
let ids=0,audit=true;
const ctx=vm.createContext({console,Date,JSON,Array,Set,Map,String,Number,Object,RegExp,Math,Error,
 DB:{timeZone:'Asia/Tokyo'},
 Utilities:{formatDate:()=> '2026-10-11 12:00:00'},
 financeDepartmentAllowed_:department=>department==='経理',
 requireSession_:token=>{if(!users[token])throw Error('AUTH_REQUIRED');return {employee:users[token]};},
 safeSheetText_:v=>v,
 normalizeDate_:v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))throw Error('日付が不正');return v;},
 withScriptLock_:fn=>fn(),
 readRowsByColumnValues_:(sheet,col,width,ids,_ci,withRows)=>sheet.rows.flatMap((row,i)=>i>0&&ids.includes(String(row[col-1]))?[withRows?{rowNumber:i+1,values:row.slice(0,width)}:row.slice(0,width)]:[]),
 financeSheet_:()=>sheet,createId_:prefix=>prefix+'-'+(++ids),
 appendAudit_:()=>audit,
 auditJson_:v=>JSON.stringify(v),
 getDb_:()=>({getSheetByName:()=>null})});
vm.runInContext(source+'\n'+bulk,ctx);
ctx.financeAuditConfirmedForRetry_=()=>true;
ctx.financeSheet_=()=>sheet;
const row=(key,more={})=>({usedOn:'2026-10-09',category:'消耗品費',vendor:'架空文具店',invoiceNo:'',
 item:'事務用品',amount:'2200',note:'',payer:'架空社員',paymentMethod:'会社カード',paid:'済',
 receiptRef:'',requestKey:key,...more});
const one='FMBULKKEY00000001',two='FMBULKKEY00000002',three='FMBULKKEY00000003';
const input={rows:[row(one),row(two,{usedOn:'2026-10-10',amount:'1450'})]};
assert.throws(()=>ctx.saveFinanceReceiptsBulk('STAFF',input),/権限/);
assert.throws(()=>ctx.saveFinanceReceiptsBulk('ADMIN',{rows:[row(one),row(one)]}),/同じ送信識別子/);
assert.throws(()=>ctx.saveFinanceReceiptsBulk('ADMIN',{rows:[row(one),row(two,{amount:'9999999999'})]}),/2行目/);
assert.equal(sheet.getLastRow(),1,'bad input must not change the ledger');
const saved=ctx.saveFinanceReceiptsBulk('ADMIN',input);
assert.equal(saved.ok,true);
assert.equal(saved.added,2);
assert.equal(sheet.getLastRow(),3);
assert.equal(sheet.writes,1,'bulk should use one range write');
const retry=ctx.saveFinanceReceiptsBulk('ADMIN',input);
assert.equal(retry.added,0);
assert.equal(retry.duplicateCount,2);
assert.equal(sheet.getLastRow(),3);
assert.throws(()=>ctx.saveFinanceReceiptsBulk('ADMIN',{rows:[row(one,{amount:'2400'})]}),/異なる行/);
assert.equal(sheet.getLastRow(),3);
audit=false;
const failedAudit=ctx.saveFinanceReceiptsBulk('ADMIN',{rows:[row(three)]});
assert.equal(failedAudit.auditRecorded,false,'an audit failure must be visible');
assert.equal(sheet.getLastRow(),4,'audit failure must not erase committed receipt');
assert.equal(ctx.saveFinanceReceiptsBulk('ADMIN',{rows:[row(three)]}).added,0,'retry must not duplicate committed receipt');
assert.throws(()=>ctx.saveFinanceReceiptsBulk('ADMIN',{rows:Array.from({length:21},(_,i)=>row('KEY000000000'+i))}),/20件/);
assert.equal(sheet.getLastRow(),4);
const state={sessionToken:'ADMIN',page:'finance',data:{permissions:{financeWorkspace:true,cashFlowWorkspace:true,adminConsole:true},user:{employeeId:'A'}}};
const cli=vm.createContext({console,Date,String,Number,Math,Set,Map,Object,Array,JSON,RegExp,Error,
 state,financeUi:{demo:false,tab:'expense',insightMode:false,overview:{totals:{expensePending:2,travelPending:1,expenseToSettle:0,travelToSettle:0},receipts:[]}},
 financeAccessAllowed:()=>true,cashFlowAllowed_:()=>true,cashFlowUi:{open:false},cfbUi:{tab:'overview'},
 escapeHtml:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
 financeDisplayedOverview_:()=>cli.financeUi.overview,financeLegacyPage:()=>'<div>一覧</div>',
 financeInsightsPage:()=>'<div>支出分析</div>',cashFlowPage_:()=>'<div>資金繰り</div>',
 renderPageIfActive:()=>{},financeNewKey:()=> 'FMKEY'+Math.random().toString(36).slice(2,15),
 financeYen:n=>String(n),financeJumpTo:()=>{},loadFinanceOverview:()=>{},
 navigate:()=>{},financeToggleDemo:()=>{},cashFlowOpenDemo_:()=>{},showToast:()=>{},
 document:{getElementById:()=>null},openConfirmDialog:()=>{},pageHead:(a,b)=>a+' '+b});
vm.runInContext(client,cli);
vm.runInContext(fs.readFileSync('src/AppFinanceGrid.html','utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),cli);
const clipboard='利用日\t経費種別\t取引先\t適格請求書番号\t商品名\t利用金額\t備考\t支払者\t支払方法\t支払有無\n'+
 '2026/10/09\t2026年10月\t架空文具店\t\t事務用品\t2,200円\t\t架空社員\t会社カード\t済\n';
const parsed=cli.financeBulkParseMatrix_(clipboard);
assert.equal(parsed.hasHeader,true);
assert.equal(parsed.mapping[1],'','legacy month column cannot be treated as an expense category');
assert.equal(parsed.mapping[5],'amount');
assert.equal(parsed.source.length,1);
vm.runInContext('financeBulkUi.raw='+JSON.stringify(clipboard)+';',cli);
cli.financeBulkPreview_();
assert.equal(vm.runInContext('financeBulkUi.rows[0].category',cli),'未分類');
assert.equal(vm.runInContext('financeBulkUi.rows[0].amount',cli),'2200');
assert.equal(cli.financeBulkValidateRow_(vm.runInContext('financeBulkUi.rows[0]',cli)).length,0);
assert.ok(cli.financeBulkValidateRow_({...vm.runInContext('financeBulkUi.rows[0]',cli),amount:'10+20'}).includes('金額'));
assert.ok(cli.financeWorkspaceNav_('overview').includes('経費台帳'));
assert.ok(cli.financeWorkspaceNav_('overview').includes('提出資料'));
assert.ok(cli.financeWorkspacePage_().includes('今日の経理業務'));
assert.ok(cli.financeWorkspaceSummary_().includes('銀行Web明細'));
assert.ok(cli.financeWorkspaceSummary_().includes('証憑の要確認'),'mismatch queue must remain discoverable');
assert.ok(cli.financeWorkspaceList_().includes('最新に更新'),'approval screen must have visible refresh');
assert.ok(!/localStorage|sessionStorage/.test(client),'financial pasted rows must remain in memory');
assert.ok(cli.financeGridPage_().includes('経費台帳｜表にまとめて入力'),'new sheet-like entry must be reachable');
console.log('PASS finance workspace navigation, pasted ledger table, validation, one-RPC batch, retries and audit uncertainty');
