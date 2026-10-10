import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=process.cwd(),css=['Styles.html','StylesWorkflowV15.html','StylesCompanyDocs.html']
  .map(n=>fs.readFileSync(path.join(root,'src',n),'utf8')).join('\n');
const src=fs.readFileSync(path.join(root,'src/AppCompanyDocs.html'),'utf8')
  .replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const escapeHtml=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const folders=[
{id:'hr',parentId:'',name:'人事・労務'},{id:'hr/work',parentId:'hr',name:'就業・勤怠'},
{id:'hr/leave',parentId:'hr',name:'休暇・福利厚生'},
{id:'general',parentId:'',name:'総務・設備'},{id:'general/equipment',parentId:'general',name:'備品・貸出'},
{id:'finance',parentId:'',name:'経理・出張'},{id:'finance/expenses',parentId:'finance',name:'経費精算'},
{id:'safety',parentId:'',name:'安全・衛生'},{id:'safety/health',parentId:'safety',name:'衛生・健康'},
{id:'information',parentId:'',name:'情報管理'},{id:'information/security',parentId:'information',name:'セキュリティ'},
{id:'other',parentId:'',name:'その他'},{id:'other/general',parentId:'other',name:'その他の文書'}
];
const types=['就業規則','社内規程','マニュアル','その他'];
const paths=['hr/work','hr/leave','general/equipment','finance/expenses','safety/health','information/security','other/general'];
const labels=['就業規則','福利厚生規程','備品管理規程','経費精算マニュアル','安全衛生管理規程','情報セキュリティ基本規程','連絡マニュアル'];
const items=Array.from({length:21},(_,i)=>({
  id:'CD-test-'+String(i+1000000000000),title:'【DEMO】'+labels[i%labels.length],
  folderId:paths[i%paths.length],tags:['業務','検証'],category:types[i%types.length],
  summary:'架空の業務文書で検索・分類を確認するためのデモ項目です。',
  updatedAt:'2026-10-'+String(10-(i%9)).padStart(2,'0')+' 10:00:00',
  effectiveOn:'2026-10-01',revision:1,status:i===9?'下書き':'公開'
}));
const data={ok:true,setupRequired:false,canManage:true,needsUpgrade:false,
  canInitialize:true,folders,categories:types,items};
const ctx=vm.createContext({
  state:{page:'companyDocs',sessionToken:'synthetic',data:{user:{employeeId:'FM-DEMO'}}},
  escapeHtml,renderPageIfActive:()=>{},Date,Math,Number,String,Array,Object,Set,RegExp,
  document:{getElementById:()=>null}
});
vm.runInContext(src,ctx,{filename:'AppCompanyDocs.html'});
vm.runInContext('companyDocsUi.data='+JSON.stringify(data),ctx);
const detail={...items[0],body:'【DEMO／架空】\n\n第1章　総則\n第1条　この文書はデザイン確認用の架空の規程です。\n\n第2章　勤務\n第2条　本文の段落と折り返しを確かめます。'.repeat(3)};
const cases=[
  {w:1440,h:900,step:'list',theme:'light'},
  {w:1366,h:768,step:'detail',theme:'light'},
  {w:1024,h:768,step:'detail',theme:'light'},
  {w:390,h:844,step:'folders',theme:'light'},
  {w:390,h:844,step:'list',theme:'light'},
  {w:390,h:844,step:'detail',theme:'light'},
  {w:390,h:844,step:'editor',theme:'light'},
  {w:1440,h:900,step:'detail',theme:'dark'}
];
const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser']
  .map(n=>{try{return execFileSync('which',[n],{encoding:'utf8'}).trim();}catch{return '';}})
  .find(Boolean);
