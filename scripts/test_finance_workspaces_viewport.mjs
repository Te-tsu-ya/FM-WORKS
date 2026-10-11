import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
const client=name=>fs.readFileSync(path.join(root,'src',name+'.html'),'utf8')
 .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const css=['Styles','StylesWorkflowV15','StylesFinanceAdvisor','StylesFinanceWorkspace','StylesFinanceGrid'].map(name=>
 fs.readFileSync(path.join(root,'src',name+'.html'),'utf8')).join('\n');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const data={setupRequired:false,expenses:[
 {id:'E1',employeeId:'U1',employeeName:'架空社員A',usedOn:'2026-10-10',item:'文具代',
  category:'消耗品費',vendor:'架空文具店',amount:2800,status:'承認待ち',receiptRef:'EX01'},
 {id:'E2',employeeId:'U2',employeeName:'架空社員B',usedOn:'2026-10-08',item:'交通費',
  category:'旅費交通費',vendor:'架空交通社',amount:4200,status:'承認済',receiptRef:'EX02'}
 ],travels:[],receipts:[
 {id:'R1',creatorId:'U1',payer:'架空社員A',usedOn:'2026-10-10',vendor:'架空文具店',
  item:'文具代',category:'消耗品費',amount:2800,paid:'済',receiptRef:'EX01'}
 ],receiptMatches:{E1:{status:'MATCHED',label:'一致'}},totals:{
 expensePending:1,travelPending:0,expenseToSettle:1,travelToSettle:0,
 expense:2,travel:0,receipt:1,expenseHidden:0,travelHidden:0,receiptHidden:0
 }};
