import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const content=fs.readFileSync('src/DataAccess.gs','utf8');
const parseDay=(s,n)=>{
 const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);
};
const ctx=vm.createContext({console,Date,Map,Set,Math,Number,String,Array,Object,RegExp,JSON,addDateString_:parseDay});
vm.runInContext(content,ctx);
const make=(data,width=15)=>{
 const stats={finders:0,wideCells:0};
 const range=(r,c,h=1,w=1)=>({
  getDisplayValues(){
   if(w>1)stats.wideCells+=h*w;
   return data.slice(r-2,r-2+h).map(row=>row.slice(c-1,c-1+w));
  },
  createTextFinder:pattern=>{
   stats.finders++;
   let regex=false;
   return {
    useRegularExpression(){regex=true;return this},
    matchEntireCell(){return this},
    findAll(){
     const compiled=regex?new RegExp(pattern):null,found=[];
     for(let i=r-2;i<r-2+h;i++){
      const value=String(data[i][c-1]||'');
      if(compiled?compiled.test(value):value===pattern)found.push({getRow:()=>i+2});
     }
     return found;
    }
   };
  }
 });
 return {stats,getLastRow:()=>data.length+1,getRange:range,
  getRangeList:specs=>({getRanges:()=>specs.map(s=>{
   const m=/^A(\d+):[A-Z]+(\d+)$/.exec(s);
   assert.ok(m,s);return range(Number(m[1]),1,Number(m[2])-Number(m[1])+1,width);
  })})};
};
const row=(date,who)=>{
 const r=Array(15).fill('');r[0]=who;r[1]=date;r[2]=who;return r;
};
const data=Array.from({length:1200},(_,i)=>row('2026-01-01',i%2?'STAFF':'OTHER'));
for(let i=400;i<442;i++)data[i]=row('2026-10-'+String(1+(i-400)%14).padStart(2,'0'),i%2?'STAFF':'OTHER');
const small=make(data);
const answer=ctx.readRowsByDateRange_(small,2,15,'2026-10-01','2026-10-14',3,['STAFF']);
assert.equal(answer.length,21);
assert.ok(answer.every(r=>r[2]==='STAFF'),'never return other employees');
assert.equal(small.stats.finders,1,'skip redundant full-sheet owner finder for a small date result');
assert.equal(small.stats.wideCells,630);
const bigger=make(Array.from({length:1200},(_,i)=>row(i%4===0?'2026-01-01':'2026-10-14',i%3?'OTHER':'STAFF')));
const found=ctx.readRowsByDateRange_(bigger,2,15,'2026-10-01','2026-10-14',3,['STAFF']);
assert.equal(bigger.stats.finders,2,'large dates keep two intersecting indexes');
assert.equal(found.length,300);assert.ok(found.every(r=>r[2]==='STAFF'));
const empty=make(data);
assert.equal(ctx.readRowsByDateRange_(empty,2,15,'2026-07-01','2026-07-10',3,['STAFF']).length,0);

// Regression: 400-day UI windows must return the complete last 30 days, even
// with >250 rows where the optimized index, not a small-sheet scan, is used.
const base='2026-01-01',day395=parseDay(base,395),day399=parseDay(base,399),day400=parseDay(base,400);
const periodRows=Array.from({length:1200},()=>row('2025-01-01','OTHER'));
periodRows[100]=row(base,'STAFF');
periodRows[700]=row(day395,'STAFF');
periodRows[701]=row(day399,'OTHER');
periodRows[800]=row(day399,'STAFF');
const fourHundred=make(periodRows);
const indexed=ctx.readRowsByDateRange_(fourHundred,2,15,base,day399,3,['STAFF']);
// A vm-created array has a different prototype: compare host-realm arrays, not realms.
assert.deepEqual(Array.from(indexed,r=>r[1]).sort(),[base,day395,day399].sort(),
  '400-day index must include the final month and never expose other employees');
assert.equal(fourHundred.stats.finders,1,'valid 400-day request must stay indexed');
assert.ok(new RegExp(ctx.dateRangeRegex_(base,day399,400)).test(day399),
  'indexed regex must include the requested final day');
// For internal >400-day ranges, completeness takes precedence over indexing.
assert.equal(ctx.dateRangeRegex_(base,day400,400),'',
  'incomplete date index must not be returned to a caller');
const fourHundredOne=make(periodRows);
const fallback=ctx.readRowsByDateRange_(fourHundredOne,2,15,base,day400,3,['STAFF']);
assert.deepEqual(Array.from(fallback,r=>r[1]).sort(),[base,day395,day399].sort(),
  'long-range fallback must still include every authorized row');
assert.equal(fourHundredOne.stats.finders,0,'overlong requests must not run truncated indexed search');
console.log('PASS adaptive date indexes: sparse, dense, complete 400-day range, long-range fallback, owner ACL');
