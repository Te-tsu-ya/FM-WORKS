import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SCHEMA=fs.readFileSync('src/Schema.gs','utf8');
const EXTRA=['プロジェクト工数対応','プロジェクト依存','プロジェクト添付','プロジェクト既読','プロジェクト原価','プロジェクト予算','資金繰り年間','資金口座','資金予定','資金取引','資金月次確定','資金明細注記','資金分類ルール','資金シナリオ','資金月次照合'];

class FakeSheet {
 constructor(name,headers=[],body=[],maxColumns=26){
  this.name=name;this.rows=[headers.slice(),...body.map(x=>x.slice())];this.maxColumns=Math.max(maxColumns,headers.length);this.frozen=0;
 }
 getMaxColumns(){return this.maxColumns;}
 insertColumnsAfter(index,count){assert.equal(index,this.maxColumns);this.maxColumns+=count;}
 setFrozenRows(n){this.frozen=n;}
 getRange(row,column,height=1,width=1){
  const sh=this;
  return {
   getDisplayValues(){return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>String(sh.rows[row+i-1]?.[column+j-1]??'')));},
   setValues(rows){rows.forEach((values,i)=>{const target=row+i-1;while(sh.rows.length<=target)sh.rows.push([]);
     values.forEach((value,j)=>{sh.rows[target][column+j-1]=value;});});}
  };
 }
}

function makeHarness(){
 const records=new Map(),events=[],audit=[],meta={version:15,backups:0,flushes:0,backupFails:false,auditFails:false,failedInsert:'',backupSnapshot:null};
 const db={
  getSheetByName:name=>records.get(name)||null,
  insertSheet(name){
   if(meta.failedInsert===name)throw Error('synthetic spreadsheet failure at '+name);
   if(records.has(name))throw Error('duplicate sheet');
   const sheet=new FakeSheet(name);records.set(name,sheet);events.push('create:'+name);return sheet;
  }
 };
 const context=vm.createContext({
  Date,console:{warn:()=>{}},
  getDb_:()=>db,getSettingsMap_:()=>({DB_VERSION:String(meta.version)}),
  requireAdminSession_:token=>{if(token!=='ADMIN')throw Error('管理者のみ');return{employee:{employeeId:'A',name:'架空管理者'}};},
  withScriptLock_:fn=>fn(),
  createDatabaseBackup_:admin=>{
   assert.equal(admin.employeeId,'A');meta.backups++;events.push('backup');
   if(meta.backupFails)throw Error('synthetic backup validation failed');
   meta.backupSnapshot=JSON.stringify([...records].map(([name,s])=>({name,rows:s.rows.map(x=>x.slice())})));
   return{name:'FM WORKS synthetic verified backup'};
  },
  saveSettings_:value=>{meta.version=Number(value.DB_VERSION);events.push('set-version');},
  appendAudit_:value=>{if(meta.auditFails)throw Error('synthetic audit failure');audit.push(value);events.push('audit');},
  SpreadsheetApp:{flush:()=>{meta.flushes++;events.push('flush');}},
  auditJson_:data=>JSON.stringify(data)
 });
 vm.runInContext(SCHEMA,context,{filename:'Schema.gs'});
 const specs=JSON.parse(JSON.stringify(vm.runInContext('DB_SCHEMA_SPECS',context)));
 for(const [name,header] of Object.entries(specs)){
  if(EXTRA.includes(name))continue;
  records.set(name,new FakeSheet(name,header,[['EXISTING-ROW-'+name,'must-stay-unchanged']]));
 }
 records.set('保護対象の既存追加シート',new FakeSheet('保護対象の既存追加シート',['番号','備考'],[['KEEP','original-value']]));
 return{context,db,records,events,audit,meta,specs};
}

const h=makeHarness();
assert.equal(h.meta.version,15);
const initial=h.context.getDatabaseSchemaStatus_();
assert.equal(initial.expectedVersion,19);
assert.equal(initial.version,15);
assert.deepEqual(Object.keys(initial.sheets).filter(n=>!initial.sheets[n].exists),EXTRA);
const originalRows=new Map([...h.records].map(([name,sh])=>[name,JSON.stringify(sh.rows)]));

