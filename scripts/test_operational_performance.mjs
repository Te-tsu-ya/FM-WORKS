import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const strip=name=>fs.readFileSync('src/'+name+'.html','utf8').replace(/<\/?script>/g,'');
const quiet={log(){},warn(){},error(){},debug(){}};
// Static HTML uses versioned immutable generations. Missing chunks/outages fall back.
const store=new Map();let generated=0,seq=0,broken=false;
const cache={get:k=>{if(broken)throw Error('CACHE_DOWN');return store.get(k)||null;},getAll:ks=>Object.fromEntries(ks.filter(k=>store.has(k)).map(k=>[k,store.get(k)])),put:(k,v)=>store.set(k,v),putAll:v=>Object.entries(v).forEach(([k,x])=>{assert.ok(Buffer.byteLength(x)<=60000);store.set(k,x);})};
const html='<html><head><title>FM WORKS</title></head><body>'+('静的な画面 😀'.repeat(18000))+'</body></html>';
const shell=version=>{const c=vm.createContext({console:quiet,CacheService:{getScriptCache:()=>cache},Utilities:{getUuid:()=>String(++seq)},HtmlService:{createTemplateFromFile:()=>({evaluate:()=>{generated++;return {getContent:()=>html};}})}});vm.runInContext(fs.readFileSync('src/Code.gs','utf8').replace("version: '0.25.6'",`version: '${version}'`),c);return c;};
const s=shell('0.25.6');assert.equal(s.getApplicationShell_(),html);assert.equal(generated,1);assert.equal(s.getApplicationShell_(),html);assert.equal(generated,1,'warm shell skips HTML evaluation/includes');
store.delete([...store.keys()].find(k=>k.includes(':1:0')));assert.equal(s.getApplicationShell_(),html);assert.equal(generated,2,'partial chunks regenerate');
shell('0.25.7').getApplicationShell_();assert.equal(generated,3,'deployments never share different versions');broken=true;assert.equal(s.getApplicationShell_(),html);assert.equal(generated,4,'cache outage keeps app available');broken=false;
// Real row-index helper returns physical positions while excluding unrelated bodies.
const data=vm.createContext({console:quiet,Date,Map,Set,Number,Object,Array,JSON,String});vm.runInContext(fs.readFileSync('src/DataAccess.gs','utf8'),data);
let cellsRead=0;const rows=[['id','project','body'],...Array.from({length:1000},(_,i)=>['R'+i,i===2||i===700?'P':'OTHER','長文'.repeat(100)])];
const sheet={getLastRow:()=>rows.length,getRange:(r,c,n=1,w=1)=>({getDisplayValues:()=>{cellsRead+=n*w;return rows.slice(r-1,r-1+n).map(x=>x.slice(c-1,c-1+w));},createTextFinder:p=>({useRegularExpression(){return this;},matchEntireCell(){return this;},findAll(){return rows.flatMap((x,i)=>i>=r-1&&i<r-1+n&&new RegExp(p).test(x[c-1])?[{getRow:()=>i+1}]:[]);}})}),getRangeList:rs=>({getRanges:()=>rs.map(r=>{const m=/A(\d+):C(\d+)/.exec(r);return sheet.getRange(+m[1],1,+m[2]-+m[1]+1,3);})})};
const indexed=data.readRowsByColumnValues_(sheet,2,3,['P'],false,true);assert.deepEqual(JSON.parse(JSON.stringify(indexed.map(x=>x.rowNumber))),[4,702]);assert.equal(cellsRead,6,'two matching rows instead of 1000 bodies');
assert.equal(data.readRowsByColumnValues_(sheet,2,3,['NONE'],false,true).length,0);assert.equal(cellsRead,6,'empty match fetches no bodies');
// Reproduce cross-login notification/global-refresh races against actual UI code.
const calls=[],events={};const runner=(meta={})=>new Proxy({}, {get:(_o,k)=>k==='withSuccessHandler'?fn=>runner({...meta,success:fn}):k==='withFailureHandler'?fn=>runner({...meta,failure:fn}):(...args)=>calls.push({method:k,args,...meta})});
const el={hidden:false,textContent:'',innerHTML:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){}};
const c=vm.createContext({console:quiet,Date,Math,Map,Set,Object,Array,Number,String,JSON,window:{addEventListener:(n,f)=>events[n]=f,scrollTo(){}},document:{getElementById:()=>el,addEventListener(){},querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{removeItem(){}},google:{script:{run:runner()}},history:{replaceState(){}},setTimeout:()=>0,clearTimeout(){},clearInterval(){},location:{hash:''},navigator:{}});
for(const name of ['AppCore','AppShell','AppPeopleMonthly','AppQuotes'])vm.runInContext(strip(name),c);
const js=code=>vm.runInContext(code,c);
js("state.sessionToken='A';state.data={user:{employeeId:'A'},today:'2026-10-14',projects:[{name:'A project'}]};renderNotificationMenu=()=>{throw Error('stale notification rendered')};syncGlobalActionBanner=()=>{};");c.loadNotifications();const notification=calls.at(-1);js("state.sessionToken='B';state.data={user:{employeeId:'B'},today:'2026-10-14'}");notification.success({count:1,items:[{title:'private A'}],monthlyReview:{targetMonth:'OLD'}});assert.equal(js('state.data.monthlyReview'),undefined);
c.refreshAppData();const refresh=calls.at(-1);js("state.sessionToken='C';state.data={user:{employeeId:'C'},today:'2026-10-14'}");refresh.success({user:{employeeId:'B'}});refresh.failure(Error('AUTH_REQUIRED'));assert.equal(js('state.data.user.employeeId'),'C');assert.equal(js('state.sessionToken'),'C','stale auth error cannot log out next user');
js("state.data={user:{employeeId:'C'},projects:[{name:'persisted project'}]};setProfileUi=()=>{};renderNav=()=>{};renderPage=()=>{};loadHomeOverview=()=>{};");c.refreshAppData();calls.at(-1).success({user:{employeeId:'C'},projects:[]});assert.equal(js('state.data.projects[0].name'),'persisted project');
js("state.data.user={fullName:'テスト担当者'};state.data.today='2026-10-14'");assert.equal(c.quoteEmptyEditor_().contact,'テスト担当者');
// Confirm drafts and in-flight saves protect against browser reload and logout.
js("quoteUi.dirty=true;state.sessionToken='C'");let prevented=false;const event={preventDefault(){prevented=true;}};events.beforeunload(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');
js("let confirmCount=0,logoutPrompt=null;openConfirmDialog=(...args)=>{confirmCount++;logoutPrompt=args};");const before=calls.length;c.performLogout();assert.equal(js('confirmCount'),1);assert.equal(calls.length,before,'logout does not transmit before draft confirmation');
js('quoteUi.busy=true');c.performLogout(true);assert.equal(calls.length,before,'busy save blocks logout even with draft confirmation');
console.log('PASS operational performance: versioned shell / UTF-8 chunks / partial cache / outage / indexed physical rows / no unrelated bodies / session races / project selection / contact / unsaved and busy guards');
