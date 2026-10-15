import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Test the actual browser functions without Google RPC or persistent data.
const source=fs.readFileSync('src/AppShell.html','utf8');
function sliceFunction(name,next){
  const start=source.indexOf('function '+name+'(');
  const end=source.indexOf(next,start+12);
  assert.ok(start>=0 && end>start,'missing source function boundary: '+name);
  return source.slice(start,end);
}
const loadSource=sliceFunction('loadAuthenticatedApp','function setProfileUi(');
const bootstrapSource=sliceFunction('bootstrap',"document.addEventListener('DOMContentLoaded',bootstrap);");
const pinSource=sliceFunction('openChangePinModal','function submitOwnPinChange(');
const keyboardSource=sliceFunction('initGlobalKeyboardShortcuts','function initTopbarInteractions(');

function fakeRpc(queue){
  const request={};
  queue.push(request);
  return {
    withSuccessHandler(fn){request.success=fn;return this;},
    withFailureHandler(fn){request.failure=fn;return this;},
    getInitialData(token){request.operation='initial';request.token=token;},
    resumeSession(token){request.operation='resume';request.token=token;}
  };
}

// 1. In-flight initial data may not revive a logged-out or switched account.
const queue=[],state={sessionToken:'old-token'};
let mounts=0,clears=0,publicConfigReloads=0,loading=0;
const ctx=vm.createContext({
  state,FMRotaryRPC:()=>fakeRpc(queue),
  mountAuthenticatedApp(){mounts++;},
  clearLocalSession(){clears++;state.sessionToken=null;},
  loadPublicLoginConfig(){publicConfigReloads++;},
  sessionErrorMessage:x=>String(x||''),
  setLoading(){loading++;}
});
vm.runInContext(loadSource,ctx);
ctx.loadAuthenticatedApp(false,null);
assert.equal(queue[0].token,'old-token');
state.sessionToken=null; // logout before the remote response
queue[0].success({user:{employeeId:'old'}});
queue[0].failure('SESSION_EXPIRED');
assert.equal(mounts,0,'logout must invalidate old success callbacks');
assert.equal(clears,0,'logout must invalidate old failure callbacks');
assert.equal(publicConfigReloads,0);

state.sessionToken='new-token'; // another employee signs in
ctx.loadAuthenticatedApp(false,null);
assert.equal(queue[1].token,'new-token');
queue[0].success({user:{employeeId:'old'}});
queue[0].failure('SESSION_EXPIRED');
assert.equal(mounts,0,'old reply cannot overwrite new employee workspace');
assert.equal(clears,0,'old error cannot log out new employee');
queue[1].success({user:{employeeId:'new'}});
assert.equal(mounts,1,'current reply still mounts');
ctx.loadAuthenticatedApp(false,{user:{employeeId:'new'}});
assert.equal(mounts,2,'initial bootstrap data still avoids an extra RPC');
ctx.loadAuthenticatedApp(false,null);
queue[2].failure('SESSION_EXPIRED');
assert.equal(clears,1,'active failed request must still invalidate its session');
assert.equal(publicConfigReloads,1);

// 2. Session restore is also fenced independently of the initial-data RPC.
const resumeQueue=[],resumeState={sessionToken:null};
let stored='restore-old',resumed=0,forced=0,resumeClears=0;
const fakeDocument={
  getElementById(){return null;},
  addEventListener(){}
};
const restoreCtx=vm.createContext({
  state:resumeState,document:fakeDocument,
  initAppResumeRefresh_(){},initTheme(){},getStoredSessionToken(){return stored;},
  FMRotaryRPC:()=>fakeRpc(resumeQueue),setLoading(){},
  loadAuthenticatedApp(){resumed++;},
  showRequiredPinChange_(){forced++;},
  clearLocalSession(){resumeClears++;resumeState.sessionToken=null;},
  loadPublicLoginConfig(){}
});
vm.runInContext(bootstrapSource,restoreCtx);
restoreCtx.bootstrap();
assert.equal(resumeQueue[0].token,'restore-old');
resumeState.sessionToken='another-user';
resumeQueue[0].success({initialData:{user:{employeeId:'old'}},mustChangePin:false});
resumeQueue[0].success({mustChangePin:true});
resumeQueue[0].failure('SESSION_EXPIRED');
assert.equal(resumed,0,'stale restore must not mount private data');
assert.equal(forced,0,'stale restore must not force a new user to change PIN');
assert.equal(resumeClears,0,'stale restore must not log out a new user');

stored='restore-new';
restoreCtx.bootstrap();
assert.equal(resumeQueue[1].token,'restore-new');
resumeQueue[1].success({mustChangePin:false,initialData:{user:{employeeId:'new'}}});
assert.equal(resumed,1,'active restore must mount');
stored='restore-third';
restoreCtx.bootstrap();
resumeQueue[2].success({mustChangePin:true});
assert.equal(forced,1,'active temporary PIN restore must open required PIN change');
resumeQueue[2].failure('SESSION_EXPIRED');
assert.equal(resumeClears,1,'active failed restore should clear its session');

// 3. Mandatory PIN modal must not close through the global Escape shortcut.
const modal={innerHTML:'',querySelector(query){
  return query.includes('data-pin-change-required') &&
    this.innerHTML.includes("data-pin-change-required='true'") ? {} : null;
}};
let keyListener,closeCount=0;
const keyCtx=vm.createContext({
  state:{page:'home'},globalKeysBound:false,
  document:{
    getElementById:id=>id==='modalRoot'?modal:null,
    addEventListener:(name,fn)=>{if(name==='keydown')keyListener=fn;}
  },
  trapModalFocus_:()=>false,
  closeModal(){closeCount++;},
  financeModalBusy_:()=>false,
  showToast(){},
});
vm.runInContext(keyboardSource,keyCtx);
keyCtx.initGlobalKeyboardShortcuts();
assert.equal(typeof keyListener,'function');
const pinCtx=vm.createContext({
  state:{publicConfig:{pinLength:8}},
  closeProfileMenu(){},
  ensureModal:()=>modal
});
vm.runInContext(pinSource,pinCtx);
pinCtx.openChangePinModal(true);
assert.match(modal.innerHTML,/data-pin-change-required='true'/);
let prevented=0;
keyListener({key:'Escape',target:{tagName:'DIV'},preventDefault(){prevented++;}});
assert.equal(prevented,1);
assert.equal(closeCount,0,'mandatory PIN modal must ignore Escape');
pinCtx.openChangePinModal(false);
keyListener({key:'Escape',target:{tagName:'DIV'},preventDefault(){prevented++;}});
assert.equal(closeCount,1,'ordinary dismissible modal should retain Escape behavior');
console.log('PASS auth async boundary: logout/switch/restore stale RPCs, successful active calls and mandatory PIN Escape protection');
