import fs from 'node:fs';
import vm from 'node:vm';

const clientFiles=['src/AppSomu.html','src/AppSomuGrowth.html','src/AppProjectHub.html','src/AppCore.html','src/AppHomePortal.html','src/AppOperations.html','src/AppPeopleMonthly.html','scripts/fixtures/AppLeaveDemo.html','src/AppQuotes.html','src/AppDocuments.html','src/AppCompanyDocs.html','src/AppOffice.html','src/AppFinance.html','src/AppFinanceAdvisor.html','src/AppFinanceWorkspace.html','src/AppFinanceGrid.html','src/AppCashFlow.html','src/AppCashFlowGrid.html','src/AppCashFlowBank.html','src/AppCashFlowBankGrid.html','src/AppCashFlowSandbox.html','src/AppAdmin.html','src/AppShell.html'];
const apiCalls=[];

function makeStorage(){
  const map=new Map();
  return {
    getItem:k=>map.has(k)?map.get(k):null,
    setItem:(k,v)=>map.set(k,String(v)),
    removeItem:k=>map.delete(k),
    clear:()=>map.clear()
  };
}

function makeClassList(){
  const set=new Set();
  return {
    add:(...xs)=>xs.forEach(x=>set.add(x)),
    remove:(...xs)=>xs.forEach(x=>set.delete(x)),
    toggle:(x,force)=>{if(force===true){set.add(x);return true}if(force===false){set.delete(x);return false}if(set.has(x)){set.delete(x);return false}set.add(x);return true},
    contains:x=>set.has(x)
  };
}

const elements=new Map();
let documentRef=null;
function makeElement(id){
  return {
    id:id||'',
    value:'',
    checked:false,
    textContent:'',
    innerHTML:'',
    hidden:false,
    disabled:false,
    type:'text',
    dataset:{},
    style:{},
    title:'',
    classList:makeClassList(),
    offsetParent:{},
    setAttribute(){},
    addEventListener(){},
    remove(){},
    click(){},
    closest(){return null},
    querySelector(){return null},
    querySelectorAll(){return []},
    contains(node){return node===this},
    focus(){if(documentRef)documentRef.activeElement=this}
  };
}
function getElement(id){
  if(!elements.has(id))elements.set(id,makeElement(id));
  return elements.get(id);
}

const documentElement=makeElement('html');
documentElement.dataset.theme='light';
const body=makeElement('body');
const document={
  documentElement,
  body,
  hidden:false,
  activeElement:body,
  addEventListener(){},
  getElementById:getElement,
  querySelector(){return null},
  querySelectorAll(){return []},
  createElement(){return makeElement('created')},
  contains(){return true}
};
documentRef=document;

let runnerProxy;
let successHandler=null;
let failureHandler=null;
const runner={
  withSuccessHandler(fn){successHandler=fn;return runnerProxy},
  withFailureHandler(fn){failureHandler=fn;return runnerProxy}
};
runnerProxy=new Proxy(runner,{
  get(target,prop){
    if(prop in target)return target[prop];
    return (...args)=>{
      apiCalls.push({method:String(prop),args});
      return runnerProxy;
    };
  }
});

const context=vm.createContext({
  console,
  apiCalls,
  Object,Array,Set,Map,JSON,RegExp,Error,Date,Math,Number,String,Boolean,
  document,
  window:{matchMedia:()=>({matches:true}),scrollTo(){}},
  history:{replaceState(){}},
  navigator:{platform:'CI',userAgent:'FM-WORKS-CLIENT-CONTRACT'},
  location:{hash:'#home'},
  localStorage:makeStorage(),
  sessionStorage:makeStorage(),
  google:{script:{run:runnerProxy}},
  invokeServerSuccess:data=>{
    const fn=successHandler;
    successHandler=null;
    if(typeof fn==='function')fn(data);
  },
  invokeServerFailure:error=>{
    const fn=failureHandler;
    failureHandler=null;
    if(typeof fn==='function')fn(error);
  },
  MutationObserver:class{observe(){} disconnect(){}},
  requestAnimationFrame:fn=>{fn();return 1},
  setTimeout:fn=>{if(typeof fn==='function')fn();return 1},
  clearTimeout(){},
  setInterval:()=>1,
  clearInterval(){},
  Blob:class{},
  URL:{createObjectURL:()=>'',revokeObjectURL(){}},
  Uint8Array,
  atob:s=>Buffer.from(s,'base64').toString('binary')
});

