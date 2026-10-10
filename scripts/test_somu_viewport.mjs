import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=process.cwd();
const css=['Styles.html','StylesWorkflowV15.html','StylesSomu.html']
 .map(f=>fs.readFileSync(path.join(root,'src',f),'utf8')).join('\n');
const source=fs.readFileSync(path.join(root,'src/AppSomu.html'),'utf8')
 .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demoData={
  setupRequired:false,today:'2026-10-10',canApprove:true,
  assets:[
    {id:'AS-A',code:'FM-PC-001',name:'検証用ノートPC',category:'パソコン',maker:'架空メーカー',model:'DEMO-A',location:'総務室',quantity:4,minimum:1,status:'利用中',revision:2},
    {id:'AS-B',code:'FM-CAB-002',name:'HDMIケーブル',category:'消耗品',location:'保管庫',quantity:2,minimum:5,status:'利用中',revision:1}
  ],
  loans:[{id:'LN-A',assetId:'AS-A',assetCode:'FM-PC-001',borrower:'架空利用者',quantity:1,loanDate:'2026-10-01',dueDate:'2026-10-06',status:'貸出中'}],
  purchases:[{id:'PR-A',name:'コピー用紙',quantity:5,estimatedPrice:700,neededOn:'2026-10-13',reason:'社内消耗品',requesterName:'架空申請者',requesterId:'FM0002',status:'申請中'}],
  documents:[{id:'DOC-A',name:'架空貸出申請書',category:'申請書',location:'共有ドライブ',status:'有効',url:'https://example.com',expiresOn:''}]
};
const ctx=vm.createContext({
 state:{page:'office',sessionToken:'synthetic-session',data:{
  today:'2026-10-10',user:{employeeId:'FM0001'},permissions:{officeWorkspace:true}}},
 escapeHtml,svg:()=>'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>',
 pageHead:(title,desc)=>'<header><h1>'+escapeHtml(title)+'</h1><p>'+escapeHtml(desc)+'</p></header>',
 renderPageIfActive:()=>{},showToast:()=>{},document:{getElementById:()=>null},
 console,Date,Math,Number,String,Array,Object,Map,JSON,Set,RegExp
});
vm.runInContext(source,ctx,{filename:'AppSomu.html'});
vm.runInContext('somuUi.loaded=true;somuUi.data='+JSON.stringify(demoData),ctx);
assert.ok(vm.runInContext("somuPage()",ctx).includes('somu-workspace'));
vm.runInContext("somuTab('assets')",ctx);
assert.ok(vm.runInContext("somuPage()",ctx).includes('FM-PC-001'));
vm.runInContext("somuSearch('ケーブル')",ctx);
assert.equal(vm.runInContext("somuRows('assets').length",ctx),1);
vm.runInContext("somuUi.query='';state.data.permissions.officeWorkspace=false",ctx);
assert.ok(vm.runInContext("somuPage()",ctx).includes('権限'));
vm.runInContext("state.data.permissions.officeWorkspace=true",ctx);

const cases=[
 {w:1440,h:900,tab:'home',theme:'light'},
 {w:1366,h:768,tab:'home',theme:'light'},
 {w:1024,h:768,tab:'home',theme:'light'},
 {w:390,h:844,tab:'home',theme:'light'},
 {w:1440,h:900,tab:'assets',theme:'light'},
 {w:390,h:844,tab:'assets',theme:'light'},
 {w:1440,h:900,tab:'purchases',theme:'dark'},
 {w:390,h:844,tab:'loans',theme:'dark'}
];
const bin=['google-chrome','google-chrome-stable','chromium','chromium-browser']
 .map(cmd=>{try{return execFileSync('which',[cmd],{encoding:'utf8'}).trim();}catch{return '';}})
 .find(Boolean);
