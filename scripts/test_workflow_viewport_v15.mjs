import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=process.cwd();
const css=fs.readFileSync(path.join(root,'src/Styles.html'),'utf8')+'\n'+
  fs.readFileSync(path.join(root,'src/StylesWorkflowV15.html'),'utf8')+'\n'+
  fs.readFileSync(path.join(root,'src/StylesFinanceAdvisor.html'),'utf8');
const source=name=>fs.readFileSync(path.join(root,'src/'+name+'.html'),'utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[ch]));
const sampleExpense={id:'EXP-QA',employeeId:'FM-OTHER',employeeName:'架空社員B',
 vendor:'架空食品株式会社',item:'事務用品・文具',category:'消耗品費',amount:'14680',
 usedOn:'2026-10-09',purpose:'社内業務用品の購入',paymentMethod:'立替',
 receiptRef:'QA-RECEIPT',status:'承認待ち',createdAt:'2026-10-09 09:00:00'};
const sampleTravel={id:'TR-QA',employeeId:'FM-OTHER',employeeName:'架空社員B',
 destination:'架空市役所',startsOn:'2026-10-07',endsOn:'2026-10-09',startsAt:'09:00',
 endsAt:'18:00',spentAmount:'42620',purpose:'架空の打ち合わせ',outcome:'仕様を確認',
 status:'承認待ち',createdAt:'2026-10-09 09:00:00'};
const sampleQuote={id:'QU-QA',number:'FI-0001-0002',revision:2,ownerName:'架空社員A',
 vendorName:'架空DX支援株式会社',vendorCode:'FI-0001',quoteDate:'2026-10-09',
 issuedAt:'2026-10-09 09:00:00',subject:'業務システム開発',
 status:'発行済',subtotal:500000,taxAmount:50000,total:550000};
const vendors=[
 {code:'FI-0001',name:'架空DX支援株式会社',invoice:'T1234567890123',address:'架空市'},
 {code:'SV-0002',name:'架空物流株式会社',invoice:'',address:'架空町'}
];
function renderScreen(kind){
 const state={page:kind.startsWith('finance')?'finance':kind==='quote'?'quotes':'financeEntry',
  sessionToken:'SYNTHETIC_SESSION',data:{
   today:'2026-10-09',user:{employeeId:'FM-QA',name:'架空社員A',displayName:'架空社員A'},
   permissions:{adminConsole:true,officeWorkspace:true,financeWorkspace:true,quoteWorkspace:true}}};
 const cx=vm.createContext({state,console,Date,Math,Number,String,Object,Array,Set,Map,JSON,
  RegExp,escapeHtml,showToast(){},renderPageIfActive(){},navigate(){},pageHead:(title,sub)=>
    '<div class="page-head"><h1>'+escapeHtml(title)+'</h1><p>'+escapeHtml(sub)+'</p></div>',
  financeYen:v=>(Number(v)||0).toLocaleString('ja-JP')+'円',
  svg:icon=>'<svg role="img" aria-label="'+escapeHtml(icon)+'" viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg>'});
 if(['finance','financeDemo','financeInsights','expense','travel'].includes(kind)){
  vm.runInContext(source('AppFinance'),cx,{filename:'AppFinance.html'});
  vm.runInContext(source('AppFinanceAdvisor'),cx,{filename:'AppFinanceAdvisor.html'});
  if(kind==='finance'||kind==='financeDemo'||kind==='financeInsights'){
   cx.qaFinance={setupRequired:false,expenses:[sampleExpense],travels:[sampleTravel],
    receipts:[],totals:{expensePending:1,travelPending:1,expenseToSettle:0,
      travelToSettle:0,receipt:0,expenseHidden:0,travelHidden:0,receiptHidden:0}};
   vm.runInContext('financeUi.overview=qaFinance;financeUi.tab="expense";financeUi.demo='+JSON.stringify(kind==='financeDemo')+';',cx);
   if(kind==='financeInsights'){
     cx.qaIns={ok:true,year:2026,total:4200,count:2,months:[
       {name:'2026-09',amount:1200,count:1},{name:'2026-10',amount:3000,count:1}],
       payers:[{name:'架空社員A',amount:1200,count:1},{name:'架空社員B',amount:3000,count:1}],
       vendors:[{name:'架空備品店',amount:1200,count:1}],
       items:[{name:'文具',amount:1200,count:1}],
       records:[{date:'2026-10-02',payer:'架空社員B',vendor:'架空交通社',
         item:'交通費',amount:3000,method:'会社カード',note:''}]};
     vm.runInContext('financeUi.insightMode=true;financeUi.insights=qaIns;financeUi.insightYear=2026;',cx);
   }
   return vm.runInContext('financePage()',cx);
  }
  cx.qaKind=kind;
  cx.qaDraft=kind==='expense'?
   {usedOn:'2026-10-09',vendor:'架空食品株式会社',item:'事務用品',category:'消耗品費',
    amount:'14680',purpose:'事務用品の購入',paymentMethod:'立替',receiptRef:'REC-001'}:
   {startsOn:'2026-10-07',startsAt:'09:00',endsOn:'2026-10-09',endsAt:'18:00',
    destination:'架空市役所',purpose:'協議',outcome:'内容を確認',spentAmount:'42620'};
  vm.runInContext('financeActiveForm={kind:qaKind,source:qaDraft,key:"QA-FAKE-KEY",editId:"",changed:false};',cx);
  return vm.runInContext('financeEntryPage()',cx);
 }
 vm.runInContext(source('AppQuotes'),cx,{filename:'AppQuotes.html'});
 cx.qaQuotes={setupRequired:false,canConfigure:true,vendors,sequencesReady:['FI-0001'],
   quotes:[sampleQuote],total:1,displayLimit:200};
 vm.runInContext('quoteUi.data=qaQuotes;',cx);
 if(kind==='quote')return vm.runInContext('quotePage()',cx);
 vm.runInContext(source('AppAdmin'),cx,{filename:'AppAdmin.html'});
 const section=vm.runInContext('quoteAdministrationSection_()',cx);
 return '<div class="v15-workspace"><header class="v15-page-hero"><div><h1>管理・設定 / 取引先・採番</h1>'+
   '<p>取引先の登録と見積番号の確認</p></div></header>'+section+'</div>';
}
function findChrome(){
 for(const exe of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  try{const p=execFileSync('which',[exe],{encoding:'utf8'}).trim();if(p)return p;}catch(_){}
 }
 throw Error('Chromium not found');
}
const chrome=findChrome();
const output=path.join(root,'artifacts','workflow-v15');fs.mkdirSync(output,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-workflow-'));
const cases=[
 [1366,768,'finance','light'],[390,844,'finance','dark'],
 [1366,768,'financeInsights','light'],[390,844,'financeInsights','dark'],
  [1600,900,'financeDemo','light'],[1366,768,'financeDemo','dark'],
  [390,844,'financeDemo','light'],[320,700,'financeDemo','dark'],
 [1366,768,'expense','light'],[390,844,'expense','light'],
 [1440,900,'travel','light'],[390,844,'travel','dark'],
 [1366,768,'quote','light'],[390,844,'quote','light'],
 [1440,900,'admin','light'],[390,844,'admin','light']
];
let failed=0;
for(const [width,height,kind,theme] of cases){
 const id=width+'x'+height+'-'+kind+'-'+theme;
 let page;
 try{page=renderScreen(kind);}catch(error){
  failed++;console.error('FAIL '+id+' render: '+String(error.stack||error));continue;
 }
 if(!page.includes("v15-workspace")||page.includes('ReferenceError:')){
  failed++;console.error('FAIL '+id+' missing unified content');continue;
 }
 if(kind!=='financeInsights'&&kind.startsWith('finance')&&(!page.includes('finance-ledger-table')||
     !page.includes('financeSelectedDetail')||!page.includes('financeSetMonthFilter('))){
   failed++;console.error('FAIL '+id+' finance ledger structure missing');continue;
  }
  if(kind==='financeInsights'&&(!page.includes('支出の見える化')||!page.includes('finance-advisor-months'))){
   failed++;console.error('FAIL '+id+' spending analytics summary missing');continue;
  }
  if(kind==='financeDemo'&&!page.includes('サンプル表示中｜架空データ')){
   failed++;console.error('FAIL '+id+' clearly-labeled synthetic data missing');continue;
  }
  if((kind==='expense'||kind==='travel')&&!page.includes('financeEntryForm')){
  failed++;console.error('FAIL '+id+' missing data entry form');continue;
 }
 const frame=path.join(temp,id+'-frame.html');
 const html='<!doctype html><html lang="ja" data-theme="'+theme+'"><head><meta charset="utf-8">'+css+
  '</head><body><div class="app-shell"><aside class="sidebar"><strong>FM WORKS</strong></aside>'+
  '<div class="workspace"><header class="topbar">FM WORKS</header><main class="content">'+page+
  '</main></div></div>'+
  '<script>window.addEventListener("error",e=>parent.postMessage({kind:"WORKFLOW_ERROR",msg:e.message},"*"));'+
  'const root=document.querySelector(".v15-workspace"),'+
  'content=document.querySelector(".content"),buttons=[...root.querySelectorAll("button")],'+
  'inputs=[...root.querySelectorAll("input,textarea,select")],'+
  'info={width:innerWidth,height:innerHeight,htmlWidth:document.documentElement.scrollWidth,'+
  'rootWidth:root.getBoundingClientRect().width,contentWidth:content.getBoundingClientRect().width,'+
  'buttons:buttons.length,inputs:inputs.length,'+
  'shortestButton:buttons.filter(x=>x.getBoundingClientRect().height>0).map(x=>x.getBoundingClientRect().height).sort((a,b)=>a-b)[0]||0};'+
  'if(root.classList.contains("finance-v0173")){'+
   'const meter=root.querySelector(".finance-priority-stats");'+
   'info.metricColumns=meter?getComputedStyle(meter).gridTemplateColumns.split(" ").filter(Boolean).length:0;}'+
   'parent.postMessage({kind:"WORKFLOW_QA",info},"*");</script></body></html>';
 fs.writeFileSync(frame,html);
 const host='<html><head><meta charset="utf-8"><script>'+
  'window.addEventListener("message",e=>{const n=document.getElementById("qa");'+
  'if(e.data?.kind==="WORKFLOW_QA")n.setAttribute("data-payload",encodeURIComponent(JSON.stringify(e.data.info)));'+
  'if(e.data?.kind==="WORKFLOW_ERROR")n.setAttribute("data-error",e.data.msg);});</script>'+
  '</head><body style="margin:0;overflow:hidden"><iframe src="'+pathToFileURL(frame).href+
  '" style="display:block;border:0;width:'+width+'px;height:'+height+'px" title="V15 application viewport"></iframe>'+
  '<output id="qa"></output></body></html>';
 const hostFile=path.join(temp,id+'-host.html');fs.writeFileSync(hostFile,host);
 const args=['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--disable-extensions',
  '--hide-scrollbars','--window-size='+Math.max(600,width)+','+(height+110),
  '--virtual-time-budget=5000'];
 try{
  let result=null,body='';
  for(let i=0;i<2;i++){
   body=execFileSync(chrome,[...args,'--dump-dom',pathToFileURL(hostFile).href],
    {encoding:'utf8',timeout:45000,maxBuffer:6*1024*1024,stdio:['ignore','pipe','ignore']});
   const match=body.match(/id="qa"[^>]*data-payload="([^"]+)"/);
   if(match){result=JSON.parse(decodeURIComponent(match[1]));break;}
  }
  if(!result)throw Error((body.match(/data-error="([^"]+)"/)||[])[1]||'No viewport metrics');
  const errors=[];
  if(Math.abs(result.width-width)>2)errors.push('viewport width');
  if(result.htmlWidth>width+2)errors.push('horizontal overflow');
  if(result.rootWidth<=0||result.rootWidth>result.contentWidth+2)errors.push('content width');
  if(!result.buttons)errors.push('no actions');
  if(['expense','travel'].includes(kind)&&result.inputs<6)errors.push('missing form fields');
  if(kind.startsWith('finance')&&result.inputs<(kind==='financeInsights'?2:3))errors.push('missing finance search controls');
  if(kind==='admin'&&result.inputs<3)errors.push('missing master form controls');
   if(kind.startsWith('finance')&&kind!=='financeInsights'&&width>=1200&&result.metricColumns!==4)errors.push('desktop finance KPIs are not one row');
   if(kind.startsWith('finance')&&kind!=='financeInsights'&&width<=760&&result.metricColumns!==2)errors.push('mobile finance KPI grid is not two columns');
  if(result.shortestButton<25)errors.push('button below 25px');
  console.log((errors.length?'FAIL ':'PASS ')+id+' '+JSON.stringify(result)+
    (errors.length?' checks='+errors.join(', '):''));
  if(errors.length)failed++;
  try{execFileSync(chrome,[...args,'--screenshot='+path.join(output,id+'.png'),
   '--virtual-time-budget=1800',pathToFileURL(hostFile).href],{timeout:45000,stdio:'ignore'});}catch(_){}
 }catch(error){failed++;console.error('FAIL '+id+' '+String(error.message||error));}
}

/* Real Chromium DOM interaction probe: no GAS network and no persistent data. */
function verifyFinanceClicks(width,height){
  const stateSource="const state={page:'finance',sessionToken:'FAKE_SESSION',data:{today:'2026-10-10',"+
    "user:{employeeId:'FM-QA'},permissions:{financeWorkspace:true}}};";
  const boot=String.raw`
  const problems=[];
  const apiCalls=[];
  function check(name,value){if(!value)problems.push(name);}
  function escapeHtml(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function svg(){return '<svg aria-hidden="true"></svg>';}
  function showToast(){}
  function pageHead(title){return '<h1>'+escapeHtml(title)+'</h1>';}
  function cleanApiErrorMessage(){return '検証用エラー';}
  function renderPageIfActive(page){if(page===state.page)document.getElementById('content').innerHTML=financePage();}
  const google={script:{run:new Proxy({}, {get(_target,name){return (...args)=>{apiCalls.push({name,args});return this;};}})}};
  `;
  const verify=String.raw`
  try{
    financeUi.demo=true;
    renderPageIfActive('finance');
    check('demo banner',document.querySelector('.finance-demo-banner')!==null);
    const pickSelector=innerWidth<=760?'.finance-mobile-record-list .finance-record-pick[data-id="DEMO-EXP-002"]':
      '.finance-ledger-table .finance-record-pick[data-id="DEMO-EXP-002"]';
    const chosen=document.querySelector(pickSelector);
    check('selectable row exists',!!chosen);
    if(chosen)chosen.click();
    check('row click updates inspector',financeUi.selectedIds.expense==='DEMO-EXP-002'&&
      document.getElementById('financeSelectedDetail').textContent.includes('8,560円'));
    const search=document.getElementById('financeSearchInput');
    search.focus();search.value='架空社員F';
    search.dispatchEvent(new Event('input',{bubbles:true}));
    check('search filters visible rows',financeVisibleItems_('expense').length===1);
    check('search retains keyboard focus',document.activeElement===search);
    const month=document.querySelector('.finance-ledger-filters input[type="month"]');
    month.value='2026-09';month.dispatchEvent(new Event('change',{bubbles:true}));
    check('month filter updates displayed rows',financeVisibleItems_('expense').length===0);
    const travel=[...document.querySelectorAll('.finance-kind-tabs button')].find(n=>n.textContent.includes('出張報告'));
    check('travel tab exists',!!travel);if(travel)travel.click();
    check('tab clicks switch dataset',financeUi.tab==='travel'&&financeVisibleItems_('travel').length===3);
    const travelPick=document.querySelector(innerWidth<=760?
      '.finance-mobile-record-list .finance-record-pick[data-id="DEMO-TR-002"]':
      '.finance-ledger-table .finance-record-pick[data-id="DEMO-TR-002"]');
    check('travel row exists',!!travelPick);if(travelPick)travelPick.click();
    check('travel inspector shows correct selected record',
      document.getElementById('financeSelectedDetail').textContent.includes('架空支店'));
    financeSubmitDecision('expense','DEMO-EXP-001','APPROVE');
    financeSubmitSettlement('expense','DEMO-EXP-003');
    check('demo never touches GAS',apiCalls.length===0);
    financeToggleDemo();
    check('exiting demo removes fabricated content',
      !financeUi.demo&&!document.getElementById('content').textContent.includes('架空支店'));
  }catch(e){problems.push('runtime '+(e&&e.message||String(e)));}
  document.getElementById('qaFinance').setAttribute('data-result',encodeURIComponent(JSON.stringify({
    success:problems.length===0,issues:problems,apiCalls:apiCalls.length
  })));
  `;
  const html='<!doctype html><html lang="ja"><head><meta charset="utf-8">'+css+'</head>'+
    '<body><div class="app-shell"><aside class="sidebar"><strong>FM WORKS</strong></aside>'+
    '<main class="workspace"><div id="content" class="content"></div><output id="qaFinance"></output></main></div>'+
    '<script>'+stateSource+boot+source('AppFinance')+verify+'</script></body></html>';
  const file=path.join(temp,'finance-clicks-'+width+'x'+height+'.html');
  fs.writeFileSync(file,html);
  const dom=execFileSync(chrome,['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
    '--window-size='+Math.max(600,width)+','+(height+100),'--dump-dom',pathToFileURL(file).href],
    {encoding:'utf8',timeout:45000,maxBuffer:7*1024*1024,stdio:['ignore','pipe','ignore']});
  const match=dom.match(/id="qaFinance"[^>]*data-result="([^"]+)"/);
  if(!match)throw Error('Finance interaction probe did not complete');
  const data=JSON.parse(decodeURIComponent(match[1]));
  console.log((data.success?'PASS ':'FAIL ')+'finance browser interactions '+width+'x'+height+' '+JSON.stringify(data));
  if(!data.success)failed++;
}
for(const [width,height] of [[1366,768],[390,844]]){
 try{verifyFinanceClicks(width,height);}catch(error){failed++;console.error('FAIL finance clicks '+width+'x'+height+' '+String(error.message||error));}
}

console.log('UNIFIED WORKFLOW V15 VIEWPORTS: '+(cases.length-failed)+'/'+cases.length+' passed');
if(failed)process.exitCode=1;