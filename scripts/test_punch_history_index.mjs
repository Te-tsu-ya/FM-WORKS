import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// All data below are synthetic. The test has no connector, DB writes or live account access.
const c=vm.createContext({console,Date,Map,Set,JSON,RegExp,Math,Number,String,Boolean,Object,Array,Error});
vm.runInContext(fs.readFileSync('src/Code.gs','utf8'),c,{filename:'Code.gs'});
vm.runInContext(fs.readFileSync('src/DataAccess.gs','utf8'),c,{filename:'DataAccess.gs'});
const make=(id,emp,date,stamp,deleted='',replaces='')=>[
 id,emp,'架空社員',date,'出勤',stamp,'出社','WEB',deleted,replaces,'','2026-10-11 00:00:00'
];
function sheet(rows){
 const calls={whole:0,wideCells:0,index:0,finds:0};
 const area=(row,col,height=1,width=1)=>({
  getDisplayValues(){
   if(row>=2&&width===12){
    calls.wideCells+=height*width;
    if(height===rows.length)calls.whole++;
   }
   return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>
     String((row+i===1?Array(12).fill('見出し'):rows[row+i-2])?.[col+j-1]??'')));
  },
  createTextFinder(pattern){
   let regex=false,exact=false;
   return {
    useRegularExpression(value){regex=!!value;return this},
    matchEntireCell(value){exact=!!value;return this},
    findAll(){
     calls.finds++;
     const matches=[],re=regex?new RegExp(pattern):null;
     for(let i=Math.max(2,row);i<row+height;i++){
      const value=String(rows[i-2]?.[col-1]??'');
      if(re?re.test(value):(exact?value===pattern:value.includes(pattern)))matches.push({getRow:()=>i});
     }
     return matches;
    }
   };
  }
 });
 return {
  calls,rows,
  getLastRow:()=>rows.length+1,
  getRange:area,
  getRangeList(names){
   calls.index++;
   return {getRanges:()=>names.map(name=>{
    const match=/^A(\d+):L(\d+)$/.exec(name);
    assert.ok(match,'expected bounded A:L range '+name);
    return area(Number(match[1]),1,Number(match[2])-Number(match[1])+1,12);
   })};
  }
 };
}
let active=sheet([]);
c.getDb_=()=>({getSheetByName(name){assert.equal(name,'打刻ログ');return active;}});
c.requireSession_=token=>{assert.equal(token,'AUTHENTICATED-TEST');return {employee:{employeeId:'E-01'}};};
const legacy=(rows,employeeId)=>{
 const all=rows.filter(r=>r[1]===employeeId);
 const superseded=new Set(all.map(r=>String(r[9]||'').trim()).filter(Boolean));
 return all.filter(r=>String(r[8]).toUpperCase()!=='TRUE'&&!superseded.has(String(r[0]||'').trim()));
};

const large=Array.from({length:1000},(_,i)=>make('P-'+i,'E-02','2026-10-01','2026-10-01 09:00:00'));
large[44]=make('P-OLD','E-01','2026-09-10','2026-09-10 09:00:00');
large[483]=make('P-ACTIVE','E-01','2026-09-30','2026-09-30 09:00:00');
large[876]=make('P-FIX','E-01','2026-10-10','2026-10-10 09:01:00','', 'P-OLD');
large[930]=make('P-DELETED','E-01','2026-10-09','2026-10-09 09:00:00','TRUE');
large[957]=make('P-FOREIGN','E-02','2026-10-09','2026-10-09 11:00:00','','P-ACTIVE');
active=sheet(large);
const expected=legacy(large,'E-01');
const actual=c.getActivePunchRows_('E-01');
assert.deepEqual(Array.from(actual,r=>r[0]),expected.map(r=>r[0]),'all active punches must match the original 12-column full scan');
assert.deepEqual(Array.from(actual,r=>r[0]),['P-ACTIVE','P-FIX'],'same-user replacement/deletion handling is preserved');
assert.equal(active.calls.whole,0,'large sparse staff history must not read the whole 12-column log');
assert.equal(active.calls.finds,1,'look up only one employee ID');
assert.ok(active.calls.wideCells<=48,'only four employee rows (including old/deleted for correction handling) should be fetched; got '+active.calls.wideCells);
assert.equal(active.calls.index,1,'use bounded range-list blocks');
assert.deepEqual(Array.from(c.getPunchHistory('AUTHENTICATED-TEST',1),x=>x.punchId),['P-FIX'],'chronological limit and auth must be preserved');
assert.ok(c.getPunchHistory('AUTHENTICATED-TEST',50).every(x=>x.employeeId==='E-01'),'other staff history must not leak');

active=sheet(Array.from({length:14},(_,i)=>make('SM-'+i,i%2===0?'E-01':'E-02','2026-10-02','2026-10-02 08:00:00')));
assert.deepEqual(Array.from(c.getActivePunchRows_('E-01'),r=>r[0]),legacy(active.rows,'E-01').map(r=>r[0]));
assert.equal(active.calls.whole,1,'small tables keep one-shot all-column read');
assert.equal(active.calls.finds,0,'avoid TextFinder overhead on small tables');

const meta=Array.from({length:600},(_,i)=>make('META-'+i,'E-02','2026-10-02','2026-10-02 08:00:00'));
meta[11]=make('META-MATCH','E+([01])','2026-10-03','2026-10-03 08:00:00');
active=sheet(meta);
assert.deepEqual(Array.from(c.getActivePunchRows_('E+([01])'),r=>r[0]),['META-MATCH'],'escaped regex metacharacters preserve literal employee ID matching');
assert.equal(active.calls.whole,0);

active=sheet(Array.from({length:600},(_,i)=>make('FRAGMENT-'+i,i%2===0?'E-01':'E-02','2026-10-02','2026-10-02 08:00:00')));
assert.deepEqual(Array.from(c.getActivePunchRows_('E-01'),r=>r[0]),legacy(active.rows,'E-01').map(r=>r[0]),'fragmented index fallback produces the same active records');
assert.equal(active.calls.whole,0,'fragmented matches use bounded windows instead of the entire table');
assert.ok(active.calls.wideCells<600*12,'window gaps stay unread');

active=sheet([]);
assert.deepEqual(Array.from(c.getActivePunchRows_('E-01')),[],'empty sheets return without scanning');

// A caller-provided Infinity/huge limit must not create an unbounded GAS RPC.
active=sheet(Array.from({length:240},(_,i)=>make('BOUND-'+i,'E-01',
  '2026-10-12','2026-10-12 09:00:00')));
assert.equal(c.getPunchHistory('AUTHENTICATED-TEST',500000).length,100,
  'excessive history requests must be capped to 100 entries');
assert.equal(c.getPunchHistory('AUTHENTICATED-TEST',Infinity).length,20,
  'nonfinite limit must fall back to normal 20-entry response');
assert.equal(c.getPunchHistory('AUTHENTICATED-TEST',-200).length,1,
  'negative limit must not request an invalid array range');
assert.equal(c.getPunchHistory('AUTHENTICATED-TEST').length,20,
  'default history limit must remain 20');

console.log('PASS: indexed employee punch history, corrected/cancelled records, auth scope, limit/order, escaped IDs and small/fragmented fallback');
