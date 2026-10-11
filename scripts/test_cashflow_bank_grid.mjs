import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync('src/'+name+'.html','utf8')
 .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const calls=[];
function runner(){
 return new Proxy({}, {get(_t,name){
  if(name==='withSuccessHandler')return cb=>{const r=runner();r._success=cb;return r;};
  if(name==='withFailureHandler')return cb=>{const r=runner();r._failure=cb;return r;};
  return (...args)=>{calls.push({method:name,args});};
 }});
}
let dialog=null,renders=0;
const escaped=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={sessionToken:'ADMIN-SYNTHETIC',page:'finance',data:{permissions:{adminConsole:true,cashFlowWorkspace:true}}};
const cashFlowUi={open:true,year:2026,busy:false};
const dom={'cbg-total':{textContent:''},'cbg-invalid':{textContent:''},
 'cbg-in':{textContent:''},'cbg-out':{textContent:''},
 'cbg-import':{disabled:false},
 'cbg-copy':{hidden:true,value:'',focus(){},select(){}},
 'cbg-error-0':{textContent:'',dataset:{}}};
const cx=vm.createContext({console,Date,Math,Number,Array,Object,Map,Set,String,Error,JSON,RegExp,
 state,cashFlowUi,financeUi:{demo:false},cashFlowAllowed_:()=>true,
 document:{getElementById:id=>dom[id]||null,querySelector:()=>null},
 google:{script:{run:runner()}},escapeHtml:escaped,
 renderPageIfActive:()=>{renders++;},showToast:()=>{},pageHead:(a,b)=>a+' '+b,
 cfbAccountOptions_:()=>'<option value="A1">架空銀行</option>',
 cleanApiErrorMessage:e=>String(e.message||e),
 openConfirmDialog:(title,detail,label,callback)=>{dialog={title,detail,label,callback};},
 cashFlowDiscard_:cb=>cb()
});
vm.runInContext(read('AppCashFlowBank'),cx);
vm.runInContext(read('AppCashFlowBankGrid'),cx);
vm.runInContext(read('AppCashFlowPaste'),cx);
const js=expression=>vm.runInContext(expression,cx);
cx.cfbUi; // bank state is declared as let inside VM.
js("cfbUi.loaded={ok:true,accounts:[{id:'A1',bank:'架空銀行',name:'普通預金',active:true}],transactions:[],plans:[]};cfbUi.csvAccountId='A1';");
const valid={date:'2026/10/09',description:'架空の入金',incoming:2200,outgoing:0,
 balance:6500,externalId:'',occurrence:1,transfer:false};
