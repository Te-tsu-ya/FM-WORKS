import fs from 'node:fs';
import vm from 'node:vm';

const clientFiles=['src/AppCore.html','src/AppOperations.html','src/AppPeopleMonthly.html','src/AppAdmin.html','src/AppShell.html'];
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
  expect('top navigation definition is limited to five daily jobs plus admin',JSON.stringify(topNav)===JSON.stringify(['home','attendance','worklog','schedule','requests','admin']));
  expect('admin navigation is permission-gated for non-admin users',visibleNav().every(x=>x[0]!=='admin'));
  expect('monthly is represented by attendance in the primary navigation',primaryNavIdForPage('monthly')==='attendance');
  expect('company calendar is represented by schedule in the primary navigation',primaryNavIdForPage('companyCalendar')==='schedule');
  expect('people administration is represented by admin in the primary navigation',primaryNavIdForPage('people')==='admin');
  expect('attendance workspace exposes today monthly and history views',attendanceWorkspaceTabs('history').includes('本日')&&attendanceWorkspaceTabs('history').includes('月間')&&attendanceWorkspaceTabs('history').includes('履歴'));
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


  expect('schedule workspace exposes plan and company calendar views',scheduleWorkspaceTabs('companyCalendar').includes('予定')&&scheduleWorkspaceTabs('companyCalendar').includes('会社カレンダー'));


  state.data={employees:[{employeeId:'FM0001',name:'青木 悠真'}]};
  state.schedule={
    date:'2026-10-01',view:'month',employeeId:'ALL',category:'ALL',
    employees:[{employeeId:'FM0001',name:'青木 悠真'}],
    companyDays:[],
    events:[{id:'E1',date:'2026-10-01',allDay:false,start:'09:00',end:'10:00',title:'会議',category:'予定',participantIds:'FM0001',participantNames:'青木 悠真',ownerEmployeeId:'FM0001',ownerName:'青木 悠真'}]
  };
  expect('month schedule exposes keyboard-focusable day control',monthView().includes("class='day-open'"));
  expect('day schedule uses native button for appointment row',dayView().includes("<button type='button' class='agenda-item'"));
  state.schedule.events=[{id:'E-XSS',date:'2026-10-01',allDay:false,start:'09:00',end:'10:00',title:'<img src=x onerror=alert(1)>',category:'予定',participantIds:'FM0001',participantNames:'<b>攻撃</b>',ownerEmployeeId:'FM0001',ownerName:'<b>攻撃</b>'}];
  const escapedMonth=monthView();
  expect('schedule title is HTML-escaped before innerHTML rendering',!escapedMonth.includes('<img src=x')&&escapedMonth.includes('&lt;img'));


  return {failures};
})()
`,context);

if(result.failures){
  console.error('Client contract failures:',result.failures);
  process.exit(1);
}
console.log('All FM WORKS client contract tests passed.');
