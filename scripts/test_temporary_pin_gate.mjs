import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Synthetic credentials, session rows and Sheets only; no GAS/Google/network writes.
const src=fs.readFileSync('src/Auth.gs','utf8');
const app=fs.readFileSync('src/AppShell.html','utf8');
const section=(text,from,to)=>{
  const start=text.indexOf('function '+from+'('),end=text.indexOf('function '+to+'(',start+9);
  assert.ok(start>=0&&end>start,'missing function boundaries: '+from+' => '+to);
  return text.slice(start,end);
};
let mustChange=true,prototype=false,bootstrapReads=0,invalidated=0,dbWrites=0;
let employee={employeeId:'FM9001',name:'架空社員',role:'ADMIN',active:true,authState:'ACTIVE',
  pinSalt:'fake-salt',pinHash:'hash:123456',mustChangePin:true,failures:0,lockUntil:''};
const token='A'.repeat(72);
const future=new Date(Date.now()+86400000).toISOString();
const row=['S-1','hashed',employee.employeeId,'created',future,future,new Date().toISOString(),'ACTIVE','','',false];
const sheet={getRange(){dbWrites++;return{setValues(){},setValue(){}}}};
const ctx=vm.createContext({
  console,Date,Number,String,Object,Array,JSON,Math,RegExp,Error,Set,
  AUTH:{sessionSheet:'sessions',sessionTouchMinutes:5},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  SpreadsheetApp:{flush(){}},
  normalizeEmployeeId_:x=>String(x),
  getAuthConfig_:()=>({maxFailures:5,lockMinutes:10,idleMinutes:30,rememberIdleMinutes:1440}),
  loginError_:()=>new Error('LOGIN_DENIED'),
  getEmployeeAuthRecord_:id=>id===employee.employeeId?employee:null,
  isPrototypeLogin_:()=>prototype,
  isPrototypeMode_:()=>prototype,
  hashPin_:(_id,_salt,pin)=>'hash:'+pin,
  validatePin_:pin=>{if(!/^\d{6}$/.test(String(pin)))throw Error('Invalid test PIN')},
  safeEqual_:(a,b)=>a===b,
  updateEmployeeAuthCells_:()=>{dbWrites++},
  toTimestamp_:date=>date.toISOString(),
  createSession_:()=>token,
  appendAudit_:()=>true,
  sanitizeClientInfo_:()=>'' ,
  publicEmployee_:record=>({employeeId:record.employeeId}),
  buildInitialDataForEmployee_:()=>{bootstrapReads++;return {today:'2026-10-15'};},
  hashToken_:()=> 'hashed',
  getDb_:()=>({getSheetByName:()=>sheet}),
  findVerifiedSheetRow_:()=>({rowNumber:2,row}),
  parseTimestamp_:value=>new Date(value),
  withScriptLock_:fn=>fn(),
  setEmployeePin_:(record,newPin,mustChangePin)=>{record.pinHash='hash:'+newPin;record.mustChangePin=mustChangePin;},
  invalidateEmployeeSessions_:()=>{invalidated++;},
});
vm.runInContext([
  section(src,'login','prototypeSettingEnabled_'),
  section(src,'resumeSession','logout'),
  section(src,'changeOwnPin','requestPinHelp'),
  section(src,'requireSession_','createSession_')
].join('\n'),ctx);

const pendingLogin=ctx.login(employee.employeeId,'123456','test',false);
assert.equal(pendingLogin.mustChangePin,true);
assert.equal(Object.hasOwn(pendingLogin,'initialData'),false,'temporary login must not preload business data');
assert.equal(bootstrapReads,0);
assert.throws(()=>ctx.requireSession_(token),/PIN_CHANGE_REQUIRED/);
assert.throws(()=>ctx.requireAdminSession_(token),/PIN_CHANGE_REQUIRED/,
  'even administrators must replace temporary PINs before using admin API');
assert.equal(ctx.requireSession_(token,true).employee.employeeId,employee.employeeId);
const resumed=ctx.resumeSession(token);
assert.equal(resumed.mustChangePin,true);
assert.equal(Object.hasOwn(resumed,'initialData'),false,'session restore must not leak business data');
assert.equal(bootstrapReads,0);

assert.deepEqual(JSON.parse(JSON.stringify(ctx.changeOwnPin(token,'123456','654321'))),{ok:true});
assert.equal(invalidated,1,'all other sessions revoked on PIN replacement');
assert.equal(employee.mustChangePin,false);
assert.equal(ctx.requireSession_(token).employee.employeeId,employee.employeeId);
const ready=ctx.resumeSession(token);
assert.equal(ready.mustChangePin,false);
assert.equal(ready.initialData.today,'2026-10-15');
assert.equal(bootstrapReads,1);
const normalLogin=ctx.login(employee.employeeId,'654321','test',false);
assert.equal(normalLogin.mustChangePin,false);
assert.equal(normalLogin.initialData.today,'2026-10-15');
assert.equal(bootstrapReads,2);

// Historical prototype-only behavior stays behind the existing runtime gate.
employee.mustChangePin=true;prototype=true;
assert.equal(ctx.requireSession_(token).employee.employeeId,employee.employeeId);
assert.equal(ctx.resumeSession(token).mustChangePin,false);
const demoLogin=ctx.login(employee.employeeId,'prototype-pin','test',false);
assert.equal(demoLogin.mustChangePin,false);
prototype=false;

let requiredScreens=0,loadedApps=0;
const uiState={sessionToken:token,data:null,publicConfig:{pinLength:8}};
const ui=vm.createContext({
  state:uiState,
  setSessionToken(value){uiState.sessionToken=value;},
  showLogin(){requiredScreens++;},
  openChangePinModal(force){assert.equal(force,true)},
  loadAuthenticatedApp(){loadedApps++;},
});
vm.runInContext(section(app,'acceptLogin','mountAuthenticatedApp'),ui);
ui.acceptLogin({sessionToken:token,remembered:false,mustChangePin:true});
assert.equal(requiredScreens,1);
assert.equal(loadedApps,0,'pending PIN must not mount business UI');
ui.acceptLogin({sessionToken:token,remembered:false,mustChangePin:false,initialData:{}});
assert.equal(loadedApps,1);

let forcedChanges=0,normalChanges=0;
const inputs={currentPin:{value:'123456'},newPin:{value:'654321'},newPinConfirm:{value:'654321'}};
const ui2=vm.createContext({
  state:{sessionToken:token},
  document:{getElementById:id=>inputs[id]},
  showToast(){},closeModal(){},
  handleApiError(){},
  loadAuthenticatedApp(){forcedChanges++;},
  FMRotaryRPC:()=>({
    withSuccessHandler(fn){this.success=fn;return this;},
    withFailureHandler(fn){this.failure=fn;return this;},
    changeOwnPin(){this.success();}
  })
});
vm.runInContext(section(app,'submitOwnPinChange','openPinHelpModal'),ui2);
ui2.submitOwnPinChange(true);
assert.equal(forcedChanges,1,'successful required PIN change unlocks full app');
ui2.submitOwnPinChange(false);
assert.equal(forcedChanges,1,'normal voluntary PIN change must not reload the app');
assert.ok(src.includes("throw new Error('PIN_CHANGE_REQUIRED')"));
console.log('PASS temporary PIN gate: blocked business/admin RPC, no bootstrap leakage, forced-change UI, restore, current-session recovery and prototype parity');
