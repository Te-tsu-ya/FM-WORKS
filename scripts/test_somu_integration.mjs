import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const root=process.cwd();
const backend=fs.readFileSync(root+'/src/Somu.gs','utf8');
const schema=fs.readFileSync(root+'/src/Schema.gs','utf8');
const browser=fs.readFileSync(root+'/src/AppSomu.html','utf8').replace(/^<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
execFileSync(process.execPath,['--check','-'],{input:browser,encoding:'utf8'});
new Function(backend);
const headers={
 '総務備品':['備品ID','管理番号','品名','分類','メーカー','型番','保管場所','保有数','在庫下限','状態','備考','登録日時','更新日時','更新者ID','改訂番号'],
 '総務貸出':['貸出ID','備品ID','管理番号','貸出先','貸出数','貸出日','返却予定日','返却日','状態','使用目的','登録者ID','登録日時','更新日時','送信識別子'],
 '総務購買':['購買ID','品名','数量','概算単価','希望日','申請理由','申請者ID','申請者名','状態','関連備品ID','発注日','入荷日','備考','登録日時','更新日時','送信識別子','承認者ID','承認日時'],
 '総務書類':['書類ID','書類名','分類','保管場所','HTTPSリンク','期限','備考','状態','登録者ID','登録日時','更新日時','送信識別子']
};
let serial=0,rangeReads=0,fullColumnReads=0,indexLookups=0;const logs=[],sheets={},snapshotCache=new Map();let employee={role:'ADMIN',employeeId:'FM0001',name:'架空管理者',department:'総務'};
function sheet(rows){return{
 rows,getLastRow(){return this.rows.length;},
 getRange(r,c,n,w){return{
 getDisplayValues:()=>{rangeReads++;if(r===2&&w===1&&n>1)fullColumnReads++;return this.rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w).map(v=>String(v??'')));},
 setValues:values=>{for(let i=0;i<values.length;i++){if(!this.rows[r-1+i])this.rows[r-1+i]=[];for(let j=0;j<values[i].length;j++)this.rows[r-1+i][c-1+j]=values[i][j];}},
 createTextFinder:value=>{indexLookups++;return {matchEntireCell(){return this;},
   findNext(){const idx=rows.findIndex((row,i)=>i>=r-1&&i<r-1+n&&String(row[c-1])===String(value));
     return idx<0?null:{getRow:()=>idx+1};}}}
 };},
 appendRow(row){this.rows.push(row)}
};}
for(const [key,v] of Object.entries(headers))sheets[key]=sheet([v]);
const ctx=vm.createContext({
 Object,Array,Number,String,Date,RegExp,Math,JSON,Set,
 DB:{timeZone:'Asia/Tokyo'},DB_SCHEMA_SPECS:headers,
 requireSession_:()=>({employee}),assertPermission_:(who,permission)=>{if(permission!=='officeWorkspace'||!((who.role==='ADMIN')||who.department==='総務'))throw Error('権限なし')},
 Utilities:{formatDate:(d,tz,fmt)=>fmt==='yyyy-MM-dd'?'2026-10-10':'2026-10-10 10:00:00',
  newBlob:raw=>({getBytes:()=>new Uint8Array(Buffer.byteLength(raw,'utf8'))})},
 getDatabaseSpreadsheetId_:()=> 'SYNTHETIC_DB',
 cacheJsonGet_:key=>snapshotCache.get(key)||null,
 cacheJsonPut_:(key,value)=>{snapshotCache.set(key,JSON.parse(JSON.stringify(value)));return true;},
 cacheRemove_:key=>{snapshotCache.delete(key);},
 logPerformance_:()=>{},

 getDb_:()=>({getSheetByName:n=>sheets[n]||null}),
 // The production reader is covered by indexed-data tests; this mock preserves
 // complete per-asset/per-code results rather than the display page limit.
 readRowsByColumnValues_:(sheet,column,width,values)=>{
   const wanted=new Set((values||[]).map(String));
   return sheet.rows.slice(1).filter(row=>wanted.has(String(row[column-1]??'')))
     .map(row=>row.slice(0,width).map(v=>String(v??'')));
 },
 // The shared DataAccess helper is separately tested for moved-row hints and DB isolation.
 // Here, keep its live-row verification contract while exercising the Somu workflows.
 findVerifiedSheetRow_:(sheet,column,width,value)=>{
   const last=sheet.getLastRow();if(last<2)return null;
   const cell=sheet.getRange(2,column,last-1,1).createTextFinder(String(value))
     .matchEntireCell(true).findNext();
   if(!cell)return null;
   const rowNumber=cell.getRow(),row=sheet.getRange(rowNumber,1,1,width).getDisplayValues()[0];
   return String(row[column-1])===String(value)?{rowNumber,row}:null;
 },
 schemaHeaderIssues_:(a,b)=>a.flatMap((v,i)=>v===b[i]?[]:[i]),
 safeSheetText_:(x,max)=>String(x??'').trim().slice(0,max||200),
 normalizeDate_:s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw Error('日付不正');return s;},
 createId_:p=>p+'-'+(++serial),withScriptLock_:fn=>fn(),
 appendAudit_:v=>logs.push(v),auditJson_:v=>JSON.stringify(v),
 console
});
vm.runInContext(backend,ctx);
const call=(name,...args)=>vm.runInContext(name,ctx)(...args);
const storage=call('getSomuWorkspace','token');
assert.equal(storage.setupRequired,false);
assert.equal(storage.assets.length,0);
assert.equal(storage.canApprove,true);
const firstReadCount=rangeReads;
assert.equal(firstReadCount,4,'cold empty workspace verifies 4 headers exactly once');
const warmStorage=call('getSomuWorkspace','token');
assert.equal(rangeReads,firstReadCount,'hot cache must not read the Sheets header or any rows');
assert.equal(warmStorage.canApprove,true);
employee={role:'USER',employeeId:'FM0040',name:'架空総務社員',department:'総務'};
const warmStaff=call('getSomuWorkspace','token');
assert.equal(warmStaff.canApprove,false,'approval rights must be recalculated per session');
assert.equal(rangeReads,firstReadCount);
employee={role:'ADMIN',employeeId:'FM0001',name:'架空管理者',department:'総務'};
call('getSomuWorkspace','token',true);
assert.equal(rangeReads,firstReadCount+4,'explicit refresh must bypass server cache');
const checkedAfterForce=rangeReads;
call('getSomuWorkspace','token');
assert.equal(rangeReads,checkedAfterForce);

