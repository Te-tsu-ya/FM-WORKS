import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const calls=[],scheduled=[];
const runner=(meta={})=>new Proxy({}, {get(_o,key){
 if(key==='withSuccessHandler')return success=>runner({...meta,success});
 if(key==='withFailureHandler')return failure=>runner({...meta,failure});
 return (...args)=>calls.push({method:key,args,...meta});
}});
const client=vm.createContext({console,Date,Math,Map,Set,WeakMap,Array,Object,String,Number,JSON,
 state:{page:'office',sessionToken:'SAME-SESSION',data:{user:{employeeId:'A'},permissions:{officeWorkspace:true}}},
 google:{script:{run:runner()}},window:{},document:{getElementById:()=>null},
 scheduleBackgroundTask:fn=>scheduled.push(fn),renderPageIfActive(){},showToast(){},
 cleanApiErrorMessage:e=>e.message,escapeHtml:v=>String(v??''),pageHead:()=>'',svg:()=>''});
for(const name of ['AppSomu','AppSomuGrowth'])vm.runInContext(fs.readFileSync('src/'+name+'.html','utf8').replace(/<\/?script>/g,''),client);
const js=code=>vm.runInContext(code,client),base={setupRequired:false,assets:[],loans:[],purchases:[],documents:[]},growth={ready:true,contracts:[],facilities:[],tickets:[]};
client.somuLoad(false);const old=calls.at(-1);client.somuReset();client.somuLoad(false);const fresh=calls.at(-1);
old.success({...base,marker:'OLD'});old.failure(Error('OLD ERROR'));
assert.equal(js('somuUi.loading'),true);assert.equal(js('somuUi.data'),null,'same-session reset must reject old success/failure');
fresh.success(base);const staleSchedule=scheduled.at(-1);client.somuReset();const beforeSchedule=calls.length;staleSchedule();
assert.equal(calls.length,beforeSchedule,'same-session reset also cancels scheduled growth');

client.somuLoad(false);const core=calls.at(-1),beforeForce=calls.length;
client.somuGrowthLoad(true);assert.equal(calls.length,beforeForce);
core.success(base);assert.equal(calls.length,beforeForce,'growth refresh cannot cause another base RPC');
scheduled.at(-1)();assert.equal(calls.at(-1).method,'getSomuGrowthData');assert.equal(calls.at(-1).args[1],true,'pending growth force is preserved');
const oldGrowth=calls.at(-1);client.somuGrowthReset_();client.somuGrowthLoad(false);const newGrowth=calls.at(-1);
oldGrowth.success({...growth,marker:'OLD'});oldGrowth.failure(Error('OLD ERROR'));
assert.equal(js('somuGrowth.loading'),true);assert.equal(js('somuGrowth.data'),null,'reset serial reuse cannot accept old growth callbacks');
newGrowth.success(growth);
client.somuGrowthLoad(true);const pendingGrowth=calls.at(-1);client.somuLoad(false);const pendingBase=calls.at(-1);
// Expire the base cache to overlap two independent reads.
if(pendingBase===pendingGrowth){js('somuUi.loadedAt=0');client.somuLoad(false);}
const actualBase=calls.at(-1);assert.equal(actualBase.method,'getSomuWorkspace');
actualBase.success(base);assert.equal(js('somuGrowth.loading'),true,'base completion must not unlock an active growth RPC');
const beforeCoalesce=calls.length;scheduled.at(-1)();assert.equal(calls.length,beforeCoalesce,'no duplicate growth request while it is in flight');
pendingGrowth.success(growth);assert.equal(js('somuGrowth.loading'),false);
client.somuLoad(true);const failedCore=calls.at(-1);client.somuGrowthLoad(true);failedCore.failure(Error('base network failure'));
scheduled.at(-1)();assert.equal(calls.at(-1).method,'getSomuGrowthData','base failure must not strand the independent growth refresh');calls.at(-1).success(growth);
js("somuUi.tab='assets'");client.somuLoad(true);const hiddenCore=calls.at(-1);client.somuGrowthLoad(true);
const beforeHidden=calls.length;hiddenCore.success(base);assert.equal(calls.length,beforeHidden,'hidden growth tabs must not cause speculative reads');
js("somuUi.tab='contracts'");client.somuGrowthLoad(false);
assert.equal(calls.at(-1).args[1],true,'a deferred force survives a switch away from growth tabs');calls.at(-1).success(growth);
console.log('PASS operational refresh: independent base/growth reads, queued force, coalescing, same-session reset, old success/failure and network recovery');

