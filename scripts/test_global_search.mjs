import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Only synthetic records. No authenticated live RPC or production Sheets writes.
const person=(id,name)=>({employeeId:id,name,displayName:name,department:'架空部門',title:'担当'});
const scheduleRow=(id,title,visible=true)=>{
 const r=Array(18).fill('');
 r[0]=id;r[1]='2026-10-11';r[2]='10:00';r[6]='架空担当';r[7]=title;
 r[8]='社内';r[9]='架空会場';r[10]='alpha';r[11]=visible?'公開':'管理者のみ';r[12]='有効';
 return r;
};
const requestRow=(id,owner,content)=>{
 const r=Array(19).fill('');
 r[0]=id;r[2]=owner;r[3]='架空の社員';r[4]='有給';r[5]='2026-10-11';
 r[7]=content;r[8]='サンプル理由';r[9]='承認待ち';
 return r;
};
function sheet(records,width){
 return {
  rows:records,reads:0,
  getLastRow(){return records.length+1;},
  getRange(start,col,count,nCols){
   this.reads++;
   assert.equal(nCols,width,'Unexpected full-sheet read width');
   return {getDisplayValues:()=>records.slice(start-2,start-2+count).map(r=>r.slice(col-1,col-1+nCols))};
  }
 };
}
let roster=[person('U','alpha 本人'),person('E','別人')],approve=true,dbCalls=0,peopleCalls=0,indexCalls=[],viewerRole='MANAGER';
let schedules=sheet([scheduleRow('EV-1','alpha 公開'),scheduleRow('EV-X','alpha 機密',false)],18);
let requests=sheet([requestRow('RQ-U','U','alpha 本人の申請'),requestRow('RQ-M','M','alpha 部下の申請'),requestRow('RQ-X','X','alpha 閲覧不可')],19);
const db={getSheetByName(name){
 if(name==='予定')return schedules;
 if(name==='申請')return requests;
 throw Error('Unexpected sheet '+name);
}};
const server=vm.createContext({
 console,Date,Math,Set,Map,JSON,String,Number,Array,Error,
 DB:{sheets:{schedule:'予定'}},
 requireSession_:token=>{assert.equal(token,'TOKEN');return {employee:{employeeId:'U',role:viewerRole}};},
 getEmployees_:()=>{peopleCalls++;return roster;},
 getDb_:()=>{dbCalls++;return db;},
 getPermissions_:()=>({requestApprove:approve}),
 getManagedEmployeeIds_:()=>new Set(['M']),
 canViewScheduleRow_:(_actor,row)=>row[11]!=='管理者のみ',
 readRowsByColumnValues_:(sh,col,width,ids)=>{
  assert.equal(sh,requests);assert.equal(col,3);assert.equal(width,19);
  indexCalls.push(Array.from(ids));
  return sh.rows.filter(r=>ids.includes(r[2])).map(r=>r.slice());
 }
});
vm.runInContext(fs.readFileSync('src/Search.gs','utf8'),server,{filename:'Search.gs'});
const find=q=>server.searchApp('TOKEN',q);
assert.deepEqual(Array.from(find('a')),[],'short query returns no results');
assert.equal(peopleCalls,0,'too-short searches do not hit employee cache');
let results=find(' ALPHA ');
assert.deepEqual(JSON.parse(JSON.stringify(results.map(x=>x.title))),
 ['alpha 本人','alpha 公開','有給 / 架空の社員','有給 / 架空の社員'],
 'visible results preserve employees/schedule/requests ordering');
assert.deepEqual(results.filter(x=>x.type==='申請').map(x=>x.id).join(','),'RQ-U,RQ-M');
assert.ok(results.every(x=>!String(x.title).includes('機密')),'private schedule is never returned');
assert.ok(results.every(x=>x.id!=='RQ-X'),'unmanaged request is not returned');
assert.deepEqual(indexCalls[0],['U','M'],'request read is scoped before fetching rows');
assert.equal(requests.reads,0,'request sheet never performs a broad 19-column fetch');
assert.equal(peopleCalls,1,'shared employee directory is accessed once, no 13-column scan');
assert.equal(results[0].employeeId,'U','employee lookup must preserve the selected ID');
assert.equal(results[0].route,'schedule','non-admin search cannot link to admin-only people page');
viewerRole='ADMIN';
assert.equal(find('alpha')[0].route,'people','admin search opens the employee detail');
viewerRole='MANAGER';

approve=false;
indexCalls=[];
results=find('alpha');
assert.deepEqual(Array.from(results.filter(x=>x.type==='申請'),x=>x.id),['RQ-U']);
assert.deepEqual(indexCalls[0],['U'],'ordinary viewer cannot fetch subordinate records');
approve=true;
roster=Array.from({length:40},(_,i)=>person('B'+i,'bulk 架空社員 '+i));
dbCalls=0;indexCalls=[];
results=find('bulk');
assert.equal(results.length,30,'search cap remains exactly 30');
assert.equal(results[0].title,'bulk 架空社員 0','original employee order is preserved');
assert.equal(dbCalls,0,'after 30 employee hits no Sheets are accessed');
assert.equal(indexCalls.length,0,'no request index lookup after result cap');

