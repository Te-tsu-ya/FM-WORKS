import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/AppAdmin.html','utf8').replace('<script>','').replace('</script>','');
let copied='',cleared=0;
const state={page:'admin',adminTab:'performance',adminUi:{menuOpen:false},authAdmin:null,data:{permissions:{adminConsole:true}}};
const perf={methods:[{method:'getMonthly<script>',calls:23,failures:1,p50Ms:342,p95Ms:2380,lastMs:90}],coalescedReads:3};
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const c=vm.createContext({state,FMWorksPerformance:{report:()=>perf,clear:()=>{cleared++;}},
 navigator:{clipboard:{writeText:v=>{copied=v;return Promise.resolve();}}},
 card:(h,b)=>h+b,pageHead:(h,d)=>h+d,escapeHtml,renderPageIfActive:()=>{},showToast:()=>{},
 Object,Array,Date,String,Number,JSON,Set,Map,Math,console});
vm.runInContext(source,c);
const run=s=>vm.runInContext(s,c);
assert.match(run('adminPage()'),/通信速度/);
assert.match(run('adminPage()'),/2,380 ms/);
assert.match(run('adminPage()'),/getMonthly&lt;script&gt;/);
assert.doesNotMatch(run('adminPage()'),/<script>/);
run('adminCopyRpcPerformance_()');
assert.equal(JSON.parse(copied).methods[0].p95Ms,2380);
assert.ok(!copied.includes('sessionToken')&&!copied.includes('args'));
run('adminClearRpcPerformance_()');assert.equal(cleared,1);
state.data.permissions.adminConsole=false;
assert.match(run('adminPage()'),/権限/);
run('adminClearRpcPerformance_()');assert.equal(cleared,1);
console.log('PASS admin RPC timing UI: P50/P95, output escaping, safe clipboard, permission gate');
