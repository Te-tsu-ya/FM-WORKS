import assert from 'node:assert/strict';
import fs from 'node:fs';
const index=fs.readFileSync('src/Index.html','utf8');
const includes=[...index.matchAll(/include_\('([^']+)'\)/g)].map(x=>x[1]);
assert.ok(includes.length>30,'unexpected missing app module includes');
assert.equal(new Set(includes).size,includes.length,'no duplicate include files');
const entries=includes.map(name=>{
 const path='src/'+name+'.html';
 assert.ok(fs.existsSync(path),'missing HTML fragment '+name);
 return {name,bytes:Buffer.byteLength(fs.readFileSync(path,'utf8'))};
});
const total=Buffer.byteLength(index)+entries.reduce((sum,x)=>sum+x.bytes,0);
// Catch accidental runaway single-page growth. A true network payload may
// be compressed and Google iframe overhead is not measured by this test.
const maxBytes=1600*1024;
assert.ok(total<=maxBytes,'HTML entry exceeds 1.6 MiB source budget; audit unused CSS/JS modules, not network gzip alone. '+total);
const code=fs.readFileSync('src/Code.gs','utf8');
assert.match(code,/fm:static-shell:v1:.*APP\.version/,'static shell cache must be release-specific');
assert.match(code,/count>0&&count<=40/,'cache manifest stays within 40 chunks');
assert.match(code,/if\(size\+bytes>60000\)/,'cache chunk size must remain under 100 KiB per CacheService key');
assert.ok(!includes.includes('GeneratedDocs'),'the large generated in-app manuals should not be inlined into the entry HTML');
console.log('PASS shell source budget: '+includes.length+' modules, '+total+' UTF-8 bytes, cap '+maxBytes);
