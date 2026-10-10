import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const root=process.cwd();
const source=fs.readFileSync(root+'/src/CompanyDocs.gs','utf8');
const html=fs.readFileSync(root+'/src/AppCompanyDocs.html','utf8');
execFileSync(process.execPath,['--check','-'],{
  input:html.replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),
  encoding:'utf8'
});
const baseHeaders=['文書ID','文書名','分類','概要','施行日','公開状態','改訂番号','更新日時','更新者ID',
  '参照URL','登録日時','登録者ID','削除日時','削除者ID','送信識別子','本文'];
const fullHeaders=baseHeaders.concat(['業務フォルダID','タグ']);
const logs=[],audit=[];
function mockSheet(headers=fullHeaders){
  const rows=[headers.slice()],sheet={
    rows,reads:[],cols:headers.length,
    getLastRow(){return rows.length;},
    getMaxColumns(){return this.cols;},
    insertColumnsAfter(pos,count){
      assert.equal(pos,this.cols);
      this.cols+=count;
      rows.forEach(r=>{while(r.length<this.cols)r.push('');});
    },
    getRange(r,c,n,w){
      this.reads.push([r,c,n,w]);
      const range={
        getDisplayValues(){
          return rows.slice(r-1,r-1+n).map(row=>Array.from({length:w},(_,i)=>String(row[c-1+i]??'')));
        },
        setValues(values){
          for(let i=0;i<values.length;i++){
            rows[r+i-1]=rows[r+i-1]||[];
            for(let j=0;j<values[i].length;j++)rows[r+i-1][c+j-1]=values[i][j];
          }
        },
        createTextFinder(query){
          let lower=String(query).toLowerCase();
          return {matchCase(){return this;},useRegularExpression(flag){assert.equal(flag,false);return this;},findAll(){
            return rows.slice(r-1,r-1+n).flatMap((row,i)=>
              String(row[c-1]||'').toLowerCase().includes(lower)?[{getRow:()=>r+i}]:[]);
          }};
        }
      };return range;
    },
    appendRow(row){rows.push(row.slice());},
    setFrozenRows(){}
  };
  return sheet;
}
const db={sheet:null,getSheetByName(n){return n==='社内文書'?this.sheet:null;}};
let employee={role:'ADMIN',department:'管理部',employeeId:'FM0001',name:'管理者'},sequence=0;
const context=vm.createContext({
  Object,String,Array,Number,Math,Date,RegExp,JSON,Set,console,
  DB:{timeZone:'Asia/Tokyo'},
  schemaHeaderIssues_:(a,b)=>a.flatMap((v,i)=>v===b[i]?[]:[i]),
  getDb_:()=>db,
  requireSession_:()=>({employee}),
  requireAdminSession_:()=>{if(employee.role!=='ADMIN')throw Error('管理者のみ');return {employee};},
  createDatabaseBackup_:()=>{logs.push('backup');return {name:'backup'};},
  ensureSchemaSheet_:(_db,name,headers)=>{
    assert.equal(name,'社内文書');
    if(!db.sheet)db.sheet=mockSheet(headers);
    else{
      const sh=db.sheet;
      if(sh.getMaxColumns()<headers.length)sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());
      const current=sh.getRange(1,1,1,headers.length).getDisplayValues()[0];
      current.forEach((v,i)=>{if(v&&v!==headers[i])throw Error('wrong header');});
      sh.getRange(1,1,1,headers.length).setValues([headers]);
    }
  },
  withScriptLock_:fn=>fn(),
  Utilities:{formatDate:()=> '2026-10-10 11:40:00'},
  normalizeDate_:v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))throw Error('日付不正');return v;},
  safeSheetText_:(v,n)=>{
    let s=String(v??'').trim().slice(0,n);
    return /^[=+\-@]/.test(s)?"'"+s:s;
  },
  createId_:prefix=>prefix+'-abcdefghijklmnop-'+(++sequence),
  appendAudit_:v=>audit.push(v),auditJson_:v=>JSON.stringify(v)
});
vm.runInContext(source,context,{filename:'CompanyDocs.gs'});
const call=(name,...args)=>context[name](...args);
const staff={role:'USER',department:'開発',employeeId:'FM0002',name:'一般社員'};
const somu={role:'USER',department:'総務',employeeId:'FM0003',name:'総務担当'};
const admin={role:'ADMIN',department:'管理部',employeeId:'FM0001',name:'管理者'};
assert.equal(call('getCompanyDocuments','SESSION').setupRequired,true);
employee=staff;
assert.throws(()=>call('initializeCompanyDocuments','SESSION'),/管理者のみ/);
employee=admin;
assert.equal(call('initializeCompanyDocuments','SESSION').changed,true);
assert.equal(db.sheet.getMaxColumns(),18);
assert.equal(logs.filter(v=>v==='backup').length,1);
assert.equal(call('initializeCompanyDocuments','SESSION').changed,false);
assert.equal(logs.filter(v=>v==='backup').length,1,'repeat initialization must not back up or modify');
const folders=call('getCompanyDocuments','SESSION').folders;
assert.ok(folders.some(f=>f.id==='general/equipment'&&f.parentId==='general'));
assert.ok(folders.some(f=>f.id==='safety/health'));
const payload={title:'【DEMO】備品管理規程',category:'社内規程',folderId:'general/equipment',
  tags:['備品','貸出'],summary:'架空の規程',body:'【DEMO】一般向けテスト本文。',
  status:'下書き',requestKey:'seed20261010one'};