const runs=[
 [1440,900,'overview','light'],[390,844,'overview','dark'],[320,700,'overview','light'],
 [1440,900,'approvals','light'],[390,844,'ledger','light'],
 [1440,900,'bulk','light'],[390,844,'bulk','dark'],[320,700,'bulk','light']
];
function generate(mode){
 const state={sessionToken:'QA_SYNTHETIC',page:'finance',data:{
  today:'2026-10-11',permissions:{financeWorkspace:true,cashFlowWorkspace:true,adminConsole:true},
  user:{employeeId:'QA',name:'架空管理者'}}};
 const cx=vm.createContext({console,Date,String,Number,Math,Array,Object,Map,Set,JSON,RegExp,
  state,escapeHtml:esc,svg:()=>'<svg aria-hidden="true"></svg>',
  cashFlowUi:{open:false},cfbUi:{tab:'overview'},cashFlowAllowed_:()=>true,
  renderPageIfActive:()=>{},showToast:()=>{},navigate:()=>{},
  cleanApiErrorMessage:error=>String(error?.message||error),pageHead:(name)=>'<h1>'+esc(name)+'</h1>'
 });
 vm.runInContext(client('AppFinance'),cx,{filename:'AppFinance.html'});
 vm.runInContext(client('AppFinanceWorkspace'),cx,{filename:'AppFinanceWorkspace.html'});
 vm.runInContext(client('AppFinanceGrid'),cx,{filename:'AppFinanceGrid.html'});
 cx.qaData=data;
 vm.runInContext('financeUi.overview=qaData; financeWorkspaceMode='+JSON.stringify(mode)+';',cx);
 if(mode==='bulk'){
  const sample='利用日\t経費種別\t取引先\t品目\t金額\t支払者\t支払方法\t支払有無\n'+
   '2026/10/09\t消耗品費\t架空文具店\t事務用品\t2200\t架空社員A\t会社カード\t済\n'+
   '2026/10/10\t交通費\t架空交通社\t電車代\t1450\t架空社員B\t現金\t済\n';
  cx.qaSample=sample;
  vm.runInContext('financeBulkUi.raw=qaSample;financeBulkPreview_()',cx);
  const got=vm.runInContext('financeBulkUi.rows.length',cx);
  if(got!==2)throw Error('bulk paste preview did not parse two rows');
 }
 const html=vm.runInContext('financePage()',cx);
 if(!html.includes('fw-navigation'))throw Error('finance menu not rendered');
 if(mode==='bulk'&&(!html.includes('fg-grid')||!html.includes('data-fin-cell')))throw Error('direct spreadsheet grid not rendered');
 if(mode==='approvals'&&!html.includes('financeSelectedDetail'))throw Error('approvals inspector not rendered');
 if(mode==='ledger'&&!html.includes('経費台帳'))throw Error('ledger entry not rendered');
 return html;
}
function chrome(){
 for(const cmd of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  try{const found=execFileSync('which',[cmd],{encoding:'utf8'}).trim();if(found)return found;}catch(_){}
 }
 throw Error('Chromium is required for visual QA');
}
const bin=chrome(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fm-fin-workspace-'));
const output=path.join(root,'artifacts','finance-workspace');fs.mkdirSync(output,{recursive:true});
let errors=0;
for(const [width,height,mode,theme] of runs){
 const name=width+'x'+height+'-'+mode+'-'+theme;
 try {
  const page=generate(mode);
  const frame='<!doctype html><html lang="ja" data-theme="'+theme+'"><head><meta charset="utf-8">'+css+
   '</head><body><div class="app-shell"><aside class="sidebar"><strong>FM WORKS</strong></aside>'+
   '<div class="workspace"><header class="topbar">FM WORKS</header><main class="content">'+page+
   '</main></div></div><script>const root=document.querySelector(".fw-root"),'+
   'nav=document.querySelector(".fw-navigation"),'+
   'grid=document.querySelector(".fw-grid-scroll"),'+
   'buttons=[...document.querySelectorAll(".fw-root button")],'+
   'info={width:innerWidth,docWidth:document.documentElement.scrollWidth,'+
   'rootWidth:root?.getBoundingClientRect().width||0,navCount:nav?.querySelectorAll("button").length||0,navColumns:getComputedStyle(nav).gridTemplateColumns.split(" ").filter(Boolean).length,'+
   'actions:buttons.length,minButtonHeight:Math.min(...buttons.filter(b=>b.getBoundingClientRect().height>0).map(b=>b.getBoundingClientRect().height)),'+
   'gridScrollWidth:grid?.scrollWidth||0,gridClientWidth:grid?.clientWidth||0};'+
   'parent.postMessage({kind:"FINANCE_WORKSPACE_QA",info},"*");</script></body></html>';
  const framePath=path.join(tmp,name+'-frame.html');fs.writeFileSync(framePath,frame);
  const host='<html><head><meta charset="utf-8"><script>window.addEventListener("message",e=>{if(e.data?.kind==="FINANCE_WORKSPACE_QA")document.getElementById("res").setAttribute("data-qa",encodeURIComponent(JSON.stringify(e.data.info)));});</script></head>'+
   '<body style="margin:0;overflow:hidden"><iframe src="'+pathToFileURL(framePath).href+'"'+
   ' style="display:block;width:'+width+'px;height:'+height+'px;border:0" title="Finance workspaces QA"></iframe><output id="res"></output></body></html>';
  const hostPath=path.join(tmp,name+'-host.html');fs.writeFileSync(hostPath,host);
  const common=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-extensions','--hide-scrollbars',
   '--window-size='+Math.max(600,width)+','+(height+100),'--virtual-time-budget=2500'];
  const dom=execFileSync(bin,[...common,'--dump-dom',pathToFileURL(hostPath).href],
   {encoding:'utf8',timeout:45000,maxBuffer:7*1024*1024,stdio:['ignore','pipe','ignore']});
  const encoded=dom.match(/id="res"[^>]*data-qa="([^"]+)"/)?.[1];
  if(!encoded)throw Error('Chromium viewport metric callback absent');
  const info=JSON.parse(decodeURIComponent(encoded)),issues=[];
  if(info.width!==width)issues.push('viewport width mismatch');
  if(info.docWidth>width+2)issues.push('document horizontal overflow');
  if(info.rootWidth<100)issues.push('workspace is not visible');
  if(info.navCount!==6)issues.push('six workspace tabs missing');
  if(width<=360&&info.navColumns!==2)issues.push('compact navigation must show all six items in two columns');
  if(width>360&&width<=760&&info.navColumns!==3)issues.push('mobile navigation must show all six items in three columns');
  if(info.actions<6)issues.push('quick actions missing');
  if(info.minButtonHeight<28)issues.push('button hit target below 28px');
  if(mode==='bulk'&&info.gridScrollWidth<=info.gridClientWidth)issues.push('table horizontal scroll absent');
  if(issues.length)throw Error(issues.join(', ')+' '+JSON.stringify(info));
  console.log('PASS '+name+' '+JSON.stringify(info));
  try{execFileSync(bin,[...common,'--screenshot='+path.join(output,name+'.png'),pathToFileURL(hostPath).href],
    {timeout:45000,stdio:'ignore'});}catch(_){}
 }catch(error){console.error('FAIL '+name+' '+String(error.message||error));errors++;}
}
console.log('Finance workspace viewport QA: '+(runs.length-errors)+'/'+runs.length);
if(errors)process.exitCode=1;