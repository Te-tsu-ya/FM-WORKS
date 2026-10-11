import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Synthetic task-link table. No real employee, customer, bank or production data.
const context=vm.createContext({console,Date,Math,Map,Set,JSON,Number,Array,Object,String,RegExp,Boolean,Error});
vm.runInContext(fs.readFileSync('src/Schema.gs','utf8'),context,{filename:'Schema.gs'});
const header=JSON.parse(JSON.stringify(vm.runInContext("DB_SCHEMA_SPECS['プロジェクト工数対応']",context)));
class LinkSheet {
 constructor(size=1000){
  this.rows=[header.slice(),...Array.from({length:size},(_,i)=>[
   'W-'+i,'P-1','TASK-'+(i%7),'2026-10-11','USER','KEY-'+i
  ])];
  this.stats={allWide:0,wideCells:0,indexFinds:0,header:0};
 }
 getLastRow(){return this.rows.length;}
 getRange(row,col,height=1,width=1){
  const sheet=this;
  return {
   getDisplayValues(){
    if(row===1)sheet.stats.header++;
    if(row===2&&width===6&&height===sheet.rows.length-1)sheet.stats.allWide++;
    if(row>=2&&width>1)sheet.stats.wideCells+=height*width;
    return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>
     String(sheet.rows[row+i-1]?.[col+j-1]??'')));
   },
   createTextFinder(pattern){
    let regex=false,entire=false;
    return {
     useRegularExpression(value){regex=!!value;return this;},
     matchEntireCell(value){entire=!!value;return this;},
     findAll(){
      sheet.stats.indexFinds++;
      const match=regex?new RegExp(pattern):null,out=[];
      for(let i=row-1;i<Math.min(sheet.rows.length,row-1+height);i++){
       const cell=String(sheet.rows[i][col-1]||'');
       const valid=match?(entire?match.test(cell):match.test(cell)):(entire?cell===pattern:cell.includes(pattern));
       if(valid)out.push({getRow:()=>i+1});
      }
      return out;
     }
    };
   }
  };
 }
 getRangeList(locations){
  const sheet=this;
  return {getRanges(){return locations.map(name=>{
   const m=/^A(\d+):F(\d+)$/.exec(name);
   assert.ok(m,'bounded column block expected: '+name);
   return sheet.getRange(Number(m[1]),1,Number(m[2])-Number(m[1])+1,6);
  });}};
 }
}
let target=new LinkSheet(1000);
context.getDb_=()=>({getSheetByName:name=>name==='プロジェクト工数対応'?target:null});
context.getDatabaseSpreadsheetId_=()=> 'SYNTHETIC-DB';
vm.runInContext(fs.readFileSync('src/DataAccess.gs','utf8'),context,{filename:'DataAccess.gs'});
vm.runInContext(fs.readFileSync('src/ProjectAdvanced.gs','utf8'),context,{filename:'ProjectAdvanced.gs'});

const visible=[{id:'W-4',date:'2026-10-11'},{id:'W-499'},{id:'W-998'},{id:'NOT-FOUND'},{id:'W-4'}];
const copy=JSON.stringify(visible);
const empty=context.projectAdvancedWorklogIds_([]);
assert.equal(empty.length,0);
assert.deepEqual(target.stats,{allWide:0,wideCells:0,indexFinds:0,header:0},'empty date must never open the task-link sheet');

const actual=context.projectAdvancedWorklogIds_(visible);
assert.deepEqual(actual.map(x=>x.taskId),['TASK-4','TASK-2','TASK-4','','TASK-4']);
assert.equal(JSON.stringify(visible),copy,'client worklog rows are not mutated');
assert.equal(actual.length,visible.length,'never return unseen employee/task records');
assert.equal(target.stats.indexFinds,1,'large/sparse link sheet is indexed by visible worklog IDs');
assert.equal(target.stats.allWide,0,'small date does not scan full six-column link table');
assert.ok(target.stats.wideCells<=18,'only three existing linked rows are fetched, got '+target.stats.wideCells);
assert.equal(target.stats.header,1,'header validation still enforced');

target=new LinkSheet(6);
const small=context.projectAdvancedWorklogIds_([{id:'W-1'},{id:'W-3'}]);
assert.deepEqual(small.map(x=>x.taskId),['TASK-1','TASK-3']);
assert.equal(target.stats.indexFinds,0,'small tables keep cheaper one-shot full read');
assert.equal(target.stats.allWide,1);

target=new LinkSheet(1000);
const many=context.projectAdvancedWorklogIds_(Array.from({length:25},(_,i)=>({id:'W-'+i})));
assert.equal(many.length,25);
assert.equal(target.stats.indexFinds,0,'larger views avoid excessively fragmented indexed reads');
assert.equal(target.stats.allWide,1,'large visible sets use existing one-shot semantics');

target=new LinkSheet(1000);
target.rows[0][0]='不正な見出し';
assert.throws(()=>context.projectAdvancedWorklogIds_([{id:'W-1'}]),/列構成/,'schema header guard must never be bypassed');

target=null;
assert.deepEqual(context.projectAdvancedWorklogIds_([{id:'W-1'}]).map(x=>x.taskId),[''],'old installations without the optional sheet stay compatible');

console.log('PASS: task-link index / zero-I-O empty day / header guard / duplicate items / sparse vs large fallback / scope');
