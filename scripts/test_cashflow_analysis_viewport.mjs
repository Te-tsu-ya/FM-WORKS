import fs from 'node:fs';import vm from 'node:vm';import os from 'node:os';
import path from 'node:path';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const css=['Styles.html','StylesCashFlow.html','StylesCashFlowBank.html','StylesCashFlowAnalysis.html']
 .map(name=>fs.readFileSync('src/'+name,'utf8')).join('\n');
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx=vm.createContext({
 state:{sessionToken:'ADMIN_FAKE',page:'finance',data:{today:'2026-10-11',permissions:{adminConsole:true,cashFlowWorkspace:true}}},
 cashFlowUi:{open:true,year:2026},financeUi:{demo:false},escapeHtml,
 cashFlowAllowed_:()=>true,renderPageIfActive(){},cleanApiErrorMessage:e=>e.message,
 pageHead:(t,s)=>'<h1>'+t+'</h1>'+s,showToast(){},console,Date,Math,Number,String,Object,Array,Map,Set,JSON,Error,RegExp
});
for(const name of ['AppCashFlowBank','AppCashFlowAnalysis'])
 vm.runInContext(fs.readFileSync('src/'+name+'.html','utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),ctx);
const months=Array.from({length:12},(_,i)=>i?'2026-'+String(i).padStart(2,'0'):'2025-12');
const fixture={workspace:{ok:true,setupRequired:false,year:2026,months,unreviewedCount:2,accounts:[{id:'AC1',bank:'架空信用金庫',name:'本店 普通'}],
 checks:[{accountId:'AC1',accountName:'本店 普通',month:'2026-10',latestBalance:1450000,actualIn:200000,actualOut:75000,importedCount:6,verified:false,revision:1,note:'Web画面で照合中'}],
 rules:[{id:'R1',keyword:'カイヅヤ',category:'売上入金',tags:'契約',direction:'IN',priority:90,active:true,revision:1}],
 scenarios:[{id:'S1',name:'売上1か月遅延',changes:[],revision:1}]},
 banks:{accounts:[{id:'AC1',bank:'架空信用金庫',name:'本店 普通'}],plans:[{id:'P1',title:'受託案件',active:true,amount:100000,direction:'IN',startMonth:'2025-12',endMonth:'2026-11',frequency:'MONTHLY'}]},
 rows:[{id:'T1',accountId:'AC1',date:'2026-10-11',description:'カイヅヤ 業務入金',incoming:200000,outgoing:0,category:'売上入金',tags:'契約',note:'請求書を確認',revision:1,reviewed:true,suggested:false,transfer:false},
 {id:'T2',accountId:'AC1',date:'2026-10-10',description:'サーバー利用料',incoming:0,outgoing:75000,category:'通信費',tags:'月額',note:'',revision:0,reviewed:false,suggested:true,transfer:false}],
 projection:{ok:true,setupRequired:false,scenarioId:'S1',scenarioName:'売上1か月遅延',plannedIn:1200000,plannedOut:890000,yearEnd:1960000,firstShort:'',
  warnings:['2026-10 の入金取引の区分を確認してください。'],
  rows:months.map((month,i)=>({month,plannedIn:100000,plannedOut:75000,actualIn:i===10?200000:null,actualOut:i===10?75000:null,
    forecastEnd:1450000+i*25000,difference:i===10?-100000:0,source:i<5?'確定実績':'予定'}))}
};
const cases=[
 {w:1366,h:768,tab:'analysis',theme:'light',editor:true},
 {w:390,h:844,tab:'analysis',theme:'dark',editor:true},
 {w:320,h:720,tab:'analysis',theme:'light'},
 {w:1440,h:900,tab:'scenarios',theme:'light',editor:true},
 {w:390,h:844,tab:'scenarios',theme:'dark',editor:true},
 {w:1440,h:900,tab:'reports',theme:'dark'},
 {w:390,h:844,tab:'reports',theme:'light'}
];
const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser'].map(binary=>{
 try{return execFileSync('which',[binary],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return ''}
}).find(Boolean);
assert.ok(chrome,'Chromium required for cash flow responsive verification');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-cashflow-qa-'));
fs.mkdirSync('artifacts/cashflow-analysis',{recursive:true});
for(const c of cases){
 vm.runInContext('cfbUi.tab='+JSON.stringify(c.tab)+';cfbUi.loaded='+JSON.stringify(fixture.banks)+';cfaUi.year=2026;cfaUi.workspace='+JSON.stringify(fixture.workspace)+
  ';cfaUi.month="2026-10";cfaUi.rows='+JSON.stringify(fixture.rows)+';cfaUi.total=2;cfaUi.projection='+JSON.stringify(fixture.projection)+
  ';cfaUi.scenarioId="S1";cfaUi.editor='+(c.editor&&c.tab==='analysis'?JSON.stringify({id:'T1',category:'売上入金',tags:'契約',note:'請求書を確認',revision:1}):'null')+
  ';cfaUi.scenarioDraft='+(c.editor&&c.tab==='scenarios'?JSON.stringify({id:'S1',revision:1,name:'売上1か月遅延',changes:[{type:'SHIFT',month:'2026-10',planId:'P1',monthsDelta:1}]}):'null')+';',ctx);
 const content=ctx.cfaPage_();assert.ok(content.includes('cfa-panel'),c.tab+' panel missing');
 const id=c.w+'x'+c.h+'-'+c.tab+'-'+c.theme+'-'+(c.editor?'editor':'view');
 const frame='<html lang="ja" data-theme="'+c.theme+'"><head><meta charset="utf-8">'+css+'</head><body>'+
  '<div class="app-shell"><div class="workspace"><main class="content"><div class="cf-workspace"><header class="cf-head"><h1>年間資金繰り｜2026年11月期</h1></header>'+
  content+'</div></main></div></div>'+
  '<script>addEventListener("load",()=>{const surface=document.querySelector(".cfa-panel");parent.postMessage({type:"CFA_QA",data:{width:innerWidth,scroll:document.documentElement.scrollWidth,panel:!!surface,heading:!!surface?.querySelector("h2"),visibleTop:surface?.getBoundingClientRect().top,buttons:document.querySelectorAll("button").length,inputsContained:[...document.querySelectorAll(".cfa-editor input,.cfa-editor select,.cfa-reconcile-item input")].every(e=>e.getBoundingClientRect().right<=innerWidth+2),theme:getComputedStyle(surface).backgroundColor}},"*")})</script></body></html>';
 const fp=path.join(temp,id+'-frame.html');fs.writeFileSync(fp,frame);
 const host='<html><head><script>addEventListener("message",e=>{if(e.data?.type==="CFA_QA")document.getElementById("result").setAttribute("data-value",encodeURIComponent(JSON.stringify(e.data.data)))})</script></head><body style="margin:0"><iframe title="Cashflow QA" style="display:block;border:0;width:'+c.w+'px;height:'+c.h+'px" src="'+pathToFileURL(fp).href+'"></iframe><output id="result"></output></body></html>';
 const hp=path.join(temp,id+'.html');fs.writeFileSync(hp,host);
 const flags=['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--no-first-run','--force-device-scale-factor=1','--window-size='+Math.max(c.w,520)+','+(c.h+130),'--virtual-time-budget=1300'];
 const dump=execFileSync(chrome,[...flags,'--dump-dom',pathToFileURL(hp).href],{encoding:'utf8',timeout:30000,maxBuffer:3*1024*1024,stdio:['ignore','pipe','ignore']});
 const match=dump.match(/<output[^>]*id="result"[^>]*data-value="([^"]+)"/);
 assert.ok(match,'Missing browser metrics: '+id);
 const v=JSON.parse(decodeURIComponent(match[1]));
 assert.equal(v.width,c.w);assert.ok(v.panel&&v.heading,id+' missing UI');
 assert.ok(v.scroll<=c.w+2,id+' overflows document '+JSON.stringify(v));
 assert.ok(v.inputsContained,id+' overflows input or select '+JSON.stringify(v));
 assert.ok(v.visibleTop<500,id+' content hidden below first viewport');
 assert.ok(v.buttons>=2,id+' missing usable controls');
 if(c.theme==='dark')assert.notEqual(v.theme,'rgb(255, 255, 255)',id+' white surface in dark');
 if(c.w===1440||c.tab==='analysis'||c.editor)execFileSync(chrome,[...flags,'--screenshot='+path.resolve('artifacts/cashflow-analysis/'+id+'.png'),pathToFileURL(hp).href],{timeout:30000,stdio:'ignore'});
 console.log('PASS cashflow responsive '+id+' '+JSON.stringify(v));
}
