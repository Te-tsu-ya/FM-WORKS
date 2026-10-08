import fs from 'node:fs';
import vm from 'node:vm';
// In-memory test data only: never accesses a live GAS project or spreadsheet.
let passed=0,failed=0;
const ok=(label,yes)=>{if(yes){passed++;console.log('PASS '+label)}else{failed++;console.error('FAIL '+label)}};
const denied=(label,fn,pattern)=>{let msg='';try{fn()}catch(e){msg=String(e.message||e)}ok(label,!!msg&&(!pattern||pattern.test(msg)))};
const members={
 STAFF:{employeeId:'FM9011',name:'架空社員A',department:'開発部',role:'USER'},
 MANAGER:{employeeId:'FM9020',name:'架空上長',department:'営業部',role:'MANAGER'},
 ACCOUNTING:{employeeId:'FM9033',name:'架空経理',department:'経理部',role:'USER'},
 GENERAL:{employeeId:'FM9044',name:'架空総務',department:'総務部',role:'USER'},
 ADMIN:{employeeId:'FM9001',name:'架空管理者',department:'開発部',role:'ADMIN'}
};
let seq=0;
const audits=[];
const ctx=vm.createContext({
  console,Date,Math,Number,String,Object,Array,Set,Map,JSON,RegExp,Error,
  Utilities:{getUuid:()=>String(++seq),
    formatDate:(_date,_zone,format)=>format==='yyyy-MM-dd HH:mm:ss'?'2026-10-08 12:00:00':'2026-10-08'},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  requireSession_:token=>{if(!members[token])throw Error('AUTH_REQUIRED');return {employee:members[token]}}
});
for(const file of ['src/Code.gs','src/Schema.gs','src/Finance.gs']){
  vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
}
const specs=vm.runInContext('DB_SCHEMA_SPECS',ctx),models=vm.runInContext('FINANCE_MODELS',ctx);
class Sheet{
 constructor(headers){this.rows=[headers.slice()]}
 getLastRow(){return this.rows.length}
 appendRow(values){this.rows.push(values.slice())}
 getRange(row,col,height=1,width=1){
  const sheet=this;
  const get=()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>{
   const source=sheet.rows[row+r-1]||[];return source[col+c-1]??'';
  }));
  return {
    getValues:get,
    getDisplayValues:()=>get().map(r=>r.map(v=>v instanceof Date?v.toISOString().slice(0,10):String(v))),
    setValues:values=>{for(let r=0;r<height;r++){const idx=row+r-1;
      sheet.rows[idx]=sheet.rows[idx]||[];
      for(let c=0;c<width;c++)sheet.rows[idx][col+c-1]=values[r][c];
    }}
  };
 }
}
const sheets={};
for(const kind of Object.keys(models))sheets[models[kind].sheet]=new Sheet(specs[models[kind].sheet]);
ctx.mockDb={getSheetByName:name=>sheets[name]||null};
ctx.mockAudits=audits;
vm.runInContext('getDb_=()=>mockDb;appendAudit_=item=>mockAudits.push(item);',ctx);
const api=vm.runInContext('({financeOperatorAllowed_,financeStorageStatus_,submitFinanceExpense,submitFinanceTravel,saveFinanceReceipt,getMyFinanceItems,getFinanceOverview,reviewFinanceRequest,settleFinanceRequest})',ctx);
const expense={
 usedOn:'2026-10-08',vendor:'架空の販売店',item:'事務用品',category:'消耗品費',
 amount:'2500',purpose:'架空業務用品の購入',paymentMethod:'立替',
 requestKey:'test-20261008-expense-A'
};
const travel={
 startsOn:'2026-10-08',endsOn:'2026-10-09',startsAt:'09:00',endsAt:'17:00',
 destination:'架空の出張先',purpose:'取引先と打ち合わせ',outcome:'打ち合わせ結果の報告',
 distanceCategory:'30km以上',spentAmount:'12300',lodgingArea:'新潟県',nights:'1',
 dailyCategory:'確認中',requestedAllowance:'0',requestKey:'test-20261008-travel-A'
};
const receipt={
 usedOn:'2026-10-08',category:'消耗品費',vendor:'架空の販売店',item:'コピー用紙',amount:'1000',
 payer:'架空総務',paymentMethod:'会社カード',paid:'済',invoiceNo:'T1234567890123',
 requestKey:'test-20261008-receipt-A'
};
ok('schema is initially ready',api.financeStorageStatus_().ready);
ok('admin accounting GA are authorized',api.financeOperatorAllowed_(members.ADMIN)&&
 api.financeOperatorAllowed_(members.ACCOUNTING)&&api.financeOperatorAllowed_(members.GENERAL));
ok('ordinary manager and misleading department denied',
 !api.financeOperatorAllowed_(members.MANAGER)&&
 !api.financeOperatorAllowed_({role:'USER',department:'非経理'}));
denied('invalid session denied',()=>api.getMyFinanceItems('INVALID'),/AUTH_REQUIRED/);
denied('staff cannot see all records',()=>api.getFinanceOverview('STAFF'),/権限/);
denied('manager cannot see all records',()=>api.getFinanceOverview('MANAGER'),/権限/);
denied('staff cannot enter receipt',()=>api.saveFinanceReceipt('STAFF',receipt),/権限/);
denied('manager cannot approve',()=>api.reviewFinanceRequest('MANAGER','expense','x','APPROVE',''),/権限/);
const saved=api.submitFinanceExpense('STAFF',expense);
ok('self-service creates owned pending expense',saved.ok&&sheets['経費精算申請'].rows.length===2&&
 sheets['経費精算申請'].rows[1][2]==='FM9011'&&sheets['経費精算申請'].rows[1][12]==='承認待ち');
