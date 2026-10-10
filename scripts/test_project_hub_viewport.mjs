import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {workspace,detail,escapeHtml} from './test_project_hub.mjs';
const css=['Styles.html','StylesWorkflowV15.html','StylesProjectHub.html'].map(f=>fs.readFileSync('src/'+f,'utf8')).join('\n');
const ctx=vm.createContext({state:{page:'projects',sessionToken:'A',data:{user:{employeeId:'A'},permissions:{adminConsole:true}}},window:{addEventListener:()=>{}},document:{getElementById:()=>null},escapeHtml,renderPageIfActive:()=>{},showToast:()=>{}});
vm.runInContext(fs.readFileSync('src/AppProjectHub.html','utf8').replace(/<\/?script>/g,''),ctx);
vm.runInContext('projectHubUi.data='+JSON.stringify({...workspace,canCreate:true})+';projectHubUi.selected="PRJ-001";projectHubUi.details.set("PRJ-001",{data:'+JSON.stringify({...detail,canManage:true,canSeeOrderValue:true})+',at:Date.now()});',ctx);
const bin=['google-chrome','google-chrome-stable','chromium','chromium-browser'].map(cmd=>{try{return execFileSync('which',[cmd],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{return '';}}).find(Boolean);
assert.ok(bin,'Chromium is required');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'project-qa-'));fs.mkdirSync('artifacts/project-hub',{recursive:true});
const cases=[{w:1440,h:900,tab:'overview',theme:'light'},{w:390,h:844,tab:'overview',theme:'light'},{w:320,h:720,tab:'tasks',theme:'dark'},{w:1440,h:900,tab:'effort',theme:'dark'},{w:390,h:844,tab:'resources',theme:'dark',editor:'resource'},{w:390,h:844,tab:'overview',theme:'light',editor:'plan'}];
for(const c of cases){
 vm.runInContext('projectHubUi.editor=null;projectHubUi.view='detail';projectHubUi.tab='+JSON.stringify(c.tab),ctx);if(c.editor)ctx.projectHubOpenEditor_(c.editor);
 const fragment=ctx.projectHubPage(),id=c.w+'-'+c.tab+'-'+(c.editor||'view')+'-'+c.theme;
 const frame='<html lang="ja" data-theme="'+c.theme+'"><head><meta charset="utf-8">'+css+'</head><body><div class="app-shell"><aside class="sidebar">FM WORKS</aside><div class="workspace"><header class="topbar">FM WORKS</header><main class="content">'+fragment+'</main></div></div><script>addEventListener("load",()=>{const v={width:innerWidth,scroll:document.documentElement.scrollWidth,tabs:document.querySelectorAll(".ph-tabs button").length,heading:!!document.querySelector(".ph-heading h1"),inputs:[...document.querySelectorAll(".ph-editor input,.ph-editor select,.ph-editor textarea")].every(e=>e.getBoundingClientRect().right<=innerWidth+2),panelTop:document.querySelector(".ph-panel,.ph-metrics")?.getBoundingClientRect().top,selectorHeight:document.querySelector(".ph-project-sidebar")?.getBoundingClientRect().height,surface:getComputedStyle(document.querySelector(".ph-panel")).backgroundColor};parent.postMessage({type:"PROJECT_QA",v},"*")});</script></body></html>';
 const fp=path.join(temp,id+'-frame.html');fs.writeFileSync(fp,frame);
 const host='<html><head><script>addEventListener("message",e=>{if(e.data?.type==="PROJECT_QA")document.getElementById("qa").setAttribute("data-value",encodeURIComponent(JSON.stringify(e.data.v)))})</script></head><body style="margin:0"><iframe title="Project QA" style="border:0;display:block;width:'+c.w+'px;height:'+c.h+'px" src="'+pathToFileURL(fp).href+'"></iframe><output id="qa"></output></body></html>';
 const hp=path.join(temp,id+'.html');fs.writeFileSync(hp,host);const flags=['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--no-first-run','--force-device-scale-factor=1','--window-size='+Math.max(520,c.w)+','+(c.h+130),'--virtual-time-budget=1500'];
 const dump=execFileSync(bin,[...flags,'--dump-dom',pathToFileURL(hp).href],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']});const match=dump.match(/<output[^>]*id="qa"[^>]*data-value="([^"]+)"/);assert.ok(match,id+' browser metrics');const v=JSON.parse(decodeURIComponent(match[1]));assert.equal(v.width,c.w);assert.ok(v.scroll<=c.w+2,id+' horizontal overflow '+JSON.stringify(v));assert.ok(v.heading&&v.tabs===5);assert.ok(v.inputs,id+' input overflow');if(c.w<700){assert.ok(v.selectorHeight<100,id+' compact project selector');assert.ok(v.panelTop<600,id+' project content appears in first viewport');}if(c.theme==='dark')assert.notEqual(v.surface,'rgb(255, 255, 255)',id+' dark surface');
 if(c.w===1440||c.editor||c.tab==='overview')execFileSync(bin,[...flags,'--screenshot='+path.resolve('artifacts/project-hub/'+id+'.png'),pathToFileURL(hp).href],{timeout:30000,stdio:'ignore'});
 console.log('PASS project layout '+id+' '+JSON.stringify(v));
}
