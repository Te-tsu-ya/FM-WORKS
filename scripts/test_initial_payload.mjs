import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
// GAS source budgets use canonical UTF-8 bytes; Git for Windows can check out
// the very same HTML as CRLF, adding a byte per line without adding UI payload.
const canonicalBytes=source=>Buffer.byteLength(String(source).replace(/\r\n?/g,'\n'),'utf8');
const fileBytes=file=>canonicalBytes(fs.readFileSync(file,'utf8'));
assert.equal(canonicalBytes('日本語\r\nabc\r\n'),canonicalBytes('日本語\nabc\n'),
  'Windows line endings must not change the source payload budget');
const index=fs.readFileSync('src/Index.html','utf8');
const names=[...index.matchAll(/include_\('([A-Za-z0-9_-]+)'\)/g)].map(x=>x[1]);
assert.ok(names.length>=30,'Index include parsing failed');
assert.equal(new Set(names).size,names.length,'Duplicate initial HTML include');
for(const name of ['AppLeaveDemo','AppCashFlowSandbox'])assert.ok(!names.includes(name),'Demo-only module loaded: '+name);
const total={all:canonicalBytes(index),css:0,js:0};
const files=[];
for(const name of names){
 const file=path.join('src',name+'.html');
 assert.ok(fs.existsSync(file),'Included module missing: '+file);
 const bytes=fileBytes(file);
 assert.ok(bytes>0,'Included module empty: '+file);
 const kind=name.startsWith('Styles')?'css':'js';
 total[kind]+=bytes;total.all+=bytes;files.push({name,bytes});
}
console.log('Initial HTML canonical UTF-8 source bytes (LF-normalized): '+JSON.stringify({all:total.all,css:total.css,js:total.js,includes:names.length}));
console.log('Top initial modules: '+files.sort((a,b)=>b.bytes-a.bytes).slice(0,8).map(x=>x.name+'='+x.bytes).join(', '));
for(const [kind,max] of Object.entries({all:1360000,css:420000,js:950000}))assert.ok(total[kind]<=max,'Initial '+kind+' budget exceeded: '+total[kind]+' > '+max);
console.log('PASS: source payload budget, module presence and demo exclusion');
