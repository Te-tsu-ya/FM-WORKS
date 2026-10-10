import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Synthetic in-memory spreadsheet. No real employee records or Google services.
const headings=Array.from({length:15},(_,i)=>'H'+i);
const initial=['W-1','2026-10-10','FM0002','架空社員B','案件A','開発','実装','09:00','10:00',60,'','2026-10-10 09:00:00','有効','',''];
const rows=[headings.slice(),initial.slice()];
let idSerial=0,indexedReadCount=0,saveCalls=0;
const sheet={
 getLastRow(){return rows.length;},
 getRange(row,col,height=1,width=1){
  const matrix=()=>Array.from({length:height},(_,r)=>
    Array.from({length:width},(_,c)=>String(rows[row-1+r]?.[col-1+c]??'')));
  return {
   getDisplayValues:matrix,
   setValues(values){
    assert.equal(values.length,height);
    for(let r=0;r<height;r++){
     assert.equal(values[r].length,width);
     const at=row-1+r;rows[at]??=Array(15).fill('');
     values[r].forEach((v,c)=>{rows[at][col-1+c]=v;});
    }
    saveCalls++;
   },
   createTextFinder(value){
    return {
     matchEntireCell(){return this;},
     findNext(){
      const i=rows.findIndex((r,j)=>j>0&&String(r[col-1])===String(value));
      return i<0?null:{getRow:()=>i+1};
     }
    };
   }
  };
 }
};
const people={
 FM0001:{employeeId:'FM0001',name:'架空管理者',active:true},
 FM0002:{employeeId:'FM0002',name:'架空社員B',active:true},
 FM0003:{employeeId:'FM0003',name:'架空社員C',active:true}
};
const ctx=vm.createContext({
 console,Date,Number,String,Math,Array,Object,JSON,
 requireSession_:token=>({employee:token==='ADMIN'?{...people.FM0001,role:'ADMIN'}:
   token==='STAFF_B'?{...people.FM0002,role:'USER'}:{...people.FM0003,role:'USER'}}),
 withScriptLock_:fn=>fn(),
 normalizeDate_:value=>String(value),
 assertMonthOpenForDate_:()=>{},
 safeSheetText_:value=>String(value??''),
 normalizeTime_:value=>String(value),
 getProjectByName_:()=>({status:'進行中'}),
 getDb_:()=>({getSheetByName:()=>sheet}),
 toTimestamp_:()=> '2026-10-10 10:20:00',
 createId_:()=> 'W-'+(++idSerial+100),
 getEmployee_:id=>{if(!people[id])throw Error('employee not found');return people[id]},
 auditJson_:record=>JSON.stringify(record),
 appendAudit_:()=>{},
 SpreadsheetApp:{flush(){}},
 readRowsByDateRange_:(sh,col,width,start,end)=>{
  assert.equal(sh,sheet);assert.equal(col,2);assert.equal(width,15);assert.equal(start,end);
  indexedReadCount++;
  return rows.slice(1).filter(r=>String(r[1])===start).map(r=>r.map(x=>String(x??'')));
 }
});
vm.runInContext(fs.readFileSync('src/Worklog.gs','utf8'),ctx);
const save=vm.runInContext('saveWorklog',ctx);
const draft={id:'W-1',date:'2026-10-10',project:'案件A',category:'開発',
 description:'修正',start:'09:00',end:'10:00',note:''};
assert.equal(save('ADMIN',draft).ok,true);
assert.equal(rows[1][2],'FM0002','admin editing staff-owned record must keep original owner by default');
assert.equal(rows[1][3],'架空社員B');
assert.equal(save('STAFF_B',{...draft,description:'本人編集'}).ok,true);
assert.equal(rows[1][2],'FM0002','own editing must preserve owner');
assert.throws(()=>save('STAFF_C',draft),/権限/,'other staff cannot take over record');
assert.equal(rows[1][2],'FM0002','unauthorized edit must not mutate row');

const later=['W-OTHER','2026-10-10','FM0002','架空社員B','案件A','開発','別作業','10:00','11:00',60,'','','有効','',''];
rows.push(later.slice());
assert.throws(()=>save('ADMIN',{...draft,start:'10:30',end:'11:00'}),/同じ時間帯/,'overlap on same date and employee is rejected');
assert.equal(rows[1][7],'09:00','overlap failure does not corrupt original row');
rows[2][12]='削除';
assert.equal(save('ADMIN',{...draft,start:'10:30',end:'11:00'}).ok,true,'deleted rows do not conflict');
assert.equal(rows[1][2],'FM0002');
assert.equal(save('ADMIN',{...draft,employeeId:'FM0003',start:'10:30',end:'11:00'}).ok,true);
assert.equal(rows[1][2],'FM0003','explicit admin reassignment still works');

assert.equal(save('ADMIN',{...draft,id:'',date:'2026-10-11',start:'12:00',end:'13:00'}).ok,true);
assert.equal(rows.at(-1)[2],'FM0001','new admin worklog belongs to admin by default');
assert.ok(indexedReadCount>=6,'overlap tests must use indexed single-date lookup');
assert.ok(saveCalls>=5);
console.log('PASS: worklog owner preservation, authorization, overlap integrity and indexed date lookup');
