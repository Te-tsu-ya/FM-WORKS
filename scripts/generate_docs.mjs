import fs from 'node:fs';

const specs = {
  requirements: { path: 'docs/REQUIREMENTS.md', title: 'FM WORKS 要件定義書' },
  technical: { path: 'docs/TECHNICAL_DESIGN.md', title: 'FM WORKS 技術設計書' }
};
const out = {};
for (const [key, spec] of Object.entries(specs)) {
  const markdown = fs.readFileSync(spec.path, 'utf8').replace(/\r\n/g,'\n');
  const version = (markdown.match(/\*\*文書版:\*\*\s*([^\s]+)/) || [,''])[1];
  const updatedAt = (markdown.match(/\*\*更新日:\*\*\s*([^\s]+)/) || [,''])[1];
  if (!version || !updatedAt) throw new Error(spec.path + ' must contain 文書版 and 更新日');
  out[key] = { title: spec.title, version, updatedAt, markdown };
}
const source = 'const GENERATED_DOCS = Object.freeze(' + JSON.stringify(out, null, 2) + ');\n';
fs.writeFileSync('src/GeneratedDocs.gs', source, 'utf8');
console.log('Generated src/GeneratedDocs.gs');
