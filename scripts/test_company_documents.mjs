import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),src=fs.readFileSync(root+'/src/CompanyDocs.gs','utf8');
const html=fs.readFileSync(root+'/src/AppCompanyDocs.html','utf8');
execFileSync(process.execPath,['--check','-'],{input:html.replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),encoding:'utf8'});
const headers=['文書ID','文書名','分類','概要','施行日','公開状態','改訂番号','更新日時','更新者ID','参照URL','登録日時','登録者ID','削除日時','削除者ID','送信識別子','本文'];
const db={sheet:null,getSheetByName(name){return name==='社内文書'?this.sheet:null}};
function mockSheet(){
 const rows=[headers.slice()];return {rows,getLastRow(){return rows.length},getRange(r,c,n,w){
   return {getDisplayValues(){return rows.slice(r-1,r-1+n).map(row=>Array.from({length:w},(_,i)=>String(row[c-1+i]??'')))},
     setValues(values){for(let i=0;i<values.length;i++){rows[r+i-1]=rows[r+i-1]||[];for(let j=0;j<values[i].length;j++)rows[r+i-1][c+j-1]=values[i][j]}}}
 },appendRow(row){rows.push(row)},setFrozenRows(){}};
}
let employee={role:'ADMIN',department:'管理部',employeeId:'FM0001',name:'テスト管理者'},seq=0;
const audit=[],context=vm.createContext({
  Object,String,Array,Number,Math,Date,RegExp,JSON,Set,console,
  DB:{timeZone:'Asia/Tokyo'},schemaHeaderIssues_:(a,b)=>a.flatMap((v,i)=>v===b[i]?[]:[i]),
  getDb_:()=>db,requireSession_:()=>({employee}),requireAdminSession_:()=>{if(employee.role!=='ADMIN')throw Error('管理者のみ');return {employee}},
  createDatabaseBackup_:()=>({name:'backup'}),ensureSchemaSheet_:()=>{db.sheet=mockSheet()},
  withScriptLock_:fn=>fn(),createId_:prefix=>prefix+'-abcdefghijklmnop-'+(++seq),
  Utilities:{formatDate:()=> '2026-10-10 10:00:00'},normalizeDate_:v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))throw Error('日付不正');return v},
  safeSheetText_:(v,n)=>String(v??'').trim().slice(0,n),createId_:p=>p+'-abcdefghijklmnop-'+(++seq),
  appendAudit_:v=>audit.push(v),auditJson_:v=>JSON.stringify(v)
});
vm.runInContext(src,context);const call=(name,...args)=>context[name](...args);
assert.equal(call('getCompanyDocuments','token').setupRequired,true);
employee={role:'USER',department:'開発',employeeId:'FM0002'};
assert.throws(()=>call('initializeCompanyDocuments','token'),/管理者のみ/);
employee={role:'ADMIN',department:'管理部',employeeId:'FM0001',name:'管理者'};
assert.equal(call('initializeCompanyDocuments','token').changed,true);
const payload={title:'テスト用就業規則',category:'就業規則',body:'これは架空のテスト本文です。',status:'下書き',requestKey:'abcdefghi123456'};
const a=call('saveCompanyDocument','token',payload);assert.equal(a.document.revision,1);
const same=call('saveCompanyDocument','token',payload);assert.equal(same.duplicate,true);assert.equal(db.sheet.rows.length,2);
employee={role:'USER',department:'開発',employeeId:'FM0002',name:'社員'};
assert.equal(call('getCompanyDocuments','token').items.length,0);
assert.throws(()=>call('getCompanyDocument','token',a.document.id),/権限がありません/);
assert.throws(()=>call('saveCompanyDocument','token',payload),/権限がありません/);
employee={role:'USER',department:'総務',employeeId:'FM0003',name:'担当者'};
assert.equal(call('getCompanyDocuments','token').items.length,1);
assert.throws(()=>call('saveCompanyDocument','token',{...payload,title:'不正URL',url:'javascript:alert(1)',id:a.document.id,revision:1,requestKey:'otherkey1234567'}),/HTTPS/);
const b=call('saveCompanyDocument','token',{...payload,id:a.document.id,revision:1,status:'公開',requestKey:'anotherkey123456'});assert.equal(b.document.revision,2);
assert.throws(()=>call('saveCompanyDocument','token',{...payload,id:a.document.id,revision:1,requestKey:'thirdkey1234567'}),/別の担当者/);
employee={role:'USER',department:'開発',employeeId:'FM0002',name:'社員'};
assert.equal(call('getCompanyDocuments','token').items.length,1);
assert.equal(call('getCompanyDocument','token',a.document.id).document.body,payload.body);
employee={role:'ADMIN',department:'管理部',employeeId:'FM0001',name:'管理者'};
assert.throws(()=>call('deleteCompanyDocument','token',a.document.id,1),/別の担当者/);
assert.equal(call('deleteCompanyDocument','token',a.document.id,2).deleted,true);
assert.equal(call('getCompanyDocuments','token').items.length,0);
assert.ok(audit.length>=4);
console.log('PASS company documents: init, CRUD, visibility, access, HTTPS, idempotency, revision conflict, deletion, audit, client syntax');
