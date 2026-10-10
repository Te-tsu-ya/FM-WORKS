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
let serial=0;const logs=[],sheets={};let employee={role:'ADMIN',employeeId:'FM0001',name:'架空管理者',department:'総務'};
function sheet(rows){return{
 rows,getLastRow(){return this.rows.length;},
 getRange(r,c,n,w){return{
 getDisplayValues:()=>this.rows.slice(r-1,r-1+n).map(row=>row.slice(c-1,c-1+w).map(v=>String(v??''))),
 setValues:values=>{for(let i=0;i<values.length;i++){if(!this.rows[r-1+i])this.rows[r-1+i]=[];for(let j=0;j<values[i].length;j++)this.rows[r-1+i][c-1+j]=values[i][j];}}
 };},
 appendRow(row){this.rows.push(row)}
};}
for(const [key,v] of Object.entries(headers))sheets[key]=sheet([v]);
const ctx=vm.createContext({
 Object,Array,Number,String,Date,RegExp,Math,JSON,Set,
 DB:{timeZone:'Asia/Tokyo'},DB_SCHEMA_SPECS:headers,
 requireSession_:()=>({employee}),assertPermission_:(who,permission)=>{if(permission!=='officeWorkspace'||!((who.role==='ADMIN')||who.department==='総務'))throw Error('権限なし')},
 Utilities:{formatDate:(d,tz,fmt)=>fmt==='yyyy-MM-dd'?'2026-10-10':'2026-10-10 10:00:00'},
 getDb_:()=>({getSheetByName:n=>sheets[n]||null}),
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
const saved=call('saveSomuAsset','token',{code:'AS-001',name:'架空PC',quantity:'3',minimum:'1'});
assert.equal(saved.ok,true);
assert.equal(saved.record.quantity,3);
assert.equal(call('getSomuWorkspace','token').assets.length,1);
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
employee={role:'USER',employeeId:'FM0099',name:'架空一般社員',department:'開発'};
assert.throws(()=>call('getSomuWorkspace','token'),/権限なし/);
assert.throws(()=>call('saveSomuAsset','token',{code:'AS-002',name:'不正保存',quantity:1,minimum:0}),/権限なし/);
assert.ok(logs.length>=8);
const shell=fs.readFileSync(root+'/src/Index.html','utf8');
assert.ok(shell.includes("include_('AppSomu')")&&shell.includes("include_('StylesSomu')"));
console.log('PASS SOMU: schema, create, idempotency, bounds, return, approvals, access, audit, client syntax');