import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
class Sheet{
 constructor(headers){this.rows=[headers.slice()];this.writes=0;}
 getLastRow(){return this.rows.length;}
 getMaxRows(){return Math.max(101,this.rows.length);}
 insertRowsAfter(_after,n){this.maxExtra=(this.maxExtra||0)+n;}
 getRange(row,col,h=1,w=1){const sh=this;return {
  getDisplayValues(){return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>String(sh.rows[row+i-1]?.[col+j-1]??'')));},
  setValues(values){sh.writes++;values.forEach((r,i)=>{while(sh.rows.length<row+i)sh.rows.push([]);r.forEach((v,j)=>{sh.rows[row+i-1][col+j-1]=v;});});}
 };}
 appendRow(row){this.writes++;this.rows.push(row.slice());}
}
const sheets=new Map(),audits=[];let uid=0,failedAudit=false,flushes=0;
const utils={DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},
 formatDate:()=> '2026-10-11 12:00:00',getUuid:()=> 'UUID-'+(++uid),
 computeDigest:(_algorithm,source)=>[...createHash('sha256').update(source).digest()].map(x=>x>127?x-256:x)};
const ctx=vm.createContext({
 console:{warn(){}},Date,Number,String,Array,Math,Set,Map,JSON,Error,RegExp,Utilities:utils,
 DB:{timeZone:'Asia/Tokyo'},getDb_:()=>({getSheetByName:name=>sheets.get(name)||null}),
 safeSheetText_:(s)=>String(s).startsWith('=')?"'"+s:s,
 requireAdminSession_:t=>{if(t!=='ADMIN')throw Error('管理者のみ');return{employee:{employeeId:'A',name:'架空管理者'}};},
 withScriptLock_:fn=>fn(),SpreadsheetApp:{flush(){flushes++;}},
 appendAudit_:data=>{if(failedAudit)throw Error('audit unavailable');audits.push(data);},
 auditJson_:x=>JSON.stringify(x)
});
for(const path of ['src/Schema.gs','src/CashFlow.gs','src/CashFlowBank.gs'])vm.runInContext(fs.readFileSync(path,'utf8'),ctx,{filename:path});
const js=code=>vm.runInContext(code,ctx);
assert.equal(js('DB_SCHEMA_VERSION'),19);
assert.throws(()=>ctx.getCashFlowBankWorkspace('STAFF',2026),/管理者/);
assert.throws(()=>ctx.saveCashFlowScheduledItem('STAFF',{}),/管理者/);
assert.throws(()=>ctx.saveCashFlowBankAccount('STAFF',{}),/管理者/);
assert.throws(()=>ctx.importCashFlowBankRows('STAFF',{}),/管理者/);
assert.throws(()=>ctx.setCashFlowTransfer('STAFF','T',true,0),/管理者/);
assert.throws(()=>ctx.saveCashFlowClosedThrough('STAFF',{}),/管理者/);
assert.equal(ctx.getCashFlowBankWorkspace('ADMIN',2026).setupRequired,true);
const spec=JSON.parse(JSON.stringify(js('DB_SCHEMA_SPECS')));
for(const key of ['資金繰り年間','資金口座','資金予定','資金取引','資金月次確定'])sheets.set(key,new Sheet(spec[key]));
const accBase={id:'',bank:'架空信用金庫',branch:'本店',name:'運転資金',last4:'1234',active:true,revision:0,requestKey:'CFB-ACCOUNT-KEY-0001'};
assert.throws(()=>ctx.saveCashFlowBankAccount('ADMIN',{...accBase,last4:'12345'}),/末尾/);
const account=ctx.saveCashFlowBankAccount('ADMIN',accBase);
assert.equal(account.ok,true);assert.equal(account.revision,1);
assert.equal(ctx.saveCashFlowBankAccount('ADMIN',accBase).duplicate,true);
assert.equal(sheets.get('資金口座').rows.length,2);
assert.throws(()=>ctx.saveCashFlowBankAccount('ADMIN',{...accBase,bank:'別の銀行'}),/識別子/);
const account2=ctx.saveCashFlowBankAccount('ADMIN',{...accBase,bank:'架空銀行',name:'積立',last4:'5678',requestKey:'CFB-ACCOUNT-KEY-0002'});
assert.equal(ctx.getCashFlowBankWorkspace('ADMIN',2026).accounts.length,2);
const planBase={id:'',title:'事務所の家賃',direction:'OUT',amount:50000,accountId:account.id,category:'固定費',
 frequency:'MONTHLY',startMonth:'2025-12',endMonth:'2026-11',day:25,active:true,note:'',revision:0,requestKey:'CFB-SCHEDULE-000001'};