roster=[];
schedules=sheet(Array.from({length:36},(_,i)=>scheduleRow('S'+i,'event alpha '+i)),18);
indexCalls=[];
results=find('alpha');
assert.equal(results.length,30);
assert.equal(indexCalls.length,0,'after 30 schedules no requests are fetched');
assert.deepEqual(results[0].id,'S0');

const input={value:''},box={hidden:true,innerHTML:'',_items:[]};
const errors=[],calls=[];
const makeRunner=()=>({
 withSuccessHandler(fn){this.success=fn;return this;},
 withFailureHandler(fn){this.failure=fn;return this;},
 searchApp(token,query){calls.push({token,query,success:this.success,failure:this.failure});}
});
const clientState={sessionToken:'CLIENT-SESSION',page:'home',
 data:{permissions:{adminConsole:true}},
 schedule:{employeeId:'OTHER',category:'業務',date:'2026-10-14',selectedEventId:'',view:'month',mobileDetailOpen:false},
 adminUi:{search:'stale',role:'ADMIN',status:'active',selectedEmployeeId:''}};
const openedRoutes=[];
const client=vm.createContext({
 console,Date,Map,Set,Math,String,JSON,Error,
 state:clientState,
 document:{
  getElementById:id=>id==='globalSearchInput'?input:id==='globalSearchResults'?box:null,
  addEventListener(){}
 },
 google:{script:{get run(){return makeRunner();}}},
 escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
 handleApiError:e=>errors.push(String(e.message||e)),
 navigate:r=>{openedRoutes.push(r);clientState.page=r;},
 clearTimeout(){},setTimeout:()=>1
});
vm.runInContext(fs.readFileSync('src/AppShell.html','utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),client,{filename:'AppShell.html'});
const invoke=s=>vm.runInContext(s,client);
invoke("renderSearchResults([{type:'社員',employeeId:'U',title:'架空の担当',route:'people'}])");
invoke('openSearchResult(0)');
assert.equal(openedRoutes.at(-1),'people');
assert.equal(clientState.adminUi.selectedEmployeeId,'U');
assert.equal(clientState.adminUi.status,'ALL','employee search resets hidden admin filters');
clientState.page='home';
invoke("renderSearchResults([{type:'社員',employeeId:'E',title:'架空社員',route:'schedule'}])");
invoke('openSearchResult(0)');
assert.equal(openedRoutes.at(-1),'schedule');
assert.equal(clientState.schedule.employeeId,'E','ordinary user sees selected colleague on schedule');
clientState.page='home';
invoke("renderSearchResults([{type:'予定',id:'S42',title:'会議',route:'schedule',date:'2026-10-24'}])");
invoke('openSearchResult(0)');
assert.equal(clientState.schedule.date,'2026-10-24');
assert.equal(clientState.schedule.employeeId,'ALL','event search resets previous employee filter');
assert.equal(clientState.schedule.category,'ALL','event search resets category filter');
assert.equal(clientState.schedule.selectedEventId,'S42','event search selects target on arrival');
clientState.page='home';
input.value='first';invoke("performGlobalSearch('first')");
input.value='second';invoke("performGlobalSearch('second')");
assert.equal(calls.length,2);
calls[1].success([{type:'予定',title:'newer',sub:'new'}]);
calls[0].success([{type:'予定',title:'obsolete',sub:'old'}]);
assert.equal(box._items[0].title,'newer','late old query must not overwrite latest results');

input.value='dismiss';invoke("performGlobalSearch('dismiss')");
invoke('hideSearchResults()');
calls[2].success([{type:'社員',title:'dismissed'}]);
assert.equal(box.hidden,true,'dismiss prevents late results reopening');
assert.equal(box._items.length,0,'dismiss purges cached search records');
assert.equal(box.innerHTML,'','dismiss purges private DOM text');

input.value='route';invoke("performGlobalSearch('route')");
clientState.page='finance';
calls[3].success([{type:'予定',title:'wrong route'}]);
assert.equal(box.hidden,true,'results are suppressed following navigation');
clientState.page='home';

input.value='old-error';invoke("performGlobalSearch('old-error')");
input.value='new-error';invoke("performGlobalSearch('new-error')");
calls[4].failure(new Error('stale failure'));
assert.equal(errors.length,0,'older failure cannot interrupt newer query');
calls[5].failure(new Error('active failure'));
assert.equal(errors.length,1,'current failure still reaches normal error handling');

input.value='signout';invoke("performGlobalSearch('signout')");
invoke('resetGlobalSearch_()');
clientState.sessionToken=null;
calls[6].success([{type:'申請',title:'prior user request'}]);
assert.equal(box._items.length,0,'logout discards private search records');
assert.equal(box.innerHTML,'','logout removes previous user private DOM content');
assert.equal(input.value,'','logout clears the search query');
assert.equal(box.hidden,true,'logout keeps result panel closed');
assert.ok(fs.readFileSync('src/AppCore.html','utf8').includes("if(typeof resetGlobalSearch_==='function')resetGlobalSearch_()"),'real logout invokes the guard');
invoke("performGlobalSearch('signout')");
assert.equal(calls.length,7,'unauthenticated search never sends RPC');
console.log('PASS: indexed search scope, cached employee directory, result cap, ACL, stale RPC, navigation, errors and logout purge');