const retry=api.submitFinanceExpense('STAFF',expense);
ok('retry is idempotent',retry.duplicate&&retry.id===saved.id&&sheets['経費精算申請'].rows.length===2);
denied('another user cannot reuse a submission key',()=>api.submitFinanceExpense('ACCOUNTING',expense),/重複/);
const mine=api.getMyFinanceItems('STAFF'),notMine=api.getMyFinanceItems('ACCOUNTING');
ok('users can only see own finance submissions',mine.expenses.length===1&&notMine.expenses.length===0);
denied('expense cannot settle before approval',()=>api.settleFinanceRequest('ACCOUNTING','expense',saved.id,'2026-10-09'),/承認済/);
const approval=api.reviewFinanceRequest('ACCOUNTING','expense',saved.id,'APPROVE','');
ok('authorized operator approves independently',approval.status==='承認済');
denied('duplicate approval rejected',()=>api.reviewFinanceRequest('GENERAL','expense',saved.id,'APPROVE',''),/変更/);
denied('receipt date cannot precede payment',()=>api.settleFinanceRequest('ACCOUNTING','expense',saved.id,'2026-10-09','2026-10-08'),/以降/);
const settled=api.settleFinanceRequest('ACCOUNTING','expense',saved.id,'2026-10-09','2026-10-10');
ok('approved claim enters settled state',settled.status==='精算済'&&
 sheets['経費精算申請'].rows[1][16]==='2026-10-09'&&
 sheets['経費精算申請'].rows[1][17]==='2026-10-10');
denied('second settlement blocked',()=>api.settleFinanceRequest('GENERAL','expense',saved.id,'2026-10-09'),/承認済/);
const trip=api.submitFinanceTravel('STAFF',travel);
ok('employee travel report captures outcome and lodging',trip.ok&&
 sheets['出張報告'].rows[1][9]===travel.destination&&sheets['出張報告'].rows[1][15]===1);
denied('return requires a stated reason',()=>api.reviewFinanceRequest('ACCOUNTING','travel',trip.id,'RETURN',''),/差戻し理由/);
const returned=api.reviewFinanceRequest('ACCOUNTING','travel',trip.id,'RETURN','理由を確認してください');
ok('travel report can be returned to employee',returned.status==='差戻し'&&
 sheets['出張報告'].rows[1][23]==='理由を確認してください');
denied('returned trip cannot be settled',()=>api.settleFinanceRequest('GENERAL','travel',trip.id,'2026-10-10'),/承認済/);
const owned=api.submitFinanceExpense('ACCOUNTING',{...expense,requestKey:'test-20261008-expense-B'});
denied('accountant cannot approve own request',()=>api.reviewFinanceRequest('ACCOUNTING','expense',owned.id,'APPROVE',''),/自分自身/);
const rec=api.saveFinanceReceipt('GENERAL',receipt);
ok('GA can register business receipt',rec.ok&&sheets['経費記録'].rows[1][11]==='架空総務');
const summary=api.getFinanceOverview('ADMIN');
ok('authorized user sees all 3 record families',summary.expenses.length===2&&
 summary.travels.length===1&&summary.receipts.length===1);
ok('Sheet record display uses serializable primitive values',summary.expenses.every(x=>
 typeof x.usedOn==='string'&&typeof x.amount==='string'));
denied('decimal expense amounts rejected',()=>api.submitFinanceExpense('STAFF',{
 ...expense,amount:'23.5',requestKey:'test-20261008-expense-X'}),/円単位/);
denied('travel arriving before departure rejected',()=>api.submitFinanceTravel('STAFF',{
 ...travel,endsOn:'2026-10-07',requestKey:'test-20261008-travel-Z'}),/帰着日/);
const formula=api.submitFinanceExpense('STAFF',{
 ...expense,vendor:'=HYPERLINK("x")',requestKey:'test-20261008-expense-C'});
ok('formula-looking input is escaped in a Sheet',String(sheets['経費精算申請'].rows.find(x=>x[0]===formula.id)[5]).startsWith("'="));
sheets['経費記録'].rows[0][0]='不正な列見出し';
ok('schema mismatch is detected',!api.financeStorageStatus_().ready);
denied('misconfigured Sheet rejects writes',()=>api.saveFinanceReceipt('GENERAL',{
 ...receipt,requestKey:'test-20261008-receipt-B'}),/列構成/);
delete sheets['経費記録'];
ok('missing Sheet yields setup notice without auto-creating it',
 api.getFinanceOverview('ADMIN').setupRequired===true);
ok('audited creation, approval, return, settlement',audits.some(x=>x.operation==='経理新規登録')&&
 audits.some(x=>x.operation==='経理承認')&&audits.some(x=>x.operation==='経理差戻し')&&
 audits.some(x=>x.operation==='経理精算確認'));
if(failed){console.error('Finance integration FAILED '+failed+' / '+(passed+failed));process.exitCode=1;}
else console.log('All '+passed+' finance integration tests passed on in-memory Sheets.');
