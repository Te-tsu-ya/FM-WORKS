import fs from 'node:fs';
// Use the actual GAS entry point's CSS order in every application fixture.
export function appStyles(){
 const index=fs.readFileSync('src/Index.html','utf8');
 const names=[...index.matchAll(/include_\('(Styles[A-Za-z]*)'\)/g)].map(m=>m[1]);
 if(!names.length||new Set(names).size!==names.length)throw Error('Invalid application style includes');
 return names.map(n=>fs.readFileSync('src/'+n+'.html','utf8')).join('\n');
}
