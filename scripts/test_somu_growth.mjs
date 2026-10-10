import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const src=fs.readFileSync('src/Somu.gs','utf8');
const growth=fs.readFileSync('src/SomuGrowth.gs','utf8');
new Function(src);new Function(growth);
const ui=['AppSomu.html','AppSomuGrowth.html'].map(n=>
 fs.readFileSync('src/'+n,'utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'')).join('\n');
execFileSync(process.execPath,['--check','-'],{input:ui,encoding:'utf8'});
const specs={
 '総務備品':15,'総務貸出':14,'総務購買':18,'総務書類':12,
 '総務契約':20,'総務施設設備':17,'総務依頼':17
};
const defs=Object.fromEntries(Object.entries(specs).map(([name,n])=>[name,
 Array.from({length:n},(_,i)=>name+'_COL_'+i)]));
const sheets={};
function createSheet(name){
 const rows=[defs[name]];
 return {rows,getLastRow(){return rows.length;},
 getRange(r,c,n,w){return{
  getDisplayValues:()=>rows.slice(r-1,r-1+n).map(a=>a.slice(c-1,c-1+w).map(v=>String(v??''))),
  setValues:values=>values.forEach((row,i)=>{const base=rows[r-1+i]||Array.from({length:defs[name].length},()=>'');
   row.forEach((v,j)=>{base[c-1+j]=v});rows[r-1+i]=base;})
 };},
 appendRow(row){rows.push([...row]);}
 };
}
for(const name of Object.keys(specs).slice(0,4))sheets[name]=createSheet(name);
let employee={employeeId:'F001',name:'架空総務担当',role:'ADMIN',department:'総務'};
let counter=0,audit=[],cache=new Map(),sheetReadCount=0;
const ctx=vm.createContext({
 Object,Array,String,Number,Date,JSON,Map,Set,Math,RegExp,Error,console,Uint8Array,Buffer,
 DB:{timeZone:'Asia/Tokyo'},DB_SCHEMA_SPECS:defs,
 requireSession_:()=>({employee}),
 assertPermission_:(e,p)=>{if(p!=='officeWorkspace'||(e.role!=='ADMIN'&&e.department!=='総務'))throw Error('権限なし');},
 getDb_:()=>({getSheetByName:name=>sheets[name]||null}),
 getDatabaseSpreadsheetId_:()=> 'DUMMY_DB',
 cacheJsonGet_:key=>cache.get(key)||null,
 cacheJsonPut_:(key,value)=>{cache.set(key,JSON.parse(JSON.stringify(value)));return true;},
 cacheRemove_:key=>{cache.delete(key);},
 logPerformance_:()=>{},
 schemaHeaderIssues_:(actual,expected)=>expected.flatMap((v,i)=>v===actual[i]?[]:[i]),
 Utilities:{formatDate:(d,tz,format)=>format==='yyyy-MM-dd'?'2026-10-10':'2026-10-10 10:00:00',
   newBlob:x=>({getBytes:()=>Array.from(Buffer.from(x,'utf8'))})},
 safeSheetText_:(v,max)=>String(v??'').trim().slice(0,max||200),
 normalizeDate_:s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s).toISOString().slice(0,10)!==s)throw Error('日付');return s;},
 withScriptLock_:fn=>fn(),
 createId_:p=>p+'-'+(++counter),
 appendAudit_:x=>audit.push(x),auditJson_:v=>JSON.stringify(v)
});
vm.runInContext(src+'\n'+growth,ctx,{filename:'GAS Somu Growth'});
const call=(name,...args)=>vm.runInContext(name,ctx)(...args);
assert.equal(call('getSomuWorkspace','auth').setupRequired,false,
 'existing four general affairs tables should not require optional migration');