const saved=call('saveSomuAsset','token',{code:'AS-001',name:'架空PC',quantity:'3',minimum:'1'});
assert.equal(saved.ok,true);
assert.equal(saved.record.quantity,3);
const afterAssetWrite=rangeReads;
assert.equal(call('getSomuWorkspace','token').assets.length,1);
assert.equal(rangeReads,afterAssetWrite+5,'cache invalidation reads 4 headers and 1 data block only');
const cachedAssetRead=rangeReads;
assert.equal(call('getSomuWorkspace','token').assets[0].code,'AS-001');
assert.equal(rangeReads,cachedAssetRead,'second read must use the snapshot cache');

assert.throws(()=>call('saveSomuAsset','token',{code:'AS-001',name:'重複',quantity:1,minimum:0}),/同じ管理番号/);
const assetId=saved.record.id;
const loan=call('createSomuLoan','token',{assetId,borrower:'架空社員A',quantity:2,loanDate:'2026-10-10',dueDate:'2026-10-20',requestKey:'somu-test-key-001'});
assert.equal(loan.record.status,'貸出中');
assert.equal(call('createSomuLoan','token',{assetId,borrower:'架空社員A',quantity:2,loanDate:'2026-10-10',dueDate:'2026-10-20',requestKey:'somu-test-key-001'}).duplicate,true);
assert.throws(()=>call('createSomuLoan','token',{assetId,borrower:'架空社員B',quantity:2,loanDate:'2026-10-10',dueDate:'2026-10-20',requestKey:'somu-test-key-002'}),/貸出可能数/);
assert.throws(()=>call('saveSomuAsset','token',{id:assetId,revision:1,code:'AS-001',name:'架空PC',quantity:1,minimum:0}),/貸出中/);
assert.equal(call('returnSomuLoan','token',loan.record.id).record.status,'返却済');
assert.equal(call('returnSomuLoan','token',loan.record.id).duplicate,true);
assert.throws(()=>call('saveSomuAsset','token',{id:assetId,revision:0,code:'AS-001',name:'架空PC',quantity:2,minimum:0}),/更新しました/);
const purchase=call('createSomuPurchase','token',{name:'架空資材',quantity:4,estimatedPrice:1000,reason:'備品補充',requestKey:'somu-test-key-003'});
assert.equal(purchase.record.status,'申請中');
assert.throws(()=>call('advanceSomuPurchase','token',purchase.record.id,'APPROVE',''),/自分の購買申請/);
employee={role:'ADMIN',employeeId:'FM0002',name:'架空管理者B',department:'総務'};
assert.equal(call('advanceSomuPurchase','token',purchase.record.id,'APPROVE','').record.status,'承認済');
assert.equal(call('advanceSomuPurchase','token',purchase.record.id,'ORDER','').record.status,'発注済');
assert.equal(call('advanceSomuPurchase','token',purchase.record.id,'RECEIVE','').record.status,'入荷済');
assert.equal(Number(call('getSomuWorkspace','token').assets[0].quantity),3);
const doc=call('saveSomuDocument','token',{name:'架空書類',category:'規程',location:'共有',url:'https://example.com/doc',requestKey:'somu-test-key-004'});
assert.equal(doc.ok,true);
assert.throws(()=>call('saveSomuDocument','token',{name:'不正URL',url:'javascript:alert(1)',requestKey:'somu-test-key-005'}),/https/);
// Edge cases: Japanese date display, rejected dates and department-vs-admin approval.
const slashRow=['LON-DATE','AS-A','FA-001','架空利用者','1','2026/10/01','2026/10/09','','貸出中','','FM0001','','',''];
assert.equal(call('somuRecord_','loan',slashRow).dueDate,'2026-10-09');
assert.throws(()=>call('somuCount_','-1','数量',0,100),/整数/);
assert.throws(()=>call('createSomuLoan','token',{assetId,borrower:'架空社員',quantity:1,loanDate:'2026-10-20',dueDate:'2026-10-10',requestKey:'somu-test-key-006'}),/以降/);
const secondRequest=call('createSomuPurchase','token',{name:'架空文具',quantity:2,reason:'補充',requestKey:'somu-test-key-007'});
employee={role:'USER',employeeId:'FM0088',name:'架空総務担当',department:'総務'};
assert.throws(()=>call('advanceSomuPurchase','token',secondRequest.record.id,'APPROVE',''),/管理者のみ/);
// A returned purchasing request may only be corrected and resubmitted by its creator.
employee={role:'ADMIN',employeeId:'FM0001',name:'架空管理者A',department:'総務'};
assert.equal(call('advanceSomuPurchase','token',secondRequest.record.id,'RETURN','数量と理由を確認').record.status,'差戻し');
assert.throws(()=>call('resubmitSomuPurchase','token',secondRequest.record.id,
  {name:'不正な代理申請',quantity:3,reason:'代理',requestKey:'somu-test-key-008'}),/他の社員/);
