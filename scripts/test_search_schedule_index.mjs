import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function row(id,title,visibility='公開'){
 const r=Array(18).fill('');
 r[0]=id;r[1]='2026-10-11';r[6]='架空社員';r[7]=title;r[8]='予定';
 r[9]='架空会場';r[11]=visibility;r[12]='有効';return r;
}
class Sheet{
 constructor(rows){this.rows=rows;this.wideCells=0;this.full=0;this.finder=0;this.blocks=0;this.fail=false;}
 getLastRow(){return this.rows.length+1;}
 getRange(start,col,count,width=1){
  const s=this;return{
   getDisplayValues(){
    if(width===18){s.wideCells+=count*18;if(start===2&&count===s.rows.length)s.full++;}
    return s.rows.slice(start-2,start-2+count).map(r=>r.slice(col-1,col+width-1));
   },
   createTextFinder(q){
    assert.equal(col,7);assert.equal(width,5);s.finder++;
    let regex=null,caseSensitive=null;
    return{
     useRegularExpression(v){regex=!!v;return this;},
     matchCase(v){caseSensitive=!!v;return this;},
     findAll(){
      if(s.fail)throw Error('Finder failed');
      assert.equal(regex,false);assert.equal(caseSensitive,false);
      const found=[];
      for(let i=start-2;i<Math.min(s.rows.length,start-2+count);i++)
       for(let c=col-1;c<col-1+width;c++)
        if(String(s.rows[i][c]||'').toLowerCase().includes(String(q).toLowerCase())){
         const n=i+2;found.push({getRow:()=>n});
        }
      return found;
     }
    };
   }
  };
 }
 getRangeList(refs){
  this.blocks+=refs.length;
  return{getRanges:()=>refs.map(ref=>{
   const m=/^A(\d+):R(\d+)$/.exec(ref);assert.ok(m,'bounded A:R row block');
   const a=Number(m[1]),b=Number(m[2]);return this.getRange(a,1,b-a+1,18);
  })};
 }
}
const blockRows=rows=>{
 const unique=[...new Set(rows)].sort((a,b)=>a-b),out=[];
 for(const value of unique){const last=out.at(-1);if(last&&last.end===value-1)last.end=value;else out.push({start:value,end:value});}
 return out;
};
let current=new Sheet([]);
const server=vm.createContext({
 console,Set,Map,Array,Object,Date,Math,String,Error,
 DB:{sheets:{schedule:'予定'}},requireSession_:()=>({employee:{employeeId:'U'}}),
 getEmployees_:()=>[],
 getDb_:()=>({getSheetByName:name=>name==='予定'?current:{getLastRow:()=>1}}),
 canViewScheduleRow_:(_,r)=>r[11]!=='管理者のみ',
 contiguousRowBlocks_:blockRows,readRowsByColumnValues_:()=>{throw Error('unexpected request lookup');}
});
vm.runInContext(fs.readFileSync('src/DataAccess.gs','utf8'),server);
vm.runInContext(fs.readFileSync('src/Search.gs','utf8'),server);
const query=q=>Array.from(server.searchApp('TOKEN',q),x=>({...x}));
let rows=Array.from({length:1000},(_,i)=>row('S'+i,'other'));
rows[12]=row('S12','needle visible');rows[12][10]='needle second match';
rows[222]=row('S222','needle confidential','管理者のみ');
rows[998]=row('S998','needle visible last');
current=new Sheet(rows);
assert.deepEqual(query('NEEDLE').map(x=>x.id),['S12','S998']);
assert.equal(current.finder,1);assert.equal(current.full,0);
assert.equal(current.wideCells,54,'only 3 six-column-match candidate rows fetched at 18 columns');
assert.equal(current.blocks,3,'dedupe multi-column matches in same row');

rows=Array.from({length:1000},(_,i)=>row('S'+i,'ordinary'));
rows[339]=row('S339','token');rows[339][6]='needle';
current=new Sheet(rows);
assert.deepEqual(query('needle token').map(x=>x.id),['S339'],'cross-column joined terms preserved');
assert.equal(current.finder,0);assert.equal(current.full,1);
current=new Sheet([row('S1','needle'),row('S2','ordinary')]);
assert.deepEqual(query('needle').map(x=>x.id),['S1']);
assert.equal(current.full,1,'small sheets read once');

rows=Array.from({length:1000},(_,i)=>row('S'+i,'ordinary'));
for(let i=0;i<60;i++)rows[i*10]=row('S'+i*10,'needle '+i);
current=new Sheet(rows);
const abundant=query('needle');assert.equal(abundant.length,30);
assert.equal(abundant[0].id,'S0');assert.equal(abundant[29].id,'S290');
assert.equal(current.finder,1);
assert.equal(current.full,0,'fragmented matches must avoid full-table transfer');
assert.ok(current.blocks<=8,'no more than eight body reads');
assert.equal(current.blocks,1,'small gaps collapse into a single remote read');
assert.ok(current.wideCells<rows.length*18,'transfer fewer cells than the full table');

rows=Array.from({length:1000},(_,i)=>row('S'+i,'ordinary'));
for(let i=0;i<8;i++)rows[i*100]=row('S'+i*100,'needle distant');
current=new Sheet(rows);
const separated=query('needle');
assert.equal(separated.length,8,'distant hits remain visible');
assert.equal(current.blocks,8,'large gaps keep isolated low-cell reads');
assert.equal(current.full,0);
assert.equal(current.wideCells,8*18);
rows=Array.from({length:1000},(_,i)=>row('S'+i,'ordinary'));
for(let i=0;i<100;i++)rows[i*10]=row('S'+i*10,'needle '+i);
current=new Sheet(rows);
const nearlyFull=query('needle');
assert.equal(nearlyFull.length,30,'dense search cap is unchanged');
assert.equal(current.full,1,'when matched windows span over 75% of the table, one full read wins');
assert.equal(current.blocks,0,'dense fallback avoids multiple getDisplayValues calls');

rows=Array.from({length:1000},(_,i)=>row('S'+i,'ordinary'));
rows[100]=row('S100','needle');
current=new Sheet(rows);current.fail=true;
assert.deepEqual(query('needle').map(x=>x.id),['S100']);
assert.equal(current.full,1,'finder failure fallback');

rows[10]=row('S10','a.b exact');rows[11]=row('S11','axb unrelated');
current=new Sheet(rows);
assert.deepEqual(query('a.b').map(x=>x.id),['S10'],'user search treated as literal');
assert.equal(current.full,0);
console.log('PASS: large schedule sparse read, ACL, 30 limit, source order, whitespace / fragmented / finder failure fallback');