const unready=call('getSomuGrowthData','auth');
assert.equal(unready.ready,false);assert.equal(unready.missing.length,3);
for(const name of Object.keys(specs).slice(4))sheets[name]=createSheet(name);
const empty=call('getSomuGrowthData','auth');
assert.equal(empty.ready,true);assert.equal(empty.contracts.length,0);
assert.equal(cache.size,2,'base and growth snapshots can coexist independently');
employee={employeeId:'NO',name:'架空一般社員',role:'USER',department:'営業'};
assert.throws(()=>call('getSomuGrowthData','auth'),/権限/,'no shared cache authorization bypass');
assert.throws(()=>call('saveSomuGrowthRecord','auth','contract',{}),/権限/);
employee={employeeId:'F001',name:'架空総務担当',role:'ADMIN',department:'総務'};
assert.throws(()=>call('saveSomuGrowthRecord','auth','contract',
 {name:'不正',vendor:'提供元',startedOn:'2027-01-01',expiresOn:'2026-01-01',requestKey:'key-long-00001'}),/開始日以降/);
assert.throws(()=>call('saveSomuGrowthRecord','auth','contract',
 {name:'不正',vendor:'提供元',url:'javascript:alert(1)',requestKey:'key-long-00002'}),/https/);
const contract={
 name:'架空の保守契約',vendor:'架空ベンダー',category:'保守',startedOn:'2026-01-01',expiresOn:'2026-12-31',
 noticeOn:'2026-11-30',renewal:'自動更新あり',annualYen:150000,owner:'総務担当',
 url:'https://example.com/contract',status:'有効',requestKey:'key-long-00003'
};
const c=call('saveSomuGrowthRecord','auth','contract',contract);
assert.equal(c.ok,true);assert.equal(c.record.revision,1);
assert.equal(cache.size,0,'write removes shared snapshot cache');
assert.equal(call('saveSomuGrowthRecord','auth','contract',contract).duplicate,true);
assert.equal(call('getSomuGrowthData','auth').contracts.length,1);
assert.throws(()=>call('saveSomuGrowthRecord','auth','contract',{
 ...contract,id:c.record.id,revision:0,name:'古い情報'}),/更新/);
const updated=call('saveSomuGrowthRecord','auth','contract',{
 ...contract,id:c.record.id,revision:1,name:'架空の保守契約・更新'});
assert.equal(updated.record.revision,2);
assert.equal(updated.record.name,'架空の保守契約・更新');
const facility={code:'FM-CAR-1',name:'架空の社用車',type:'車両',location:'駐車場',
 lastCheckedOn:'2026-01-01',nextCheckOn:'2026-11-01',status:'稼働中',requestKey:'key-long-00004'};
const car=call('saveSomuGrowthRecord','auth','facility',facility);
assert.equal(car.record.type,'車両');
assert.throws(()=>call('saveSomuGrowthRecord','auth','facility',{
 ...facility,requestKey:'key-long-00005'}),/同じ管理番号/);
assert.throws(()=>call('saveSomuGrowthRecord','auth','facility',{
 ...facility,lastCheckedOn:'2026-12-01',requestKey:'key-long-00006'}),/以降/);
const ticket={subject:'架空備品の修理',category:'設備・修理',priority:'高',assignee:'架空担当B',
 dueOn:'2026-10-20',description:'修理依頼',status:'未着手',requestKey:'key-long-00007'};
const t=call('saveSomuGrowthRecord','auth','ticket',ticket);
assert.equal(t.record.requesterName,'架空総務担当');
employee={employeeId:'F002',name:'別の架空総務担当',role:'ADMIN',department:'総務'};
assert.throws(()=>call('saveSomuGrowthRecord','auth','ticket',ticket),/送信識別子/);
const done=call('saveSomuGrowthRecord','auth','ticket',{...ticket,id:t.record.id,revision:1,status:'完了'});
assert.equal(done.record.resolvedOn,'2026-10-10');
const reopened=call('saveSomuGrowthRecord','auth','ticket',{...ticket,id:t.record.id,revision:2,status:'対応中'});
assert.equal(reopened.record.resolvedOn,'');
assert.ok(audit.length>=5);
assert.deepEqual(new Set(Object.keys(specs)).size,7);

// Client UI must show the 8 grouped destinations and a real contract form.
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,disabled:false,
 innerHTML:'',focus(){}});return elements.get(id);}
