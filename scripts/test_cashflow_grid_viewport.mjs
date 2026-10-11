import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const client=name=>fs.readFileSync('src/'+name+'.html','utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const styles=['Styles','StylesCashFlow','StylesCashFlowGrid'].map(name=>fs.readFileSync('src/'+name+'.html','utf8')).join('\n');
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser'].map(cmd=>{
 try{return execFileSync('which',[cmd],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return '';}
}).find(Boolean);
assert.ok(chrome,'Chromium required for responsive cashflow spreadsheet QA');
const runs=[[1440,900,'light'],[1024,768,'dark'],[768,1024,'light'],[390,844,'dark'],[320,700,'light']];
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-cashflow-grid-qa-'));
const output='artifacts/cashflow-grid';fs.mkdirSync(output,{recursive:true});
const months=Array.from({length:12},(_,i)=>({month:i?'2026-'+String(i).padStart(2,'0'):'2025-12',
 planIn:i*10000,planOut:8000,actualIn:i<2?0:null,actualOut:i<2?0:null,note:'確認メモ'+i}));
for(const [width,height,theme] of runs){
 const state={sessionToken:'SYNTHETIC_ADMIN',data:{today:'2026-10-11',permissions:{adminConsole:true,cashFlowWorkspace:true}}};
 const cx=vm.createContext({console,Date,JSON,Number,Math,String,Object,Array,Map,Set,RegExp,Error,
 state,escapeHtml:esc,financeUi:{demo:false},renderPageIfActive:()=>{},showToast:()=>{},
 pageHead:()=>'',document:{getElementById:()=>null}});
 vm.runInContext(client('AppCashFlow'),cx,{filename:'AppCashFlow.html'});
 vm.runInContext(client('AppCashFlowGrid'),cx,{filename:'AppCashFlowGrid.html'});
 cx.qaMonths=months;
 vm.runInContext("cashFlowUi.open=true;cashFlowUi.year=2026;cashFlowUi.data={setupRequired:false,record:{openingBalance:1000000,exists:true}};cashFlowUi.draft={openingBalance:1000000,revision:2,months:qaMonths};",cx);
 const html=vm.runInContext('cashFlowPage_()',cx);
 assert.ok(html.includes('cfg-table')&&html.includes('cfg-legacy'),'new and old input methods both available');
 const frame='<html lang="ja" data-theme="'+theme+'"><head><meta charset="utf-8">'+styles+'</head>'+
  '<body><div class="app-shell"><aside class="sidebar">FM WORKS</aside><div class="workspace"><main class="content">'+html+
  '</main></div></div><script>addEventListener("load",()=>{const table=document.querySelector(".cfg-table"),'+
  'pane=document.querySelector(".cfg-scroll"),root=document.querySelector(".cf-workspace"),'+
  'head=document.querySelector(".cfg-table thead th"),'+
  'data={viewport:innerWidth,docWidth:document.documentElement.scrollWidth,'+
  'tableWidth:table?.scrollWidth,scrollWidth:pane?.scrollWidth,clientWidth:pane?.clientWidth,'+
  'cellCount:document.querySelectorAll(".cfg-table [data-cfg-cell]").length,'+
  'columns:document.querySelectorAll(".cfg-table thead th").length,'+
  'rowHeaderSticky:getComputedStyle(document.querySelector(".cfg-table tbody th")).position,'+
  'rootLeft:root.getBoundingClientRect().left,rootRight:root.getBoundingClientRect().right,'+
  'firstText:head?.textContent,hasDetails:!!document.querySelector("details.cfg-legacy"),'+
  'theme:getComputedStyle(document.querySelector(".cfg-panel")).backgroundColor};'+
  'parent.postMessage({type:"CF_GRID",value:data},"*")});</script></body></html>';
 const id=width+'x'+height+'-'+theme;
 const fp=path.join(tmp,id+'-frame.html');fs.writeFileSync(fp,frame);
 const host='<html><head><meta charset="utf-8"><script>addEventListener("message",e=>{if(e.data?.type==="CF_GRID")document.querySelector("#result").setAttribute("data-json",encodeURIComponent(JSON.stringify(e.data.value)))})</script></head>'+
  '<body style="margin:0"><iframe title="Annual cashflow grid" src="'+pathToFileURL(fp).href+'" style="border:0;width:'+width+'px;height:'+height+'px"></iframe><output id="result"></output></body></html>';
 const hp=path.join(tmp,id+'.html');fs.writeFileSync(hp,host);
 const flags=['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-extensions','--force-device-scale-factor=1','--window-size='+Math.max(600,width)+','+(height+100),'--virtual-time-budget=1500'];
 const dump=execFileSync(chrome,[...flags,'--dump-dom',pathToFileURL(hp).href],{encoding:'utf8',timeout:40000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']});
 const raw=dump.match(/id="result"[^>]*data-json="([^"]+)"/)?.[1];
 assert.ok(raw,'browser metric callback missing '+id);
 const result=JSON.parse(decodeURIComponent(raw));
 assert.equal(result.viewport,width);
 assert.ok(result.docWidth<=width+2,'document horizontal scroll '+id+' '+JSON.stringify(result));
 assert.equal(result.cellCount,60,'expected 5x12 grid '+id);
 assert.equal(result.columns,13,'expected 12 months plus row label '+id);
 assert.ok(result.scrollWidth>result.clientWidth,'only grid should scroll horizontally '+id);
 assert.equal(result.rowHeaderSticky,'sticky','row labels must remain visible '+id);
 assert.ok(result.rootRight<=width+3,'cashflow work area must fit '+id);
 assert.ok(result.hasDetails,'legacy input should be disclosed but preserved '+id);
 if(theme==='dark')assert.notEqual(result.theme,'rgb(255, 255, 255)');
 if(width===1440||width===390){
  execFileSync(chrome,[...flags,'--screenshot='+path.resolve(output+'/'+id+'.png'),pathToFileURL(hp).href],{timeout:40000,stdio:'ignore'});
 }
 console.log('PASS annual cashflow responsive '+id+' '+JSON.stringify(result));
}
