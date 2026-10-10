import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('src/AppCompanyDocs.html','utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const calls=[],elements={},modal={innerHTML:''},toasts=[];
let nextSuccess=null,nextFailure=null;
const runner={withSuccessHandler(fn){nextSuccess=fn;return proxy;},
  withFailureHandler(fn){nextFailure=fn;return proxy;}};
const proxy=new Proxy(runner,{get(obj,key){
  if(key in obj)return obj[key];
  return (...args)=>{calls.push({method:String(key),args,success:nextSuccess,failure:nextFailure});nextSuccess=null;nextFailure=null;return proxy;};
}});
const escapeHtml=s=>String(s==null?'':s).replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const folders=[
  {id:'hr',parentId:'',name:'人事・労務'},{id:'hr/work',parentId:'hr',name:'就業・勤怠'},
  {id:'hr/leave',parentId:'hr',name:'休暇・福利厚生'},
  {id:'general',parentId:'',name:'総務・設備'},
  {id:'general/equipment',parentId:'general',name:'備品・貸出'},
  {id:'finance',parentId:'',name:'経理・出張'},
  {id:'finance/expenses',parentId:'finance',name:'経費精算'},
  {id:'other',parentId:'',name:'その他'},{id:'other/general',parentId:'other',name:'その他の文書'}
];
const items=[
  {id:'CD-aaaaaaaaaaaa-111',title:'【DEMO】就業規則',summary:'就業に関するルール',category:'就業規則',
   folderId:'hr/work',tags:['勤怠','就業'],status:'公開',revision:1,updatedAt:'2026-10-10 12:00:00'},
  {id:'CD-bbbbbbbbbbbb-222',title:'【DEMO】経費精算マニュアル',summary:'経費の申請',category:'マニュアル',
   folderId:'finance/expenses',tags:['精算'],status:'公開',revision:2,updatedAt:'2026-10-09 12:00:00'},
  {id:'CD-cccccccccccc-333',title:'【DEMO】福利厚生規程',summary:'制度検討中',category:'社内規程',
   folderId:'hr/leave',tags:['制度'],status:'下書き',revision:1,updatedAt:'2026-10-08 12:00:00'}
];
const data={ok:true,setupRequired:false,needsUpgrade:false,canManage:true,
  canInitialize:true,folders,categories:['就業規則','社内規程','マニュアル','その他'],items};
const ctx=vm.createContext({
  state:{page:'companyDocs',sessionToken:'SESSION-A',data:{user:{employeeId:'FM0001'}}},
  document:{getElementById:id=>elements[id]||(elements[id]={innerHTML:'',textContent:''})},
  google:{script:{run:proxy}},escapeHtml,renderPageIfActive:()=>{},
  ensureModal:()=>modal,closeModal:()=>{},showToast:message=>toasts.push(message),
  cleanApiErrorMessage:e=>String(e&&e.message||e),Date,Math,Number,String,Array,Object,Set,RegExp,
  setTimeout:fn=>{fn();return 1;},clearTimeout:()=>{}
});
vm.runInContext(source,ctx,{filename:'AppCompanyDocs.html'});
const run=expr=>vm.runInContext(expr,ctx);
assert.match(run('companyDocsPage()'),/文書一覧を読み込んでいます/);
run('loadCompanyDocs()');
assert.equal(calls.at(-1).method,'getCompanyDocuments');
calls.at(-1).success(data);
let markup=run('companyDocsPage()');
for(const cls of ['company-doc-tree-pane','company-doc-list-pane','company-doc-detail-pane',
  'company-doc-quick-folders','company-doc-toolbar']){
  assert.ok(markup.includes(cls),'missing '+cls);
}
assert.ok(markup.includes('総務・設備'),'folder taxonomy must be rendered');
assert.equal(run('companyDocsVisibleItems_().length'),3);
run("companyDocsSelectFolder('hr')");
assert.equal(run('companyDocsVisibleItems_().length'),2);
assert.equal(run("companyDocsUi.mobileStep"),'list');
run("companyDocsSetStatus('公開')");
assert.equal(run('companyDocsVisibleItems_().length'),1);
run('companyDocsClearFilters()');
run("companyDocsSetCategory('マニュアル')");
assert.equal(run('companyDocsVisibleItems_().length'),1);
run("companyDocsSetCategory('all')");
run("companyDocsSetQuery('秘密キーワード')");
assert.equal(calls.at(-1).method,'searchCompanyDocumentBodies');
assert.equal(calls.at(-1).args[1],'秘密キーワード');
assert.equal(run('companyDocsVisibleItems_().length'),0);
calls.at(-1).success({ok:true,matchedIds:[items[0].id],truncated:false});
assert.equal(run('companyDocsVisibleItems_().length'),1,'remote full-body match should join local results');
run('companyDocsClearFilters()');
run("companyDocsSelect("+JSON.stringify(items[0].id)+")");
assert.equal(calls.at(-1).method,'getCompanyDocument');
assert.equal(calls.at(-1).args[1],items[0].id);
calls.at(-1).success({document:{...items[0],body:'<script>alert(1)</script> サンプル',url:'https://example.com'}});
markup=run('companyDocsPage()');
assert.ok(markup.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),'body escaped');
assert.ok(!markup.includes('<script>alert(1)</script>'),'raw body never becomes HTML');
run('companyDocsUi.detail.url="javascript:alert(1)"');
assert.ok(!run('companyDocsPage()').includes('href="javascript:'),'unsafe links never appear');
run('companyDocsUi.detail.url="https://example.com"');
run("companyDocsStartEdit("+JSON.stringify(items[0].id)+")");
markup=run('companyDocsPage()');
assert.ok(markup.includes('業務フォルダ')&&markup.includes('検索タグ'),'editable folder and tags');
run("companyDocsDraftField('folderId','general/equipment')");
run("companyDocsDraftField('tags','備品,貸出')");
run("companyDocsDraftField('title','【DEMO】備品管理規程')");
run('companyDocsSave()');
assert.equal(calls.at(-1).method,'saveCompanyDocument');
assert.equal(calls.at(-1).args[1].folderId,'general/equipment');
assert.deepEqual(Array.from(calls.at(-1).args[1].tags),['備品','貸出']);
const busyBefore=calls.length;
run('companyDocsSave()');
assert.equal(calls.length,busyBefore,'double save blocked');
calls.at(-1).success({document:{...items[0],title:'【DEMO】備品管理規程',folderId:'general/equipment',
  revision:2,body:'本文',tags:['備品','貸出']}});