let rpc=[],succeeded=null,failed=null,closeCalls=0;
const runner={withSuccessHandler(fn){succeeded=fn;return proxy;},withFailureHandler(fn){failed=fn;return proxy;}};
const proxy=new Proxy(runner,{get(o,prop){if(prop in o)return o[prop];return(...args)=>{rpc.push({api:String(prop),args});return proxy;};}});
const htmlEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modal={innerHTML:''};
const browser=vm.createContext({
 state:{page:'office',sessionToken:'SESSION',data:{today:'2026-10-10',user:{employeeId:'F001'},
   permissions:{officeWorkspace:true,adminConsole:true}}},
 escapeHtml:htmlEscape,svg:()=>'<svg/>',pageHead:(t,m)=>t+' '+m,showToast:()=>{},
 closeModal:()=>{closeCalls++},ensureModal:()=>modal,document:{getElementById:el},
 window:{},google:{script:{run:proxy}},renderPageIfActive:()=>{},Date,Math,String,Number,Object,
 Set,Map,JSON,RegExp,WeakMap,console
});
vm.runInContext(ui,browser,{filename:'AppSomuGrowth'});
const ev=s=>vm.runInContext(s,browser);
ev("somuUi.loaded=true;somuUi.data={setupRequired:false,assets:[],loans:[],purchases:[],documents:[],today:'2026-10-10',canApprove:true}");
ev("somuGrowth.loaded=true;somuGrowth.loadedAt=Date.now();somuGrowth.data="+JSON.stringify({
 ready:true,contracts:[c.record],facilities:[car.record],tickets:[t.record],today:'2026-10-10'}) );
const home=ev('somuPage()');
assert.match(home,/今日、対応すること/);assert.match(home,/契約・更新/);assert.doesNotMatch(home,/CONTRACT WATCH/);
assert.equal((home.match(/aria-current="(page|false)"/g)||[]).length,8);
const syntheticPurchases=Array.from({length:7},(_,i)=>({id:'PQ'+i,name:'架空購買'+i,requesterName:'架空担当',status:'申請中',quantity:1,estimatedPrice:100}));
ev('somuUi.data.purchases='+JSON.stringify(syntheticPurchases));
const denseHome=ev('somuPage()');
assert.equal((denseHome.match(/class="somu-task somu-focus-row"/g)||[]).length,4,'only four highest-priority actions in first fold');
assert.match(denseHome,/ほか\d+件は各台帳から確認/);
ev("somuUi.data.purchases=[]");
ev("somuTab('contracts')");
assert.equal(ev("somuRows('assets').length"),0);
const contractPage=ev('somuPage()');
assert.match(contractPage,/架空の保守契約/);
ev("somuGrowthOpenForm_('contracts')");
assert.match(modal.innerHTML,/原本へのリンク/);
el('somug-name').value='架空更新契約';
el('somug-vendor').value='架空ベンダー';
el('somug-annualYen').value='55000';
ev('somuGrowthSubmit_()');
assert.equal(rpc.at(-1).api,'saveSomuGrowthRecord');
assert.equal(rpc.at(-1).args[1],'contract');
assert.equal(rpc.at(-1).args[2].name,'架空更新契約');
assert.equal(ev('somuUi.busy'),true);
ev('somuGrowthSubmit_()');
assert.equal(rpc.filter(x=>x.api==='saveSomuGrowthRecord').length,1);
succeeded({ok:true,record:{...c.record,id:'CTR-CREATED',name:'架空更新契約'}});
assert.equal(ev('somuUi.busy'),false);
assert.equal(rpc.at(-1).api,'getSomuGrowthData');
ev('somuDemo(true)');
const beforeDemo=rpc.length;
ev("somuGrowthOpenForm_('contracts')");
assert.equal(rpc.length,beforeDemo);
assert.match(ev('somuPage()'),/架空データ/);
console.log('PASS SOMU Growth: migration isolation, contract/facility/ticket CRUD, permissions, locks, deduplication, renewals UI');
