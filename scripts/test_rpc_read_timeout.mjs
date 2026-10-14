import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/AppRotaryIntegration.html','utf8').replace(/^<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
let seq=0,now=0;const timers=new Map(),actions=[];
class Loader{
 constructor({mode}){this.mode=mode;this.state='idle';this.activeToken=0;this.root={classList:{add(){},remove(){}}};this.sub={textContent:''}}
 start(){this.state='loading';return ++this.activeToken}
 _announce(){}
 complete(){this.state='success'}
 fail(){this.state='error'}
 hide(){this.state='idle'}
}
const rpc=(meta={})=>new Proxy({}, {get(_o,k){
 if(k==='withSuccessHandler')return f=>rpc({...meta,success:f});
 if(k==='withFailureHandler')return f=>rpc({...meta,failure:f});
 return (...args)=>actions.push({method:String(k),args,...meta});
}});
const g={window:null,document:{body:{},querySelector(){return {}}},
 FMRotaryLoader:Loader,google:{script:{run:rpc()}},
 console,Date,Object,Array,Map,Set,Number,Math,Proxy,String,JSON,Error,
 performance:{now:()=>now},
 setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},
 clearTimeout:id=>timers.delete(id)};
g.window=g;vm.runInContext(source,vm.createContext(g));
let failures=0,successes=0;
g.FMRotaryRPC().withFailureHandler(()=>failures++).getWorklogs('TOKEN',{date:'2026-10-14'});
g.FMRotaryRPC().withFailureHandler(()=>failures++).getWorklogs('TOKEN',{date:'2026-10-14'});
assert.equal(actions.length,1);
assert.equal(timers.size,1);
const old=actions[0],timer=[...timers.values()][0];
assert.equal(timer.ms,45000);
now=45000;timer.fn();
assert.equal(failures,2,'one shared failure for both listeners');
assert.equal(timers.size,0,'timeout releases timer');
old.success({items:['late']});old.failure(new Error('late'));
assert.equal(failures,2,'late callbacks ignored');
assert.equal(g.FMWorksPerformance.report().methods.find(x=>x.method==='getWorklogs').failures,1);
g.FMRotaryRPC().withSuccessHandler(()=>successes++).saveWorklog('TOKEN',{id:'W1'});
assert.equal(timers.size,0,'write does not have an automatic timeout');
assert.equal(actions.length,2,'write issued only once');
actions[1].success({ok:true});assert.equal(successes,1);
g.FMRotaryRPC().withFailureHandler(()=>failures++).getHomeOverview('TOKEN');
assert.equal(timers.size,1);
const t=[...timers.values()][0];const pending=actions[2];
g.FMRotaryActivity.reset();t.fn();pending.success({});
assert.equal(failures,2,'logout cannot show old response');
console.log('PASS bounded read timeout, shared failures, late response discarded, write excluded, logout');
