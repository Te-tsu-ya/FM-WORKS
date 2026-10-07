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
