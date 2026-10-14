import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const entries=new Map();let puts=0,seq=0;
const cache={get:k=>entries.get(k)||null,getAll:ks=>Object.fromEntries(ks.filter(k=>entries.has(k)).map(k=>[k,entries.get(k)])),
 put:(k,v)=>entries.set(k,v),putAll:data=>{puts++;for(const [k,v] of Object.entries(data))entries.set(k,v);},
 remove:k=>entries.delete(k)};
const c=vm.createContext({console,DB:{timeZone:'Asia/Tokyo'},CacheService:{getScriptCache:()=>cache},getDatabaseSpreadsheetId_:()=> 'TEST_DB',
 Utilities:{getUuid:()=>String(++seq),formatDate:()=> '2026-10-14'},
 requireSession_:token=>({employee:{role:token==='ADMIN'?'ADMIN':token==='STAFF'?'USER':'DENIED'}}),
 assertPermission_:(x,p)=>{if(p!=='officeWorkspace'||x.role==='DENIED')throw Error('access denied');},
 Object,Array,Date,String,Number,JSON,Set,Map,Math,RegExp});
vm.runInContext(fs.readFileSync('src/DataAccess.gs','utf8')+'\n'+fs.readFileSync('src/Somu.gs','utf8'),c);
const run=s=>vm.runInContext(s,c);
c.payload={setupRequired:false,assets:Array.from({length:850},(_,i)=>({id:'A'+i,name:'架空備品'.repeat(14)})),
 loans:[],purchases:[],documents:[],rowCount:850};
assert.ok(Buffer.byteLength(JSON.stringify(c.payload),'utf8')>90000);
assert.equal(run('somuPutCachedSnapshot_(payload)'),true);
assert.ok(puts>0);assert.equal(run('somuGetCachedSnapshot_()').assets.length,850);
assert.equal(run('getSomuWorkspace("ADMIN").canApprove'),true);
assert.equal(run('getSomuWorkspace("STAFF").canApprove'),false);
assert.throws(()=>run('getSomuWorkspace("DENIED")'),/access denied/);
const key='fm:db:TEST_DB:fm:somu:workspace:v5:TEST_DB',manifest=JSON.parse(entries.get(key));
assert.ok(manifest.count>1);
const part=key+':'+manifest.generation+':0',saved=entries.get(part);
entries.delete(part);assert.equal(run('somuGetCachedSnapshot_()'),null);
entries.set(part,saved);assert.equal(run('somuGetCachedSnapshot_()').rowCount,850);
run('somuInvalidateSnapshot_()');assert.equal(run('somuGetCachedSnapshot_()'),null);
console.log('PASS large SOMU snapshot cache: chunks, access, stale/incomplete recovery');
