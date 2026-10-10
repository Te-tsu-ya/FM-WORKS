import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
function stripped(path,tag){
 const source=fs.readFileSync(path,'utf8').trim();
 assert.ok(source.startsWith('<'+tag+'>')&&source.endsWith('</'+tag+'>'),path+' wrapper');
 return source.slice(tag.length+2,-tag.length-3);
}
const engine=stripped('src/RotaryEngine.html','script');
const integration=stripped('src/AppRotaryIntegration.html','script');
execFileSync(process.execPath,['--check','-'],{input:engine,encoding:'utf8'});
execFileSync(process.execPath,['--check','-'],{input:integration,encoding:'utf8'});
const index=fs.readFileSync('src/Index.html','utf8');
for(const marker of ["include_('StylesRotaryLoader')","include_('RotaryEngine')","include_('AppRotaryIntegration')"]){
 assert.ok(index.includes(marker),'Index must include '+marker);
}
assert.ok(index.indexOf("include_('AppRotaryIntegration')")<index.indexOf("include_('AppCore')"),
  'loader must be ready before application scripts');
const files=['AppCore','AppOperations','AppPeopleMonthly','AppQuotes','AppDocuments','AppCompanyDocs',
  'AppSomu','AppSomuGrowth','AppFinance','AppFinanceAdvisor','AppAdmin','AppShell'];
let calls=0;
for(const p of files){
 const s=fs.readFileSync('src/'+p+'.html','utf8');
 const count=(s.match(/\(typeof FMRotaryRPC==='function'\?FMRotaryRPC\(\):google\.script\.run\)/g)||[]).length;
 assert.ok(count>0,p+' must use rotary tracking for GAS RPCs');
 calls+=count;
}
assert.ok(calls>=80,'expected at least 80 foreground GAS call sites, got '+calls);
assert.ok(!integration.includes('setProgress('),'GAS network completion must never be reported as fake percent');
assert.match(engine,/1\.22/, 'original fast rotor speed');
assert.match(engine,/Math\.cos\(3\*t\)/,'eccentric housing');
assert.match(engine,/deg\/3/,'3:1 eccentric rotor');
const drawing=engine.slice(engine.indexOf('function svgMarkup('),engine.indexOf('function markup('));
assert.ok(!/tachometer|sparkplug|spark-plug/i.test(drawing),'no tachometer or external plugs in rendered engine');
assert.match(fs.readFileSync('src/AppCore.html','utf8'),/FMRotaryActivity\.route\(page\)/,'navigation clears old overlays');
assert.match(fs.readFileSync('src/AppCore.html','utf8'),/FMRotaryActivity\.reset\(\)/,'logout resets loader');
assert.match(fs.readFileSync('src/AppShell.html','utf8'),/FMRotaryActivity\.route\(state\.page\)/,'initial route established');

