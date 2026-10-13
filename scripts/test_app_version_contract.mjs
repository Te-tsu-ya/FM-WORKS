import assert from 'node:assert/strict';
import fs from 'node:fs';

// A source change must never show a different version than the two in-app docs.
const code=fs.readFileSync('src/Code.gs','utf8');
const match=code.match(/\bconst APP\s*=\s*Object\.freeze\(\s*\{[\s\S]*?\bversion:\s*'([^']+)'/);
assert.ok(match,'APP.version is missing');
const appVersion=match[1];
assert.match(appVersion,/^\d+\.\d+\.\d+$/,'APP.version is not a semver triplet');

const specs=[
 ['requirements','docs/REQUIREMENTS.md','FM WORKS 要件定義書'],
 ['technical','docs/TECHNICAL_DESIGN.md','FM WORKS 技術設計書']
];
const generated=fs.readFileSync('src/GeneratedDocs.gs','utf8');
const prefix='const GENERATED_DOCS = Object.freeze(';
assert.ok(generated.startsWith(prefix) && generated.endsWith(');\n'),'Unexpected generated document format');
const bundled=JSON.parse(generated.slice(prefix.length,-3));
for(const [key,path,title] of specs){
 const markdown=fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n');
 const version=(markdown.match(/\*\*文書版:\*\*\s*([^\s]+)/)||[])[1];
 const updatedAt=(markdown.match(/\*\*更新日:\*\*\s*([^\s]+)/)||[])[1];
 assert.equal(version,appVersion,path+' does not match APP.version');
 assert.equal(bundled[key]?.version,appVersion,'Generated version mismatch: '+key);
 assert.equal(bundled[key]?.title,title,'Generated title mismatch: '+key);
 assert.equal(bundled[key]?.updatedAt,updatedAt,'Generated date mismatch: '+key);
 assert.equal(bundled[key]?.markdown,markdown,'Generated markdown drift: '+key);
}
console.log('PASS application version contract: APP.version '+appVersion+', requirements, technical design and generated in-app documents match');