if(!bin)throw Error('Chromium browser not found');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'somu-ui-'));
const outputs=path.join(root,'artifacts','somu-layout');fs.mkdirSync(outputs,{recursive:true});
let failed=0;
for(const c of cases){
 vm.runInContext("somuTab("+JSON.stringify(c.tab)+")",ctx);
 const fragment=vm.runInContext("somuPage()",ctx);
 const id=c.w+'x'+c.h+'-'+c.tab+'-'+c.theme;
 const iframe='<html lang="ja" data-theme="'+c.theme+'"><head><meta charset="utf-8">'+css+'</head>'+
 '<body><div class="app-shell"><aside class="sidebar"><div class="brand">FM WORKS</div></aside>'+
 '<div class="workspace"><header class="topbar">FM WORKS</header><main class="content">'+fragment+'</main></div></div>'+
 '<script>addEventListener("load",()=>{const x=document.documentElement,content=document.querySelector(".content"),page=document.querySelector(".somu-workspace");'+
 'const result={width:innerWidth,height:innerHeight,scrollWidth:x.scrollWidth,pageWidth:page?.getBoundingClientRect().width,'+
 'contentWidth:content?.getBoundingClientRect().width,heading:!!document.querySelector(".somu-heading h1"),'+
 'tabs:document.querySelectorAll(".somu-tabs button").length,records:document.querySelectorAll(".somu-list-item").length};'+
 'parent.postMessage({type:"SOMU_QA",result},"*")});</script></body></html>';
 const iframePath=path.join(dir,id+'-frame.html');fs.writeFileSync(iframePath,iframe);
 const host='<html><head><script>addEventListener("message",e=>{if(e.data?.type==="SOMU_QA")document.getElementById("result").setAttribute("data-qa",encodeURIComponent(JSON.stringify(e.data.result)))})</script></head>'+
 '<body style="margin:0"><iframe title="Somu QA" style="display:block;border:0;width:'+c.w+'px;height:'+c.h+'px" src="'+pathToFileURL(iframePath).href+'"></iframe><output id="result"></output></body></html>';
 const hostPath=path.join(dir,id+'.html');fs.writeFileSync(hostPath,host);
 const flags=['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
   '--force-device-scale-factor=1','--window-size='+Math.max(c.w,520)+','+(c.h+130),
   '--virtual-time-budget=3300','--disable-extensions','--no-first-run'];
 try{
 const dump=execFileSync(bin,[...flags,'--dump-dom',pathToFileURL(hostPath).href],
   {encoding:'utf8',timeout:40000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','ignore']});
 const match=dump.match(/<output[^>]*id="result"[^>]*data-qa="([^"]+)"/);
 if(!match)throw Error('No browser metrics');
 const v=JSON.parse(decodeURIComponent(match[1]));
 const errors=[];
 if(Math.abs(v.width-c.w)>2)errors.push('viewport-width');
 if(Math.abs(v.height-c.h)>2)errors.push('viewport-height');
 if(v.scrollWidth>v.width+2)errors.push('horizontal-overflow');
 if(!v.heading||v.tabs!==5)errors.push('navigation');
 if(v.pageWidth>v.contentWidth+2)errors.push('content-clipping');
 if(c.tab!=='home'&&v.records<1)errors.push('record-missing');
 console.log((errors.length?'FAIL ':'PASS ')+id+' '+JSON.stringify(v)+(errors.length?' errors='+errors.join(','):''));
 if(errors.length)failed++;
 }catch(error){failed++;console.error('FAIL '+id+' '+String(error.message||error));}
 if(c.tab==='home'||c.tab==='assets'){
 try{execFileSync(bin,[...flags,'--screenshot='+path.join(outputs,id+'.png'),pathToFileURL(hostPath).href],
 {timeout:40000,stdio:'ignore'});}catch{}
 }
}
if(failed){console.error('Somu UI viewport failures: '+failed);process.exitCode=1;}
else console.log('PASS all '+cases.length+' Somu UI browser viewports, filters and permission-gates');
