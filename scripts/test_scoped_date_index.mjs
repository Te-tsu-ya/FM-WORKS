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
console.log('PASS adaptive date indexes: 1 finder for sparse scoped date, 2 for dense, owner ACL, no-hit');