assert.equal(cx.cfbBankGridNormalize_(valid).date,'2026-10-09');
assert.equal(cx.cfbBankGridNormalize_({...valid,incoming:'2,200円'}).incoming,2200);
assert.equal(cx.cfbBankGridMoney_(' (2,000) ','残高',true,true),-2000);
for(const bad of ['2026/02/29','2026/13/01','2026/10/32','2026100']){
 assert.ok(cx.cfbBankGridErrors_({...valid,date:bad}).length,'invalid day '+bad);
}
assert.ok(cx.cfbBankGridErrors_({...valid,outgoing:900}).length,'two directions must not be set');
assert.ok(cx.cfbBankGridErrors_({...valid,incoming:0,outgoing:0}).length,'zero/zero is invalid');
assert.ok(cx.cfbBankGridErrors_({...valid,incoming:'-2'}).length,'negative incoming is invalid');
assert.ok(cx.cfbBankGridErrors_({...valid,description:'X'.repeat(241)}).length,'long description rejected');
assert.ok(cx.cfbBankGridErrors_({...valid,externalId:'Z'.repeat(101)}).length,'long external ID rejected');
assert.ok(cx.cfbBankGridErrors_({...valid,amount:1, incoming:'9999999999999'}).length,'13 digits too large');
const rows=Array.from({length:31},(_,i)=>({...valid,date:'2026-10-09',description:'架空'+i,incoming:i+1}));
rows[0].description='<img src=x onerror=alert(1)>';js('cfbUi.preview='+JSON.stringify(rows)+';cfbUi.bankGridPage=0;');
const html=cx.cfbBankGridPreview_();
assert.ok(html.includes('明細の確認・修正'));
assert.ok(html.includes('取引日')&&html.includes('出金（円）'));
assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!html.includes('<img src=x onerror=alert(1)>'),'bank data must be escaped');
assert.equal((html.match(/data-cbg-cell=/g)||[]).length,25*6,'first preview page renders 25x6 cells');
cx.cfbBankGridPageChange_(1);
const second=cx.cfbBankGridPreview_();
assert.equal((second.match(/data-cbg-cell=/g)||[]).length,6*6);
assert.ok(second.includes('26 / 31')||second.includes('表示 26〜31'));
const before=js('cfbUi.preview[1].description');
assert.throws(()=>cx.cfbBankGridApplyPaste_('A\tB\tC\tD\tE\tF\tG',1,0),/6列/);
assert.equal(js('cfbUi.preview[1].description'),before);
assert.throws(()=>cx.cfbBankGridApplyPaste_('1\t2',30,5),/超えています/);
assert.equal(js('cfbUi.preview[30].description'),'架空30');
const applied=cx.cfbBankGridApplyPaste_('2026/10/11\t交通費\t0\t2000',1,0);
assert.equal(applied.rows,1);
assert.equal(js('cfbUi.preview[1].description'),'交通費');
assert.equal(cx.cfbBankGridStats_().invalid,0);
cx.cfbBankGridCell_(1,'outgoing','3+2');
assert.equal(cx.cfbBankGridStats_().invalid,1);
assert.equal(dom['cbg-import'].disabled,true,'invalid bank row must disable import');
cx.cfbBankGridCell_(1,'outgoing','2,000');
assert.equal(cx.cfbBankGridStats_().invalid,0);
assert.equal(dom['cbg-import'].disabled,false);
js("cfbUi.preview=[{date:'2026-10-11',description:'同日同額',incoming:1000,outgoing:0,balance:1000,externalId:'',transfer:false},{date:'2026-10-11',description:'同日同額',incoming:1000,outgoing:0,balance:1000,externalId:'',transfer:false}];");
cx.cfbBankGridReindex_();
assert.equal(js('cfbUi.preview[1].occurrence'),2,'repeated legitimate rows keep distinct occurrence');
cx.cfbBankGridRemove_(0);
assert.ok(dialog&&/取込対象/.test(dialog.title),'removing staged bank rows needs confirmation');
dialog.callback();
assert.equal(js('cfbUi.preview.length'),1);
assert.equal(js('cfbUi.preview[0].occurrence'),1,'exclusion renumbers repeated payments');
const oldAccount=js('cfbUi.csvAccountId');
dialog=null;cx.cfbBankGridSetAccount_('A2');
assert.equal(js('cfbUi.csvAccountId'),oldAccount,'changing account must wait for explicit confirmation');
assert.ok(dialog&&/口座/.test(dialog.title));
dialog=null;cx.cfbReload_();
assert.ok(dialog&&/編集済み/.test(dialog.title),'refresh must ask before dropping edited rows');
dialog=null;cx.cfbPastePreview_();
assert.ok(dialog&&/編集済み/.test(dialog.title),'new paste cannot silently erase an edited preview');
dialog=null;
assert.match(fs.readFileSync('src/AppCashFlow.html','utf8'),/function cashFlowChangeYear_\([\s\S]{0,160}importPending/,
 'fiscal-year switch must not discard paused import');
assert.match(fs.readFileSync('src/AppCashFlow.html','utf8'),/cfbUi\.importPending/,
 'cashflow close must protect unresolved bank import state');

cx.cfbBeginImport_();
assert.equal(calls.at(-1).method,'importCashFlowBankRows');
assert.equal(calls.at(-1).args[1].rows.length,1);
assert.equal(calls.at(-1).args[1].rows[0].date,'2026-10-11');
assert.equal(js('cfbUi.importPending.rows[0].occurrence'),1);
const snapshot=js('JSON.stringify(cfbUi.importPending)');
cx.cfbBankGridCell_(0,'incoming','999999');
assert.equal(js('cfbUi.preview[0].incoming'),1000,'locked preview cannot mutate');
assert.throws(()=>cx.cfbBankGridApplyPaste_('2026-10-12\t誤編集',0,0),/変更できません/);
cx.cfbPreviewCSV_();
assert.equal(js('JSON.stringify(cfbUi.importPending)'),snapshot,'reparse cannot destroy a pending snapshot');
cx.cfbMapCSV_('date','1');
assert.equal(js('JSON.stringify(cfbUi.importPending)'),snapshot,'remapping cannot destroy a pending snapshot');
js('cfbUi.pasteText="取引日\\t摘要\\t出金額\\t入金額\\n2026-11-09\\t上書き\\t\\t100";');
cx.cfbPastePreview_();
assert.equal(js('JSON.stringify(cfbUi.importPending)'),snapshot,'paste cannot wipe an uncertain bank batch');
cx.cfbReset_();
assert.equal(js('cfbUi.importPending'),null,'logout clears all sensitive bank preview and keys');
js("cfbUi.loaded={ok:true,accounts:[{id:'A1'}]};cfbUi.csvAccountId='A1';");
const pasteRows=[['取引日','摘要','入金額','出金額'],['','金額があるのに日付なし','3000','']];
js('cfbUi.csvRows='+JSON.stringify(pasteRows)+';cfbUi.csvMap='+JSON.stringify({date:0,description:1,incoming:2,outgoing:3,amount:-1,direction:-1,balance:-1,externalId:-1})+';');
cx.cfbPreviewCSV_();
assert.ok(/取引日が未入力/.test(js('cfbUi.error')),'undated nonempty transactions must fail instead of being silently dropped');
assert.ok(!/localStorage|sessionStorage/.test(read('AppCashFlowBankGrid')));
console.log('PASS bank grid: 25-row paging, multi-cell paste, bank parsing, strict validation, removal/reindex, uncertain batch protection, security and logout');