employee={role:'ADMIN',employeeId:'FM0002',name:'架空管理者B',department:'総務'};
const corrected={name:'架空文具 改訂',quantity:3,estimatedPrice:1100,reason:'必要量の明記',requestKey:'somu-test-key-008'};
const resubmitted=call('resubmitSomuPurchase','token',secondRequest.record.id,corrected);
assert.equal(resubmitted.record.status,'申請中');
assert.equal(resubmitted.record.quantity,3);
assert.equal(resubmitted.record.approvedBy,'');
assert.equal(call('resubmitSomuPurchase','token',secondRequest.record.id,corrected).duplicate,true);
assert.match(call('somuFind_','purchase',secondRequest.record.id).item.note,/数量と理由を確認/);
employee={role:'ADMIN',employeeId:'FM0001',name:'架空管理者A',department:'総務'};
assert.equal(call('advanceSomuPurchase','token',secondRequest.record.id,'APPROVE','').record.status,'承認済');
employee={role:'ADMIN',employeeId:'FM0002',name:'架空管理者B',department:'総務'};
assert.throws(()=>call('resubmitSomuPurchase','token',secondRequest.record.id,
  {name:'上書き拒否',quantity:5,reason:'不正',requestKey:'somu-test-key-009'}),/差戻された/);
assert.throws(()=>call('createSomuLoan','token',{
  assetId,borrower:'別社員',quantity:1,loanDate:'2026-10-10',dueDate:'2026-10-20',
  requestKey:'somu-test-key-001'}),/送信識別子の重複/);