const actions=[];
class FakeLoader{
 constructor({mode}){this.mode=mode;this.state='idle';this.options={mode};this.root={classList:{add(){},remove(){}}};this.sub={textContent:''};this.history=[];this.activeToken=0;this._progress=null;}
 start({label,progress=null}={}){this.activeToken++;this.state='loading';this.history.push(['start',label,progress]);this._progress=progress;return this.activeToken}
 complete(token){if(token!==this.activeToken||this.state!=='loading')return false;this.state='success';this.history.push(['complete',token]);return true}
 fail(message,{token}={}){if(token!==this.activeToken||this.state!=='loading')return false;this.state='error';this.history.push(['fail',message]);return true}
 hide(){this.state='idle';this.history.push(['hide']);return true}
 _announce(label){this.history.push(['announce',label])}
}
const makeRunner=(meta={})=>new Proxy({}, {get(_obj,key){
 if(key==='withSuccessHandler')return fn=>makeRunner({...meta,success:fn});
 if(key==='withFailureHandler')return fn=>makeRunner({...meta,failure:fn});
 if(key==='withUserObject')return obj=>makeRunner({...meta,userObject:obj});
 if(key==='then')return undefined;
 return (...args)=>{actions.push({method:String(key),args,meta})};
}});
const g={
 document:{body:{},querySelector(sel){return sel==='#app .workspace'?{}:sel==='.search-wrap'?{}:null}},
 FMRotaryLoader:FakeLoader,google:{script:{run:makeRunner()}},
 console,performance:{now:()=>2000},window:null,Map,Set,Object,Number,Math,String,Date,Error,Array,Proxy
};
g.window=g;
const ctx=vm.createContext(g);
vm.runInContext(integration,ctx,{filename:'AppRotaryIntegration.html'});
const ui=g.FMRotaryActivity,invoke=expr=>vm.runInContext(expr,ctx);
assert.equal(ui.loaders.page.state,'loading','boot starts immediately');
assert.equal(ui.snapshot().bootstrap,true);
invoke('FMRotaryRPC().withSuccessHandler(()=>{}).withFailureHandler(()=>{}).getPublicAuthConfig()');
assert.equal(ui.snapshot().pending.page,1);
actions.at(-1).meta.success({needsSetup:false});
assert.equal(ui.snapshot().pending.page,0);
assert.equal(ui.snapshot().bootstrap,false);
assert.equal(ui.loaders.page.state,'success','bootstrap completes on real RPC success');
invoke('FMRotaryActivity.route("home")');
invoke('FMRotaryRPC().withSuccessHandler(()=>{}).getHomeOverview("SESSION")');
invoke('FMRotaryRPC().withSuccessHandler(()=>{}).getAttendancePreview("SESSION")');
assert.equal(ui.snapshot().pending.region,2);
assert.equal(ui.loaders.region.state,'loading');
assert.equal(ui.loaders.region._progress,null,'unknown progress must remain indeterminate');
const first=actions.at(-2),second=actions.at(-1);
first.meta.success({});
assert.equal(ui.snapshot().pending.region,1,'concurrent requests maintain rotor');
assert.equal(ui.loaders.region.state,'loading');
second.meta.success({});
assert.equal(ui.snapshot().pending.region,0);
assert.equal(ui.loaders.region.state,'success');
invoke('FMRotaryRPC().withFailureHandler(()=>{}).getMonthly("SESSION")');
actions.at(-1).meta.failure(new Error('network offline'));
assert.equal(ui.loaders.region.state,'error','real errors stop rotation and show failure');
const count=actions.length;
invoke('FMRotaryRPC().getNotifications("SESSION")');
assert.equal(ui.snapshot().pending.region,0,'silent notifications must not flash overlay');
assert.equal(actions.length,count+1,'silent requests still reach the server');
invoke('FMRotaryRPC().withUserObject({id:123}).withSuccessHandler((v,u)=>{window._userObject=u;}).getWorklogWindow("SESSION")');
actions.at(-1).meta.success({ok:true},actions.at(-1).meta.userObject);
assert.equal(g._userObject.id,123,'GAS callback user object preserved');
invoke('FMRotaryActivity.route("requests")');
invoke('FMRotaryRPC().withSuccessHandler(()=>{}).getHomeOverview("SESSION")');
assert.equal(ui.snapshot().pending.region,1);
invoke('FMRotaryActivity.route("finance")');
assert.equal(ui.snapshot().pending.region,0,'old route does not cover the new page');
invoke('FMRotaryActivity.reset()');
assert.equal(ui.snapshot().pending.page+ui.snapshot().pending.region+ui.snapshot().pending.inline,0);
assert.ok(actions.every(a=>a.method!=='withSuccessHandler'),'only GAS method names are dispatched');
console.log('PASS FM rotary loader integration: '+calls+' RPC sites, boot, concurrency, errors, quiet background, correct 3:1 geometry contract, user object, route cancellation and no fake percent');