for(const file of clientFiles){
  const source=fs.readFileSync(file,'utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
  vm.runInContext(source,context,{filename:file});
}

const result=vm.runInContext(`
(() => {
  let failures=0;
  const expect=(name,condition,detail='')=>{
    if(!condition){failures++;console.error('FAIL:',name,detail)}
    else console.log('PASS:',name);
  };
  const lastCall=()=>apiCalls[apiCalls.length-1]||null;
  const resetCalls=()=>{apiCalls.length=0};

  state.publicConfig={needsSetup:false,pinLength:6,support:{}};
  state.sessionToken='SESSION_TOKEN';
  state.workLocation='在宅';

  document.getElementById('loginEmployeeId').value='fm0001';
  document.getElementById('loginPin').value='246810';
  document.getElementById('rememberLogin').checked=true;
  document.getElementById('loginSubmit').textContent='ログイン';
  resetCalls();
  submitLogin({preventDefault(){}});
  let call=lastCall();
  expect('login submits employee id + PIN through GAS contract',call&&call.method==='login'&&call.args[0]==='FM0001'&&call.args[1]==='246810'&&call.args[3]===true);

  resetCalls();
  performPunch('出勤');
  call=lastCall();
  expect('punch submits session/action/location through GAS contract',call&&call.method==='recordPunch'&&call.args[0]==='SESSION_TOKEN'&&call.args[1]==='出勤'&&call.args[2]==='在宅');
  state.busy=false;

  state.data={attendance:{state:'working',workLocation:'出社'}};
  state.workLocation='出社';
  resetCalls();
  selectWorkLocation('在宅');
  call=lastCall();
  expect('mid-shift location switch reaches dedicated server contract',call&&call.method==='recordWorkLocationChange'&&call.args[0]==='SESSION_TOKEN'&&call.args[1]==='在宅');
  state.busy=false;

  requestPayloadFromForm=()=>({type:'有給',startDate:'2026-10-08',endDate:'2026-10-08',reason:'私用',content:''});
  validateRequestForm=()=>null;
  hideRequestError=()=>{};
  document.getElementById('requestSubmitButton').textContent='申請する';
  resetCalls();
  submitRequestFromModal();
  call=lastCall();
  expect('request submission reaches submitRequest contract',call&&call.method==='submitRequest'&&call.args[0]==='SESSION_TOKEN'&&call.args[1].type==='有給');

  openConfirmDialog=(title,message,label,onConfirm)=>onConfirm();
  resetCalls();
  approveTeamRequest('R-100');
  call=lastCall();
  expect('approval reaches scoped approveRequest contract',call&&call.method==='approveRequest'&&call.args[1]==='R-100'&&call.args[2]==='APPROVE');

  state.monthly.data={yearMonth:'2026-09',reviewStatus:null};
  resetCalls();
  confirmMonthlyReviewFromPage();
  call=lastCall();
  expect('monthly confirmation reaches confirmMonthlyReview contract',call&&call.method==='confirmMonthlyReview'&&call.args[1]==='2026-09');

  document.documentElement.dataset.theme='light';
  toggleTheme();
  expect('theme toggle changes theme without server call',document.documentElement.dataset.theme==='dark');
  document.documentElement.dataset.fontSize='standard';
  setFontSizeMode('large');
  expect('large-text mode persists on the html root',document.documentElement.dataset.fontSize==='large'&&localStorage.getItem('fmworks.fontSize')==='large');
  toggleFontSize();
  expect('font size toggle returns to standard mode',document.documentElement.dataset.fontSize==='standard');
  const topNav=NAV.map(x=>x[0]);
  expect('main navigation includes project workspace and role-scoped management',JSON.stringify(topNav)===JSON.stringify(['home','attendance','worklog','projects','schedule','requests','quotes','documentHistory','companyDocs','finance','office','admin']));
  expect('admin navigation is permission-gated for non-admin users',visibleNav().every(x=>x[0]!=='admin'));
  expect('monthly is represented by attendance in the primary navigation',primaryNavIdForPage('monthly')==='attendance');
  expect('company calendar is represented by schedule in the primary navigation',primaryNavIdForPage('companyCalendar')==='schedule');
  expect('people administration is represented by admin in the primary navigation',primaryNavIdForPage('people')==='admin');
  expect('attendance workspace exposes today monthly and history views',attendanceWorkspaceTabs('history').includes('本日')&&attendanceWorkspaceTabs('history').includes('月間')&&attendanceWorkspaceTabs('history').includes('履歴'));

  // v0.14.0: quote creation is a self-service business action, not finance access.
  const quoteBeforeData=state.data;
  state.data={today:'2026-10-09',user:{employeeId:'FM9011',name:'架空社員',role:'USER'},
    permissions:{quoteWorkspace:true,officeWorkspace:false,financeWorkspace:false,adminConsole:false}};
  state.sessionToken='SESSION_TOKEN';
  expect('quote menu is visible to ordinary staff without accounting privileges',
    visibleNav().some(x=>x[0]==='quotes')&&!visibleNav().some(x=>x[0]==='office'||x[0]==='finance'));
  resetQuoteUi();
  quoteUi.data={setupRequired:false,vendors:[{code:'FI-0001',name:'架空法人A',invoice:'T1234567890123',address:'架空市'}],
    sequencesReady:['FI-0001'],quotes:[],canConfigure:false};
  quoteUi.identity=quoteIdentity_();quoteUi.at=Date.now();
  quoteUi.data.quotes=[{id:'DEMO-QUOTE-20261010-001',status:'下書き',vendorName:'【デモ】架空取引先',subject:'【デモ】テスト用見積',total:110000,quoteDate:'2026-10-10',updatedAt:'2026-10-10 08:40:00'}];
  expect('persisted demo drafts appear in creation entry',quotePage().includes('操作確認用のデモ見積が 1 件あります')&&quotePage().includes('デモ見積を開く'));
  expect('archive marks genuine stored demo records',documentHistoryPage().includes('doc-demo-tag')&&documentHistoryPage().includes('DEMO'));
  quoteUi.data.quotes=[];
  expect('creation page offers all four documents without status-dashboard clutter',
    quotePage().includes('書類を作成する')&&quotePage().includes('請求書')&&
    quotePage().includes('納品書')&&quotePage().includes('領収書')&&
    !quotePage().includes('今月の発行額'));
  expect('separate history route renders unified search and type filters',
    documentHistoryPage().includes('書類一覧・履歴')&&
    documentHistoryPage().includes('docHistorySearch')&&
    documentHistoryPage().includes('請求書'));

  resetCalls();
  quoteNew();
  expect('ordinary employee can open an editable quote without GAS roundtrip',
    quoteUi.mode==='edit'&&quotePage().includes('見積明細')&&apiCalls.length===0);
  const newQuoteUi=quotePage();
  expect('quote builder has live A4 preview and Excel-like item grid',
    newQuoteUi.includes("id='quoteLivePreview'")&&newQuoteUi.includes('qb-grid-head')&&
    newQuoteUi.includes('qb-preview-column')&&newQuoteUi.includes('正式発行'));
  expect('quote builder preview includes issuer and bank instructions',
    newQuoteUi.includes('Fusion Mind株式会社')&&newQuoteUi.includes('振込先'));
  quoteUi.editor.vendorCode='FI-0001';
  quoteUi.editor.lines=[{description:'開発支援',quantity:'2',unit:'ヶ月',price:'300000'},
    {description:'値引き',quantity:'2',unit:'式',price:'-50000'}];
  quoteUi.key='CLIENT_QUOTE_KEY000001';
  const localSum=quoteTotals_(quoteUi.editor.lines);
  expect('local preview matches source Excel totals',localSum.subtotal===500000&&
    localSum.tax===50000&&localSum.total===550000);
  quoteSaveDraft();
  let quoteCall=lastCall();
  expect('client posts all quote data to authenticated draft endpoint',
    quoteCall&&quoteCall.method==='saveQuoteDraft'&&quoteCall.args[0]==='SESSION_TOKEN'&&
    quoteCall.args[1].vendorCode==='FI-0001');
  invokeServerSuccess({ok:true,id:'QUOTE-DRAFT',revision:1,status:'下書き'});
  expect('newly saved draft holds persisted ID and is eligible for issuance',
    quoteUi.editor.id==='QUOTE-DRAFT'&&!quoteUi.dirty&&quoteUi.editor.revision===1);
  quoteUpdateField('subject','導入支援の見積');
  expect('editing subject updates live preview without additional GAS calls',
    quoteUi.dirty&&quotePreviewDocument_(quoteUi.editor).includes('導入支援の見積')&&apiCalls.filter(x=>x.method==='saveQuoteDraft').length===1);
  quoteUpdateLine(0,'quantity','3');
  expect('editing quantity recalculates preview instantly',
    quotePreviewDocument_(quoteUi.editor).includes('900,000円')&&quoteTotals_(quoteUi.editor.lines).subtotal===800000);
  quoteUi.editor.note='<img src=x onerror=alert(1)>';
  expect('live estimate preview escapes spreadsheet-sourced HTML',
    quotePreviewDocument_(quoteUi.editor).includes('&lt;img')&&!quotePreviewDocument_(quoteUi.editor).includes('<img src=x'));
  const lineCountBefore=quoteUi.editor.lines.length;
  quoteDuplicateLine(0);
  expect('Excel-like duplicate row copies editable values',quoteUi.editor.lines.length===lineCountBefore+1&&
    quoteUi.editor.lines[1].description===quoteUi.editor.lines[0].description);
  quoteMoveLine(1,-1);
  expect('Excel-like row reorder preserves line items',quoteUi.editor.lines.length===lineCountBefore+1);
  quoteRemoveLine(0);
  expect('row deletion restores original line count',quoteUi.editor.lines.length===lineCountBefore);
  quoteUi.details={header:{...quoteUi.editor,status:'出力失敗',number:'FI-0001-0002',ownerName:'架空社員',
    vendorName:'架空法人A',subtotal:500000,taxAmount:50000,total:550000},lines:quoteUi.editor.lines};
  quoteUi.mode='detail';
  const failedQuoteView=quotePage();
  expect('failed exports retain same number, provide retry and never offer download',
    failedQuoteView.includes('FI-0001-0002')&&failedQuoteView.includes('同じ番号で出力を再試行')&&
    !failedQuoteView.includes('PDFを保存'));
  quoteUi.details.header.status='発行処理中';
  expect('running output does not expose nonexistent document download',
    quotePage().includes('発行処理中')&&!quotePage().includes('Excelを保存'));
  quoteUi.details.header.status='発行済';
  quoteUi.data.documentsSetupRequired=false;
  quoteUi.data.quotes=[{...quoteUi.details.header,id:'QUOTE-DRAFT',number:'FI-0001-0002',quoteId:'QUOTE-DRAFT'}];
  quoteUi.data.relatedDocs=[{id:'DOC-INVOICE',kind:'invoice',quoteId:'QUOTE-DRAFT',
    number:'INV-2026-0001',vendorName:'架空法人A',subject:'導入',total:550000,status:'発行済',
    updatedAt:'2026-10-09 10:00:00',documentDate:'2026-10-09'}];
  const historyWithDocuments=documentHistoryPage();
  expect('archive mixes quote and issued invoice with clear document labels',
    historyWithDocuments.includes('FI-0001-0002')&&historyWithDocuments.includes('INV-2026-0001'));
  documentSetFilter('invoice');
  expect('invoice archive filter excludes estimates',documentRowsClient_().length===1&&
    documentRowsClient_()[0].kind==='invoice');
  documentSetFilter('all');
  expect('conversion buttons appear for issued quotes',quotePage().includes('請求書を作成')&&
    quotePage().includes('領収書を作成'));
  documentCreateFromQuote('receipt','QUOTE-DRAFT');
  expect('receipt issuance always requires explicit payment confirmation in its UI',
    document.getElementById('modalRoot').innerHTML.includes('docPaidConfirmed')&&
    document.getElementById('modalRoot').innerHTML.includes('入金を確認'));
  closeModal();

  expect('both downloads become available after finalized issuance',
    quotePage().includes('PDFを保存')&&quotePage().includes('Excelを保存'));
  const persistedQuote=quotePage();
  expect('issued quotation reuses the same full document preview as editor',
    persistedQuote.includes('qb-issued-surface')&&persistedQuote.includes('qb-paper')&&
    persistedQuote.includes('件名：')&&persistedQuote.includes('Fusion Mind株式会社'));
  expect('issued quotation displays server-recorded price and total, not an accidental client recalculation',
    persistedQuote.includes('550,000円')&&!persistedQuote.includes('800,000円'));
  const priorVendorName=quoteUi.data.vendors[0].name;
  quoteUi.data.vendors[0].name='変更後の取引先表示名';
  const frozenView=quotePage();
  expect('previously issued quotation keeps its customer name after vendor master changes',
    frozenView.includes('架空法人A')&&!frozenView.includes('変更後の取引先表示名'));
  quoteUi.data.vendors[0].name=priorVendorName;
  resetQuoteUi();
  state.data=quoteBeforeData;
  resetCalls();

  // v0.18.2: General Affairs now opens its own loading and CRUD workspace, not legacy planning.
  const beforeOfficeData=state.data;
  const beforeOfficePage=state.page;
  state.data={today:'2026-10-08',user:{employeeId:'FM9000',displayName:'一般社員',department:'開発'},
    permissions:{adminConsole:false,employeeAdmin:false,officeWorkspace:false}};
  state.officeUi={selected:'overview',recordId:'',query:'',status:'all'};
  state.page='home';
  resetCalls();
  expect('general employee navigation excludes finance, general affairs and settings',
    !visibleNav().some(x=>['office','finance','admin'].includes(x[0])));
  expect('all employees can access estimates, leave and business reports',
    visibleNav().some(x=>x[0]==='quotes')&&visibleNav().some(x=>x[0]==='requests'));
  expect('four sidebar groups separate daily activity, forms, finance, settings',
    NAV_GROUPS.length===4&&NAV_GROUPS[0].label==='日常業務'&&
    NAV_GROUPS[1].label==='申請・帳票'&&NAV_GROUPS[2].label==='管理業務'&&
    NAV_GROUPS[3].label==='システム管理');
  const officeDenied=officePage();
  expect('unauthorized general affairs is blocked even through direct page call',
    officeDenied.includes('権限')&&!officeDenied.includes('v15-affairs-grid'));
  state.data.permissions.officeWorkspace=true;
  const officePlanning=officePage();
  expect('general affairs shows its own loading state without legacy planning flicker',
    officePlanning.includes('総務')&&officePlanning.includes('読み込んでいます')&&
    !officePlanning.includes('設計中')&&!officePlanning.includes('v15-affairs-grid')&&
    !officePlanning.includes('finance-overview-row')&&!officePlanning.includes('quote-record'));
  expect('loading state has no unverified save button',
    !officePlanning.includes('保存する')&&!officePlanning.includes('新規資産登録'));
  somuUi.loaded=true;
  somuUi.data={setupRequired:false,assets:[],loans:[],purchases:[],documents:[],canApprove:false};
  const officeReady=officePage();
  expect('general affairs renders 8 grouped destinations and action-centered home',
    officeReady.includes('somu-workspace')&&officeReady.includes('今日、対応すること')&&
    officeReady.includes('管理台帳を開く')&&officeReady.includes('契約・更新')&&
    officeReady.includes('施設・車両')&&officeReady.includes('書類整理')&&
    (officeReady.match(/aria-current=/g)||[]).length===8);
  somuReset();
  state.data.permissions.adminConsole=true;
  expect('administrator can open both general affairs and system settings',
    visibleNav().some(x=>x[0]==='office')&&visibleNav().some(x=>x[0]==='admin'));
  expect('planning operations have no GAS roundtrip',apiCalls.length===0);

  state.data.permissions.financeWorkspace=false;
  expect('non-accounting staff cannot see finance page or route',
    !visibleNav().some(x=>x[0]==='finance')&&financePage().includes('権限'));
  resetCalls();loadFinanceOverview();
  expect('unauthorized client cannot request finance overview',apiCalls.length===0);
  state.data.permissions.financeWorkspace=true;
  expect('accounting staff can see finance route without admin permissions',
    visibleNav().some(x=>x[0]==='finance')&&financePage().includes('経理'));
  resetCalls();loadFinanceOverview();
  call=lastCall();
  expect('finance overview uses server-scoped method',call&&call.method==='getFinanceOverview'&&call.args[0]==='SESSION_TOKEN');
  resetFinanceUi();resetCalls();loadMyFinanceItems();
  call=lastCall();
  expect('all employees fetch only own expense and travel history',call&&call.method==='getMyFinanceItems'&&call.args[0]==='SESSION_TOKEN');
  const financeFakeExpense={
    id:'EXP-FAKE-1',employeeId:'FM9000',employeeName:'架空社員',
    vendor:'安全な取引先',item:'<img src=x onerror=alert(1)>',
    usedOn:'2026-10-08',category:'消耗品費',amount:'2500',purpose:'確認',
    paymentMethod:'立替',receiptRef:'REC-001',status:'差戻し',
    returnReason:'使途を修正してください'
  };
  state.data.permissions.financeWorkspace=true;
  financeUi.overview={expenses:[financeFakeExpense],travels:[],receipts:[],
    receiptMatches:{'EXP-FAKE-1':{status:'AMOUNT_MISMATCH',label:'金額差異',claimAmount:2500,recordedAmount:2000}}};
  const htmlDetail=financeDetailRows_('expense',financeFakeExpense);
  expect('finance record details escape untrusted spreadsheet markup',
    htmlDetail.includes('&lt;img')&&!htmlDetail.includes('<img src=x'));
  expect('finance detail shows receipt reference and mismatch evidence',
    htmlDetail.includes('REC-001')&&htmlDetail.includes('金額差異')&&htmlDetail.includes('2,000円'));
  financeVisual.match='ISSUE';
  expect('finance receipt discrepancy filter isolates mismatched references',
    financeVisibleItems_('expense').length===1);
  financeVisual.match='MATCHED';
  expect('finance match filter excludes genuine discrepancies',
    financeVisibleItems_('expense').length===0);
  financeVisual.match='ALL';
  expect('finance inline detail escapes spreadsheet markup',
    financeInspectorHtml_('expense',financeFakeExpense).includes('金額差異')&&
    !financeInspectorHtml_('expense',financeFakeExpense).includes('<img src=x'));
  const financeRowsHtml=financeOverviewRows('expense');
  expect('financial approval view includes detail action for every record',
    financeRowsHtml.includes('financeSelectRecord(')&&financeRowsHtml.includes('finance-ledger-table'));
  financeUi.mine={setupRequired:false,expenses:[financeFakeExpense],travels:[]};
  expect('returned finance claim offers an owner resubmission path',
    financeMyRow('expense',financeFakeExpense).includes('修正して再申請'));
  resetCalls();
  openFinanceForm('expense','EXP-FAKE-1');
  expect('returned claim editing retains original row id and prepopulates fields',
    financeActiveForm&&financeActiveForm.editId==='EXP-FAKE-1'&&
    state.page==='financeEntry'&&financeEntryPage().includes('安全な取引先'));
  document.getElementById('fin-vendor').value='安全な取引先';
  document.getElementById('fin-item').value='消耗品';
  document.getElementById('fin-amount').value='2500';
  document.getElementById('fin-usedOn').value='2026-10-08';
  document.getElementById('fin-purpose').value='確認';
  submitFinanceForm();
  call=lastCall();
  expect('finance resubmission uses dedicated server endpoint with original id',
    call&&call.method==='resubmitFinanceRequest'&&call.args[0]==='SESSION_TOKEN'&&
    call.args[1]==='expense'&&call.args[2]==='EXP-FAKE-1');
  resetFinanceUi();
  // v0.15.0: dashboard access, query filtering and self-approval protections.
  state.data.permissions.officeWorkspace=true;
  state.data.permissions.financeWorkspace=true;
  financeVisual={query:'',status:'ALL'};
  const pendingFake={...financeFakeExpense,id:'EXP-PENDING',status:'承認待ち',
    employeeId:'OTHER',employeeName:'架空他社員'};
  financeUi.overview={setupRequired:false,expenses:[financeFakeExpense,pendingFake],travels:[],
    receipts:[],totals:{expensePending:1,travelPending:0,expenseToSettle:0,
      receipt:0,expenseHidden:0,travelHidden:0,receiptHidden:0}};
  expect('new accounting portal prioritizes pending work and bulk entry',financePage().includes('今日の経理業務')&&financePage().includes('表にまとめて貼り付ける')&&financePage().includes('承認待ち')&&financePage().includes('1件'));
  expect('accounting dashboard reads real response totals rather than hardcoded sample values',
    financeLegacyPage().includes('v15-finance-dashboard')&&financeLegacyPage().includes('承認待ち')&&
    financeLegacyPage().includes('1件')&&financeLegacyPage().includes('financeTableRows'));
  resetCalls();
  financeSearchVisible('No matching record');
  expect('accounting query filter is local and has a proper empty state',
    financeVisibleItems_('expense').length===0&&apiCalls.length===0);
  financeVisual.query='';
  financeSetVisualFilter('承認待ち');
  expect('accounting status filter finds pending approvals without extra requests',
    financeVisibleItems_('expense').length===1&&apiCalls.length===0);
  financeVisual.status='ALL';
  resetCalls();
  financeSelectRecord('expense','EXP-PENDING');
  expect('finance selection updates local selected detail without GAS roundtrip',
    financeUi.selectedIds.expense==='EXP-PENDING'&&apiCalls.length===0);
  expect('finance screen has table + inline inspector + date filter',
    financeLegacyPage().includes('financeSelectedDetail')&&financeLegacyPage().includes('finance-ledger-table')&&
    financeLegacyPage().includes('financeSetMonthFilter('));
  const unchangedReal=financeUi.overview;
  resetCalls();financeToggleDemo();
  expect('finance demo uses fabricated data without overwriting the real cache',
    financeUi.demo===true&&financeUi.overview===unchangedReal&&financeVisibleItems_('expense').length===6);
  expect('finance demo is visibly labeled and forbids saving or approval',
    financeLegacyPage().includes('サンプル表示中｜架空データ')&&
    financeInspectorHtml_('expense',financeVisibleItems_('expense')[0]).includes('サンプルでは承認')&&
    financeLegacyPage().includes('経費記録を追加'));
  financeUi.tab='expense';financeSetMonthFilter('2026-09');
  expect('demo month filter uses only loaded synthetic rows',
    financeVisibleItems_('expense').length===0&&apiCalls.length===0);
  financeSetMonthFilter('2026-10');
  expect('demo local month filter restores relevant records',
    financeVisibleItems_('expense').length===6&&apiCalls.length===0);
  financeVisual.query='';
  financeSearchVisible('架空社員F');
  expect('demo local text search is instantaneous and server-free',
    financeVisibleItems_('expense').length===1&&apiCalls.length===0);
  financeVisual.query='';financeVisual.match='ISSUE';
  expect('demo detects unmatched and discrepant receipts without API calls',
    financeVisibleItems_('expense').length===3&&apiCalls.length===0);
  resetCalls();financeSubmitDecision('expense','DEMO-EXP-001','APPROVE');
  financeSubmitSettlement('expense','DEMO-EXP-003');
  expect('attempted demo approval or settlement makes zero GAS requests',apiCalls.length===0);
  financeUi.demo=false;financeUi.demoData=null;
  financeVisual={query:'',status:'ALL',match:'ALL',month:''};
  expect('demo leaves actual financial records untouched',financeUi.overview===unchangedReal&&
    financeVisibleItems_('expense').length===2);
  expect('required finance amount fields require 1 yen at the browser level',
    financeFormField(FINANCE_FORM_FIELDS.expense.find(x=>x[0]==='amount')).includes('min="1"')&&
    financeFormField(FINANCE_FORM_FIELDS.receipt.find(x=>x[0]==='amount')).includes('min="1"'));
  const confirmedExpense={id:'EXP-CONFIRMED',employeeId:'FM9000',employeeName:'架空社員',
    item:'登録確認用文具',vendor:'架空店舗',usedOn:'2026-10-10',amount:1900,status:'承認待ち'};
  financeUi.mine={setupRequired:false,expenses:[],travels:[]};
  financeUi.mineAt=1;
  const testSave=financeApplyServerSavedRecord_('expense',{ok:true,id:confirmedExpense.id,record:confirmedExpense});
  expect('GAS-confirmed expense appears immediately in own history before roundtrip refresh',
    testSave&&financeUi.mine.expenses.some(x=>x.id===confirmedExpense.id)&&financeUi.mineAt>1);
  financeApplyServerSavedRecord_('expense',{ok:true,id:confirmedExpense.id,duplicate:true,record:confirmedExpense});
  expect('idempotent callback does not insert duplicate finance history entries',
    financeUi.mine.expenses.filter(x=>x.id===confirmedExpense.id).length===1);
  expect('failed or incomplete save responses do not appear as registered',
    financeApplyServerSavedRecord_('expense',{ok:false,id:'EXP-BAD',record:{id:'EXP-BAD'}})===false&&
    !financeUi.mine.expenses.some(x=>x.id==='EXP-BAD'));
  const originalFinanceTab=financeUi.tab;
  financeUi.overview={setupRequired:false,expenses:[],travels:[],receipts:[],totals:{receipt:0}};
  const recorded={id:'REC-CONFIRMED',creatorId:'FM9000',creatorName:'架空経理',
    usedOn:'2026-10-10',vendor:'架空店',item:'紙',amount:2500,paid:'未'};
  financeApplyServerSavedRecord_('receipt',{ok:true,id:recorded.id,record:recorded});
  expect('GAS-confirmed receipt appears in finance without second roundtrip',
    financeUi.overview.receipts[0].id===recorded.id&&financeUi.overview.totals.receipt===1);
  financeUi.tab=originalFinanceTab;
  resetCalls();
  financeActiveForm={kind:'expense',key:'FMTESTKEY00000001',editId:'',source:{},changed:false};
  document.getElementById('fin-usedOn').value='2026-10-10';
  document.getElementById('fin-vendor').value='架空店舗';
  document.getElementById('fin-item').value='紙';
  document.getElementById('fin-category').value='消耗品費';
  document.getElementById('fin-amount').value='2500';
  document.getElementById('fin-purpose').value='架空テスト';
  submitFinanceForm();
  expect('finance submission has a busy state while awaiting server confirmation',
    financeUi.busy===true&&document.getElementById('financeSubmitButton').disabled&&
    document.getElementById('financeSubmitButton').textContent==='登録しています…');
  invokeServerSuccess({ok:false});
  expect('a server response without ok:true leaves the form available and shows error',
    financeUi.busy===false&&financeActiveForm!==null&&
    !document.getElementById('financeFormError').hidden&&
    !document.getElementById('financeSubmitButton').disabled);
  financeActiveForm=null;

  // Risk-gate: all three entry forms must match the server's non-truncating limits.
  financeActiveForm={kind:'expense',key:'FRONT-EXP-001',editId:'',source:{},changed:false};
  expect('expense fields restrict input to exact server lengths',
    financeFormField(FINANCE_FORM_FIELDS.expense.find(f=>f[0]==='vendor')).includes('maxlength="120"')&&
    financeFormField(FINANCE_FORM_FIELDS.expense.find(f=>f[0]==='purpose')).includes('maxlength="500"'));
  financeActiveForm={kind:'travel',key:'FRONT-TR-001',editId:'',source:{},changed:false};
  expect('travel description and outcome have independently validated limits',
    financeFormField(FINANCE_FORM_FIELDS.travel.find(f=>f[0]==='purpose')).includes('maxlength="600"')&&
    financeFormField(FINANCE_FORM_FIELDS.travel.find(f=>f[0]==='outcome')).includes('maxlength="1000"'));
  financeActiveForm={kind:'receipt',key:'FRONT-REC-001',editId:'',source:{},changed:false};
  expect('finance receipt input is limited to the backend field length',
    financeFormField(FINANCE_FORM_FIELDS.receipt.find(f=>f[0]==='invoiceNo')).includes('maxlength="32"')&&
    financeFormField(FINANCE_FORM_FIELDS.receipt.find(f=>f[0]==='vendor')).includes('maxlength="120"'));
  financeActiveForm=null;
  resetCalls();financeUi.demo=true;
  openFinanceForm('expense');
  expect('sample mode forbids opening live employee expense entry',
    financeActiveForm===null&&apiCalls.length===0);
  financeActiveForm={kind:'expense',key:'FRONT-EXP-002',editId:'',source:{},changed:false};
  submitFinanceForm();
  expect('sample mode also rejects direct submit attempts without GAS RPC',apiCalls.length===0);
  financeActiveForm=null;financeUi.demo=false;
  financeUi.overview={setupRequired:false,expenses:[],travels:[],receipts:[],totals:{receipt:0}};
  financeUi.at=0;financeUi.identity=financeIdentity();financeUi.revOverview=0;financeUi.loading=false;
  resetCalls();loadFinanceOverview({force:true,silent:true});
  expect('fresh finance overview starts a server request',financeUi.loading&&apiCalls.length===1);
  const staleReceipt={id:'REC-RACE-001',creatorId:'FM0001',item:'保存済文具',amount:4500,
    usedOn:'2026-10-10',vendor:'架空店舗',payer:'社員A',paid:'未'};
  financeApplyServerSavedRecord_('receipt',{ok:true,id:staleReceipt.id,record:staleReceipt});
  invokeServerSuccess({setupRequired:false,expenses:[],travels:[],receipts:[],totals:{receipt:0}});
  expect('out-of-order finance read cannot erase newly saved receipt',
    financeUi.overview.receipts[0].id===staleReceipt.id&&apiCalls.length===2&&financeUi.loading);
  invokeServerSuccess({setupRequired:false,expenses:[],travels:[],receipts:[staleReceipt],
    totals:{receipt:1},performance:{serverMs:12}});
  expect('finance refresh resolves to current confirmed data after old response',
    financeUi.overview.receipts[0].id===staleReceipt.id&&financeUi.loading===false);
  financeUi.mine={setupRequired:false,expenses:[],travels:[]};
  financeUi.mineAt=0;financeUi.revMine=0;financeUi.ownLoading=false;
  resetCalls();loadMyFinanceItems({force:true,silent:true});
  expect('own expense history request starts',financeUi.ownLoading&&apiCalls.length===1);
  const ownSaved={id:'EXP-RACE-001',employeeId:'FM0001',employeeName:'社員A',status:'承認待ち',
    vendor:'架空文具店',item:'文具',amount:3200,usedOn:'2026-10-10'};
  financeApplyServerSavedRecord_('expense',{ok:true,id:ownSaved.id,record:ownSaved});
  invokeServerSuccess({setupRequired:false,expenses:[],travels:[]});
  expect('old employee history cannot erase confirmed expense while refresh is pending',
    financeUi.mine.expenses[0].id===ownSaved.id&&apiCalls.length===2&&financeUi.ownLoading);
  invokeServerSuccess({setupRequired:false,expenses:[ownSaved],travels:[]});
  expect('post-write employee history eventually uses fresh server rows',
    financeUi.mine.expenses[0].id===ownSaved.id&&!financeUi.ownLoading);
  financeUi.overview={setupRequired:false,expenses:[pendingFake],travels:[],receipts:[],
    receiptMatches:{[pendingFake.id]:{status:'MULTIPLE_CLAIMS',
      label:'同じ証憑番号の申請が複数件（重複精算に注意）'}}};
  financeUi.tab='expense';financeVisual={query:'',status:'ALL',match:'ISSUE',month:''};
  expect('accounting dashboard displays duplicate-claim warning in filter and detail',
    financeVisibleItems_('expense').length===1&&
    financeOverviewRows('expense').includes('申請複数')&&
    financeInspectorHtml_('expense',pendingFake).includes('重複精算に注意'));
  financeVisual={query:'',status:'ALL',match:'ALL',month:''};

  // A pending finance write freezes fields. On failure they are usable again,
  // with the same idempotency key, and repeated clicks do not issue extra RPC.
  resetCalls();
  financeUi.busy=false;financeUi.demo=false;
  const lastSubmitForm=document.getElementById('financeEntryForm');
  const vendorInput=document.getElementById('fin-vendor');
  const submitButton=document.getElementById('financeSubmitButton');
  vendorInput.disabled=false;submitButton.disabled=false;
  lastSubmitForm.querySelectorAll=()=>[vendorInput,submitButton];
  financeActiveForm={kind:'expense',key:'SAFE-RETRY-KEY-20261010',editId:'',source:{},changed:false};
  submitFinanceForm();
  expect('pending finance write freezes editable controls',
    financeUi.busy&&vendorInput.disabled&&submitButton.disabled);
  submitFinanceForm();
  expect('double-submit during a pending write produces only one RPC',apiCalls.length===1);
  invokeServerFailure(new Error('意図的な通信エラー'));
  expect('failed finance write restores all controls without losing the retry key',
    !financeUi.busy&&!vendorInput.disabled&&!submitButton.disabled&&
    financeActiveForm.key==='SAFE-RETRY-KEY-20261010');
  lastSubmitForm.querySelectorAll=()=>[];
  financeActiveForm=null;
  financeUi.overview={setupRequired:false,expenses:[pendingFake],travels:[],receipts:[]};
  financeUi.tab='expense';financeVisual={query:'',status:'ALL',match:'ALL',month:''};
  expect('desktop ledger selection button does not double-fire from its parent row',
    financeOverviewRows('expense').includes('event.stopPropagation();financeSelectRecord('));
  const originalCloseModal=closeModal;
  let modalCloseCalls=0;
  closeModal=()=>{modalCloseCalls++;};
  financeUi.busy=true;
  financeCloseModalIfIdle();
  expect('finance modal cannot close while save or approval is pending',modalCloseCalls===0);
  financeUi.busy=false;
  financeCloseModalIfIdle();
  expect('finance modal can close once the operation has finished',modalCloseCalls===1);
  closeModal=originalCloseModal;
  financeUi.auditWarning='';
  const auditWarningExposed=financeTrackAuditResult_({ok:true,id:'EXP-AUDIT-TEST',auditRecorded:false});
  expect('audit failure notice distinguishes stored data from unconfirmed audit record',
    auditWarningExposed&&financeUi.auditWarning.includes('EXP-AUDIT-TEST')&&
    financeUi.auditWarning.includes('保存済み')&&financeUi.auditWarning.includes('重複登録'));
  expect('finance and employee screens display persistent audit warning',
    financeLegacyPage().includes('EXP-AUDIT-TEST')&&financeSelfSection().includes('EXP-AUDIT-TEST'));
  financeUi.auditWarning='';
  const financeModal={querySelector:selector=>selector==='[data-finance-modal="true"]'?{}:null};
  financeUi.busy=true;
  expect('Escape gating correctly identifies a busy finance dialog',
    financeModalBusy_(financeModal)===true);
  financeUi.busy=false;
  expect('finance dialog can close after the operation finishes',
    financeModalBusy_(financeModal)===false);
  // Keyboard shortcut regression: same test checks the actual listener, not only the helper.
  document.addEventListener=(name,fn)=>{if(name==='keydown')document.financeKeydownListener=fn;};
  globalKeysBound=false;
  initGlobalKeyboardShortcuts();
  const modalHost=document.getElementById('modalRoot');
  modalHost.innerHTML='<section data-finance-modal="true"></section>';
  modalHost.querySelector=financeModal.querySelector;
  const originalCloseModalEsc=closeModal;
  let modalEscCloses=0;
  closeModal=()=>{modalEscCloses++;};
  financeUi.busy=true;
  document.financeKeydownListener({key:'Escape',target:document.body,preventDefault(){}});
  expect('Escape cannot close finance confirmation while server write is pending',
    modalEscCloses===0);
  financeUi.busy=false;
  document.financeKeydownListener({key:'Escape',target:document.body,preventDefault(){}});
  expect('Escape closes finance confirmation after server finishes',
    modalEscCloses===1);
  closeModal=originalCloseModalEsc;
  modalHost.innerHTML='';
  modalHost.querySelector=()=>null;

  // Expense analysis stays separate from existing bookkeeping and uses local-only filters.
  financeUi.insightMode=true;financeUi.insightYear=2026;
  financeUi.insights={ok:true,year:2026,total:4200,count:2,months:[
    {name:'2026-09',amount:1200,count:1},{name:'2026-10',amount:3000,count:1}],
    payers:[{name:'架空社員A',amount:1200,count:1},{name:'架空社員B',amount:3000,count:1}],
    payerMonths:[{month:'2026-09',payer:'架空社員A',amount:1200,count:1},{month:'2026-10',payer:'架空社員B',amount:3000,count:1}],
    vendors:[{name:'架空備品店',amount:1200,count:1}],items:[{name:'文具',amount:1200,count:1}],
    records:[{date:'2026-10-02',payer:'架空社員B',vendor:'架空交通社',item:'交通費',amount:3000,method:'現金',note:''},
      {date:'2026-09-12',payer:'架空社員A',vendor:'架空備品店',item:'文具',amount:1200,method:'会社カード',note:''}]
  };
  expect('finance insights display a distinct read-only workspace with honest source accounting',
    financePage().includes('支出の見える化')&&financePage().includes('旧台帳')&&
    financePage().includes('4,200円')&&financePage().includes('支払者別'));
  financeInsightPickPayer('架空社員A');
  expect('payer drilldown filters item rows in-browser without a server request',
    financeInsightRows().includes('架空備品店')&&!financeInsightRows().includes('架空交通社'));
  const filteredInsight=financePage();
  expect('payer selection changes monthly totals to the verified 1,200 yen for the chosen payer',
    filteredInsight.includes('支払者：架空社員A')&&filteredInsight.includes('1,200円')&&
    filteredInsight.includes('finance-advisor-month'));
  financeUi.insightPayer='';financeUi.insightMode=false;financeUi.insights=null;
  expect('normal finance approvals remain available after closing expense insight mode',
    financeLegacyPage().includes('経理記録の一覧'));
  expect('travel evidence and official invoice lookup controls are visible in their correct forms',
    financeTravelEvidencePanel().includes('計算式と支給根拠を確認')&&
    financeInvoiceLookupPanel().includes('適格請求書番号'));
  financeActiveForm={kind:'travel',key:'CLIENT-TRAVEL-20261010',editId:'',source:{},changed:false};
  const tripNote=document.getElementById('fin-note');
  const tripAllowance=document.getElementById('fin-requestedAllowance');
  tripNote.value='既存の備考';tripAllowance.value='0';
  financeUi.travelEstimate={status:'REFERENCE',total:18500,note:'[旅費試算2025-12-01/参考] 日当6,500円、宿泊実費12,000円'};
  financeUseTravelEstimate();
  expect('explicit user action records an auditable travel breakdown and proposed allowance',
    tripNote.value.includes('既存の備考')&&tripNote.value.includes('旅費試算')&&
    tripAllowance.value==='18500');
  financeActiveForm=null;
  resetCalls();
  document.getElementById('fin-invoiceNo').value='T1234567890123';
  financeLookupInvoice();
  expect('issuer search uses authenticated server RPC rather than browser-side API keys',
    apiCalls.length===1&&lastCall().method==='lookupFinanceInvoiceIssuer');
  invokeServerSuccess({status:'UNCONFIGURED',number:'T1234567890123',message:'ID未設定'});
  expect('unconfigured NTA integration does not hallucinate a business name',
    document.getElementById('financeInvoiceResult').innerHTML.includes('ID未設定')&&
    !document.getElementById('financeInvoiceResult').innerHTML.includes('公表された取引先名称'));
  financeUi.invoiceIssuer=null;
  const safeOffice=officePage();
  expect('finance records never appear in general affairs workspace',
    !safeOffice.includes('EXP-PENDING')&&!safeOffice.includes('2,500円'));
  quoteUi.data={setupRequired:false,canConfigure:true,vendors:[{name:'架空ベンダー',code:'FI-0001'}],sequencesReady:[]};
  expect('administration contains quote vendors and numbering setup section',
    ADMIN_CATEGORIES.some(x=>x.id==='quotes')&&
    quoteAdministrationSection_().includes('取引先マスタ'));
  state.data.permissions.financeWorkspace=false;
  expect('finance records are guarded for non-operators',
    financePage().includes('権限')&&!financePage().includes('EXP-PENDING'));
  resetFinanceUi();
  state.data=beforeOfficeData;
  state.page=beforeOfficePage;

  state.data={today:'2026-10-08',user:{employeeId:'FM0001',displayName:'青木さん',fullName:'青木 悠真'},permissions:{adminConsole:true}};
  state.attendancePreview={data:null,key:'',at:0,loading:false,error:''};
  const attendanceSample=attendanceDisplayPreview();
  expect('empty admin attendance gets a browser-only QA sample',attendanceSample&&attendanceSample._sample===true);
  expect('attendance QA sample covers issue and worklog-difference states',attendanceSample.daily.some(x=>x.issue)&&attendanceSample.daily.some(x=>x.worklogIssue));
  expect('attendance QA sample covers leave and remote-work states',attendanceSample.daily.some(x=>x.leaveStatus==='有給')&&attendanceSample.daily.some(x=>x.remote===true));

  state.data={
    today:'2026-10-08',
    user:{employeeId:'FM0001',displayName:'青木さん',fullName:'青木 悠真'},
    permissions:{adminConsole:true},
    attendance:{state:'off',workedMinutes:0,worked:'0時間00分',clockIn:'',clockOut:'',history:[]},
    projects:[]
  };
  state.worklog={date:'2026-10-08',loadedDate:'2026-10-08',items:[],totalMinutes:0,loading:false,error:''};
  const worklogSample=worklogDisplayData();
  expect('empty admin worklog gets browser-only QA sample',worklogSample&&worklogSample.sample===true&&worklogSample.items.length===4);
  const worklogSegments=worklogTimelineSegments(worklogSample);
  expect('worklog QA sample includes a lunch break',worklogSegments.some(x=>x.type==='break'&&x.start===720&&x.end===780));
  expect('worklog QA sample exposes a 90-minute missing interval',worklogSegments.some(x=>x.type==='gap'&&(x.end-x.start)===90));
  const worklogHtml=worklogPage();
  expect('worklog hybrid renders timeline quick input and table',worklogHtml.includes('本日のタイムライン')&&worklogHtml.includes('クイック入力')&&worklogHtml.includes('本日の工数一覧'));

  state.data.projects=[{name:'テスト案件A',status:'進行中'}];
  document.getElementById('wlQuickProject').value='テスト案件A';
  document.getElementById('wlQuickCategory').value='UI設計';
  document.getElementById('wlQuickStart').value='16:30';
  document.getElementById('wlQuickEnd').value='18:00';
  document.getElementById('wlQuickDescription').value='工数画面の確認';
  resetCalls();
  saveQuickWorklog();
  call=lastCall();
  expect('quick worklog input reaches existing saveWorklog contract',call&&call.method==='saveWorklog'&&call.args[0]==='SESSION_TOKEN'&&call.args[1].project==='テスト案件A'&&call.args[1].start==='16:30'&&call.args[1].end==='18:00');
  state.busy=false;

  // One GAS call should fill a 14-day window, not just one selected day.
  invalidatePageCache('worklog');
  state.worklog.date='2026-10-08';
  state.data.projects=[];
  resetCalls();
  loadWorklogs();
  call=lastCall();
  expect('worklog fetch covers month and surrounding weeks',call&&call.method==='getWorklogs'&&call.args[1].start==='2026-09-20'&&call.args[1].end==='2026-11-07'&&call.args[1].includeProjects===true);
  invokeServerSuccess({
    items:[
      {id:'W-7',date:'2026-10-07',project:'テスト案件A',category:'設計',description:'画面設計',start:'09:00',end:'10:00',minutes:60},
      {id:'W-8',date:'2026-10-08',project:'テスト案件A',category:'開発',description:'テスト',start:'10:00',end:'12:00',minutes:120}
    ],
    projects:[{name:'テスト案件A',status:'進行中'}]
  });
  expect('worklog window presents the requested day',state.worklog.loadedDate==='2026-10-08'&&state.worklog.totalMinutes===120);
  resetCalls();
  jumpWorklogDate('2026-11-01');
  expect('cross-month worklog day navigation has zero extra GAS requests',
    apiCalls.length===0&&state.worklog.loadedDate==='2026-11-01');
  jumpWorklogDate('2026-10-08');
  expect('cross-month return uses the same cached worklog and minutes',
    apiCalls.length===0&&state.worklog.totalMinutes===120);
  resetCalls();
  moveWorklogDate(-1);
  expect('adjacent date opens without another GAS call',apiCalls.length===0&&state.worklog.loadedDate==='2026-10-07'&&state.worklog.totalMinutes===60);
  moveWorklogDate(-1);
  expect('empty day from the cached range is immediate',apiCalls.length===0&&state.worklog.loadedDate==='2026-10-06'&&state.worklog.items.length===0);
  moveWorklogDate(1);
  expect('return to cached date stays network-free',apiCalls.length===0&&state.worklog.loadedDate==='2026-10-07'&&state.worklog.totalMinutes===60);
  resetCalls();
  state.worklog.date='2026-09-10';
  loadWorklogs();
  call=lastCall();
  expect('uncached month fetches once without repeating project master',apiCalls.length===1&&call.method==='getWorklogs'&&call.args[1].start==='2026-08-23'&&call.args[1].end==='2026-10-10'&&call.args[1].includeProjects===false);
  moveWorklogDate(-1);
  moveWorklogDate(-1);
  expect('rapid navigation does not queue repeated GAS requests',apiCalls.length===1&&state.worklog.date==='2026-09-08');
  invokeServerSuccess({
    items:[{id:'W-9',date:'2026-09-08',project:'テスト案件A',start:'09:00',end:'11:00',minutes:120}],
    projects:[]
  });
  expect('worklog day navigation preserves loaded project master when omitted',
    state.data.projects.length===1&&state.data.projects[0].name==='テスト案件A');
  expect('late server response applies the last selected day',state.worklog.loadedDate==='2026-09-08'&&state.worklog.items[0].id==='W-9');
  expect('cached earlier days survive a later window fetch',worklogCachedWindow('2026-10-08')!==null);
  invalidatePageCache('worklog');
  expect('worklog mutation invalidates all cached windows',worklogCachedWindow('2026-10-08')===null&&worklogCachedWindow('2026-09-08')===null);

  // Keep edits intact while switching dates and while a cached day is rendered.
  state.page='worklog';
  state.worklog.date='2026-10-08';
  state.worklog.loadedDate='2026-10-08';
  const worklogWithPicker=worklogPage();
  expect('worklog exposes accessible direct date picker',worklogWithPicker.includes("id='worklogDatePicker'")&&worklogWithPicker.includes("aria-label='前の日へ'")&&worklogWithPicker.includes("aria-label='次の日へ'"));
  const workProject=document.getElementById('wlQuickProject');
  workProject.closest=()=>({className:'worklog-quick-card'});
  workProject.value='テスト案件A';
  const workDesc=document.getElementById('wlQuickDescription');
  const workCategory=document.getElementById('wlQuickCategory');
  const workStart=document.getElementById('wlQuickStart');
  const workEnd=document.getElementById('wlQuickEnd');
  workDesc.value='未保存の画面設計';
  workCategory.value='設計';
  workStart.value='09:15';
  workEnd.value='10:45';
  rememberWorklogQuickDraft();
  state.worklog.renderedDate='2026-10-07';
  workDesc.value='別の日の打合せ';
  rememberWorklogQuickDraft();
  state.worklog.renderedDate='2026-10-08';
  workDesc.value='';
  workCategory.value='';
  restoreWorklogQuickDraft();
  expect('quick-input draft survives a date change',workDesc.value==='未保存の画面設計'&&workCategory.value==='設計'&&workStart.value==='09:15');
  state.worklog.renderedDate='2026-10-07';
  restoreWorklogQuickDraft();
  expect('quick-input draft stays assigned to its own date',workDesc.value==='別の日の打合せ');
  state.sessionToken='ANOTHER_SESSION';
  workDesc.value='異なる社員の入力';
  restoreWorklogQuickDraft();
  expect('draft does not leak across sessions',workDesc.value==='異なる社員の入力');
  state.sessionToken='SESSION_TOKEN';
  state.worklog.renderedDate='2026-10-08';
  restoreWorklogQuickDraft();
  resetCalls();
  state.busy=false;
  saveQuickWorklog();
  saveQuickWorklog();
  expect('double click causes exactly one worklog save',apiCalls.length===1&&apiCalls[0].method==='saveWorklog');
  invokeServerFailure({message:'QA expected failure'});
  expect('failed worklog save releases busy state and retains draft',state.busy===false&&worklogQuickDrafts.has(worklogDraftKey('2026-10-08')));
  clearWorklogQuickDrafts();
  expect('worklog drafts clear on logout helper',worklogQuickDrafts.size===0&&state.worklog.renderedDate===null);
  state.page='home';


  expect('schedule workspace exposes plan and company calendar views',scheduleWorkspaceTabs('companyCalendar').includes('予定')&&scheduleWorkspaceTabs('companyCalendar').includes('会社カレンダー'));


  state.data={employees:[{employeeId:'FM0001',name:'青木 悠真'}]};
  state.schedule={
    date:'2026-10-01',view:'month',employeeId:'ALL',category:'ALL',
    employees:[{employeeId:'FM0001',name:'青木 悠真'}],
    companyDays:[],
    events:[{id:'E1',date:'2026-10-01',allDay:false,start:'09:00',end:'10:00',title:'会議',category:'予定',participantIds:'FM0001',participantNames:'青木 悠真',ownerEmployeeId:'FM0001',ownerName:'青木 悠真'}]
  };
  state.schedule.loadedKey=scheduleCacheKey();
  state.schedule.selectedDate='2026-10-01';
  expect('month schedule exposes keyboard-focusable day control',monthView().includes("class='day-open'"));
  expect('day schedule exposes employee timelines',dayView().includes('schedule-timeboard day-board')&&dayView().includes('schedule-time-lane'));
  expect('week schedule exposes seven time lanes',weekView().includes('schedule-timeboard week-board')&&weekView().split("class='schedule-time-lane'").length===8);
  state.schedule.events=[{id:'E-XSS',date:'2026-10-01',allDay:false,start:'09:00',end:'10:00',title:'<img src=x onerror=alert(1)>',category:'予定',participantIds:'FM0001',participantNames:'<b>攻撃</b>',ownerEmployeeId:'FM0001',ownerName:'<b>攻撃</b>'}];
  const escapedMonth=monthView();
  expect('schedule title is HTML-escaped before innerHTML rendering',!escapedMonth.includes('<img src=x')&&escapedMonth.includes('&lt;img'));



  // Selected day must remain within month mode, and all hidden events must be accessible.
  state.page='schedule';
  state.schedule.date='2026-10-08';
  state.schedule.selectedDate='2026-10-08';
  state.schedule.view='month';
  state.schedule.events=[
    {id:'S1',date:'2026-10-08',start:'09:00',end:'10:00',title:'資料作成',category:'業務',employeeIds:['FM0001'],employeeNames:['青木 悠真'],canEdit:true},
    {id:'S2',date:'2026-10-08',start:'09:30',end:'11:00',title:'調整会議',category:'社内',employeeIds:['FM0001'],employeeNames:['青木 悠真'],canEdit:false},
    {id:'S3',date:'2026-10-08',start:'13:00',end:'14:00',title:'顧客対応',category:'予定',employeeIds:['FM0001'],employeeNames:['青木 悠真']},
    {id:'S4',date:'2026-10-08',allDay:true,title:'研修',category:'業務',employeeIds:['FM0001'],employeeNames:['青木 悠真']}
  ];
  state.schedule.companyDays=[{date:'2026-10-08',type:'会社休日',name:'社内記念日',working:false}];
  state.schedule.loadedKey=scheduleCacheKey();
  state.schedule.loading=false;
  const hybridMonth=monthView();
  expect('month uses short event previews and a +N affordance',hybridMonth.includes('＋2件')&&hybridMonth.includes('schedule-day-dots'));
  const callsBeforeSelect=apiCalls.length;
  selectScheduleDay('2026-10-08');
  expect('day selection keeps month view and avoids an extra GAS call',state.schedule.view==='month'&&apiCalls.length===callsBeforeSelect);
  const hybridDetail=scheduleDetailPanel();
  expect('detail shows all events and company holiday',hybridDetail.includes('資料作成')&&hybridDetail.includes('調整会議')&&hybridDetail.includes('顧客対応')&&hybridDetail.includes('研修')&&hybridDetail.includes('社内記念日'));
  selectScheduleEvent('S2');
  const readonlyDetail=scheduleDetailPanel();
  expect('readonly schedule selection shows view-only action',readonlyDetail.includes('詳細を確認')&&!readonlyDetail.includes('予定を編集'));
  const overlap=scheduleTimelineLayout(state.schedule.events,scheduleTimeBounds(state.schedule.events));
  expect('overlapping events are laid out side-by-side',overlap.length===3&&overlap[0].columns===2&&overlap[1].columns===2&&overlap[0].column!==overlap[1].column);
  expect('day view retains all-day and timed events',dayView().includes('終日 · 研修')&&dayView().includes('schedule-timed-event'));
  closeScheduleDetail();
  expect('mobile detail can be closed without losing the selected date',!state.schedule.mobileDetailOpen&&state.schedule.selectedDate==='2026-10-08');
  state.schedule.events=[{id:'E-XSS',date:'2026-10-08',start:'09:00',end:'10:00',title:'<img src=x onerror=alert(1)>',category:'予定',employeeIds:['FM0001'],employeeNames:['<b>攻撃</b>']}];
  state.schedule.selectedEventId='E-XSS';
  expect('detail never interpolates untrusted HTML',!scheduleDetailPanel().includes('<img src=x')&&scheduleDetailPanel().includes('&lt;img'));
  expect('schedule rejects invalid day navigation',(()=>{const old=state.schedule.selectedDate;scheduleJumpTo('2026-02-30');return state.schedule.selectedDate===old})());


  // One authorized monthly payload powers all four views and both filters without GAS.
  invalidateScheduleWindowCache();
  state.page='schedule';
  state.schedule.date='2026-10-08';
  state.schedule.selectedDate='2026-10-08';
  state.schedule.employeeId='ALL';
  state.schedule.category='ALL';
  state.schedule.view='month';
  state.schedule.employees=[
    {employeeId:'FM0001',name:'青木 悠真'},{employeeId:'FM0002',name:'森川 彩乃'}
  ];
  resetCalls();
  loadSchedule();
  let firstFetch=lastCall();
  expect('one full-month fetch requests all authorized people/categories',
    apiCalls.length===1&&firstFetch&&firstFetch.method==='getScheduleBundle'&&
    firstFetch.args[1].employeeId==='ALL'&&firstFetch.args[1].category==='ALL'&&
    firstFetch.args[1].start==='2026-09-27'&&firstFetch.args[1].end==='2026-10-31');
  const sourceEvents=[
    {id:'FAST1',date:'2026-10-08',start:'09:00',end:'10:00',title:'青木の仕事',category:'社内',employeeIds:['FM0001'],employeeNames:['青木 悠真']},
    {id:'FAST2',date:'2026-10-08',start:'13:00',end:'14:00',title:'森川の仕事',category:'業務',employeeIds:['FM0002'],employeeNames:['森川 彩乃']},
    {id:'FAST3',date:'2026-10-08',start:'14:00',end:'15:00',title:'共同作業',category:'業務',employeeIds:['FM0001','FM0002'],employeeNames:['青木 悠真','森川 彩乃']}
  ];
  invokeServerSuccess({events:sourceEvents,companyDays:[{date:'2026-10-12',name:'スポーツの日',type:'法定祝日',working:false}]});
  expect('initial full-month request becomes available',scheduleLoaded()&&state.schedule.events.length===3);
  resetCalls();
  changeScheduleView('week');
  changeScheduleView('day');
  changeScheduleView('list');
  changeScheduleView('month');
  expect('switching all calendar views uses no network',apiCalls.length===0&&scheduleLoaded());
  setScheduleFilter('category','業務');
  expect('category filter applies immediately offline',apiCalls.length===0&&state.schedule.events.length===2&&!state.schedule.events.some(e=>e.id==='FAST1'));
  setScheduleFilter('employeeId','FM0002');
  expect('person filter also applies immediately offline',apiCalls.length===0&&state.schedule.events.length===2&&state.schedule.events.every(e=>e.employeeIds.includes('FM0002')));
  setScheduleFilter('category','ALL');
  setScheduleFilter('employeeId','ALL');
  expect('clear filters restores full data offline',apiCalls.length===0&&state.schedule.events.length===3);
  const legend=schedulePeopleLegend();
  expect('employee legend exposes keyboard-operable highlight buttons',legend.includes('schedule-person-button')&&legend.includes("aria-pressed='false'"));
  toggleScheduleEmployeeHighlight('FM0001');
  expect('highlight includes shared events and dims other employees without request',
    state.schedule.highlightEmployeeId==='FM0001'&&
    scheduleHighlightClass(sourceEvents[0])==='schedule-is-emphasized'&&
    scheduleHighlightClass(sourceEvents[1])==='schedule-is-dimmed'&&
    scheduleHighlightClass(sourceEvents[2])==='schedule-is-emphasized'&&apiCalls.length===0);
  expect('highlight classes appear in month, day, week and list HTML',
    monthView().includes('schedule-is-emphasized')&&dayView().includes('schedule-is-emphasized')&&
    weekView().includes('schedule-is-emphasized')&&listView().includes('schedule-is-emphasized'));
  toggleScheduleEmployeeHighlight('FM0001');
  expect('clicking again releases emphasis without a server call',state.schedule.highlightEmployeeId==='ALL'&&apiCalls.length===0);
  const coloredDays=monthView();
  expect('calendar labels Sundays and Saturdays distinctly',coloredDays.includes('schedule-sunday')&&coloredDays.includes('schedule-saturday')&&coloredDays.includes('schedule-holiday'));
  scheduleJumpTo('2026-11-08');
  const nextFetch=lastCall();
  expect('uncached next month makes one authorized ranged request',apiCalls.length===1&&nextFetch.method==='getScheduleBundle'&&nextFetch.args[1].employeeId==='ALL'&&nextFetch.args[1].category==='ALL');
  invokeServerSuccess({events:[{id:'NOV1',date:'2026-11-08',title:'11月の予定',category:'予定',employeeIds:['FM0001']}],companyDays:[]});
  resetCalls();
  scheduleJumpTo('2026-10-08');
  scheduleJumpTo('2026-11-08');
  expect('returning to either cached month is network-free',apiCalls.length===0&&state.schedule.events.some(e=>e.id==='NOV1'));
  const novCache=scheduleWindowForDate('2026-11-08');
  novCache.at=Date.now()-SCHEDULE_WINDOW_TTL-1000;
  resetCalls();
  loadSchedule();
  expect('expired month stays visible while revalidation is requested',apiCalls.length===1&&scheduleLoaded()&&state.schedule.refreshing);
  invokeServerFailure({message:'QA temporary network failure'});
  resetCalls();
  changeScheduleView('week');
  expect('temporary GAS failure does not trigger repeat calls on every view switch',apiCalls.length===0&&scheduleLoaded()&&state.schedule.events.some(e=>e.id==='NOV1'));
  invalidatePageCache('schedule');
  expect('schedule mutation invalidates all window caches',scheduleWindowCache.size===0&&!scheduleLoaded());
  resetCalls();
  loadSchedule({force:true});
  expect('stale data is reloaded after mutation',apiCalls.length===1&&lastCall().method==='getScheduleBundle');
  invokeServerSuccess({events:[],companyDays:[]});
  state.sessionToken='DIFFERENT_LOGIN';
  expect('cached data cannot be reused by a new login identity',!scheduleLoaded()&&scheduleWindowForDate('2026-11-08')===null);
  state.sessionToken='SESSION_TOKEN';
  state.schedule.highlightEmployeeId='ALL';
  state.schedule.view='day';state.schedule.date='2026-10-08';state.schedule.selectedDate='2026-10-08';
  state.schedule.employeeId='FM0001';state.schedule.employees=[
    {employeeId:'FM0001',name:'青木 悠真'},{employeeId:'FM0002',name:'森川 彩乃'}
  ];
  state.schedule.events=[{id:'MULTI',date:'2026-10-08',start:'10:00',end:'11:00',title:'共同会議',employeeIds:['FM0001','FM0002'],employeeNames:['青木 悠真','森川 彩乃']}];
  expect('person filter does not add other employee lanes',scheduleDayPeople().length===1&&scheduleDayPeople()[0].id==='FM0001');
  state.schedule.employeeId='ALL';
  state.schedule.employees=Array.from({length:6},(_,i)=>({employeeId:'FM'+String(i+1).padStart(4,'0'),name:'社員'+(i+1)}));
  expect('six employees use two vertical timeline boards',dayView().split('schedule-timeboard day-board').length===3);
  state.schedule.mobileDetailOpen=true;
  let escPrevented=false;
  onScheduleDetailKeydown({key:'Escape',preventDefault(){escPrevented=true},stopPropagation(){}});
  expect('Escape dismisses mobile schedule sheet',escPrevented&&state.schedule.mobileDetailOpen===false);
  state.schedule.events=[];
  expect('empty day does not render twelve hours of unused timeline',dayView().includes('schedule-all-day-only')&&dayView().includes('予定なし'));
  expect('home schedule deep link passes both date and selected event',homeScheduleRows([{id:'HOME1',date:'2026-10-08',title:'確認'}]).includes('state.schedule.selectedEventId=this.dataset.eventId||null'));


  // v0.11.5 — request dashboard, authorization boundary and network-free status controls.
  state.sessionToken='SESSION_TOKEN';
  state.data={
    today:'2026-10-08',
    user:{employeeId:'FM0001',displayName:'青木さん'},
    permissions:{requestApprove:false,employeeAdmin:false}
  };
  state.page='requests';
  state.requests=createEmptyRequestsState();
  state.requests.own=[
    {id:'Q-1',type:'有給',status:'承認待ち',startDate:'2026-10-10',endDate:'2026-10-10',reason:'私用のため'},
    {id:'Q-2',type:'在宅勤務',status:'承認済',startDate:'2026-10-07',endDate:'2026-10-07',reason:'会議のため'},
    {id:'Q-3',type:'打刻修正',status:'差戻し',startDate:'2026-10-06',endDate:'2026-10-06',reason:'打刻漏れ',rejectReason:'時刻を確認してください'},
    {id:'Q-4',type:'欠勤',status:'取消申請中',startDate:'2026-10-05',endDate:'2026-10-05',reason:'体調不良'}
  ];
  state.requests.context={leaveBalanceConfigured:false,availableLeaveDays:null};
  state.requests.loadedKey=requestsIdentity();
  const employeeDashboard=requestsPage();
  expect('employee requests dashboard shows its own metrics and quick actions',employeeDashboard.includes('request-overview-metric')&&employeeDashboard.includes('QUICK REQUEST')&&employeeDashboard.includes('何を申請しますか？'));
  expect('unconfigured leave is compact and never invents balance',employeeDashboard.includes('request-inline-alert')&&employeeDashboard.includes('未設定')&&!employeeDashboard.includes('12.0日'));
  expect('employee does not see approval controls',!employeeDashboard.includes("id='requestApprovalPanel'")&&!employeeDashboard.includes('取消承認'));
  expect('request guidance explains three steps',employeeDashboard.includes('申請の進め方')&&employeeDashboard.includes('内容を確認'));
  resetCalls();
  setRequestHistoryFilter('差戻し');
  expect('returned requests filter locally',apiCalls.length===0&&filteredOwnRequests().length===1&&filteredOwnRequests()[0].id==='Q-3');
  setRequestHistoryFilter('ALL');
  searchRequestHistory('会議');
  expect('search filters request history without API call',apiCalls.length===0&&filteredOwnRequests().length===1&&filteredOwnRequests()[0].id==='Q-2');
  searchRequestHistory('');
  setRequestHistoryFilter('取消関連');
  expect('cancel-pending requests remain visible under cancel filter',filteredOwnRequests().length===1&&filteredOwnRequests()[0].id==='Q-4');
  setRequestHistoryFilter('ALL');
  const rowHtml=requestHistoryRows(state.requests.own,false);
  expect('own request list keeps cancel and approved cancellation actions',rowHtml.includes('cancelOwnRequest(this.dataset.requestId)')&&rowHtml.includes('requestApprovedCancel(this.dataset.requestId)'));
  state.requests.own.push({id:'Q-X',type:'欠勤',status:'承認待ち',startDate:'2026-10-08',endDate:'2026-10-08',reason:'<img src=x onerror=alert(1)>'});
  const xssRow=requestHistoryRows(state.requests.own,false);
  expect('request reasons are escaped in history',!xssRow.includes('<img src=x')&&xssRow.includes('&lt;img'));
  openRequestDetail('Q-X',false);
  const detailsMarkup=document.getElementById('modalRoot').innerHTML;
  expect('request detail is readonly and escapes hostile content',detailsMarkup.includes('request-readonly-list')&&detailsMarkup.includes('&lt;img')&&!detailsMarkup.includes('<img src=x'));

  state.data.permissions={requestApprove:true,employeeAdmin:true};
  state.requests.team=[
    {id:'T-1',type:'有給',status:'承認待ち',employeeId:'FM0002',name:'森川さん',startDate:'2026-10-09',endDate:'2026-10-09',reason:'私用'},
    {id:'T-2',type:'在宅勤務',status:'取消申請中',employeeId:'FM0003',name:'神谷さん',startDate:'2026-10-07',endDate:'2026-10-07',reason:'変更'},
    {id:'T-SELF',type:'有給',status:'承認待ち',employeeId:'FM0001',name:'青木さん'}
  ];
  state.requests.context={leaveBalanceConfigured:true,leaveBalance:6,pendingLeaveDays:1,availableLeaveDays:5};
  const managerDashboard=requestsPage(),managerPanel=requestApprovalPanel();
  expect('manager sees approval and cancellation queue, excluding self approval',managerDashboard.includes("id='requestApprovalPanel'")&&managerPanel.includes('取消承認')&&managerPanel.includes('承認')&&!managerPanel.includes('T-SELF'));
  expect('manager metrics use the actual available leave balance',managerDashboard.includes('5日')&&!managerDashboard.includes('request-inline-alert'));
  resetCalls();
  setRequestHistoryFilter('承認待ち');
  setRequestHistoryFilter('承認済');
  expect('manager request filters also stay local',apiCalls.length===0);
  state.requests.team=Array.from({length:110},(_,i)=>({id:'TEAM-'+i,type:'欠勤',status:'承認待ち',employeeId:'STAFF-'+i,name:'社員'+i,startDate:'2026-10-10',endDate:'2026-10-10',reason:'私用'}));
  state.requests.approvalLimit=100;
  showMoreRequestApprovals();
  expect('approval list remains navigable beyond 100 records without extra API calls',state.requests.approvalLimit===108&&apiCalls.length===0);
  state.requests.team=[
    {id:'T-1',type:'有給',status:'承認待ち',employeeId:'FM0002',name:'森川さん',startDate:'2026-10-09',endDate:'2026-10-09',reason:'私用'},
    {id:'T-2',type:'在宅勤務',status:'取消申請中',employeeId:'FM0003',name:'神谷さん',startDate:'2026-10-07',endDate:'2026-10-07',reason:'変更'}
  ];
  state.requests.approvalLimit=4;

  const largeList=Array.from({length:25},(_,i)=>({id:'H-'+i,type:'欠勤',status:'承認済',startDate:'2026-10-01',endDate:'2026-10-01',reason:'私用'}));
  state.requests.own=largeList;
  state.requests.historyLimit=10;
  setRequestHistoryFilter('ALL');
  expect('long request history begins at ten rows',requestHistoryContent().split('request-dashboard-row').length===11);
  showMoreRequestHistory();
  expect('history expands by ten without a server request',state.requests.historyLimit===20&&apiCalls.length===0);

  state.requests.submitting=false;
  document.getElementById('requestSubmitButton').disabled=false;
  resetCalls();
  submitRequestFromModal();
  submitRequestFromModal();
  expect('double-click request submission sends one API call',apiCalls.length===1&&lastCall().method==='submitRequest'&&state.requests.submitting);
  invokeServerFailure({message:'QA expected submit failure'});
  expect('request submission failure permits a safe retry',!state.requests.submitting);

  state.requests=createEmptyRequestsState();
  state.sessionToken='SESSION_A';
  state.data.user.employeeId='FM0001';
  resetCalls();
  loadRequests();
  const oldUserCall=lastCall();
  state.sessionToken='SESSION_B';
  state.data.user.employeeId='FM0002';
  state.requests=createEmptyRequestsState();
  invokeServerSuccess({own:[{id:'LEAK',status:'承認済'}],team:[],context:{}});
  expect('old login response cannot populate new user request data',state.requests.own.length===0&&!requestsDataReady());
  loadRequests();
  expect('new user requires a separate authorized bundle',apiCalls.length===2&&oldUserCall.method==='getRequestsBundle'&&lastCall().method==='getRequestsBundle');
  invokeServerSuccess({own:[{id:'NEW-USER',type:'欠勤',status:'承認待ち'}],team:[],context:{leaveBalanceConfigured:false}});
  expect('new login can only see its freshly loaded data',requestsDataReady()&&state.requests.own[0].id==='NEW-USER');
  state.sessionToken='SESSION_TOKEN';
  state.data.user.employeeId='FM0001';
  state.requests=createEmptyRequestsState();


  // v0.11.6: role-secured admin hub, local employee filters, workflow and session scope.
  const adminRecords=[
    {employeeId:'FM0001',name:'青木 悠真',displayName:'青木',department:'管理',role:'ADMIN',active:true,leaveBalance:8,leaveBalanceConfigured:true,
     pinConfigured:true,payrollIncluded:true,workStart:'09:00',workEnd:'18:00',breakMinutes:60,managerId:'',email:'aoki@example.jp'},
    {employeeId:'FM0002',name:'森川 彩乃',displayName:'森川',department:'管理',role:'ADMIN',active:true,leaveBalance:0,leaveBalanceConfigured:false,
     pinConfigured:false,payrollIncluded:true,workStart:'09:00',workEnd:'18:00',breakMinutes:60,managerId:''},
    {employeeId:'FM0003',name:'神谷 直人',displayName:'神谷',department:'開発',role:'USER',active:true,leaveBalance:3,leaveBalanceConfigured:true,
     pinConfigured:true,lockedUntil:'2026-10-08 18:00',payrollIncluded:true,workStart:'09:00',workEnd:'18:00',breakMinutes:60,managerId:'FM0001'},
    {employeeId:'FM0004',name:'小林 美月',displayName:'小林',department:'開発',role:'USER',active:false,leaveBalance:0,leaveBalanceConfigured:false,
     pinConfigured:false,payrollIncluded:false}
  ];
  state.page='people';
  state.adminTab='people';
  state.adminUi=createAdminUiState();
  state.authAdmin={employees:adminRecords,resetRequests:[],support:{}};
  state.data={today:'2026-10-08',user:{employeeId:'FM0001',name:'青木 悠真',displayName:'青木'},
    permissions:{adminConsole:true,employeeAdmin:true},app:{version:'0.11.6'},employees:adminRecords};
  state.sessionToken='SESSION_TOKEN';
  resetCalls();
  const initialHub=peoplePage();
  expect('management opens integrated employee hub with seven sections including quote settings',
    initialHub.includes('admin-workspace-body')&&initialHub.includes('admin-overview-card')&&
    initialHub.includes('admin-people-split')&&initialHub.includes('admin-side-nav')&&
    ADMIN_CATEGORIES.length===7&&settingsTabs('people').split('data-admin-tab=').length===8);
  expect('management KPI counts only real active employees, leave and PIN statuses',
    adminRecords.filter(x=>x.active!==false).length===3&&
    adminOverviewStats().includes('年休未設定')&&
    adminOverviewStats().includes('PIN要確認')&&
    adminOverviewStats().includes('>2</strong>'));
  expect('employee list displays names and safely selects a detail panel',
    initialHub.includes('青木 悠真')&&initialHub.includes('森川 彩乃')&&initialHub.includes('社員情報を編集'));
  filterAdminPeople('role','ADMIN');
  expect('role filter runs without API and returns real administrators',
    adminPeopleFiltered().length===2&&apiCalls.length===0);
  filterAdminPeople('status','leave');
  expect('leave status filter finds only active unconfigured employees',
    adminPeopleFiltered().length===1&&adminPeopleFiltered()[0].employeeId==='FM0002'&&apiCalls.length===0);
  resetAdminPeopleFilters();
  filterAdminPeople('search','神谷');
  expect('employee text search executes entirely in browser',
    adminPeopleFiltered().length===1&&adminPeopleFiltered()[0].employeeId==='FM0003'&&apiCalls.length===0);
  resetAdminPeopleFilters();
  selectAdminEmployee('FM0003');
  setAdminDetailTab('security');
  const selectedProfile=adminEmployeeDetail();
  expect('selected employee detail includes security state, correct action and no PIN secret',
    state.adminUi.selectedEmployeeId==='FM0003'&&selectedProfile.includes('ロック中')&&selectedProfile.includes('ロック解除')&&apiCalls.length===0);
  state.authAdmin.employees[0].name='<img src=x onerror=alert(1)>';
  const escapedProfile=adminEmployeeDetailFields([['社員名',state.authAdmin.employees[0].name]]);
  expect('admin detail escapes untrusted employee information',!escapedProfile.includes('<img src=x')&&escapedProfile.includes('&lt;img'));
  state.authAdmin.employees[0].name='青木 悠真';
  state.data.permissions={adminConsole:false,employeeAdmin:false};
  expect('unauthorized visitor cannot display the admin hub',!peoplePage().includes('admin-people-split')&&!adminPage().includes('admin-overview'));
  state.data.permissions={adminConsole:true,employeeAdmin:true};

  openEmployeeModal();
  const wizardHtml=document.getElementById('modalRoot').innerHTML;
  expect('new employee wizard has four guided stages and a final save control',
    state.adminUi.wizard&&wizardHtml.includes('admin-wizard-progress')&&
    wizardHtml.includes("data-admin-wizard-step='4'")&&wizardHtml.includes("id='empManagerId'")&&
    wizardHtml.includes('adminEmployeeSaveButton')&&wizardHtml.includes('年休基準日'));
  document.getElementById('empId').value='BAD';
  document.getElementById('empName').value='';
  expect('wizard requires well-formed employee IDs and a name',validateAdminWizardStep(1)===false);
  document.getElementById('empId').value='FM0001';
  document.getElementById('empName').value='田中 試験';
  expect('wizard prevents accidental overwrite of existing employee',validateAdminWizardStep(1)===false);
  document.getElementById('empId').value='FM0006';
  document.getElementById('empDisplayName').value='田中';
  document.getElementById('empDepartment').value='開発';
  document.getElementById('empTitle').value='担当';
  document.getElementById('empEmail').value='tanaka@example.jp';
  document.getElementById('empRole').value='USER';
  document.getElementById('empManagerId').value='FM0001';
  document.getElementById('empActive').checked=true;
  document.getElementById('empPayroll').checked=true;
  document.getElementById('empWorkStart').value='09:00';
  document.getElementById('empWorkEnd').value='18:00';
  document.getElementById('empBreak').value='60';
  document.getElementById('empLeave').value='1.25';
  document.getElementById('empLeaveBasisDate').value='';
  document.getElementById('empHireDate').value='2026-10-08';
  document.getElementById('empNote').value='試験用';
  resetCalls();
  adminWizardNext();
  adminWizardNext();
  expect('wizard moves to the third step without saving anything',state.adminUi.wizardStep===3&&apiCalls.length===0);
  expect('wizard blocks leave-balance submission without basis date',validateAdminWizardStep(3)===false);
  document.getElementById('empLeaveBasisDate').value='2026-10-08';
  adminWizardNext();
  expect('wizard reaches final review with no API call',state.adminUi.wizardStep===4&&apiCalls.length===0);
  document.getElementById('empName').value='<img src=x onerror=alert(1)>';
  const reviewMarkup=adminWizardReviewHtml();
  expect('wizard review escapes user-entered markup',reviewMarkup.includes('&lt;img')&&!reviewMarkup.includes('<img src=x'));
  document.getElementById('empName').value='田中 試験';
  saveEmployeeFromModal();
  saveEmployeeFromModal();
  expect('employee registration blocks double submission and retains existing GAS contract',
    apiCalls.length===1&&lastCall().method==='saveEmployee'&&
    lastCall().args[1].employeeId==='FM0006'&&state.adminUi.saving);
  invokeServerFailure({message:'QA expected save error'});
  expect('employee save failure resets busy state without discarding form inputs',
    !state.adminUi.saving&&document.getElementById('empName').value==='田中 試験');
  openEmployeeModal('FM0003');
  expect('existing employee editing keeps all fields without forcing the wizard',
    !state.adminUi.wizard&&document.getElementById('modalRoot').innerHTML.includes('empWorkEnd')&&
    !document.getElementById('modalRoot').innerHTML.includes('admin-wizard-progress'));

  state.authAdmin=null;
  invalidatePageCache('authAdmin');
  state.page='people';
  state.sessionToken='OLD_SESSION';
  resetCalls();
  loadAuthAdmin({force:true,scope:'people'});
  const firstAuthCall=lastCall();
  state.sessionToken='NEW_SESSION';
  state.data.user.employeeId='FM0009';
  state.authAdmin=null;
  invokeServerSuccess({employees:adminRecords});
  expect('outdated admin response is discarded after user changes',
    state.authAdmin===null&&firstAuthCall.method==='getAuthAdminData'&&firstAuthCall.args[1]==='people');
  loadAuthAdmin({force:true,scope:'people'});
  expect('fresh admin session gets its own scoped API call',apiCalls.length===2&&lastCall().method==='getAuthAdminData');
  invokeServerSuccess({employees:[{employeeId:'FM0009',name:'新アカウント',role:'ADMIN',active:true}]});
  expect('fresh administrator sees only freshly authorized data',
    state.authAdmin.employees.length===1&&state.authAdmin.employees[0].employeeId==='FM0009');

  // v0.11.7: notices for statutory five-day usage, uncertain grants and employee setting.
  state.sessionToken='SESSION_TOKEN';
  state.data={today:'2026-10-08',user:{employeeId:'FM0001',displayName:'青木'},permissions:{adminConsole:true,employeeAdmin:true,requestApprove:false}};
  state.page='requests';
  state.requests=createEmptyRequestsState();
  state.requests.loadedKey=requestsIdentity();
  state.requests.context={leaveBalanceConfigured:true,leaveBalance:10,availableLeaveDays:9,
    fiveDay:{status:'TRACKING',takenDays:2,remainingDays:3,periodEnd:'2027-04-01',daysRemaining:150}};
  const compliance=requestAnnualLeaveNotice();
  expect('five-day reminder shows actual progress, remaining days and deadline',
    compliance.includes('取得 2日')&&compliance.includes('あと3日')&&compliance.includes('2027-04-01'));
  state.requests.context.fiveDay={status:'COMPLETED',takenDays:5,remainingDays:0,periodEnd:'2027-04-01'};
  expect('fully acquired five days is marked complete without warning to apply',
    requestAnnualLeaveNotice().includes('達成しました')&&!requestAnnualLeaveNotice().includes('有給を申請'));
  state.requests.context.fiveDay={status:'OVERDUE',takenDays:1,remainingDays:4,periodEnd:'2026-04-01'};
  expect('overdue five days produces a clear caution',requestAnnualLeaveNotice().includes('期限を過ぎています'));
  state.requests.context.fiveDay={status:'TRACKING',takenDays:1,remainingDays:4,periodEnd:'2027-10-01',daysRemaining:355,
    previousOverdue:{periodStart:'2025-10-01',periodEnd:'2026-09-30',takenDays:2,remainingDays:3}};
  expect('prior-year noncompliance remains visible alongside current-year progress',
    requestAnnualLeaveNotice().includes('前年度の有給5日')&&requestAnnualLeaveNotice().includes('2027-10-01'));
  state.requests.context.fiveDay={status:'DATA_INCOMPLETE',reason:'会社カレンダーが不足しています'};
  state.requests.context.autoLeave={status:'DISABLED'};
  expect('incomplete company calendar is displayed as unverified compliance',
    requestAnnualLeaveNotice().includes('年5日取得の判定に必要な記録')&&
    requestAnnualLeaveNotice().includes('会社カレンダーが不足'));
  state.requests.context.fiveDay={status:'UNKNOWN'};
  state.requests.context.autoLeave={status:'REVIEW',dueDate:'2026-10-01',dueDays:10};
  expect('unverified attendance is not portrayed as granted',
    requestAnnualLeaveNotice().includes('付与条件を確認')&&requestAnnualLeaveNotice().includes('2026-10-01'));
  state.page='people';
  state.adminUi=createAdminUiState();
  state.authAdmin={employees:[{employeeId:'FM0001',name:'青木',role:'ADMIN',active:true,
    autoLeaveEnabled:true,leaveBalance:10,leaveBalanceConfigured:true,
    hireDate:'2026-04-01',leaveBasisDate:'2026-10-01'}]};
  openEmployeeModal('FM0001');
  expect('employee form offers standard-worker annual-leave automation with hire-date input',
    document.getElementById('modalRoot').innerHTML.includes('empAutoLeave')&&
    document.getElementById('modalRoot').innerHTML.includes('出勤率80％'));
  state.page='home';


  // v0.11.8: isolated dummy dataset, grant dates and interactive approval arithmetic.
  state.sessionToken='SESSION_TOKEN';
  state.data={today:'2026-10-08',user:{employeeId:'FM0001',displayName:'青木'},
    permissions:{adminConsole:true,employeeAdmin:true,requestApprove:false}};
  state.authAdmin={employees:[{employeeId:'FM0001',name:'青木',role:'ADMIN',active:true,
    leaveBalanceConfigured:true,leaveBalance:10}]};
  state.page='requests';state.requests=createEmptyRequestsState();
  state.requests.loadedKey=requestsIdentity();
  resetCalls();
  expect('annual leave demo is absent from the requests page',
    !requestsPage().includes('有給の動作デモを見る'));
  expect('annual leave demo is absent from employee administration',
    !adminPeopleContent().includes('架空の社員で動作を試す'));
  expect('demo opens for authenticated staff without a server call',
    leaveDemoOpen()&&apiCalls.length===0);
  const demoStart=leaveDemoCompute();
  expect('second-year fixture grants ten plus eleven days',
    demoStart.grants.valid.length===2&&demoStart.grants.valid[0].days===10&&
    demoStart.grants.latest.days===11&&demoStart.granted===21);
  expect('seeded dummy usage, pending, available and five-day progress are consistent',
    demoStart.used===7.5&&demoStart.pending===1&&demoStart.balance===13.5&&
    demoStart.available===12.5&&demoStart.taken===2.5&&demoStart.needed===2.5);
  expect('demo is clearly labeled as nonpersistent fictitious data',
    document.getElementById('modalRoot').innerHTML.includes('架空データ')&&
    document.getElementById('modalRoot').innerHTML.includes('保存されません'));
  leaveDemoApprove();
  const approvedDemo=leaveDemoCompute();
  expect('demo approval reduces confirmed balance and counts toward five-day use',
    approvedDemo.balance===12.5&&approvedDemo.pending===0&&
    approvedDemo.available===12.5&&approvedDemo.taken===3.5&&apiCalls.length===0);
  leaveDemoCancel();
  const cancelledDemo=leaveDemoCompute();
  expect('demo cancellation restores confirmed balance and five-day progress',
    cancelledDemo.balance===13.5&&cancelledDemo.pending===0&&
    cancelledDemo.available===13.5&&cancelledDemo.taken===2.5);
  leaveDemoApplyRequest(.5);
  expect('half-day request only reserves half a day before approval',
    leaveDemoCompute().pending===.5&&leaveDemoCompute().balance===13.5&&
    leaveDemoCompute().available===13);
  leaveDemoWithdraw();
  expect('withdrawn sample request returns the reserved half-day',
    leaveDemoCompute().pending===0&&leaveDemoCompute().available===13.5);
  leaveDemoApplyRequest(1);
  leaveDemoApprove();
  leaveDemoApplyRequest(1);
  expect('one calendar date cannot count more than one day of leave',
    leaveDemoDayReserved()===1&&leaveDemoCompute().taken===3.5&&
    leaveDemoCompute().pending===0);
  leaveDemoSelect('first');
  const initialDemo=leaveDemoCompute();
  expect('first sample employee grants ten days, then eleven the next year',
    initialDemo.grants.latest.days===10&&initialDemo.grants.next.days===11&&
    initialDemo.grants.latest.date==='2026-10-01');
  leaveDemoSelect('senior');
  const seniorDemo=leaveDemoCompute();
  expect('long service sample grants twenty, achieves five and stays under forty',
    seniorDemo.grants.latest.days===20&&seniorDemo.granted===40&&
    seniorDemo.used===13&&seniorDemo.balance===27&&
    seniorDemo.taken===5&&seniorDemo.complete);
  leaveDemoSelect('deadline');
  const warningDemo=leaveDemoCompute();
  expect('near-deadline fixture displays actual shortfall and caution',
    warningDemo.grants.latest.days===10&&warningDemo.taken===1.5&&
    warningDemo.needed===3.5&&warningDemo.caution&&warningDemo.daysLeft===11);
  leaveDemoSelect('first');
  document.getElementById('leaveDemoHireDate').value='2026-08-08';
  leaveDemoEditHire();
  const futureDemo=leaveDemoCompute();
  expect('changing dummy hire date recalculates before-first-grant and resets usage',
    futureDemo.grants.latest===null&&futureDemo.granted===0&&
    futureDemo.grants.next.date==='2027-02-08'&&leaveDemoState.records.length===0);
  leaveDemoApplyRequest(1);
  expect('demo cannot consume leave before first grant',leaveDemoCompute().pending===0);
  document.getElementById('leaveDemoHireDate').value='2019-04-01';
  leaveDemoEditHire();
  expect('custom long service date reaches maximum annual twenty',
    leaveDemoCompute().grants.latest.days===20&&leaveDemoCompute().balance===40);
  document.getElementById('leaveDemoHireDate').value='2026-13-99';
  leaveDemoEditHire();
  expect('invalid sample hire date is rejected without changing the stored fixture date',
    leaveDemoState.hire==='2019-04-01'&&leaveDemoState.notice.includes('有効な日付'));
  leaveDemoReset();
  expect('reset only restores synthetic sample, without touching backend',
    leaveDemoState.hire==='2026-04-01'&&leaveDemoCompute().used===1&&apiCalls.length===0);
  leaveDemoOpen('second');
  expect('reopening sample starts from original fictitious records',
    leaveDemoCompute().pending===1&&leaveDemoCompute().balance===13.5);
  leaveDemoClose();
  expect('clicking close releases synthetic demo data',leaveDemoState===null&&
    !document.getElementById('modalRoot').innerHTML.includes('leave-demo-modal'));
  leaveDemoOpen('second');
  resetLeaveDemoSession();
  expect('logout discard removes demo state and closes its modal',
    leaveDemoState===null&&!document.getElementById('modalRoot').innerHTML.includes('leave-demo-modal'));
  state.sessionToken=null;
  expect('logged out visitor cannot access the demo',leaveDemoOpen()===false);
  state.sessionToken='SESSION_TOKEN';
  expect('no simulated application, approval or cancellation called the backend',apiCalls.length===0);


  // v0.11.9 home portal: data truthfulness, role-aware priorities, compact empty states and session safety.
  state.page='home';
  state.sessionToken='HOME_STAFF';
  state.homeOverview={loading:false,loaded:true,reloadRequested:false,callbacks:[],error:''};
  state.data={
    today:'2026-10-08',
    user:{employeeId:'FM0003',displayName:'サンプル社員'},
    permissions:{requestApprove:false,adminConsole:false},
    attendance:{state:'off',stateLabel:'勤務外',clockIn:'',clockOut:'',workedMinutes:0,history:[]},
    companyToday:{date:'2026-10-08',type:'通常勤務',name:''},
    todaySchedule:[],
    month:{workHours:'32時間00分',overtime:'1時間00分',leaveBalance:'11日',pendingRequests:1},
    tasks:[
      {label:'工数入力',status:'120分不足',tone:'danger'},
      {label:'勤怠の確認',status:'0件',tone:'info'},
      {label:'申請の確認',status:'1件',tone:'warning'}
    ]
  };
  resetCalls();
  const portalStaff=homePage();
  expect('personal home shows four real-data metrics and the own-pending label',
    portalStaff.includes('home-portal-screen')&&portalStaff.includes('home-portal-stats')&&
    portalStaff.includes('32時間00分')&&portalStaff.includes('11日')&&
    portalStaff.includes('自分の申請待ち')&&!portalStaff.includes('チーム承認待ち'));
  expect('home first priority is attendance and punch control remains available',
    portalStaff.includes('現在の勤怠')&&portalStaff.includes('home-portal-punch-actions')&&
    portalStaff.includes('homeWorkLocationSelector')===false&&portalStaff.includes('本日の打刻'));
  expect('empty schedule is compact and offers a direct add action',
    homePortalScheduleRows([]).includes('home-portal-agenda-empty')&&
    homePortalScheduleRows([]).includes('予定を登録')&&
    !homePortalScheduleRows([]).includes('height:100%'));
  expect('home prioritizes danger then warning and collapses completed tasks',
    homePortalTaskRows(state.data.tasks).indexOf('工数入力')<
    homePortalTaskRows(state.data.tasks).indexOf('申請の確認')&&
    homePortalTaskRows(state.data.tasks).includes('<details')&&
    homePortalTaskRows(state.data.tasks).includes("navigate('worklog')"));
  expect('home task destinations are allowlisted and unknown task labels cannot inject routes',
    homePortalTaskRoute('工数入力')==='worklog'&&
    homePortalTaskRoute('勤怠の確認')==='attendance'&&
    homePortalTaskRoute('申請の承認')==='requests'&&
    homePortalTaskRoute('constructor')===null);
  expect('staff shortcuts expose estimates, expenses, travel and worklog without admin settings',
    homePortalShortcuts().includes("navigate('worklog')")&&
    homePortalShortcuts().includes("navigate('quotes')")&&
    homePortalShortcuts().includes("openFinanceForm('expense')")&&
    homePortalShortcuts().includes("openFinanceForm('travel')")&&
    !homePortalShortcuts().includes("navigate('people')"));
  expect('rendering home does not issue additional server calls',apiCalls.length===0);
  const noTasks=homePortalTaskRows([
    {label:'工数入力',status:'完了',tone:'info'},
    {label:'勤怠の確認',status:'0件',tone:'info'}]);
  expect('completed work is not mistakenly marked pending',
    noTasks.includes('今すぐ対応が必要な項目はありません')&&
    noTasks.includes('確認済みの項目'));
  const hostile=homePortalTaskRow({label:'<img src=x onerror=alert(1)>',status:'<script>alert(1)</script>',tone:'warning'});
  expect('untrusted task labels and status cannot inject markup',
    !hostile.includes('<img src=x')&&!hostile.includes('<script>')&&hostile.includes('&lt;img'));
  const upcoming=homePortalScheduleRows([
    {id:'E1',date:'2026-10-08',start:'09:30',title:'共同会議',employeeNames:['担当者A'],category:'業務'}
  ]);
  expect('home schedule keeps event date and ID for deep linking',
    upcoming.includes('data-event-id=')&&upcoming.includes('state.schedule.selectedEventId=this.dataset.eventId||null'));
  state.data.permissions={requestApprove:true,adminConsole:true};
  state.data.month.pendingRequests=3;
  state.data.tasks[2]={label:'申請の承認',status:'3件',tone:'warning'};
  const managerPortal=homePage();
  expect('manager sees team pending count without mixing employee administration into shortcuts',
    managerPortal.includes('チーム承認待ち')&&managerPortal.includes('3件')&&
    managerPortal.includes('担当チームの承認待ち申請')&&
    !managerPortal.includes("navigate('people')"));
  state.data.todaySchedule=[{id:'EVENT-X',date:'2026-10-08',title:'<img src=x onerror=alert(1)>',start:'14:00'}];
  const malicious=homePortalScheduleRows(state.data.todaySchedule);
  expect('home calendar event titles are escaped',malicious.includes('&lt;img')&&!malicious.includes('<img src=x'));
  state.data.month=null;state.data.tasks=null;
  state.homeOverview.error='ネットワーク障害';
  const failedPortal=homePage();
  expect('home overview failure keeps retry affordance instead of endless skeleton',
    failedPortal.includes('再読込')&&failedPortal.includes('取得できません')&&
    failedPortal.includes('集計を読み込めませんでした')&&
    failedPortal.split('onclick="loadHomeOverview({force:true})"').length===2);
  state.homeOverview.error='';
  const skeletonPortal=homePage();
  expect('home pending overview has compact skeleton without invented numbers',
    skeletonPortal.includes('home-portal-skeleton')&&!skeletonPortal.includes('32時間00分'));
  resetCalls();
  const oldHomeData=state.data;
  const oldHomeSession=state.sessionToken;
  loadHomeOverview({force:true,silent:true});
  const homeRequest=lastCall();
  state.sessionToken='HOME_NEW_LOGIN';
  state.data={...oldHomeData,user:{employeeId:'FM0009',displayName:'別アカウント'},month:null,tasks:null};
  invokeServerSuccess({month:{workHours:'999時間00分'},tasks:[{label:'工数入力',status:'異常',tone:'danger'}]});
  expect('old login overview response cannot populate a newly authenticated user',
    homeRequest&&homeRequest.method==='getHomeOverview'&&oldHomeSession!=='HOME_NEW_LOGIN'&&
    state.data.month===null&&state.data.tasks===null);
  state.sessionToken='HOME_STAFF';
  state.data=oldHomeData;
  state.homeOverview={loading:false,loaded:false,reloadRequested:false,callbacks:[],error:''};
  resetCalls();

  // v0.13.2 performance contracts: no unnecessary GAS roundtrip for cached tabs.
  const savedPerfData=state.data,savedPerfPage=state.page;
  state.page='home';
  state.data={today:'2026-10-08',user:{employeeId:'FM0001',displayName:'架空社員',fullName:'架空社員'},
    employees:[],permissions:{financeWorkspace:true,adminConsole:false,monthlyTeamView:false},
    attendance:{state:'off',history:[]},app:{version:'0.13.2'}};
  state.sessionToken='SESSION_TOKEN';
  invalidateMonthlyResultCache();
  state.monthly={yearMonth:'2026-10',employeeId:'FM0001',data:null,loadedKey:'',view:'calendar',loading:false,error:''};
  state.attendancePreview={data:null,key:'',at:0,loading:false,error:''};
  resetCalls();
  loadMonthly();
  loadAttendancePreview();
  expect('attendance preview and monthly detail share one in-flight GAS request',
    apiCalls.filter(x=>x.method==='getMonthlySummary').length===1);
  const october={yearMonth:'2026-10',employee:{employeeId:'FM0001',name:'架空社員'},
    daily:[],totals:{},closeStatus:{closed:false}};
  invokeServerSuccess(october);
  expect('shared result reaches both attendance and detailed monthly caches',
    state.monthly.data===october&&state.attendancePreview.data===october);
  resetCalls();loadMonthly();loadAttendancePreview();
  expect('revisiting already loaded month makes zero GAS requests',
    apiCalls.filter(x=>x.method==='getMonthlySummary').length===0);
  state.monthly.yearMonth='2026-09';
  resetCalls();loadMonthly();
  const september={yearMonth:'2026-09',employee:{employeeId:'FM0001',name:'架空社員'},
    daily:[],totals:{},closeStatus:{closed:false}};
  expect('first visit to uncached month makes one request',
    apiCalls.filter(x=>x.method==='getMonthlySummary').length===1);
  invokeServerSuccess(september);
  state.monthly.yearMonth='2026-10';
  resetCalls();loadMonthly();
  expect('returning to October displays cached data instantly with zero network',
    state.monthly.data===october&&apiCalls.filter(x=>x.method==='getMonthlySummary').length===0);
  state.monthly.yearMonth='2026-09';
  state.monthly.data=october;
  state.monthly.loadedKey=monthlyResultKey_('2026-10','FM0001');
  const mismatchedMonth=monthlyPage();
  expect('switching months never displays the previous month as if it were selected',
    mismatchedMonth.includes('月次データを読込中')&&!mismatchedMonth.includes('2026-10 月次'));
  state.monthly.yearMonth='2026-10';
  resetCalls();invalidatePageCache('monthly');loadMonthly();
  expect('data mutation invalidates monthly result memory',apiCalls.filter(x=>x.method==='getMonthlySummary').length===1);
  invokeServerSuccess(october);

  resetFinanceUi();
  resetCalls();loadFinanceOverview();
  expect('first finance tab visit calls its restricted backend once',
    apiCalls.filter(x=>x.method==='getFinanceOverview').length===1);
  invokeServerSuccess({setupRequired:false,expenses:[],travels:[],receipts:[]});
  resetCalls();loadFinanceOverview();
  expect('switching back to finance within 30 seconds uses in-memory data',
    apiCalls.filter(x=>x.method==='getFinanceOverview').length===0);
  loadFinanceOverview({force:true});
  expect('explicit financial refresh bypasses the short-lived finance cache',
    apiCalls.filter(x=>x.method==='getFinanceOverview').length===1);
  invokeServerSuccess({setupRequired:false,expenses:[],travels:[],receipts:[]});
  resetFinanceUi();

  invalidatePageCache('worklog');
  state.worklog={date:'2026-10-08',loadedDate:null,items:[],totalMinutes:0,loading:false,error:''};
  resetCalls();loadWorklogs();
  state.worklog.date='2026-08-12';loadWorklogs();
  expect('distinct worklog range no longer waits behind the previous pending range',
    apiCalls.filter(x=>x.method==='getWorklogs').length===2);
  state.worklog.date='2026-07-01';loadWorklogs();
  expect('rapid worklog navigation caps concurrent GAS reads at two',
    apiCalls.filter(x=>x.method==='getWorklogs').length===2);
  invalidatePageCache('worklog');
  resetCalls();
  state.data=savedPerfData;state.page=savedPerfPage;
  state.homeOverview={loading:false,loaded:false,reloadRequested:false,callbacks:[],error:''};

  state.adminUi=createAdminUiState();
  state.authAdmin=null;
  state.sessionToken='SESSION_TOKEN';
  state.page='home';

  state.page='home';

  // v0.17.8: stale callbacks must not mutate a newly authenticated employee's state.
  const mockEmployeeData=id=>({
    today:'2026-10-10',
    user:{employeeId:id,name:'架空テストユーザー',displayName:'試験'},
    attendance:{state:'off',workLocation:'出社',history:[]},
    permissions:{requestApprove:false,financeWorkspace:false},
    projects:[{name:'案件A',status:'進行中'}]
  });
  state.sessionToken='PUNCH_A';state.data=mockEmployeeData('FM0002');
  state.page='home';state.workLocation='出社';state.busy=false;
  resetCalls();performPunch('出勤');
  const earlierPunchCall=lastCall();
  state.sessionToken='PUNCH_B';state.data=mockEmployeeData('FM0003');
  state.workLocation='外出';state.busy=false;
  invokeServerSuccess({attendance:{state:'working',workLocation:'在宅'},serverTime:'2026-10-10T01:00:00Z'});
  expect('late punch completion never overwrites another user attendance',
    earlierPunchCall&&earlierPunchCall.method==='recordPunch'&&
    state.data.attendance.state==='off'&&state.workLocation==='外出'&&state.busy===false);

  state.sessionToken='LOCATION_A';state.data=mockEmployeeData('FM0002');
  state.workLocation='出社';state.busy=false;
  resetCalls();changeWorkLocation('在宅');
  const earlierLocationCall=lastCall();
  state.sessionToken='LOCATION_B';state.data=mockEmployeeData('FM0003');
  state.workLocation='外出';state.busy=false;
  invokeServerFailure(new Error('AUTH_REQUIRED'));
  expect('late old-session failure never logs out new employee',
    earlierLocationCall&&earlierLocationCall.method==='recordWorkLocationChange'&&
    state.sessionToken==='LOCATION_B'&&state.data.user.employeeId==='FM0003'&&state.workLocation==='外出');

  document.getElementById('reqType').value='有給';
  document.getElementById('reqStart').value='2026-10-10';
  document.getElementById('reqEnd').value='2026-10-10';
  document.getElementById('reqReason').value='テスト';
  document.getElementById('reqContent').value='テスト';
  state.sessionToken='LEAVE_A';state.data=mockEmployeeData('FM0002');
  resetCalls();refreshRequestPreview();
  const leaveRequest=lastCall();
  const previewBefore=document.getElementById('requestPreview').innerHTML;
  state.sessionToken='LEAVE_B';state.data=mockEmployeeData('FM0003');
  invokeServerSuccess({leaveBalanceConfigured:true,requestedDays:1,projectedBalance:999});
  expect('old employee leave balance cannot appear in new employee request form',
    leaveRequest&&leaveRequest.method==='previewRequest'&&
    document.getElementById('requestPreview').innerHTML===previewBefore&&
    !document.getElementById('requestPreview').innerHTML.includes('999'));

  state.sessionToken='CORRECTION_A';state.data=mockEmployeeData('FM0002');
  resetCalls();loadCorrectionPunchOptions();
  const punchOptionsRequest=lastCall();
  const punchOptionsBefore=document.getElementById('reqOriginalPunch').innerHTML;
  state.sessionToken='CORRECTION_B';state.data=mockEmployeeData('FM0003');
  invokeServerSuccess([{id:'PRIVATE-PUNCH-ID',timestamp:'2026-10-10 09:00',action:'出勤',workLocation:'出社'}]);
  expect('old employee punch history cannot appear in new correction selector',
    punchOptionsRequest&&punchOptionsRequest.method==='getPunchesForDate'&&
    document.getElementById('reqOriginalPunch').innerHTML===punchOptionsBefore&&
    !document.getElementById('reqOriginalPunch').innerHTML.includes('PRIVATE-PUNCH-ID'));

  state.sessionToken='WORKLOG_A';state.data=mockEmployeeData('FM0002');
  state.worklog={date:'2026-10-10',renderedDate:'2026-10-10',items:[],loading:false};
  state.busy=false;
  document.getElementById('wlQuickProject').value='案件A';
  document.getElementById('wlQuickCategory').value='開発';
  document.getElementById('wlQuickStart').value='09:00';
  document.getElementById('wlQuickEnd').value='10:00';
  document.getElementById('wlQuickDescription').value='試験';
  resetCalls();saveQuickWorklog();
  const quickSaveRequest=lastCall();
  state.sessionToken='WORKLOG_B';state.data=mockEmployeeData('FM0003');
  state.busy=false;
  const worklogCallsBefore=apiCalls.length;
  invokeServerSuccess({ok:true});
  expect('old employee quick-worklog completion does not refresh new employee screen',
    quickSaveRequest&&quickSaveRequest.method==='saveWorklog'&&
    apiCalls.length===worklogCallsBefore&&state.worklog.renderedDate==='2026-10-10'&&state.busy===false);

  state.sessionToken='MODAL_A';state.data=mockEmployeeData('FM0002');
  state.worklog.date='2026-10-10';
  ['wlDate','wlProject','wlCategory','wlStart','wlEnd','wlDescription','wlNote'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('wlDate').value='2026-10-09';
  resetCalls();saveWorklogFromModal('W-1');saveWorklogFromModal('W-1');
  const modalSaveRequests=apiCalls.filter(x=>x.method==='saveWorklog');
  const modalSaveRequest=lastCall();
  state.sessionToken='MODAL_B';state.data=mockEmployeeData('FM0003');
  invokeServerSuccess({ok:true});
  expect('old employee modal worklog save does not replace current worklog date',
    modalSaveRequest&&modalSaveRequest.method==='saveWorklog'&&modalSaveRequests.length===1&&
    state.worklog.date==='2026-10-10');

  state.sessionToken='LOGOUT_A';state.data=mockEmployeeData('FM0002');state.busy=true;
  clearLocalSession();
  expect('logout clears in-progress busy flag for next login',state.busy===false&&state.sessionToken===null);

  // Late logout completion must not interrupt the next successfully authenticated user.
  state.sessionToken='LOGOUT_OLD';state.data=mockEmployeeData('FM0002');
  document.getElementById('app').hidden=false;
  resetCalls();performLogout();
  const olderLogout=lastCall();
  state.sessionToken='LOGIN_NEW';state.data=mockEmployeeData('FM0003');
  document.getElementById('app').hidden=false;
  invokeServerSuccess({ok:true});
  expect('old logout success cannot hide app after a different user logs in',
    olderLogout&&olderLogout.method==='logout'&&state.sessionToken==='LOGIN_NEW'&&
    state.data.user.employeeId==='FM0003'&&document.getElementById('app').hidden===false);

  state.sessionToken='LOGOUT_FAILURE';state.data=mockEmployeeData('FM0002');
  resetCalls();performLogout();
  const failedLogout=lastCall();
  state.sessionToken='LOGIN_AFTER_FAILURE';state.data=mockEmployeeData('FM0005');
  document.getElementById('app').hidden=false;
  invokeServerFailure(new Error('old logout network failure'));
  expect('old logout error cannot interrupt next authenticated user',
    failedLogout&&failedLogout.method==='logout'&&state.sessionToken==='LOGIN_AFTER_FAILURE'&&
    document.getElementById('app').hidden===false);

  state.data=mockEmployeeData('FM0002');state.sessionToken='PROJECT_SESSION';state.page='projects';
  resetProjectHubUi();projectHubUi.editor={kind:'resource',projectId:'PRJ-001',changed:true,form:{body:'入力途中'}};
  navigate('home');
  expect('project document draft survives menu navigation',projectHubUi.editor.form.body==='入力途中'&&state.page==='home');
  state.page='projects';projectHubUi.busy=true;navigate('home');
  expect('project save prevents route changes until completion',state.page==='projects');projectHubUi.busy=false;
  projectHubUi.details.set('PRJ-001',{at:Date.now(),data:{}});projectHubUi.at=Date.now();invalidateBusinessViewsAfterWrite('saveWorklog',{ok:true});
  expect('worklog save invalidates project aggregate and detail snapshots',projectHubUi.at===0&&projectHubUi.details.size===0);
  clearLocalSession();
  expect('logout removes project data and unsaved documents',projectHubUi.editor===null&&projectHubUi.data===null&&projectHubUi.details.size===0);
  return {failures};
})()
`,context);

if(result.failures){
  console.error('Client contract failures:',result.failures);
  process.exit(1);
}
console.log('All FM WORKS client contract tests passed.');