class Sheet{
 constructor(rows){this.rows=rows;this.reads=[];}
 getLastRow(){return this.rows.length;}
 getRange(start,col,n=1,width=1){const sheet=this;return {
  getDisplayValues(){sheet.reads.push({start,col,n,width});return Array.from({length:n},(_,i)=>Array.from({length:width},(_,j)=>String(sheet.rows[start+i-1]?.[col+j-1]??'')));},
  createTextFinder(value){let regex=false,entire=false;return {useRegularExpression(v){regex=v;return this;},matchEntireCell(v){entire=v;return this;},findAll(){
   const re=regex?new RegExp(value,'i'):null,out=[];
   for(let i=start-1;i<Math.min(sheet.rows.length,start-1+n);i++){
    const text=String(sheet.rows[i][col-1]??'');if(re?re.test(text):(entire?text===value:text.includes(value)))out.push({getRow:()=>i+1});
   }return out;
  }};}
 };}
 getRangeList(ranges){return {getRanges:()=>ranges.map(ref=>{const m=/^A(\d+):([A-Z]+)(\d+)$/.exec(ref);let width=0;for(const c of m[2])width=width*26+c.charCodeAt(0)-64;return this.getRange(Number(m[1]),1,Number(m[3])-Number(m[1])+1,width);})};}
}
const db={},cache=new Map();
const users={M:{employeeId:'FM0001',role:'MANAGER'},R:{employeeId:'FM0002',role:'USER',managerId:'FM0001'},X:{employeeId:'FM0003',role:'USER'},A:{employeeId:'FM0004',role:'ADMIN'}};
const projects=[{projectId:'P1',name:'架空案件一',status:'進行中'},{projectId:'P2',name:'架空案件二',status:'進行中'}];
const server=vm.createContext({console,Date,Math,Map,Set,Array,Object,String,Number,RegExp,JSON,
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},Utilities:{formatDate:()=> '2026-10-12',getUuid:()=> 'test-generation'},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})}});
for(const name of ['Code.gs','Schema.gs','DataAccess.gs','Employees.gs','ProjectHub.gs','ProjectAdvanced.gs'])vm.runInContext(fs.readFileSync('src/'+name,'utf8'),server,{filename:name});
Object.assign(server,{getDb_:()=>({getSheetByName:n=>db[n]||null}),getEmployees_:()=>Object.values(users),
 getProjectsInternal_:()=>projects,requireSession_:token=>({employee:users[token]})});
const specs=JSON.parse(JSON.stringify(vm.runInContext('DB_SCHEMA_SPECS',server)));
for(const [name,header] of Object.entries(specs))db[name]=new Sheet([header]);delete db['見積ヘッダー'];
const employee=(id,manager,status='在籍')=>{const r=Array(26).fill('');r[0]=id;r[1]='架空社員';r[6]=status;r[23]=manager;return r;};
db['社員マスタ'].rows.push(employee('FM0002','fm0001'),employee('FM0003','FM0004'),employee('FM0099','FM0001','退職'));
db['プロジェクト計画'].rows.push(['P1',480,'FM0001']);
db['プロジェクト作業'].rows.push(['T1','P1','設計','FM0002','','2026-10-13',480,10,'進行中']);
db['工数']=new Sheet([Array(15).fill('header'),['W1','2026-10-11','FM0002','架空社員','架空案件一','設計','作業', '09:00','10:00',60,'','','有効']]);
assert.deepEqual([...server.getManagedEmployeeIds_(users.M)],['FM0002'],'live manager index keeps case-insensitive manager IDs and excludes retirees');
assert.ok(db['社員マスタ'].reads.every(r=>r.n===1),'membership lookup transfers only matching records');
assert.equal(server.getProjectHubDetail('M','P1').worklogs.length,1);
db['社員マスタ'].rows[1][23]='FM0003';
assert.equal(users.R.managerId,'FM0001','display directory deliberately remains stale');
assert.equal(server.getManagedEmployeeIds_(users.M).size,0,'reassignment takes effect without directory expiry');
const revoked=server.getProjectHubDetail('M','P1');assert.equal(revoked.worklogs.length,0);assert.equal(revoked.byPerson.length,0);
assert.equal(revoked.metrics.actualMinutes,60,'shared project totals remain available');
assert.equal(server.getProjectHubDetail('R','P1').worklogs.length,1,'the employee keeps access to own records');
assert.equal(server.getManagedEmployeeIds_(users.R).size,0,'staff cannot inherit a manager scope');

db['プロジェクト共有'].rows.push(['OWN','P1','共有','担当案件の通知','2026-10-12 09:00','FM0001','架空上司','K1']);
for(let i=0;i<600;i++)db['プロジェクト共有'].rows.push(['OTHER-'+i,'P2','共有','他案件の長い本文'.repeat(100),'2026-10-12 09:01','FM0003','架空担当','K'+i]);
for(const name of ['プロジェクト共有','プロジェクト計画','プロジェクト作業'])db[name].reads=[];
const alerts=server.projectAdvancedAlerts_(users.R,false);
assert.ok(alerts.some(x=>x.notificationId==='MEMO-OWN'));assert.ok(!alerts.some(x=>x.notificationId.startsWith('MEMO-OTHER')));
assert.ok(db['プロジェクト共有'].reads.filter(r=>r.start>1).every(r=>r.n===1),'notification fetch never transfers unrelated message bodies');
assert.ok(db['プロジェクト計画'].reads.filter(r=>r.start>1).every(r=>r.width===3),'alert plan reads omit budget and notes');
assert.ok(db['プロジェクト作業'].reads.filter(r=>r.start>1).every(r=>r.width===9),'alert task reads omit long notes and update metadata');
console.log('PASS live manager ACL and alert I/O: stale display directory, reassignment, retirees, personal/project scope and selected-project bodies only');