if(!chrome)throw Error('Chromium browser is required for company document viewport tests.');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-company-docs-'));
const out=path.join(root,'artifacts','company-docs-layout');fs.mkdirSync(out,{recursive:true});
let failures=0;
for(const c of cases){
  vm.runInContext('companyDocsUi.mobileStep='+JSON.stringify(c.step==='editor'?'detail':c.step)+';',ctx);
  vm.runInContext('companyDocsUi.selectedId='+JSON.stringify(items[0].id)+';',ctx);
  vm.runInContext('companyDocsUi.detail='+JSON.stringify(detail)+';',ctx);
  vm.runInContext('companyDocsUi.editing='+(c.step==='editor'?'true':'false')+';',ctx);
  vm.runInContext('companyDocsUi.draft='+JSON.stringify({
    id:items[0].id,revision:1,title:items[0].title,folderId:items[0].folderId,
    category:items[0].category,status:'公開',tags:['業務','検証'],
    summary:'短い概要',body:detail.body,effectiveOn:'2026-10-01',url:''
  })+';',ctx);
  const fragment=vm.runInContext('companyDocsPage()',ctx);
  const name=c.w+'x'+c.h+'-'+c.step+'-'+c.theme;
  if(!fragment.includes('company-doc-layout')||!fragment.includes('company-doc-tree-pane')||
    !fragment.includes('company-doc-list-pane')||!fragment.includes('company-doc-detail-pane')){
    failures++;console.error('FAIL '+name+' missing layout panels');continue;
  }
  const inner='<!doctype html><html lang="ja" data-theme="'+c.theme+'"><head><meta charset="utf-8">'+css+
    '</head><body><div class="app-shell"><aside class="sidebar"><div class="brand">FM WORKS</div></aside>'+
    '<div class="workspace"><header class="topbar">FM WORKS</header><main class="content">'+fragment+'</main></div></div>'+
    '<script>addEventListener("load",()=>{const root=document.documentElement,p=document.querySelector(".company-doc-workspace"),'+
      'content=document.querySelector(".content"),grid=document.querySelector(".company-doc-layout");'+
      'const panes=["tree","list","detail"].map(n=>document.querySelector(".company-doc-"+n+"-pane"));'+
      'const visible=panes.filter(n=>n&&getComputedStyle(n).display!=="none");'+
      'const metrics={width:innerWidth,height:innerHeight,scrollWidth:root.scrollWidth,'+
      'contentWidth:content.getBoundingClientRect().width,pageWidth:p.getBoundingClientRect().width,'+
      'gridWidth:grid.getBoundingClientRect().width,panels:visible.length,'+
      'panelsInContent:visible.every(n=>n.getBoundingClientRect().width<=content.getBoundingClientRect().width+2),'+
      'search:!!document.querySelector(".company-doc-search input"),rows:document.querySelectorAll(".company-doc-row").length,'+
      'body:!!document.querySelector(".company-doc-body"),editor:!!document.querySelector(".company-doc-editor")};'+
      'parent.postMessage({kind:"FM_DOC_QA",metrics},"*");});</script></body></html>';
  const frame=path.join(tmp,name+'-frame.html');fs.writeFileSync(frame,inner);
  const host='<html><head><script>addEventListener("message",e=>{if(e.data?.kind==="FM_DOC_QA")'+
    'document.getElementById("result").setAttribute("data-qa",encodeURIComponent(JSON.stringify(e.data.metrics)))})</script></head>'+
    '<body style="margin:0"><iframe title="FM WORKS 社内文書QA" style="display:block;border:0;width:'+c.w+'px;height:'+
    c.h+'px" src="'+pathToFileURL(frame).href+'"></iframe><output id="result"></output></body></html>';
  const hostPath=path.join(tmp,name+'.html');fs.writeFileSync(hostPath,host);
  const flags=['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
    '--force-device-scale-factor=1','--disable-extensions','--no-first-run',
    '--window-size='+Math.max(c.w,520)+','+(c.h+125),'--virtual-time-budget=2800'];
  try{
    const dom=execFileSync(chrome,[...flags,'--dump-dom',pathToFileURL(hostPath).href],
      {encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','ignore']});
    const match=dom.match(/<output[^>]*id="result"[^>]*data-qa="([^"]+)"/);
    if(!match)throw Error('Missing Chromium viewport metrics');
    const v=JSON.parse(decodeURIComponent(match[1])),bad=[];
    if(Math.abs(v.width-c.w)>2||Math.abs(v.height-c.h)>2)bad.push('viewport');
    if(v.scrollWidth>v.width+2)bad.push('horizontal-overflow');
    if(v.pageWidth>v.contentWidth+2||v.gridWidth>v.contentWidth+2)bad.push('content-overflow');
    if(!v.panelsInContent)bad.push('pane-overflow');
    if(v.panels!==(c.w<=760?1:3))bad.push('wrong-visible-panels');
    if(!v.search)bad.push('search-control');
    if(c.step==='list'&&v.rows<1)bad.push('document-list');
    if(c.step==='detail'&&!v.body)bad.push('document-body');
    if(c.step==='editor'&&!v.editor)bad.push('document-editor');
    console.log((bad.length?'FAIL ':'PASS ')+name+' '+JSON.stringify(v)+(bad.length?' '+bad.join(','):''));
    if(bad.length)failures++;
  }catch(error){failures++;console.error('FAIL '+name+' '+String(error.message||error));}
  if(c.w===1440||c.w===390&&['folders','detail','editor'].includes(c.step)){
    try{execFileSync(chrome,[...flags,'--screenshot='+path.join(out,name+'.png'),
      pathToFileURL(hostPath).href],{timeout:45000,stdio:'ignore'});}catch(e){
      console.warn('Screenshot unavailable '+name+': '+String(e.message||e));
    }
  }
}
if(failures){console.error('Company document browser viewport QA failed: '+failures);process.exitCode=1;}
else console.log('PASS company document browser: '+cases.length+' desktop/tablet/mobile/light/dark layouts');
