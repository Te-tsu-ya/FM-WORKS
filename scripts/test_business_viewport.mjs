import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
const css=fs.readFileSync(path.join(root,'src/Styles.html'),'utf8');
const source=n=>fs.readFileSync(path.join(root,'src/'+n+'.html'),'utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sampleExpense={
 id:'EXP-QA',employeeId:'FM_OTHER',employeeName:'架空社員B',vendor:'架空食品株式会社',
 item:'事務用品・文房具',amount:'14680',usedOn:'2026-10-09',category:'消耗品費',
 status:'承認待ち',purpose:'事務作業で使用する備品購入',paymentMethod:'立替',
 receiptRef:'REC-QA-1',createdAt:'2026-10-09 08:00:00'
};
const sampleTravel={
 id:'TRV-QA',employeeId:'FM_OTHER',employeeName:'架空社員B',title:'営業',
 startsOn:'2026-10-07',startsAt:'09:00',endsOn:'2026-10-09',endsAt:'18:00',
 destination:'架空市 本社',purpose:'取引先へのシステム説明',
 outcome:'新しい要件を持ち帰って検討する',spentAmount:'42620',
 lodgingArea:'架空県',nights:'2',requestedAllowance:'4000',
 status:'承認待ち',createdAt:'2026-10-09 08:00:00'
};
function renderBusiness(kind){
 const state={page:kind==='finance'?'finance':'requests',sessionToken:'SYNTHETIC_SESSION',
  data:{today:'2026-10-09',user:{employeeId:'FM_QA',name:'架空社員A'},
   permissions:{adminConsole:true,financeWorkspace:true,quoteWorkspace:true}}};
 const cx=vm.createContext({
   console,Date,Math,Number,String,Object,Array,Map,Set,JSON,RegExp,state,escapeHtml,
   renderPageIfActive(){},showToast(){},navigate(){},pageHead:(title,subtitle)=>
     '<div class="page-head"><h1>'+escapeHtml(title)+'</h1><p>'+escapeHtml(subtitle)+'</p></div>',
   svg:()=>'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>'
 });
 if(kind==='admin'){
   vm.runInContext(source('AppQuotes'),cx,{filename:'AppQuotes.html'});
   vm.runInContext(source('AppAdmin'),cx,{filename:'AppAdmin.html'});
   cx.__sampleQuoteData={setupRequired:false,canConfigure:true,
     vendors:[{code:'FI-0001',name:'架空DX支援株式会社',invoice:'T1234567890123',address:'架空県架空市'},
       {code:'SV-0002',name:'架空販売株式会社',invoice:'T9876543210001',address:'架空県架空町'}],
     sequencesReady:['FI-0001'],quotes:[],total:0,displayLimit:200};
   vm.runInContext('quoteUi.data=__sampleQuoteData;',cx);
   return '<div class="fm-business-page fm-admin-quote-settings"><header class="fm-business-hero"><h1>管理・設定 / 取引先・見積採番</h1></header>'+
     vm.runInContext('quoteAdminSettingsSection_()',cx)+'</div>';
 }
 vm.runInContext(source('AppFinance'),cx,{filename:'AppFinance.html'});
 if(kind==='expense'||kind==='travel'){
   cx.__sampleDraft=kind==='expense'?
     {usedOn:'2026-10-09',vendor:'架空食品株式会社',item:'事務用品・文房具',category:'消耗品費',
       amount:'14680',purpose:'事務所用消耗品の購入',paymentMethod:'立替',receiptRef:'REC-QA-1'}:
     {startsOn:'2026-10-07',startsAt:'09:00',endsOn:'2026-10-09',endsAt:'18:00',
       destination:'架空市 本社',purpose:'取引先の訪問',outcome:'次回の仕様確定について話し合った',
       spentAmount:'42620',lodgingArea:'架空県',nights:'2',requestedAllowance:'4000'};
   cx.__entryKind=kind;
   vm.runInContext('financeActiveForm={inline:true,kind:__entryKind,draft:__sampleDraft,draftDirty:true,editId:"",key:"TEST"};',cx);
   return vm.runInContext('financeEntryPage_()',cx);
 }
 cx.__overview={setupRequired:false,expenses:[sampleExpense],travels:[sampleTravel],receipts:[],
   totals:{expensePending:1,travelPending:1,expenseHidden:0,travelHidden:0,receiptHidden:0}};
 vm.runInContext('financeUi.overview=__overview;financeUi.tab="expense";financeUi.selectedId="EXP-QA";',cx);
 return vm.runInContext('financePage()',cx);
}
let chrome='';
for(const name of ['google-chrome','google-chrome-stable','chromium']){
 try{chrome=execFileSync('which',[name],{encoding:'utf8'}).trim();if(chrome)break;}catch(_){}
}
if(!chrome)throw Error('Chromium is required for business UI verification.');
const folder=path.join(root,'artifacts/business-layout');fs.mkdirSync(folder,{recursive:true});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-business-'));
const cases=[
 [1440,900,'finance','light'],[390,844,'finance','light'],
 [1440,900,'expense','light'],[390,844,'expense','light'],
 [1440,900,'travel','light'],[390,844,'travel','dark'],
 [1440,900,'admin','light'],[390,844,'admin','light']
];
let failed=0;
for(const [width,height,kind,theme] of cases){
 const id=width+'x'+height+'-'+kind+'-'+theme;
 let page='';
 try{page=renderBusiness(kind);}catch(e){console.error('FAIL '+id+' VM render: '+String(e.stack||e));failed++;continue;}
 const inner='<!doctype html><html lang="ja" data-theme="'+theme+'"><head><meta charset="utf-8">'+css+'</head><body>'+
  '<div class="app-shell"><aside class="sidebar"><strong>FM WORKS</strong></aside><div class="workspace">'+
  '<header class="topbar">FM WORKS</header><main class="content">'+page+'</main></div></div>'+
  '<script>window.addEventListener("error",e=>parent.postMessage({kind:"BUSINESS_QA_ERROR",message:String(e.message)},"*"));'+
  'const root=document.querySelector(".fm-business-page"),'+
  'buttons=[...root.querySelectorAll("button")],inputs=[...root.querySelectorAll("input,textarea,select")],'+
  'primary=[...root.querySelectorAll(".primary-button")],'+
  'content=document.querySelector(".content");'+
  'parent.postMessage({kind:"BUSINESS_QA",info:{width:innerWidth,height:innerHeight,'+
  'scrollWidth:document.documentElement.scrollWidth,rootWidth:root.getBoundingClientRect().width,'+
  'contentWidth:content.getBoundingClientRect().width,inputs:inputs.length,buttons:buttons.length,'+
  'primary:primary.length,shortestButton:buttons.filter(b=>b.getBoundingClientRect().height>0)'+
  '.map(b=>b.getBoundingClientRect().height).sort((a,b)=>a-b)[0]||0}},"*");</script></body></html>';
 const frame=path.join(tmp,id+'-frame.html');fs.writeFileSync(frame,inner);
 const host='<html><head><script>window.addEventListener("message",e=>{const o=document.getElementById("qa");'+
  'if(e.data?.kind==="BUSINESS_QA")o.setAttribute("data-payload",encodeURIComponent(JSON.stringify(e.data.info)));'+
  'if(e.data?.kind==="BUSINESS_QA_ERROR")o.setAttribute("data-error",e.data.message);});</script></head>'+
  '<body style="margin:0"><iframe title="FM WORKS synthetic business viewport" src="'+pathToFileURL(frame).href+
  '" style="border:0;display:block;width:'+width+'px;height:'+height+'px"></iframe>'+
  '<output id="qa" style="display:none"></output></body></html>';
 const pathHost=path.join(tmp,id+'-host.html');fs.writeFileSync(pathHost,host);
 const args=['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
  '--disable-extensions','--hide-scrollbars','--window-size='+Math.max(width,600)+','+(height+110)];
 try{
   let match=null,last='';
   for(let attempt=0;attempt<2;attempt++){
     last=execFileSync(chrome,[...args,'--virtual-time-budget=5500','--dump-dom',pathToFileURL(pathHost).href],
       {encoding:'utf8',timeout:45000,maxBuffer:6*1024*1024,stdio:['ignore','pipe','ignore']});
     match=last.match(/id="qa"[^>]*data-payload="([^"]+)"/);
     if(match)break;
     const error=last.match(/data-error="([^"]+)"/);
     if(error)throw Error(error[1]);
   }
   if(!match)throw Error('Browser metrics unavailable');
   const m=JSON.parse(decodeURIComponent(match[1])),errors=[];
   if(Math.abs(m.width-width)>2)errors.push('viewport width mismatch');
   if(m.scrollWidth>width+2)errors.push('horizontal overflow');
   if(m.rootWidth<=0||m.rootWidth>m.contentWidth+2)errors.push('incorrect page size');
   if(m.buttons<1)errors.push('no controls');
   if((kind==='expense'||kind==='travel')&&m.inputs<5)errors.push('missing form fields');
   if(kind==='finance'&&m.inputs<2)errors.push('missing search and filter');
   if(kind==='admin'&&m.inputs<3)errors.push('missing vendor setup form');
   if(m.shortestButton<25)errors.push('button below tap threshold');
   console.log((errors.length?'FAIL ':'PASS ')+id+' '+JSON.stringify(m)+(errors.length?' '+errors.join(', '):''));
   if(errors.length)failed++;
   try{execFileSync(chrome,[...args,'--screenshot='+path.join(folder,id+'.png'),
       '--virtual-time-budget=1800',pathToFileURL(pathHost).href],{timeout:45000,stdio:'ignore'});}
   catch(_){console.warn('Screenshot capture unavailable '+id);}
 }catch(e){failed++;console.error('FAIL '+id+' '+String(e.message||e));}
}
console.log('BUSINESS VIEWPORT TESTS: '+(cases.length-failed)+'/'+cases.length+' passed');
if(failed)process.exitCode=1;
