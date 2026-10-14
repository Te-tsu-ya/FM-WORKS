import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/AppRotaryIntegration.html','utf8').replace(/^<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
class Loader{constructor({mode}){this.mode=mode;this.state='idle';this.activeToken=0;this.root={classList:{add(){},remove(){}}};this.sub={textContent:''}}start(){this.state='loading';return ++this.activeToken}_announce(){}complete(){this.state='success'}fail(){this.state='error'}hide(){this.state='idle'}}
const make=nav=>{
 const w={window:null,document:{body:{},querySelector(){return {}}},FMRotaryLoader:Loader,google:{script:{run:{}}},
 performance:nav?{now:()=>1000,getEntriesByType:()=>[nav]}:{now:()=>1000},Date,Map,Set,Array,Object,String,Number,Math,Proxy,Error,JSON,console,setTimeout:()=>1,clearTimeout(){}};
 w.window=w;vm.runInContext(source,vm.createContext(w));return w.FMWorksPerformance;
};
const api=make({responseEnd:1720.52,domContentLoadedEventEnd:2480.27});
api.recordAuthenticatedMountMs(38.69);
const result=api.report();
assert.equal(result.startup.htmlResponseMs,1721);
assert.equal(result.startup.domContentLoadedMs,2480);
assert.equal(result.startup.authenticatedMountMs,39);
assert.equal(make(null).report().startup.domContentLoadedMs,null);
assert.equal(make(null).report().startup.htmlResponseMs,null);
assert.ok(!JSON.stringify(result).includes('sessionToken'));
assert.match(fs.readFileSync('src/AppShell.html','utf8'),/recordAuthenticatedMountMs/);
assert.match(fs.readFileSync('src/AppAdmin.html','utf8'),/HTML受信まで/);
console.log('PASS startup timing metrics, browser fallback, secret-free report');