// Public employee / unknown token cannot invoke migration or create a backup.
assert.throws(()=>h.context.migrateDatabaseToCurrent('STAFF'),/管理者/);
assert.equal(h.meta.backups,0);
assert.equal(h.events.length,0);

// A corrupt non-empty existing header stops before backup and before any mutation.
const taskSheet=h.records.get('プロジェクト作業');
const oldHeading=taskSheet.rows[0][2];taskSheet.rows[0][2]='列名不一致';
assert.throws(()=>h.context.migrateDatabaseToCurrent('ADMIN'),/列名が一致しない/);
assert.equal(h.meta.backups,0);
assert.equal(h.meta.version,15);
assert.ok(EXTRA.every(name=>!h.records.has(name)));
taskSheet.rows[0][2]=oldHeading;

// Backup verification failure stops before any schema change.
h.meta.backupFails=true;
assert.throws(()=>h.context.migrateDatabaseToCurrent('ADMIN'),/synthetic backup validation failed/);
assert.equal(h.meta.version,15);
assert.ok(EXTRA.every(name=>!h.records.has(name)));
assert.equal(h.events.filter(x=>x.startsWith('create:')).length,0);
h.meta.backupFails=false;

// Normal migration creates exactly eleven additive sheets, sets v18 and records audit.
const applied=h.context.migrateDatabaseToCurrent('ADMIN');
assert.equal(applied.ok,true);
assert.equal(applied.changed,true);
assert.equal(applied.auditRecorded,true);
assert.equal(applied.before.version,15);
assert.equal(applied.after.version,19);
assert.equal(h.meta.version,19);
assert.equal(h.audit.length,1);
assert.equal(h.audit[0].operation,'DBスキーマ更新');
assert.equal(h.context.getDatabaseSchemaStatus_().ready,true);
for(const name of EXTRA){
 const sh=h.records.get(name);
 assert.ok(sh,'created sheet '+name);
 assert.deepEqual(sh.rows[0],h.specs[name],'exact expected header '+name);
 assert.equal(sh.frozen,1,'freeze header '+name);
}
for(const [name,original] of originalRows)assert.equal(JSON.stringify(h.records.get(name).rows),original,'legacy sheet unchanged: '+name);
assert.ok(h.events.indexOf('backup')<h.events.indexOf('create:'+EXTRA[0]),'backup must precede creation');
assert.ok(h.events.indexOf('flush')<h.events.indexOf('audit'),'audit only after schema verification');

// Repeating migration is a no-op; no additional backup/audit.
const nBackups=h.meta.backups,nAudits=h.audit.length;
const second=h.context.migrateDatabaseToCurrent('ADMIN');
assert.equal(second.changed,false);
assert.equal(h.meta.backups,nBackups);
assert.equal(h.audit.length,nAudits);

// If audit append fails after successful migration, response must report success plus warning.
const auditCase=makeHarness();auditCase.meta.auditFails=true;
const notice=auditCase.context.migrateDatabaseToCurrent('ADMIN');
assert.equal(notice.ok,true);
assert.equal(notice.changed,true);
assert.equal(notice.auditRecorded,false);
assert.equal(auditCase.meta.version,19);
assert.equal(auditCase.context.getDatabaseSchemaStatus_().ready,true);

// If one sheet creation fails, DB_VERSION stays old and retry resumes safely.
const partial=makeHarness();partial.meta.failedInsert='プロジェクト添付';
assert.throws(()=>partial.context.migrateDatabaseToCurrent('ADMIN'),/synthetic spreadsheet failure/);
assert.equal(partial.meta.version,15);
assert.equal(partial.audit.length,0);
assert.equal(partial.records.get('保護対象の既存追加シート').rows[1][1],'original-value');
partial.meta.failedInsert='';
const recovered=partial.context.migrateDatabaseToCurrent('ADMIN');
assert.equal(recovered.after.ready,true);
assert.equal(partial.meta.version,19);
assert.equal(partial.meta.backups,2,'retry gets a new verified backup');
assert.equal(partial.context.getDatabaseSchemaStatus_().ready,true);
for(const name of EXTRA)assert.deepEqual(partial.records.get(name).rows[0],partial.specs[name]);

console.log('PASS schema v19: unauthorized blocked, corrupt header/backup failure no mutation, six additive sheets, backup-before-edit, audit-after-verification, idempotency, audit failure warning and recovery from partial update');
