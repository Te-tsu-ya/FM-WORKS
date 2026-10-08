import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=process.cwd();
const css=fs.readFileSync(path.join(root,'src/Styles.html'),'utf8');
const portal=fs.readFileSync(path.join(root,'src/AppHomePortal.html'),'utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixtures={
  today:'2026-10-08',
  user:{displayName:'架空社員',employeeId:'DEMO1'},
  permissions:{requestApprove:true,adminConsole:true},
  attendance:{state:'off',stateLabel:'勤務外',clockIn:'',clockOut:'',history:[]},
  todaySchedule:[],
  companyToday:{name:'通常勤務'},
  month:{workHours:'0時間00分',overtime:'0時間00分',leaveBalance:'10日',pendingRequests:0},
  tasks:[
    {label:'勤怠の確認',status:'5件',tone:'warning'},
    {label:'工数入力',status:'完了',tone:'info'},
    {label:'申請の承認',status:'0件',tone:'info'}
  ]
};
const context=vm.createContext({
  state:{data:fixtures,homeOverview:{error:''}},
  escapeHtml,
  fmtDate:()=> '10月8日（木）',
  svg:()=>'<svg aria-hidden="true"></svg>',
  liveWorkedText:()=> '0時間00分',
  punchButtons:()=>'<button class="primary-button" type="button">出勤する</button>',
  homeWorkLocationSelector:()=>'<div class="home-location"><span>勤務場所</span><div class="home-location-options"><button>出社</button><button>在宅</button><button>外出</button></div></div>',
  homePunchHistory:()=>'<div class="home-empty-mini">本日の打刻はまだありません。</div>',
  categoryColor:()=> '#1478ff',
  homeOverviewError:()=>'<p class="home-overview-error">読み込みに失敗しました</p>',
  homeOverviewLoading:()=>'<p>集計中</p>',
  Date,Math,Number,String,Object,JSON,Array
});
vm.runInContext(portal,context,{filename:'AppHomePortal.html'});
const home=vm.runInContext('homePage()',context);

const cases=[
  {width:1792,height:854,mode:'standard',fit:true},
  {width:1366,height:768,mode:'standard',fit:true},
  {width:1440,height:900,mode:'standard',fit:true},
  {width:1100,height:700,mode:'standard',fit:false},
  {width:390,height:844,mode:'standard',fit:false},
  {width:1792,height:854,mode:'large',fit:false}
];
function findChrome(){
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
    try {
      const result=execFileSync('which',[name],{encoding:'utf8'}).trim();
      if(result)return result;
    }catch(_){}
  }
  throw new Error('No Chrome/Chromium browser is installed; actual viewport QA cannot run.');
}
const chrome=findChrome();
const outputDir=path.join(root,'artifacts','home-layout');
fs.mkdirSync(outputDir,{recursive:true});
const temporaryDir=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-viewport-'));
let problems=0;
for(const scenario of cases){
  const id=scenario.width+'x'+scenario.height+'-'+scenario.mode;
  const html='<!doctype html><html data-theme="light" data-font-size="'+scenario.mode+'"><head><meta charset="utf-8">'+css+
    '</head><body><div class="app-shell"><aside class="sidebar"><div class="brand">FM WORKS</div></aside>'+
    '<div class="workspace"><header class="topbar"><div class="search-box">社員・申請・予定を検索</div></header>'+
    '<main class="content one-screen">'+home+'</main></div></div>'+
    '<output id="qa-result" style="display:none"></output>'+
    '<script>'+
    'window.addEventListener("load",()=>{requestAnimationFrame(()=>{'+
    'const c=document.querySelector(".content"),portal=document.querySelector(".home-portal-screen"),'+
      'panels=[...document.querySelectorAll(".home-portal-panel")],'+
      'shortcuts=document.querySelector(".home-portal-shortcuts"),'+
      'statButtons=[...document.querySelectorAll(".home-portal-stat")],'+
      'punch=document.querySelector(".home-portal-punch-actions button"),'+
      'doc=document.documentElement;'+
    'const info={width:innerWidth,height:innerHeight,contentBottom:Math.round(c.getBoundingClientRect().bottom),'+
      'shortcutBottom:Math.round(shortcuts.getBoundingClientRect().bottom),'+
      'panelBottom:Math.round(Math.max(...panels.map(p=>p.getBoundingClientRect().bottom))),'+
      'htmlHeight:doc.scrollHeight,htmlWidth:doc.scrollWidth,'+
      'contentHeight:c.clientHeight,contentScrollHeight:c.scrollHeight,'+
      'overflowY:getComputedStyle(c).overflowY,punchHeight:Math.round(punch.getBoundingClientRect().height),'+
      'statsCount:statButtons.length,panelsCount:panels.length};'+
    'document.getElementById("qa-result").setAttribute("data-payload",encodeURIComponent(JSON.stringify(info)));'+
    '});});'+
    '</script></body></html>';
  const file=path.join(temporaryDir,id+'.html');
  fs.writeFileSync(file,html);
  const screenshot=path.join(outputDir,id+'.png');
  const args=['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
    '--no-first-run','--disable-extensions','--force-device-scale-factor=1',
    '--hide-scrollbars','--window-size='+scenario.width+','+scenario.height,
    '--virtual-time-budget=1800','--screenshot='+screenshot,'--dump-dom',pathToFileURL(file).href];
  let result;
  try {
    const stdout=execFileSync(chrome,args,{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,
      stdio:['ignore','pipe','ignore']});
    const payload=stdout.match(/<output id="qa-result" data-payload="([^"]+)"/);
    if(!payload)throw new Error('Chrome did not emit expected layout metrics');
    result=JSON.parse(decodeURIComponent(payload[1]));
  }catch(err){
    problems++;
    console.error('FAIL '+id+': unable to render '+String(err.message||err));
    continue;
  }
  const checks={
    correctViewport:Math.abs(result.width-scenario.width)<=2&&Math.abs(result.height-scenario.height)<=2,
    cards:result.statsCount===4&&result.panelsCount===4,
    noHorizontalOverflow:result.htmlWidth<=result.width+2,
    primaryPunchSize:result.punchHeight>=40
  };
  if(scenario.fit){
    checks.pageFits=result.htmlHeight<=result.height+2;
    checks.mainFits=result.contentBottom<=result.height+2;
    checks.allPanelsVisible=result.panelBottom<=result.height+2&&result.shortcutBottom<=result.height+2;
    checks.noClippedRoot=result.contentScrollHeight<=result.contentHeight+2;
  }else{
    checks.scrollFallback=['visible','auto'].includes(result.overflowY);
  }
  const failed=Object.keys(checks).filter(k=>!checks[k]);
  console.log((failed.length?'FAIL ':'PASS ')+id+' '+JSON.stringify(result)+' '+(failed.length?'failed='+failed.join(','):''));
  if(failed.length)problems++;
}
if(problems){
  console.error('Viewport QA failures: '+problems);
  process.exitCode=1;
}else{
  console.log('All '+cases.length+' responsive Chrome viewport tests passed.');
}
