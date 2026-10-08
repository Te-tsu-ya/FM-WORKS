import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=process.cwd();
const css=fs.readFileSync(path.join(root,'src/Styles.html'),'utf8');
const source=fs.readFileSync(path.join(root,'src/AppOffice.html'),'utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const expense={
  id:'EXP-FAKE',employeeId:'FM-OTHER',employeeName:'架空経理対象',
  vendor:'架空株式会社',item:'文具の購入',amount:'2500',usedOn:'2026-10-08',
  purpose:'デバッグ用の架空経費',status:'承認待ち',receiptRef:'QA-RECEIPT',
  category:'消耗品費',paymentMethod:'立替',createdAt:'2026-10-08 09:00:00'
};
const trip={
  id:'TRP-FAKE',employeeId:'FM-OTHER',employeeName:'架空経理対象',
  destination:'架空の訪問先',spentAmount:'12500',startsOn:'2026-10-08',
  purpose:'架空の出張報告',outcome:'業務確認済み',status:'承認待ち',
  createdAt:'2026-10-08 08:30:00'
};
const receipt={
  id:'REC-FAKE',payer:'架空総務',vendor:'架空株式会社',item:'文具',
  usedOn:'2026-10-08',amount:'2500',paid:'未',createdAt:'2026-10-08 08:00:00'
};
function renderOffice(kind,privileged){
  const state={
    page:'office',sessionToken:'SYNTHETIC_SESSION',
    officeUi:{selected:kind==='overview'?'overview':kind==='planned'?'documents':'expenses',recordId:'',status:'all',query:''},
    data:{today:'2026-10-08',user:{employeeId:'FM-QA',name:'架空社員'},
      permissions:{officeWorkspace:true,financeWorkspace:privileged,adminConsole:privileged}}
  };
  const financeUi={
    overview:{setupRequired:false,expenses:[expense],travels:[trip],receipts:[receipt],
      totals:{expensePending:1,travelPending:1,expenseToSettle:0},
      receiptMatches:{'EXP-FAKE':{status:'MATCHED',label:'金額一致（番号照合）'}}},
    loading:false,error:'',at:Date.now(),limit:160
  };
  const ctx=vm.createContext({
    state,financeUi,
    escapeHtml,
    Date,Math,Number,String,Array,Object,Map,Set,JSON,RegExp,
    svg:()=>'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
    financeAccessAllowed:()=>privileged,
    financeYen:v=>Number(v).toLocaleString('ja-JP')+'円',
    financeOverviewItem_:(type,id)=>{
      const list=type==='expense'?financeUi.overview.expenses:type==='travel'?financeUi.overview.travels:financeUi.overview.receipts;
      return list.find(x=>x.id===id)||null;
    },
    financeDetailRows_:(type,item)=>"<dl class='finance-detail-rows'>"+
      [['区分',type],['申請ID',item.id],['社員',item.employeeName||item.payer],
        ['取引先',item.vendor||item.destination],['金額',item.amount||item.spentAmount],
        ['内容',item.purpose||item.item],['状態',item.status||item.paid],
        ['整理番号',item.receiptRef||''],['申請日',item.usedOn||item.startsOn]]
      .map(([key,val])=>"<div><dt>"+escapeHtml(key)+"</dt><dd>"+escapeHtml(val||'—')+"</dd></div>").join('')+"</dl>",
    pageHead:(name,sub)=>"<header class='page-head'><h1>"+escapeHtml(name)+"</h1><p>"+escapeHtml(sub)+"</p></header>",
    renderPageIfActive:()=>{},
    showToast:()=>{}
  });
  vm.runInContext(source,ctx,{filename:'AppOffice.html'});
  return vm.runInContext('officePage()',ctx);
}
const cases=[
  {width:1792,height:854,kind:'overview',privileged:true,theme:'light'},
  {width:1366,height:768,kind:'overview',privileged:true,theme:'light'},
  {width:1024,height:768,kind:'overview',privileged:true,theme:'light'},
  {width:390,height:844,kind:'overview',privileged:true,theme:'light'},
  {width:1440,height:900,kind:'records',privileged:true,theme:'light'},
  {width:390,height:844,kind:'records',privileged:true,theme:'light'},
  {width:1440,height:900,kind:'overview',privileged:false,theme:'light'},
  {width:390,height:844,kind:'planned',privileged:false,theme:'light'},
  {width:1792,height:854,kind:'overview',privileged:true,theme:'dark'}
];
function findChrome(){
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
    try {const value=execFileSync('which',[name],{encoding:'utf8'}).trim();if(value)return value;}catch(_){}
  }
  throw Error('Chromium is required for office layout QA.');
}
const chrome=findChrome();
const outputDir=path.join(root,'artifacts','office-layout');
fs.mkdirSync(outputDir,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-office-'));
let failures=0;
for(const test of cases){
  const id=test.width+'x'+test.height+'-'+test.kind+'-'+(test.privileged?'finance':'office')+'-'+test.theme;
  const page=renderOffice(test.kind,test.privileged);
  if(!test.privileged&&page.includes('架空経理対象')){
    failures++;console.error('FAIL '+id+' protected financial data leaked');continue;
  }
  if(test.kind==='overview'&&page.indexOf("office-home-work")>page.indexOf("office-home-menu")){
    failures++;console.error('FAIL '+id+' priority work should precede module list in DOM for mobile reading order');continue;
  }
  if(test.kind==='overview'&&!page.includes('office-command')){
    failures++;console.error('FAIL '+id+' hybrid dashboard missing');continue;
  }
  if(test.kind==='records'&&(!page.includes('office-record-columns')||!page.includes('finance-detail-rows'))){
    failures++;console.error('FAIL '+id+' list or record detail missing');continue;
  }
  const body='<!doctype html><html data-theme="'+test.theme+'" data-font-size="standard"><head><meta charset="utf-8">'+css+
    '</head><body><div class="app-shell"><aside class="sidebar"><div class="brand">FM WORKS</div></aside>'+
    '<div class="workspace"><header class="topbar"><div class="search-box">社員・申請・予定</div></header>'+
    '<main class="content">'+page+'</main></div></div>'+
    '<script>'+
    '(()=>{const doc=document.documentElement,content=document.querySelector(".content"),'+
      'office=document.querySelector(".office-v2"),'+
      'homeTiles=[...document.querySelectorAll(".office-shortcut-tile")],'+
      'records=[...document.querySelectorAll(".office-record-row")],'+
      'list=document.querySelector(".office-workspace-list"),detail=document.querySelector(".office-workspace-detail"),'+
      'button=document.querySelector(".office-command-actions button")||document.querySelector(".office-record-row");'+
      'const info={width:innerWidth,height:innerHeight,htmlWidth:doc.scrollWidth,htmlHeight:doc.scrollHeight,'+
      'contentWidth:content.getBoundingClientRect().width,officeWidth:office.getBoundingClientRect().width,'+
      'tiles:homeTiles.length,records:records.length,listWidth:list?list.getBoundingClientRect().width:0,'+
      'detailWidth:detail?detail.getBoundingClientRect().width:0,'+
      'buttonHeight:button?Math.round(button.getBoundingClientRect().height):0,'+
      'visible:office.getBoundingClientRect().width>0};'+
      'parent.postMessage({kind:"FM_WORKS_OFFICE_QA",info},"*");})();'+
    '</script></body></html>';
  const direct=test.width===1366;
  const frame=path.join(temp,id+'-frame.html');fs.writeFileSync(frame,body);
  const file=path.join(temp,id+'.html');
  if(direct){
    fs.writeFileSync(file,body.replace('<script>',
      '<output id="qa-result" style="display:none"></output><script>')
      .replace('parent.postMessage({kind:"FM_WORKS_OFFICE_QA",info},"*");',
        'document.getElementById("qa-result").setAttribute("data-payload",encodeURIComponent(JSON.stringify(info)));'));
  }else{
    const host='<html><head><script>'+
      'window.addEventListener("message",e=>{if(e.data&&e.data.kind==="FM_WORKS_OFFICE_QA")'+
      'document.getElementById("qa-result").setAttribute("data-payload",'+
      'encodeURIComponent(JSON.stringify(e.data.info)));});'+
      '</script></head><body style="margin:0;overflow:hidden">'+
      '<iframe title="FM WORKS office test viewport" src="'+pathToFileURL(frame).href+
      '" style="display:block;border:0;width:'+test.width+'px;height:'+test.height+'px"></iframe>'+
      '<output id="qa-result" style="display:none"></output></body></html>';
    fs.writeFileSync(file,host);
  }
  const baseArgs=['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
    '--no-first-run','--disable-extensions','--force-device-scale-factor=1',
    '--hide-scrollbars','--window-size='+Math.max(500,test.width)+','+(test.height+(direct?87:115)),
    '--virtual-time-budget=5500'];
  let result=null;
  try{
    for(let i=0;i<2;i++){
      const stdout=execFileSync(chrome,[...baseArgs,'--dump-dom',pathToFileURL(file).href],
        {encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']});
      const payload=stdout.match(/<output[^>]*id="qa-result"[^>]*data-payload="([^"]+)"/);
      if(payload){result=JSON.parse(decodeURIComponent(payload[1]));break;}
    }
    if(!result)throw Error('Chromium did not return viewport metrics');
  }catch(error){failures++;console.error('FAIL '+id+': '+String(error.message||error));continue;}
  const checks={
    width:Math.abs(result.width-test.width)<=2,
    height:Math.abs(result.height-test.height)<=2,
    visible:result.visible,
    noHorizontalOverflow:result.htmlWidth<=result.width+2,
    contentWidth:result.officeWidth<=result.contentWidth+2
  };
  if(test.kind==='overview'){checks.sixBusinessCards=result.tiles===6;checks.buttonSize=result.buttonHeight>=40;}
  if(test.kind==='records'){
    checks.recordPresent=result.records>=1;
    checks.listAndDetailsHaveWidth=result.listWidth>=200&&result.detailWidth>=200;
    checks.recordControlSize=result.buttonHeight>=40;
  }
  const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name);
  console.log((failed.length?'FAIL ':'PASS ')+id+' '+JSON.stringify(result)+(failed.length?' checks='+failed.join(','):''));
  if(failed.length)failures++;
  try{
    execFileSync(chrome,[...baseArgs,'--virtual-time-budget=1500',
      '--screenshot='+path.join(outputDir,id+'.png'),pathToFileURL(file).href],
      {timeout:45000,stdio:'ignore'});
  }catch(error){console.warn('Screenshot was unavailable: '+id+' '+String(error.message||error));}
}
if(failures){console.error('Office viewport QA failed: '+failures);process.exitCode=1;}
else console.log('All '+cases.length+' office browser viewport checks passed.');