assert.throws(()=>call('saveCompanyDocument','SESSION',{...payload,folderId:'general',
  requestKey:'seed20261010two'}),/業務フォルダ/);
assert.throws(()=>call('saveCompanyDocument','SESSION',{...payload,tags:['a','b','c','d','e','f','g','h','i'],
  requestKey:'seed20261010three'}),/最大8個/);
const created=call('saveCompanyDocument','SESSION',payload);
assert.equal(created.document.folderId,'general/equipment');
assert.equal(created.document.tags.join(','),'備品,貸出');
assert.equal(created.document.revision,1);
assert.equal(call('saveCompanyDocument','SESSION',payload).duplicate,true);
assert.equal(db.sheet.rows.length,2,'idempotency must not add duplicate rows');
db.sheet.reads=[];
const adminList=call('getCompanyDocuments','SESSION');
assert.equal(adminList.items.length,1);
assert.equal(adminList.items[0].folderId,'general/equipment');
assert.ok(!adminList.items[0].body,'metadata should never expose body');
assert.ok(db.sheet.reads.some(([r,c,n,w])=>r===2&&c===1&&w===15),'metadata A:O read');
assert.ok(db.sheet.reads.some(([r,c,n,w])=>r===2&&c===17&&w===2),'folder metadata Q:R read');
assert.ok(!db.sheet.reads.some(([r,c,n,w])=>r===2&&c===16&&n===1),'metadata API must not read body P');
employee=staff;
assert.equal(call('getCompanyDocuments','SESSION').items.length,0,'draft is private');
assert.throws(()=>call('getCompanyDocument','SESSION',created.document.id),/権限/);
assert.deepEqual(Array.from(call('searchCompanyDocumentBodies','SESSION','テスト本文').matchedIds),[]);
assert.equal(call('searchCompanyDocumentBodies','SESSION','備品 テスト本文').matchedIds.length,0,
  'draft metadata and body must stay private');
assert.throws(()=>call('saveCompanyDocument','SESSION',payload),/権限/);
employee=somu;
assert.equal(call('getCompanyDocuments','SESSION').items.length,1,'sōmu may view drafts');
assert.throws(()=>call('saveCompanyDocument','SESSION',{...payload,id:created.document.id,revision:1,url:'javascript:alert(1)',
  requestKey:'badurl20261010'}),/HTTPS/);