assert.equal(calls.at(-1).method,'getCompanyDocuments','save refreshes metadata');
assert.ok(toasts.includes('社内文書を保存しました'));
calls.at(-1).success({...data,items:[{...items[0],title:'【DEMO】備品管理規程',
  folderId:'general/equipment',revision:2,tags:['備品','貸出']},items[1],items[2]]});
run('companyDocsUi.data={...companyDocsUi.data,canManage:false,canInitialize:false,items:companyDocsUi.data.items.filter(x=>x.status==="公開")};companyDocsUi.selectedId="";companyDocsUi.detail=null;companyDocsUi.folderId="all";');
markup=run('companyDocsPage()');
assert.ok(!markup.includes('＋ 文書登録'),'normal users have no create action');
run('companyDocsBeginNew()');
assert.equal(run('companyDocsUi.editing'),false,'ordinary staff may not enter editor');
run("companyDocsSelect("+JSON.stringify(items[1].id)+")");
assert.equal(calls.at(-1).method,'getCompanyDocument');
run("state.sessionToken='SESSION-B'");
calls.at(-1).success({document:{...items[1],body:'別ユーザーのキャッシュに入れない'}});
assert.equal(run('companyDocsUi.detail'),null,'late cross-session response rejected');
run('resetCompanyDocsUi()');
assert.equal(run('companyDocsUi.data'),null,'session reset clears metadata and details');
console.log('PASS company document UI: folder hierarchy, category/status filters, body search, lazy detail, safe HTML, edit+tag save, double-submit guard, employee role and cross-session isolation');
