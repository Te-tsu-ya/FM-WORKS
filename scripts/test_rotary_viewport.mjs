import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const unwrap=(file,tag)=>{
 const s=fs.readFileSync(file,'utf8').trim();
 assert.ok(s.startsWith('<'+tag+'>')&&s.endsWith('</'+tag+'>'));
 return s.slice(tag.length+2,-tag.length-3);
};
const css=unwrap('src/StylesRotaryLoader.html','style');
const engine=unwrap('src/RotaryEngine.html','script');
const integration=unwrap('src/AppRotaryIntegration.html','script');
const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser'].map(n=>{
 try{return execFileSync('which',[n],{encoding:'utf8'}).trim()}catch{return ''}
}).find(Boolean);
if(!chrome)throw Error('Chromium required');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fmworks-rotary-'));
const shots='artifacts/rotary-loader';fs.mkdirSync(shots,{recursive:true});
const cases=[
 {name:'page-desktop',w:1440,h:900,dark:false,region:false},
 {name:'page-mobile',w:390,h:844,dark:false,region:false},
 {name:'page-dark',w:1440,h:900,dark:true,region:false},
 {name:'data-desktop',w:1440,h:900,dark:false,region:true},
 {name:'data-mobile',w:390,h:844,dark:false,region:true}
];
function html(c){
 return [
 '<!doctype html><html lang="ja" data-theme="'+(c.dark?'dark':'light')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
 '<style>html,body{margin:0;padding:0;font-family:system-ui,sans-serif;background:'+(c.dark?'#111e31':'#f3f8fd')+'}*{box-sizing:border-box}.app{display:flex;min-height:100vh}.workspace{position:relative;flex:1;min-width:0}.search-wrap{position:relative;width:200px}#content{max-width:100%;padding:20px}</style>',
 '<style>'+css+'</style></head><body>',
 '<main id="app" class="app"><section class="workspace"><header class="search-wrap">検索<input aria-label="キーワード"></header><div id="content"><div>FM WORKS のデータを確認しています</div></div></section></main>',
 '<script>window.mockJobs=[];function runner(opts={}){return new Proxy({}, {get(_,key){if(key==="withSuccessHandler")return fn=>runner({...opts,success:fn});if(key==="withFailureHandler")return fn=>runner({...opts,failure:fn});if(key==="withUserObject")return userObject=>runner({...opts,userObject});return(...args)=>window.mockJobs.push({key,args,opts});}})}window.google={script:{run:runner()}};window.metrics={};</script>',
 '<script>'+engine+'</script><script>'+integration+'</script>',
 '<script>',
 'setTimeout(()=>{const r=document.querySelector(".fmr-page .fmr-rotor");window.metrics.start=r&&r.getAttribute("transform");window.metrics.visible=document.querySelector(".fmr-page")?.classList.contains("fmr-visible");window.metrics.housing=document.querySelector(".fmr-page .fmr-engine-svg path")?.getAttribute("d");window.metrics.shownProgress=document.querySelector(".fmr-page .fmr-progress")?.classList.contains("fmr-has-progress")},260);',
 'setTimeout(()=>{const loader=window.FMRotaryActivity.loaders.page;if(loader.state==="loading"){loader._frameAt=performance.now()-40;loader._animate(performance.now());}window.metrics.end=document.querySelector(".fmr-page .fmr-rotor")?.getAttribute("transform");window.metrics.housing2=document.querySelector(".fmr-page .fmr-engine-svg path")?.getAttribute("d");',
 'if('+String(c.region)+'){window.FMRotaryRPC().withSuccessHandler(()=>{}).getPublicAuthConfig();window.mockJobs.at(-1).opts.success({ok:true});window.FMRotaryActivity.route("attendance");window.FMRotaryRPC().withSuccessHandler(()=>{}).getAttendancePreview("SESSION");document.getElementById("content").innerHTML="<div>新しい勤怠一覧</div>";}}',
 ',620);',
 'setTimeout(()=>{const root=document.documentElement;const region=document.querySelector(".fmr-region");window.metrics.viewport=innerWidth;window.metrics.scrollWidth=root.scrollWidth;window.metrics.count=document.querySelectorAll(".fmr-engine-svg").length;window.metrics.regionVisible=region?.classList.contains("fmr-visible")||false;window.metrics.regionAttached=!!document.querySelector("#app .workspace>.fmr-region");window.metrics.regionState=window.FMRotaryActivity.loaders.region.state;window.metrics.fakeProgress=!!document.querySelector(".fmr-has-progress");window.metrics.hasTachometer=!!document.querySelector(".tachometer,.spark-plug");document.body.setAttribute("data-rotary-metrics",encodeURIComponent(JSON.stringify(window.metrics)));},1080);',
 '</script></body></html>'
 ].join('\n');
}
let badCount=0;
for(const c of cases){
 const file=path.join(temp,c.name+'.html');fs.writeFileSync(file,html(c));
 const flags=['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run',
  '--disable-extensions','--force-device-scale-factor=1','--window-size='+Math.max(c.w,520)+','+(c.h+125),
  '--virtual-time-budget=1450'];
 try{
   const dom=execFileSync(chrome,[...flags,'--dump-dom',pathToFileURL(file).href],{
     encoding:'utf8',timeout:45000,maxBuffer:7*1024*1024,stdio:['ignore','pipe','ignore']
   });
   const match=dom.match(/<body[^>]*data-rotary-metrics="([^"]+)"/);
   if(!match)throw Error('missing metrics (possible JS runtime error)');
   const v=JSON.parse(decodeURIComponent(match[1])),issues=[];
   if(!v.start||v.start===v.end)issues.push('rotor did not move');
   if(!v.visible)issues.push('initial startup loader did not appear');
   if(v.housing!==v.housing2)issues.push('housing moved');
   if(v.scrollWidth>v.viewport+2)issues.push('horizontal overflow');
   if(v.fakeProgress||v.shownProgress)issues.push('fake percentage displayed');
   if(v.hasTachometer)issues.push('unwanted tachometer');
   if(v.count<3)issues.push('missing loader instances');
   if(c.region&&(!v.regionVisible||!v.regionAttached||v.regionState!=='loading'))
      issues.push('region loader was detached during DOM replacement');
   if(issues.length)throw Error(issues.join('; ')+' '+JSON.stringify(v));
   console.log('PASS '+c.name+' : fixed housing, active rotor, authentic loading, no overflow');
 }catch(e){console.error('FAIL '+c.name+' : '+e.message);badCount++}
 if(['page-desktop','page-mobile','page-dark','data-desktop'].includes(c.name)){
   try{execFileSync(chrome,[...flags,'--screenshot='+path.resolve(shots,c.name+'.png'),pathToFileURL(file).href],{timeout:45000,stdio:'ignore'})}catch(e){console.warn('Screenshot failed '+c.name)}
 }
}
if(badCount)process.exitCode=1;
else console.log('PASS rotary browser QA: '+cases.length+' layouts');