const updated=call('saveCompanyDocument','SESSION',{...payload,id:created.document.id,revision:1,status:'公開',
  folderId:'hr/work',tags:'勤務、在宅',requestKey:'edit20261010ok'});
assert.equal(updated.document.revision,2);
assert.equal(updated.document.folderId,'hr/work');
assert.equal(updated.document.tags.join(','),'勤務,在宅');
assert.throws(()=>call('saveCompanyDocument','SESSION',{...payload,id:created.document.id,
  revision:1,requestKey:'conflict20261010'}),/別の担当者/);
employee=staff;
assert.equal(call('getCompanyDocuments','SESSION').items.length,1);
assert.equal(call('getCompanyDocument','SESSION',created.document.id).document.body,payload.body);
assert.equal(call('searchCompanyDocumentBodies','SESSION','テスト本文').matchedIds.length,1,'published body searchable');
assert.equal(call('searchCompanyDocumentBodies','SESSION','一般 テスト本文').matchedIds.length,1,
  'space-separated words match anywhere in the same document, not only as one phrase');
assert.equal(call('searchCompanyDocumentBodies','SESSION','備品 テスト本文').matchedIds.length,1,
  'one word in the title and another in the body must match the same document');
assert.equal(call('searchCompanyDocumentBodies','SESSION','備品').matchedIds.length,1,
  'metadata-only keyword matches even when it is absent from the body');
assert.equal(call('searchCompanyDocumentBodies','SESSION','一般 存在しない用語').matchedIds.length,0,
  'every search term must appear in the same body');
assert.throws(()=>call('searchCompanyDocumentBodies','SESSION','一 二 三 四 五 六 七 八 九'),/最大8語/);
assert.equal(call('companyDocsValidId_','CD-demo-malicious&quot;'),false);
assert.equal(call('companyDocsValidId_',created.document.id),true);
employee=admin;
assert.throws(()=>call('deleteCompanyDocument','SESSION',created.document.id,1),/別の担当者/);
assert.equal(call('deleteCompanyDocument','SESSION',created.document.id,2).deleted,true);
assert.equal(call('getCompanyDocuments','SESSION').items.length,0);
assert.equal(call('searchCompanyDocumentBodies','SESSION','テスト本文').matchedIds.length,0);
assert.ok(audit.some(x=>x.operation==='社内文書登録'));
assert.ok(audit.some(x=>x.operation==='社内文書改訂'));
assert.ok(audit.some(x=>x.operation==='社内文書削除'));
// Existing 16-column data must remain readable and upgrade without losing the body.
db.sheet=mockSheet(baseHeaders);
db.sheet.appendRow(['CD-abcdefghijklmnop-123','【DEMO】旧規程','就業規則','旧版','2026-01-01','公開',2,
  '2026-10-01 11:00:00','ADMIN','','2026-01-01','ADMIN','','','legacyseed20261010','本文を消さないこと']);
employee=staff;
const legacy=call('getCompanyDocuments','SESSION');
assert.equal(legacy.needsUpgrade,true);
assert.equal(legacy.items[0].folderId,'other/general');
assert.equal(call('getCompanyDocument','SESSION','CD-abcdefghijklmnop-123').document.body,'本文を消さないこと');
employee=admin;
assert.throws(()=>call('saveCompanyDocument','SESSION',{...payload,requestKey:'legacyfail20261010'}),/分類列/);
assert.equal(call('initializeCompanyDocuments','SESSION').upgraded,true);
assert.equal(db.sheet.getMaxColumns(),18);
assert.equal(db.sheet.rows[1][15],'本文を消さないこと');
assert.equal(db.sheet.rows[1][16],'');
assert.equal(call('getCompanyDocuments','SESSION').needsUpgrade,false);
console.log('PASS company documents: 18-column migration, folder/tag validation, CRUD, access control, body search, metadata-only list, idempotency, revision conflict, soft deletion, audit and legacy upgrade');
