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

  state.page='home';

  return {failures};
})()
`,context);

if(result.failures){
  console.error('Client contract failures:',result.failures);
  process.exit(1);
}
console.log('All FM WORKS client contract tests passed.');
