import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=fs.readFileSync('src/AppSomu.html','utf8')
 .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const calls=[],modal={innerHTML:''},nodes={};
const get=id=>nodes[id]||(nodes[id]={value:'',textContent:'',disabled:false,hidden:false});
let success=null,failure=null,toast='',closeCount=0;
const runner={
 withSuccessHandler(fn){success=fn;return proxy;},
 withFailureHandler(fn){failure=fn;return proxy;}
};
const proxy=new Proxy(runner,{get(o,prop){
 if(prop in o)return o[prop];
 return (...args)=>{calls.push({api:String(prop),args});return proxy;};
}});
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx=vm.createContext({
 window:{},document:{getElementById:get},state:{page:'office',sessionToken:'SYNTHETIC_TOKEN',
 data:{today:'2026-10-10',user:{employeeId:'FM0001'},permissions:{officeWorkspace:true}}},
 google:{script:{run:proxy}},ensureModal:()=>modal,closeModal:()=>{closeCount++;},
 showToast:t=>{toast=t;},renderPageIfActive:()=>{},
 pageHead:(a,b)=>escapeHtml(a)+' '+escapeHtml(b),
 cleanApiErrorMessage:()=> '処理が失敗しました',handleApiError:()=>false,
 escapeHtml,svg:()=>'',Date,Math,Number,String,Array,Object,JSON,Set,RegExp
});
vm.runInContext(source,ctx);
const evaluate=s=>vm.runInContext(s,ctx);
evaluate("somuUi.loaded=true;somuUi.data={setupRequired:false,assets:[{id:'AS-1',code:'FA-001',name:'架空PC',status:'利用中',quantity:3,minimum:1}],loans:[],purchases:[],documents:[],canApprove:true,today:'2026-10-10'}");
evaluate("somuOpenForm('asset')");
assert.match(modal.innerHTML,/somu-code/);
assert.match(modal.innerHTML,/somu-quantity/);
get('somu-code').value='FA-002';get('somu-name').value='架空マウス';
get('somu-quantity').value='2';get('somu-minimum').value='1';
evaluate('somuSubmit()');
let call=calls.at(-1);
assert.equal(call.api,'saveSomuAsset');
assert.equal(call.args[0],'SYNTHETIC_TOKEN');
assert.equal(call.args[1].code,'FA-002');
assert.equal(call.args[1].quantity,'2');
assert.equal(evaluate('somuUi.busy'),true);
assert.equal(get('somuSaveButton').disabled,true);
evaluate('somuSubmit()');
assert.equal(calls.filter(x=>x.api==='saveSomuAsset').length,1,'double submit rejected');
assert.ok(success);
success({ok:true,record:{id:'AST-002'}});
assert.ok(closeCount>0);
assert.equal(toast,'保存しました');
assert.equal(calls.at(-1).api,'getSomuWorkspace','refresh after save');
assert.equal(evaluate('somuUi.busy'),false);
success({setupRequired:false,assets:[],loans:[],purchases:[],documents:[],canApprove:true});
assert.equal(evaluate('somuUi.loading'),false);
evaluate("somuReturn('LN-001')");
assert.match(modal.innerHTML,/返却を登録/);
evaluate('somuCommitDecision()');
call=calls.at(-1);
assert.equal(call.api,'returnSomuLoan');
assert.equal(call.args[1],'LN-001');
success({ok:true,record:{id:'LN-001',status:'返却済'}});
success({setupRequired:false,assets:[],loans:[],purchases:[],documents:[],canApprove:true});
evaluate("somuPurchaseAction('PUR-001','RETURN')");
assert.match(modal.innerHTML,/差戻し理由/);
const pre=calls.length;
evaluate('somuCommitDecision()');
assert.equal(calls.length,pre,'missing return reason must block call');
get('somuDecisionReason').value='利用目的を確認してください';
evaluate('somuCommitDecision()');
call=calls.at(-1);
assert.equal(call.api,'advanceSomuPurchase');
assert.deepEqual(call.args,['SYNTHETIC_TOKEN','PUR-001','RETURN','利用目的を確認してください']);
success({ok:true,record:{id:'PUR-001',status:'差戻し'}});
success({setupRequired:false,assets:[],loans:[],purchases:[],documents:[],canApprove:true});
evaluate("somuUi.data={setupRequired:false,assets:[{id:'AS-1',code:'FA-001',name:'架空PC',status:'利用中',quantity:3,minimum:1},{id:'AS-2',code:'FA-002',name:'架空モニター',status:'利用中',quantity:1,minimum:0}],loans:[],purchases:[],documents:[]}");
evaluate("somuOpenForm('loan','','AS-2')");
assert.match(modal.innerHTML,/value="AS-2" selected/,'chosen asset must remain selected');
evaluate(`somuUi.data.purchases=[{id:'PUR-001',name:'架空文具',quantity:1,estimatedPrice:500,reason:'補充',
  requesterId:'FM0001',requesterName:'架空社員',status:'差戻し',updatedAt:'2026-10-10 10:00:00',note:'差戻し理由: 数量を確認'}]`);
const returnedMarkup=evaluate("somuDetailMarkup_('purchases',somuData().purchases[0])");
assert.match(returnedMarkup,/修正して再申請/);
evaluate("somuOpenForm('purchase','PUR-001')");
assert.match(modal.innerHTML,/差戻し内容を修正/);
get('somu-name').value='架空文具（改訂）';
get('somu-quantity').value='2';
get('somu-estimatedPrice').value='600';
get('somu-reason').value='必要数量を修正';
evaluate("somuSubmit()");
call=calls.at(-1);
assert.equal(call.api,'resubmitSomuPurchase');
assert.equal(call.args[0],'SYNTHETIC_TOKEN');
assert.equal(call.args[1],'PUR-001');
assert.equal(call.args[2].quantity,'2');
success({ok:true,record:{id:'PUR-001',status:'申請中'}});
success({setupRequired:false,assets:[],loans:[],purchases:[],documents:[],canApprove:true});
evaluate("somuDemo(true)");
const count=calls.length;
evaluate("somuOpenForm('asset')");
assert.equal(calls.length,count,'demo does not write');
console.log('PASS SOMU client: save, idempotent submit, refresh, return, return reason, loan preselection, demo isolation');
