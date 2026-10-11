import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=['src/AppSomu.html','src/AppSomuGrowth.html'].map(file=>fs.readFileSync(file,'utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'')).join('\n');
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
// Production menu has no separate sample mode or disabled sample actions.
assert.doesNotMatch(source,/somuDemo|SOMU_DEMO|somuUi\.demo/);
assert.doesNotMatch(evaluate("somuPage()"),/操作サンプル|デモ終了|架空データで画面を確認/);
// Render a large synthetic inventory with at most 60 nodes, without server calls.
const largeAssets=Array.from({length:305},(_,i)=>({
 id:'AST-'+i,code:'TEST-'+String(i).padStart(4,'0'),name:'架空備品'+i,location:'倉庫',
 quantity:2,minimum:0,status:'利用中',revision:1,updatedAt:'2026-10-10 10:00:00'
}));
vm.runInContext('somuUi.data='+JSON.stringify({setupRequired:false,assets:largeAssets,loans:[],purchases:[],documents:[],today:'2026-10-10',canApprove:true}),ctx);
evaluate("somuUi.loaded=true;somuUi.tab='assets';somuUi.listLimit=60;somuUi.query='';somuUi.filter='all';somuUi.selected=''");
const firstPage=evaluate("somuPage()");
assert.equal((firstPage.match(/class="somu-list-item/g)||[]).length,60,'render at most 60 cards');
assert.match(firstPage,/残り245件/);
const beforeMoreRpc=calls.length;
evaluate("somuMore()");
assert.equal((get('somuList').innerHTML.match(/class="somu-list-item/g)||[]).length,120);
assert.equal(calls.length,beforeMoreRpc,'pagination must remain entirely client-side');
evaluate("somuSearch('TEST-0304')");
assert.equal(evaluate("somuRows('assets').length"),1);
assert.equal(evaluate("somuUi.listLimit"),60,'search returns to first page');
evaluate("somuUi.query='';somuUi.loadedAt=Date.now()");
const beforeLocalCache=calls.length;
evaluate("somuLoad(false)");
assert.equal(calls.length,beforeLocalCache,'fresh local data makes reentry without any RPC');
evaluate("somuUi.loadedAt=Date.now()-301000");
const previousData=evaluate("somuUi.data");
evaluate("somuLoad(false)");
assert.equal(calls.at(-1).api,'getSomuWorkspace');
assert.equal(calls.at(-1).args[1],false);
assert.equal(evaluate("somuUi.data"),previousData,'background refresh must keep old rows');
success({setupRequired:false,assets:[],loans:[],purchases:[],documents:[],canApprove:true});
assert.equal(evaluate("somuUi.loaded"),true);
assert.ok(evaluate("somuUi.loadedAt")>0);
evaluate("somuLoad(true)");
assert.equal(calls.at(-1).args[1],true,'explicit reload bypasses server cache');
failure({message:'Synthetic network outage'});
assert.equal(evaluate("somuUi.loaded"),true,'failed refresh keeps existing dataset');
assert.ok(evaluate("somuUi.data"));
// If historical loan rows are omitted, stock/KPI must never show a false 0/available count.
evaluate("somuUi.data="+JSON.stringify({
 setupRequired:false,assets:[{id:'AS-HIDDEN',code:'FA-HIDDEN',name:'架空備品',
 quantity:3,minimum:0,status:'利用中'}],loans:[],purchases:[],documents:[],
 truncated:true,truncatedKinds:{assets:false,loans:true,purchases:false,documents:false},
 today:'2026-10-10',canApprove:true
}));
evaluate("somuUi.loaded=true;somuUi.tab='assets';somuUi.query='';somuUi.filter='all'");
assert.match(evaluate('somuPage()'),/貸出可能数は未確定/,'partial loan list must not claim available stock');
assert.equal(evaluate("somuAvailable_(somuData().assets[0])"),null);
evaluate("somuUi.tab='home'");
assert.match(evaluate('somuPage()'),/未確定/,'overdue KPI must be marked incomplete');
assert.doesNotMatch(evaluate('somuPage()'),/現在、期限が迫っている案件はありません。/);
console.log('PASS SOMU client: saves, lending, 60-row paging, stale refresh, partial-data accuracy');

