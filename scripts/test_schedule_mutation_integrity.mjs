import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Synthetic employee and schedule rows only: no real GAS, DB or OAuth access.
const source=fs.readFileSync('src/Code.gs','utf8');
function extract(name){
 const first=source.indexOf('function '+name+'(');
 assert.ok(first>=0,'missing schedule function: '+name);
 const next=source.indexOf('\nfunction ',first+10);
 return source.slice(first,next<0?source.length:next);
}
const rows=[Array.from({length:18},(_,i)=>'H'+i)];
function addRow(id,owner,status){
 const r=Array(18).fill('');
 r[0]=id;r[1]='2026-10-16';r[2]='09:00';r[3]='10:00';r[4]='FALSE';
 r[5]=owner;r[6]='架空社員';r[7]='架空の社内予定';r[8]='予定';
 r[11]='社内';r[12]=status;r[13]=owner;r[14]='2026-10-15 09:00:00';
 r[16]='FM WORKS';r[17]='予定';rows.push(r);
}
addRow('S-DELETED','U1','削除');
addRow('S-ACTIVE','U1','有効');
let writes=0, audits=0, serial=0;
const sheet={
 getLastRow:()=>rows.length,
 getRange(row,col,height=1,width=1){
  return {
   createTextFinder(key){return{
    matchEntireCell(){return this;},
    findNext(){const i=rows.findIndex((r,j)=>j>0&&String(r[col-1])===String(key));
      return i<0?null:{getRow:()=>i+1};}
   };},
   getDisplayValues(){return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>String(rows[row+i-1]?.[col+j-1]??'')));},
   setValue(v){rows[row-1][col-1]=v;writes++;},
   setValues(data){assert.equal(data.length,height);for(let i=0;i<height;i++){
    assert.equal(data[i].length,width);rows[row+i-1]??=Array(18).fill('');
    data[i].forEach((v,j)=>{rows[row+i-1][col+j-1]=v;});
   }writes++;}
  };
 }
};
const staff={employeeId:'U1',name:'架空社員1',role:'USER'};
const other={employeeId:'U2',name:'架空社員2',role:'USER'};
const context=vm.createContext({
 String,Array,Object,Date,Math,JSON,Set,Map,
 DB:{timeZone:'Asia/Tokyo',sheets:{schedule:'予定'}},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{formatDate:()=> '2026-10-16 09:00:00'},
 SpreadsheetApp:{flush(){}},
 withScriptLock_:fn=>fn(),
 requireSession_:token=>({employee:token==='OWNER'?staff:token==='ADMIN'?{...staff,role:'ADMIN'}:other}),
 getDb_:()=>({getSheetByName:()=>sheet}),
 normalizeDate_:v=>String(v),normalizeTime_:v=>String(v),
 safeSheetText_:v=>String(v??''),
 getEmployees_:()=>[{employeeId:'U1',shortName:'架空社員1'},{employeeId:'U2',shortName:'架空社員2'}],
 normalizeScheduleVisibility_:v=>v,
 auditJson_:obj=>JSON.stringify(obj),
 createId_:()=> 'S-NEW-'+(++serial),
 appendAudit_:()=>{audits++;}
});
vm.runInContext(['canEditScheduleRow_','saveSchedule','deleteSchedule'].map(extract).join('\n'),context);
const draft=id=>({id,date:'2026-10-16',title:'新しい件名',category:'予定',
 allDay:false,start:'09:00',end:'10:00',employeeIds:['U1'],visibility:'社内'});
const initialWrites=writes;
assert.throws(()=>context.saveSchedule('OWNER',draft('S-DELETED')),/削除済み/, 'owner must not resurrect deleted event');
assert.throws(()=>context.saveSchedule('ADMIN',draft('S-DELETED')),/削除済み/, 'admin must not resurrect deleted event');
assert.throws(()=>context.saveSchedule('OTHER',draft('S-DELETED')),/権限/, 'foreign employee still denied');
assert.equal(rows[1][12],'削除');assert.equal(writes,initialWrites);
assert.throws(()=>context.deleteSchedule('OTHER','S-DELETED'),/権限/,'foreign employee must not get success for deleted record');
assert.equal(context.deleteSchedule('OWNER','S-DELETED').ok,true,'owner can retry deletion safely');
assert.equal(writes,initialWrites,'retry must not write');
assert.equal(context.deleteSchedule('OWNER','S-ACTIVE').ok,true,'active record can be deleted');
assert.equal(rows[2][12],'削除');
assert.throws(()=>context.saveSchedule('OWNER',draft('S-ACTIVE')),/削除済み/);
const fresh=context.saveSchedule('OWNER',draft(''));
assert.equal(fresh.ok,true);assert.match(fresh.id,/^S-NEW-/);
assert.equal(rows[1][12],'削除');assert.equal(rows[2][12],'削除');
assert.ok(audits>=2,'only legitimate delete/new actions were audited');
console.log('PASS schedule mutation: deleted-record ACL, no resurrection, owner idempotent retry, fresh creation');

