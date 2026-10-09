import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
const styles=fs.readFileSync(path.join(root,'src/Styles.html'),'utf8')+'\n'+fs.readFileSync(path.join(root,'src/StylesWorkflowV15.html'),'utf8');
const source=fs.readFileSync(path.join(root,'src/AppQuotes.html'),'utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demoUser={employeeId:'FM9009',name:'架空社員'};
const vendor={code:'FI-0001',name:'架空DX支援株式会社',invoice:'T1234567890123',address:'架空県架空市'};
const demo={id:'QU-FAKE',revision:1,ownerId:demoUser.employeeId,ownerName:demoUser.name,
 vendorCode:vendor.code,vendorName:vendor.name,quoteDate:'2026-10-09',subject:'業務システム開発',
 delivery:'ご相談',payment:'銀行振込',expires:'見積日から1か月',contact:'架空社員',
 bank:'架空銀行・架空支店',note:'これは架空の画面検証データです。',taxRate:10,
 subtotal:500000,taxAmount:50000,total:550000,number:'FI-0001-0002',status:'発行済'};
const demoLines=[
 {description:'月額開発サポート',quantity:2,unit:'ヶ月',price:300000,amount:600000},
 {description:'特別値引き',quantity:2,unit:'式',price:-50000,amount:-100000},
 {description:'※月40時間まで',noteOnly:true,quantity:0,unit:'',price:0,amount:0}
];
function renderQuote(kind){
 const state={page:'quotes',sessionToken:'QA_FAKE',data:{today:'2026-10-09',user:demoUser,permissions:{quoteWorkspace:true}}};
 const cx=vm.createContext({state,console,Math,Date,Number,String,Object,Array,Map,Set,JSON,RegExp,escapeHtml,
 financeYen:value=>(Number(value)||0).toLocaleString('ja-JP')+'円',
 showToast(){},renderPageIfActive(){},pageHead(){},svg:()=>'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 4h18v16H3z"/></svg>'});
 vm.runInContext(source,cx,{filename:'AppQuotes.html'});
 const base={setupRequired:false,vendors:[vendor],sequencesReady:['FI-0001'],quotes:[demo],total:1,displayLimit:200,canConfigure:false};
 cx.quoteUi=undefined;
 vm.runInContext('quoteUi.data=__sampleData;quoteUi.mode=__sampleMode;quoteUi.editor=__sampleEditor;quoteUi.details=__sampleDetails;quoteUi.id=__sampleId;',Object.assign(cx,{
  __sampleData:base,__sampleMode:kind==='list'?'list':kind==='edit'?'edit':'detail',
  __sampleEditor:{...demo,id:'',revision:0,lines:demoLines},
  __sampleDetails:{header:demo,lines:demoLines},__sampleId:demo.id
 }));
 return vm.runInContext('quotePage()',cx);
}
let chrome='';
for(const program of ['google-chrome','google-chrome-stable','chromium']){
 try{chrome=execFileSync('which',[program],{encoding:'utf8'}).trim();if(chrome)break;}catch(_){}
}
if(!chrome)throw Error('Chromium required to validate quote UI');
const target=path.join(root,'artifacts','quote-layout');fs.mkdirSync(target,{recursive:true});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-quote-'));
const cases=[
 [1366,768,'list','light'],[390,844,'list','light'],
 [1440,900,'edit','light'],[390,844,'edit','light'],
 [1366,768,'detail','light'],[390,844,'detail','dark']
];
let bad=0;
for(const [width,height,kind,theme] of cases){
 const id=width+'x'+height+'-'+kind+'-'+theme;
 const html=renderQuote(kind);
 const inner='<!doctype html><html lang="ja" data-theme="'+theme+'"><head><meta charset="utf-8">'+styles+'</head>'+
  '<body><div class="app-shell"><aside class="sidebar"><div class="brand">FM WORKS</div></aside>'+
  '<div class="workspace"><header class="topbar">FM WORKS</header><main class="content">'+html+
  '</main></div></div>'+
  '<script>const shell=document.querySelector(".quote-layout")||document.querySelector(".v15-quote-overview"),'+
  'toolbar=shell.querySelector(".quote-toolbar")||shell.querySelector(".v15-page-hero"),'+
  'buttons=[...shell.querySelectorAll("button")],all=[...shell.querySelectorAll(".quote-line")];'+
  'const info={w:innerWidth,h:innerHeight,scrollWidth:document.documentElement.scrollWidth,'+
  'shellWidth:shell.getBoundingClientRect().width,toolbarHeight:toolbar.getBoundingClientRect().height,'+
  'lines:all.length,buttons:buttons.length,smallButton:buttons.filter(x=>x.getBoundingClientRect().height>0).map(x=>x.getBoundingClientRect().height).sort((a,b)=>a-b)[0]||0};'+
  'parent.postMessage({kind:"QUOTE_QA",info},"*");</script></body></html>';
 const frame=path.join(tmp,id+'-inner.html');fs.writeFileSync(frame,inner);
 const host='<html><head><meta charset="utf-8"><script>'+
  'window.addEventListener("message",e=>{if(e.data&&e.data.kind==="QUOTE_QA")document.getElementById("metrics").setAttribute("data-metrics",encodeURIComponent(JSON.stringify(e.data.info)));});'+
  '</script></head><body style="margin:0"><iframe src="'+pathToFileURL(frame).href+
  '" style="border:0;display:block;width:'+width+'px;height:'+height+'px"></iframe><output id="metrics"></output></body></html>';
 const file=path.join(tmp,id+'-host.html');fs.writeFileSync(file,host);
 const args=['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage','--disable-extensions',
  '--hide-scrollbars','--window-size='+Math.max(width,600)+','+(height+110),'--virtual-time-budget=4000'];
 let metrics;
 try{
  const response=execFileSync(chrome,[...args,'--dump-dom',pathToFileURL(file).href],
   {encoding:'utf8',timeout:45000,maxBuffer:5*1024*1024,stdio:['ignore','pipe','ignore']});
  const match=response.match(/id="metrics"[^>]*data-metrics="([^"]+)"/);
  if(!match)throw Error('Viewport metrics not captured');
  metrics=JSON.parse(decodeURIComponent(match[1]));
  const reasons=[];
  if(Math.abs(metrics.w-width)>2)reasons.push('width');
  if(metrics.scrollWidth>width+2)reasons.push('horizontal overflow');
  if(metrics.shellWidth<=0)reasons.push('empty screen');
  if(metrics.buttons<1)reasons.push('no actionable control');
  if(kind==='edit'&&metrics.lines!==3)reasons.push('editable line count');
  if(metrics.smallButton<26)reasons.push('button too small');
  console.log((reasons.length?'FAIL ':'PASS ')+id+' '+JSON.stringify(metrics)+(reasons.length?' '+reasons.join(','):''));
  if(reasons.length)bad++;
  try{
   execFileSync(chrome,[...args,'--screenshot='+path.join(target,id+'.png'),pathToFileURL(file).href],
     {timeout:45000,stdio:'ignore'});
  }catch(e){console.warn('Unable to capture screenshot for '+id);}
 }catch(e){bad++;console.error('FAIL '+id+' '+String(e.message||e));}
}
console.log('QUOTE VIEWPORT TESTS: '+(cases.length-bad)+'/'+cases.length+' passed');
if(bad)process.exitCode=1;