const p=ctx.saveCashFlowScheduledItem('ADMIN',planBase);
assert.equal(p.revision,1);
const once=ctx.saveCashFlowScheduledItem('ADMIN',{...planBase,title:'取引先から入金',direction:'IN',amount:150000,accountId:account2.id,
 frequency:'ONCE',startMonth:'2026-02',endMonth:'',day:10,requestKey:'CFB-ONCE-ITEM-00001'});
const quarter=ctx.saveCashFlowScheduledItem('ADMIN',{...planBase,title:'四半期支払',amount:12000,
 frequency:'QUARTERLY',requestKey:'CFB-QUARTER-ITEM-01'});
const annual=ctx.saveCashFlowScheduledItem('ADMIN',{...planBase,title:'年次保険',amount:8000,
 frequency:'YEARLY',requestKey:'CFB-ANNUAL-ITEM-001'});
const rows=ctx.getCashFlowBankWorkspace('ADMIN',2026).monthly;
assert.equal(rows.length,12);
assert.equal(rows[0].month,'2025-12');
assert.equal(rows[0].scheduledOut,70000,'monthly 50000 + quarterly 12000 + annual 8000');
assert.equal(rows[1].scheduledOut,50000);
assert.equal(rows[2].scheduledIn,150000);
assert.equal(rows[3].scheduledOut,62000,'quarterly recurrence');
assert.equal(rows[11].scheduledOut,50000);
assert.equal(ctx.saveCashFlowScheduledItem('ADMIN',planBase).duplicate,true);
assert.throws(()=>ctx.saveCashFlowScheduledItem('ADMIN',{...planBase,id:p.id,revision:0,requestKey:'CFB-NEW-ITEM-000001'}),/他の利用者/);
const stop=ctx.saveCashFlowScheduledItem('ADMIN',{...planBase,id:p.id,revision:1,active:false,requestKey:'CFB-DISABLE-ITEM-001'});
assert.equal(stop.revision,2);
assert.equal(ctx.getCashFlowBankWorkspace('ADMIN',2026).monthly[1].scheduledOut,0,'disabled expenses not forecast');
assert.throws(()=>ctx.saveCashFlowScheduledItem('ADMIN',{...planBase,frequency:'WEEKLY',requestKey:'CFB-BAD-PERIOD-001'}),/繰り返し/);
assert.throws(()=>ctx.saveCashFlowScheduledItem('ADMIN',{...planBase,startMonth:'2026-02',endMonth:'2026-01',requestKey:'CFB-BAD-DATE-00001'}),/終了月/);
const tx={date:'2026/04/10',incoming:100000,outgoing:0,description:'架空の売上入金',balance:500000,externalId:'BANK-001',occurrence:1,transfer:false};
const payment={date:'2026-04-11',incoming:0,outgoing:33000,description:'家賃の支払',balance:467000,externalId:'BANK-002',occurrence:1,transfer:false};
const internal={date:'2026-04-12',incoming:0,outgoing:20000,description:'会社口座間の移動',balance:447000,externalId:'BANK-003',occurrence:1,transfer:true};
assert.throws(()=>ctx.importCashFlowBankRows('ADMIN',{accountId:account.id,rows:[{...tx,date:'2026/02/30'}],fileName:'fixture.csv',requestKey:'CFB-BAD-TX-KEY-0001'}),/存在しない/);
assert.throws(()=>ctx.importCashFlowBankRows('ADMIN',{accountId:account.id,rows:[{...tx,outgoing:1000}],fileName:'fixture.csv',requestKey:'CFB-BAD-TX-KEY-0002'}),/いずれか/);
assert.throws(()=>ctx.importCashFlowBankRows('ADMIN',{accountId:'missing',rows:[tx],fileName:'fixture.csv',requestKey:'CFB-BAD-TX-KEY-0003'}),/見つかりません/);
const first=ctx.importCashFlowBankRows('ADMIN',{accountId:account.id,rows:[tx,payment,internal],fileName:'statement.csv',requestKey:'CFB-BANK-BATCH-00001'});
assert.equal(first.added,3);assert.equal(first.skipped,0);
const again=ctx.importCashFlowBankRows('ADMIN',{accountId:account.id,rows:[tx,payment,internal],fileName:'another-name.csv',requestKey:'CFB-BANK-BATCH-00002'});
assert.equal(again.added,0);assert.equal(again.skipped,3);
assert.equal(sheets.get('資金取引').rows.length,4);
let state=ctx.getCashFlowBankWorkspace('ADMIN',2026);
const apr=state.monthly.find(x=>x.month==='2026-04');
assert.equal(apr.actualIn,100000);assert.equal(apr.actualOut,33000);
assert.equal(apr.transferOut,20000);assert.equal(apr.importedCount,3);
const bankTotals=state.bankSummaries.find(x=>x.accountId===account.id);
assert.equal(bankTotals.latestBalance,447000);
assert.equal(bankTotals.incoming,100000);
assert.equal(bankTotals.outgoing,33000);
assert.equal(bankTotals.statementIn,100000);
assert.equal(bankTotals.statementOut,53000,'bank statement totals include transfer amounts');
assert.equal(bankTotals.transferOut,20000);
const transferId=state.transactions.find(x=>x.transfer).id;
const change=ctx.setCashFlowTransfer('ADMIN',transferId,false,1);
assert.equal(change.revision,2);
assert.throws(()=>ctx.setCashFlowTransfer('ADMIN',transferId,true,1),/更新/);
const transferChanged=ctx.getCashFlowBankWorkspace('ADMIN',2026);
assert.equal(transferChanged.monthly.find(x=>x.month==='2026-04').actualOut,53000);
assert.equal(transferChanged.bankSummaries.find(x=>x.accountId===account.id).statementOut,53000);
assert.equal(transferChanged.bankSummaries.find(x=>x.accountId===account.id).transferOut,0);
const setting={fiscalYear:2026,through:'2026-04',revision:0,requestKey:'CFB-CLOSE-MONTH-0001'};
assert.throws(()=>ctx.saveCashFlowClosedThrough('ADMIN',{...setting,through:'2027-03'}),/期間内/);
const close=ctx.saveCashFlowClosedThrough('ADMIN',setting);
assert.equal(close.revision,1);
assert.equal(ctx.getCashFlowBankWorkspace('ADMIN',2026).closing.through,'2026-04');
assert.equal(ctx.saveCashFlowClosedThrough('ADMIN',setting).duplicate,true);
assert.throws(()=>ctx.saveCashFlowClosedThrough('ADMIN',{...setting,through:'2026-03',requestKey:'CFB-CLOSE-MONTH-0002'}),/変更/);
const invalidHeader=sheets.get('資金取引');
invalidHeader.rows[0][2]='BROKEN';
assert.throws(()=>ctx.getCashFlowBankWorkspace('ADMIN',2026),/ヘッダー/);
invalidHeader.rows[0][2]=spec['資金取引'][2];
assert.ok(flushes>0);
assert.ok(audits.some(x=>x.operation==='銀行明細取込'),'imports are auditable');
failedAudit=true;
const noAudit=ctx.saveCashFlowBankAccount('ADMIN',{...accBase,id:account.id,revision:1,bank:'架空信用金庫の変更',
 requestKey:'CFB-AUDIT-FALLBACK-001'});
assert.equal(noAudit.auditRecorded,false,'audit failures must be visible');
console.log('PASS: financial ADMIN ACL, 11-month fiscal year, monthly/quarterly/annual/once, bank CSV dedup, per-account totals, transfers, confirmation, revision and audit');
