import fs from 'node:fs';
import vm from 'node:vm';

const clientFiles=['src/AppCore.html','src/AppHomePortal.html','src/AppOperations.html','src/AppPeopleMonthly.html','src/AppLeaveDemo.html','src/AppOffice.html','src/AppFinance.html','src/AppAdmin.html','src/AppShell.html'];
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
  window:{matchMedia:()=>({matches:true})},
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
  expect('main navigation preserves five daily tabs and adds role-scoped office plus admin',JSON.stringify(topNav)===JSON.stringify(['home','attendance','worklog','schedule','requests','office','finance','admin']));
  expect('admin navigation is permission-gated for non-admin users',visibleNav().every(x=>x[0]!=='admin'));
  expect('monthly is represented by attendance in the primary navigation',primaryNavIdForPage('monthly')==='attendance');
  expect('company calendar is represented by schedule in the primary navigation',primaryNavIdForPage('companyCalendar')==='schedule');
  expect('people administration is represented by admin in the primary navigation',primaryNavIdForPage('people')==='admin');
  expect('attendance workspace exposes today monthly and history views',attendanceWorkspaceTabs('history').includes('本日')&&attendanceWorkspaceTabs('history').includes('月間')&&attendanceWorkspaceTabs('history').includes('履歴'));

  // v0.12.0: unified office navigation with least-privilege preview access.
  const beforeOfficeData=state.data;
  const beforeOfficePage=state.page;
  state.data={today:'2026-10-08',user:{employeeId:'FM9000',displayName:'一般社員',department:'開発'},
    permissions:{adminConsole:false,employeeAdmin:false,officeWorkspace:false}};
  state.officeUi={selected:'documents'};
  state.page='home';
  resetCalls();
  expect('non-office staff never see the office or administrator routes',
    !visibleNav().some(x=>x[0]==='office'||x[0]==='admin'));
  const officeDenied=officePage();
  expect('office page is protected when link is opened directly',
    officeDenied.includes('権限')&&!officeDenied.includes('office-module-detail'));
  const initialDeniedModule=state.officeUi.selected;
  selectOfficeModule('expenses');
  expect('unauthorized office module selection does not change UI state or call the backend',
    state.officeUi.selected===initialDeniedModule&&apiCalls.length===0);
  state.data.permissions.officeWorkspace=true;
  expect('office member sees only office navigation, not administrative navigation',
    visibleNav().some(x=>x[0]==='office')&&!visibleNav().some(x=>x[0]==='admin'));
  const moduleHtml=officePage();
  expect('office scaffold lists six reference-grounded modules',
    OFFICE_MODULES.length===6&&moduleHtml.includes('office-module-nav')&&
    OFFICE_MODULES.every(m=>moduleHtml.includes("data-office-module='"+m.id+"'")));
  expect('office scaffold clearly states that saving and PDF export are not available',
    moduleHtml.includes('入力・保存機能は未実装')&&
    moduleHtml.includes('PDF発行はできません')&&moduleHtml.includes('元Excelの実データは移行していません'));
  selectOfficeModule('expenses');
  const expenseScaffold=officePage();
  expect('expense scaffold shows source columns without uploading any real business data',
    state.officeUi.selected==='expenses'&&expenseScaffold.includes('立替者受取日')&&
    expenseScaffold.includes('出金日')&&expenseScaffold.includes('申請理由'));
  selectOfficeModule('travel');
  const travelScaffold=officePage();
  expect('travel scaffold includes traveler dates, lodging and allowance fields',
    state.officeUi.selected==='travel'&&travelScaffold.includes('宿泊地域')&&
    travelScaffold.includes('日当区分'));
  selectOfficeModule('vendors');
  expect('vendor scaffold includes invoice registration and vendor code',
    officePage().includes('適格請求書発行事業者登録番号')&&officePage().includes('ベンダーコード'));
  selectOfficeModule('not-a-module');
  expect('unknown office module ID is rejected without changing state',
    state.officeUi.selected==='vendors'&&apiCalls.length===0);
  state.data.permissions.adminConsole=true;
  expect('administrators can access both office and administrator routes',
    visibleNav().some(x=>x[0]==='office')&&visibleNav().some(x=>x[0]==='admin'));
  expect('office module switching sends zero GAS requests',apiCalls.length===0);

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
  const financeRowsHtml=financeOverviewRows('expense');
  expect('financial approval view includes detail action for every record',
    financeRowsHtml.includes('financeShowDetail('));
  financeUi.mine={setupRequired:false,expenses:[financeFakeExpense],travels:[]};
  expect('returned finance claim offers an owner resubmission path',
    financeMyRow('expense',financeFakeExpense).includes('修正して再申請'));
  resetCalls();
  openFinanceForm('expense','EXP-FAKE-1');
  expect('returned claim editing retains original row id and prepopulates fields',
    financeActiveForm&&financeActiveForm.editId==='EXP-FAKE-1'&&
    document.getElementById('fin-vendor').value==='安全な取引先');
  submitFinanceForm();
  call=lastCall();
  expect('finance resubmission uses dedicated server endpoint with original id',
    call&&call.method==='resubmitFinanceRequest'&&call.args[0]==='SESSION_TOKEN'&&
    call.args[1]==='expense'&&call.args[2]==='EXP-FAKE-1');
  resetFinanceUi();
  // v0.13.3 Office Hybrid: actual finance data in actionable dashboard and list/detail,
  // but no financial data rendered for office-only managers.
  state.data.permissions.officeWorkspace=true;
  state.data.permissions.financeWorkspace=true;
  state.officeUi={selected:'overview',recordId:'',query:'',status:'all'};
  const financePending={...financeFakeExpense,id:'EXP-FAKE-PENDING',status:'承認待ち',employeeName:'架空別社員'};
  financeUi.overview={setupRequired:false,expenses:[financeFakeExpense,financePending],travels:[],receipts:[],
    receiptMatches:{'EXP-FAKE-1':{status:'AMOUNT_MISMATCH',label:'金額差異',recordedAmount:2000,claimAmount:2500}},
    totals:{expensePending:1,travelPending:0,expenseToSettle:0}};
  const overviewOffice=officePage();
  expect('hybrid office top provides six business shortcuts, quick entry and actionable queue',
    overviewOffice.includes('office-command')&&overviewOffice.includes('office-home-body')&&
    overviewOffice.includes('office-tile-grid')&&overviewOffice.includes('office-queue-row')&&
    (overviewOffice.match(/office-shortcut-tile/g)||[]).length===6);
  expect('overview uses financial records, never invented placeholder totals',
    overviewOffice.includes('EXP-FAKE-1')&&overviewOffice.includes('架空社員')&&
    !overviewOffice.includes('dummy-count'));
  resetCalls();
  selectOfficeModule('expenses');
  const officeWorklist=officePage();
  expect('finance office module renders real index with inline detail',
    officeWorklist.includes('office-record-columns')&&officeWorklist.includes('officeRecordsList')&&
    officeWorklist.includes('officeRecordsDetail')&&officeWorklist.includes('finance-detail-rows'));
  expect('inline record details escape untrusted names',
    officeWorklist.includes('&lt;img')&&!officeWorklist.includes('<img src=x'));
  expect('switching to record/detail makes no extra GAS calls',
    apiCalls.length===0);
  officeFilterRecords('nomatch-xyz');
  expect('client-side office search has explicit empty state without a GAS request',
    officeFilteredRecords_('expense').length===0&&apiCalls.length===0&&
    document.getElementById('officeRecordsList').innerHTML.includes('該当する記録'));
  officeFilterRecords('');
  officeSetStatus('承認済');
  expect('filter by status restores matching rows without network',
    officeFilteredRecords_('expense').length===0&&apiCalls.length===0);
  officeSetStatus('差戻し');
  expect('status filter finds returned records',
    officeFilteredRecords_('expense').length===1);
  officeOpenFinanceRecord('expense','EXP-FAKE-1');
  expect('summary opens exact record in list and detail',
    state.officeUi.selected==='expenses'&&state.officeUi.recordId==='EXP-FAKE-1');
  officeOpenFinanceRecord('expense','UNKNOWN');
  expect('invalid record id does not move the selected document',
    state.officeUi.recordId==='EXP-FAKE-1');
  state.officeUi.selected='overview';
  state.data.permissions.financeWorkspace=false;
  const managerOverview=officePage();
  expect('office-only manager cannot see personal accounting rows even if prior finance state exists',
    managerOverview.includes('office-home-body')&&!managerOverview.includes('EXP-FAKE-1')&&
    !managerOverview.includes('架空社員')&&!managerOverview.includes('2,500円'));
  selectOfficeModule('expenses');
  expect('office-only role gets self-service guidance but no accounting records',
    officePage().includes('担当者向け')&&!officePage().includes('EXP-FAKE-1'));
  state.data.permissions.financeWorkspace=true;
  financeUi.overview={setupRequired:true,expenses:[],travels:[],receipts:[]};
  expect('uninitialized accounting sheets are announced rather than showing invented records',
    officePage().includes('初期設定が必要'));
  financeUi.overview=null;
  financeUi.error='権限確認のエラー';
  expect('data-loading failure is visible and provides retry feedback',
    officePage().includes('取得できませんでした')&&officePage().includes('再試行'));
  financeUi.error='';
  financeUi.overview=null;
  state.officeUi.selected='overview';
  expect('office never interprets an unloaded financial total as zero',
    !officePage().includes('0件表示')&&officePage().includes('経理データを読み込み中'));
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
  resetCalls();
  loadWorklogs();
  call=lastCall();
  expect('worklog fetch requests a multi-day window',call&&call.method==='getWorklogs'&&call.args[1].start==='2026-09-28'&&call.args[1].end==='2026-10-11');
  invokeServerSuccess({
    items:[
      {id:'W-7',date:'2026-10-07',project:'テスト案件A',category:'設計',description:'画面設計',start:'09:00',end:'10:00',minutes:60},
      {id:'W-8',date:'2026-10-08',project:'テスト案件A',category:'開発',description:'テスト',start:'10:00',end:'12:00',minutes:120}
    ],
    projects:[{name:'テスト案件A',status:'進行中'}]
  });
  expect('worklog window presents the requested day',state.worklog.loadedDate==='2026-10-08'&&state.worklog.totalMinutes===120);
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
  expect('uncached period starts exactly one ranged fetch',apiCalls.length===1&&call.method==='getWorklogs'&&call.args[1].start==='2026-08-31'&&call.args[1].end==='2026-09-13');
  moveWorklogDate(-1);
  moveWorklogDate(-1);
  expect('rapid navigation does not queue repeated GAS requests',apiCalls.length===1&&state.worklog.date==='2026-09-08');
  invokeServerSuccess({
    items:[{id:'W-9',date:'2026-09-08',project:'テスト案件A',start:'09:00',end:'11:00',minutes:120}],
    projects:[{name:'テスト案件A',status:'進行中'}]
  });
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
  expect('management opens integrated employee hub with six vertical sections',
    initialHub.includes('admin-workspace-body')&&initialHub.includes('admin-overview-card')&&
    initialHub.includes('admin-people-split')&&initialHub.includes('admin-side-nav')&&
    ADMIN_CATEGORIES.length===6&&settingsTabs('people').split('data-admin-tab=').length===7);
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
  expect('annual leave demo is available from the requests page',
    requestsPage().includes('有給の動作デモを見る'));
  expect('annual leave demo is linked in employee administration',
    adminPeopleContent().includes('架空の社員で動作を試す'));
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
  expect('staff shortcuts do not expose administrator-only settings',
    homePortalShortcuts().includes("navigate('worklog')")&&
    homePortalShortcuts().includes("navigate('monthly')")&&
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
  expect('manager sees team pending count and role-specific administration links',
    managerPortal.includes('チーム承認待ち')&&managerPortal.includes('3件')&&
    managerPortal.includes('担当チームの承認待ち申請')&&
    managerPortal.includes("navigate('people')"));
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

  return {failures};
})()
`,context);

if(result.failures){
  console.error('Client contract failures:',result.failures);
  process.exit(1);
}
console.log('All FM WORKS client contract tests passed.');