// Old active loans and duplicate asset codes must remain visible to server-side
// stock checks even when 3,001 newer records hide them from the UI list.
const lookupStart=indexLookups,wideReadStart=fullColumnReads;
const historicalLoan=['LON-EARLY-OPEN',assetId,'AS-001','架空の長期貸出',
  '1','2025-01-01','2025-01-31','','貸出中','','FM0001','','',''];
sheets['総務貸出'].rows.splice(1,0,historicalLoan);
const historicalAsset=['AST-EARLY','AS-OLD','架空の旧備品','','','','',
  '5','0','利用中','','','','FM0001','1'];
sheets['総務備品'].rows.splice(1,0,historicalAsset);
for(let i=0;i<3001;i++){
  sheets['総務備品'].rows.push(['AST-HISTORY-'+i,...Array(14).fill('')]);
  sheets['総務貸出'].rows.push(['LON-HISTORY-'+i,'OTHER-ASSET','','架空利用者',
    '1','2025-01-01','2025-01-31','2025-01-31','返却済','','FM0001','','','']);
}
assert.equal(call('somuOpenLoans_',assetId).length,1,'old live loan cannot be truncated');
assert.throws(()=>call('createSomuLoan','token',{assetId,borrower:'在庫超過',
  quantity:3,loanDate:'2026-10-10',dueDate:'2026-10-20',requestKey:'somu-scale-denied-001'}),/不足/);
const allowedLoan=call('createSomuLoan','token',{assetId,borrower:'在庫範囲',
  quantity:2,loanDate:'2026-10-10',dueDate:'2026-10-20',requestKey:'somu-scale-allowed-001'});
assert.equal(allowedLoan.record.quantity,2);
assert.throws(()=>call('saveSomuAsset','token',{id:assetId,revision:1,code:'AS-001',
  name:'架空PC',quantity:2,minimum:0}),/貸出中/);
assert.equal(call('returnSomuLoan','token','LON-EARLY-OPEN').record.status,'返却済');
assert.equal(call('somuOpenLoans_',assetId).length,1,'returned old loan not counted');
assert.throws(()=>call('saveSomuAsset','token',{code:'AS-OLD',name:'重複',
  quantity:1,minimum:0}),/同じ管理番号/);
assert.equal(call('saveSomuAsset','token',{code:'AS-NEW',name:'新規備品',
  quantity:1,minimum:0}).ok,true);
assert.equal(call('somuFind_','asset',assetId).item.id,assetId);
assert.equal(call('somuByRequestKey_','loan','somu-test-key-001').id,loan.record.id);
assert.throws(()=>call('somuFind_','asset','UNKNOWN-ASSET'),/見つかりません/);
assert.equal(call('somuByRequestKey_','loan','unknown-request-key'),null);
assert.equal(fullColumnReads,wideReadStart,'single record/key search must not fetch the entire ID column');
assert.ok(indexLookups>=lookupStart+4,'single record/key search must use the indexed finder');
const partial=call('getSomuWorkspace','token',true);
assert.equal(partial.truncatedKinds.assets,true,'asset list has incomplete page flag');
assert.equal(partial.truncatedKinds.loans,true,'loan list has incomplete page flag');
assert.equal(partial.truncated,true);
employee={role:'USER',employeeId:'FM0099',name:'架空一般社員',department:'開発'};
assert.throws(()=>call('getSomuWorkspace','token'),/権限なし/);
assert.throws(()=>call('saveSomuAsset','token',{code:'AS-002',name:'不正保存',quantity:1,minimum:0}),/権限なし/);
assert.ok(logs.length>=8);
const shell=fs.readFileSync(root+'/src/Index.html','utf8');
assert.ok(shell.includes("include_('AppSomu')")&&shell.includes("include_('StylesSomu')"));
console.log('PASS SOMU: schema, create, idempotency, bounds, return, approvals, access, audit, client syntax');