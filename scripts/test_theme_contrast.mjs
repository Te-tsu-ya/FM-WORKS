import {appStyles} from './theme_styles.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const index=fs.readFileSync('src/Index.html','utf8');
const names=[...index.matchAll(/include_\('(Styles[^']*)'\)/g)].map(m=>m[1]);
assert.equal(names.at(-1),'StylesAccessibility','contrast roles must load after every workspace');
const css=appStyles().replace(/<\/?style>/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1].trim(),body:m[2]}));
const declarations=body=>Object.fromEntries(body.split(';').filter(x=>x.includes(':')).map(x=>{const i=x.indexOf(':');return [x.slice(0,i).trim(),x.slice(i+1).trim().replace(/!important$/,'').trim()];}));
const rgb=value=>{
 if(value==='white')return [255,255,255];if(value==='black')return [0,0,0];
 assert.match(value,/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i,'explicit sRGB color required: '+value);
 let x=value.slice(1);if(x.length===3)x=[...x].map(c=>c+c).join('');
 return [0,2,4].map(i=>parseInt(x.slice(i,i+2),16));
};
const luminance=rgb=>rgb.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(rgb(a)),y=luminance(rgb(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const report={type:'source-color-contract',notBrowserRendering:true,styleFiles:names.length,pairs:[]};
for(const theme of ['light','dark']){
 const vars={};for(const rule of rules){
  if(rule.selector===':root'||(theme==='dark'&&rule.selector==='html[data-theme="dark"]'))
   Object.assign(vars,Object.fromEntries(Object.entries(declarations(rule.body)).filter(([k])=>k.startsWith('--'))));
 }
 const val=k=>{let v=vars['--'+k];for(let n=0;n<12&&/^var\(/.test(v||'');n++)v=vars[v.slice(4,-1)];assert.ok(v,'undefined theme role '+k);return v;};
 const check=(fg,bg,min=4.5)=>{const ratio=contrast(val(fg),val(bg));report.pairs.push({theme,fg,bg,ratio:Number(ratio.toFixed(3)),min});assert.ok(ratio>=min,theme+' '+fg+'/'+bg+' contrast '+ratio+' < '+min);};
 const backgrounds=['bg','surface','surface2','info-bg','success-bg','warning-bg','danger-bg','purple-bg'];
 for(const bg of backgrounds)for(const fg of ['text','muted','blue','blue2'])check(fg,bg);
 for(const role of ['info','success','warning','danger','purple'])check(role+'-ink',role+'-bg');
 for(const role of ['info','info-strong','success','warning','danger','purple'])check('on-action','fill-'+role);
 for(const bg of ['surface','surface2'])check('control-line',bg,3);
}
// Every fixed foreground in the shared application styles must have a theme role.
// Explicit white is permitted for filled controls and print paper remains light.
for(const rule of rules){
 const c=declarations(rule.body).color;
 if(!c||rule.selector.includes('qb-paper')||rule.selector.includes(':root'))continue;
 if(/^#[0-9a-f]{3,8}$|^rgba?\(/i.test(c)&&!['#fff','#ffffff'].includes(c.toLowerCase()))
  assert.equal(rule.selector,'html[data-theme] .person-avatar','unpaired fixed foreground: '+rule.selector+' '+c);
}
const a11y=fs.readFileSync('src/StylesAccessibility.html','utf8');
for(const marker of ['.monthly-close-banner.closed','.monthly-close-banner.open','.monthly-day.off','input::placeholder','select option',':focus-visible','.schedule-category-badge'])assert.ok(a11y.includes(marker),marker);
const people=fs.readFileSync('src/AppCore.html','utf8').split('const PERSON_COLORS=')[1].split('];')[0];
for(const bg of [...people.matchAll(/bg:'(#[0-9a-f]+)'/g)].map(m=>m[1]))assert.ok(contrast('#173452',bg)>=4.5,'employee avatar contrast on '+bg);
// Prevent palette regressions that numerical text-contrast checks alone do not catch.
const surfaceBackgrounds=selector=>rules.filter(r=>r.selector.trim()===selector).map(r=>declarations(r.body).background).filter(Boolean);
for(const selector of ['.sidebar','.topbar','.mobile-nav','.mobile-drawer','.login-stage','.login-panel','.login-input-wrap','.secondary-button','.search-results','.profile-menu','.field input,.field select,.field textarea','.day','.month-day','.home-stat','.request-quick-card']){
 const backgrounds=surfaceBackgrounds(selector);assert.ok(backgrounds.length,'missing neutral CSS: '+selector);
 for(const background of backgrounds)assert.ok(!/var\\(--fill-danger\\)/.test(background),'danger red leaked into '+selector+': '+background);
}
for(const selector of ['.sidebar','.topbar','.login-stage','.login-panel','.mobile-nav','.mobile-drawer']){
 for(const background of surfaceBackgrounds(selector))assert.ok(!/var\\(--fill-(?:info|success)\\)/.test(background),'strong action background leaked into '+selector);
}
for(const selector of ['.login-submit','.brand-mark']){
 const backgrounds=surfaceBackgrounds(selector);assert.ok(backgrounds.length,'missing brand action: '+selector);
 for(const background of backgrounds)assert.ok(!/var\\(--(?:info-bg|fill-danger|danger-bg)\\)/.test(background),'invalid faded/danger brand background '+selector);
}
assert.ok(surfaceBackgrounds('.tone-green').some(x=>x.includes('var(--success-bg)')),'green tone must stay soft');
assert.ok(surfaceBackgrounds('.notification-dot').some(x=>x.includes('var(--fill-danger)')),'real alert marker must stay red');
fs.mkdirSync('artifacts/theme-audit',{recursive:true});fs.writeFileSync('artifacts/theme-audit/contrast.json',JSON.stringify(report,null,2)+'\n');
console.log('PASS contrast contract: '+report.styleFiles+' style includes, '+report.pairs.length+' actual token pairs across light/dark; paper, placeholders, fields, calendar and category labels. This is a source/color check, not browser or GAS rendering.');
