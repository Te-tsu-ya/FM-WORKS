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
for(const file of ['src/Code.gs','src/Schema.gs','src/DataAccess.gs','src/Finance.gs','src/FinanceAdvisor.gs']){
  vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
}
const specs=vm.runInContext('DB_SCHEMA_SPECS',ctx),models=vm.runInContext('FINANCE_MODELS',ctx);
const rowHints=new Map();
ctx.CacheService={getScriptCache:()=>({
  get:key=>rowHints.get(key)||null,
  put:(key,value)=>rowHints.set(key,String(value)),
  remove:key=>rowHints.delete(key)
})};
class Sheet{
 constructor(headers){this.rows=[headers.slice()];this.stats={displayCells:0,displayCalls:0,headerReads:0,rawCells:0,finds:0}}
 getLastRow(){return this.rows.length}
 appendRow(values){this.rows.push(values.slice())}
 getRange(row,col,height=1,width=1){
  const sheet=this;
  const get=()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>{
   const source=sheet.rows[row+r-1]||[];return source[col+c-1]??'';
  }));
  return {
    getValues:()=>{sheet.stats.rawCells+=height*width;return get();},
   createTextFinder(value){
     return {matchEntireCell(){return this;},
       findNext(){
         sheet.stats.finds++;
         const idx=sheet.rows.findIndex((r,i)=>i>=1&&String(r[col-1]??'')===String(value));
         return idx<0?null:{getRow:()=>idx+1};
       },
       findAll(){
         sheet.stats.finds++;
         const found=[];
         for(let i=row-1;i<Math.min(row-1+height,sheet.rows.length);i++){
           if(String(sheet.rows[i]?.[col-1]??'')===String(value)){
             const at=i+1;found.push({getRow:()=>at});
           }
         }
         return found;
       }
     };
   },
    getDisplayValues:()=>{sheet.stats.displayCalls++;sheet.stats.displayCells+=height*width;if(row===1)sheet.stats.headerReads++;return get().map(r=>r.map(v=>v instanceof Date?v.toISOString().slice(0,10):String(v)))},
    setValues:values=>{for(let r=0;r<height;r++){const idx=row+r-1;
      sheet.rows[idx]=sheet.rows[idx]||[];
      for(let c=0;c<width;c++)sheet.rows[idx][col+c-1]=values[r][c];
    }}
  };
 }
}
const sheets={};
for(const kind of Object.keys(models))sheets[models[kind].sheet]=new Sheet(specs[models[kind].sheet]);
// Separate synthetic audit table: id, at, employeeId, name, operation, kind,
// targetId, before, after, source, result, note.
const auditSheet=new Sheet(Array.from({length:12},(_,i)=>'AUDIT_'+i));
sheets['監査ログ']=auditSheet;
ctx.mockDb={getSheetByName:name=>sheets[name]||null};
ctx.mockAudits=audits;
ctx.mockAuditSheet=auditSheet;
ctx.auditAvailable=true;
let invoiceApiId='',invoiceFetches=0;
const oldLedger=new Sheet(['利用日','経費種別','取引先','適格請求書番号','商品名','利用金額','備考','支払者','支払方法','支払有無']);
oldLedger.appendRow(['2026/09/12','2026年9月','架空備品店','T1234567890123','文具','¥1,200','検証','架空社員A','会社カード','済']);
oldLedger.appendRow(['2026/10/02','2026年10月','架空交通社','T1234567890123','交通費','¥3,000','','架空社員B','現金','済']);
oldLedger.appendRow(['2025/10/02','2025年10月','過去年の架空店','','備品','¥8,000','','架空社員A','現金','済']);
let legacyWrites=0;
const oldAppend=oldLedger.appendRow.bind(oldLedger);
oldLedger.appendRow=function(row){legacyWrites++;return oldAppend(row)};
ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>
 k==='NTA_INVOICE_API_ID'?invoiceApiId:k==='FM_LEGACY_EXPENSE_SPREADSHEET_ID'?'':''
})};
ctx.SpreadsheetApp={openById:id=>{
 if(id!=='1jLC5gBcNrimWz57E3GKUNjQAeTqRdYshQB6zwdAoWeI')throw Error('OTHER_SOURCE');
 return {getSheetByName:name=>name==='経費'?oldLedger:null};
}};
ctx.UrlFetchApp={fetch:url=>{invoiceFetches++;return {
 getResponseCode:()=>200,
 getContentText:()=>JSON.stringify({announcement:[{registratedNumber:'T1234567890123',
   name:'架空の照会結果',address:'架空住所',registrationDate:'2023-10-01'}]})
}}};
vm.runInContext(`getDb_=()=>mockDb;getDatabaseSpreadsheetId_=()=>"FAKE-FINANCE-DB";
  appendAudit_=item=>{if(!auditAvailable)return false;mockAudits.push(item);
    mockAuditSheet.appendRow(['AUD-'+mockAudits.length,'2026-10-10 12:00:00',
      item.employeeId||'',item.employeeName||'',item.operation||'',item.target||'',
      item.targetId||'',item.before||'',item.after||'',item.source||'',
      item.result||'',item.note||'']);return true;};`,ctx);
const api=vm.runInContext('({financeOperatorAllowed_,financeStorageStatus_,submitFinanceExpense,submitFinanceTravel,saveFinanceReceipt,getMyFinanceItems,getFinanceOverview,reviewFinanceRequest,settleFinanceRequest,resubmitFinanceRequest,financeReceiptCrossCheck_,financeNormalizeDateText_,financeOutstandingFirst_,financeMyActionFirst_,financeAmountDisplay_,assertDatabaseMigrationSafe_})',ctx);
const advisor=vm.runInContext('({financeSpendingDigest_,financeTravelExplanation_,getFinanceTravelExplanation,financeInvoiceNumber_,lookupFinanceInvoiceIssuer,getFinanceSpendingInsights})',ctx);
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
const auditFindsBeforeWrite=auditSheet.stats.finds;
const saved=api.submitFinanceExpense('STAFF',expense);
ok('first-time save never performs a slow audit lookup',auditSheet.stats.finds===auditFindsBeforeWrite);
const beforeFastRead=sheets['経費精算申請'].stats.rawCells;
ok('the finance save API explicitly confirms its audit entry',saved.auditRecorded===true);
ok('self-service creates owned pending expense',saved.ok&&sheets['経費精算申請'].rows.length===2&&
 sheets['経費精算申請'].rows[1][2]==='FM9011'&&sheets['経費精算申請'].rows[1][12]==='承認待ち');
denied('same request id with edited amount cannot silently confirm the wrong record',
 ()=>api.submitFinanceExpense('STAFF',{...expense,amount:'2700'}),/前回と異なる内容/);
const retry=api.submitFinanceExpense('STAFF',expense);
ok('retry is idempotent and verifies the actual original audit entry',
  retry.duplicate&&retry.id===saved.id&&retry.auditRecorded===true&&
  sheets['経費精算申請'].rows.length===2);
const savedAuditRow=auditSheet.rows.find(row=>row[6]===saved.id&&row[4]==='経理新規登録');
const auditOperation=savedAuditRow[4];savedAuditRow[4]='経理差戻し';
const mismatchedAudit=api.submitFinanceExpense('STAFF',expense);
ok('a wrong audit operation is never considered proof of a successful finance audit',
  mismatchedAudit.duplicate&&mismatchedAudit.auditRecorded===false);
savedAuditRow[4]=auditOperation;
ok('confirmed expense is returned from server, without resubmission secret',
  saved.record&&saved.record.id===saved.id&&saved.record.status==='承認待ち'&&
  saved.record.amount===2500&&!('requestKey' in saved.record)&&
  retry.record.id===saved.id);
const sizeBefore=sheets['経費精算申請'].rows.length;
denied('oversized vendor is rejected instead of silently truncated',
 ()=>api.submitFinanceExpense('STAFF',{...expense,vendor:'架'.repeat(121),requestKey:'test-too-long-vendor'}),/120文字以内/);
denied('oversized purpose is rejected instead of silently truncated',
 ()=>api.submitFinanceExpense('STAFF',{...expense,purpose:'説明'.repeat(251),requestKey:'test-too-long-purpose'}),/500文字以内/);
ok('invalid overlength input never writes a row',
 sheets['経費精算申請'].rows.length===sizeBefore);
denied('another user cannot reuse a submission key',()=>api.submitFinanceExpense('ACCOUNTING',expense),/重複/);
const mine=api.getMyFinanceItems('STAFF'),notMine=api.getMyFinanceItems('ACCOUNTING');
ok('users can only see own finance submissions',mine.expenses.length===1&&notMine.expenses.length===0);
denied('expense cannot settle before approval',()=>api.settleFinanceRequest('ACCOUNTING','expense',saved.id,'2026-10-09'),/承認済/);
const approval=api.reviewFinanceRequest('ACCOUNTING','expense',saved.id,'APPROVE','');
ok('authorized operator approves independently',approval.status==='承認済');
ok('status mutation uses a verified single-row lookup rather than reading the full sheet',
  sheets['経費精算申請'].stats.finds>0);
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
denied('other employee cannot resubmit a returned trip',()=>api.resubmitFinanceRequest('ACCOUNTING','travel',trip.id,
 {...travel,requestKey:'test-20261008-travel-B'}),/他の社員/);
const revised=api.resubmitFinanceRequest('STAFF','travel',trip.id,{
 ...travel,outcome:'差戻しを修正した出張報告',requestKey:'test-20261008-travel-B'
});
ok('returned travel may be resubmitted by its original owner',
 revised.ok&&revised.id===trip.id&&revised.status==='承認待ち'&&
 sheets['出張報告'].rows[1][11]==='差戻しを修正した出張報告'&&
 sheets['出張報告'].rows[1][23]==='');
denied('edited retry with same resubmission key cannot mask changed contents',
 ()=>api.resubmitFinanceRequest('STAFF','travel',trip.id,{
    ...travel,outcome:'異なる成果',requestKey:'test-20261008-travel-B'
  }),/前回と異なる内容/);
const revisionRetry=api.resubmitFinanceRequest('STAFF','travel',trip.id,{
 ...travel,outcome:'差戻しを修正した出張報告',requestKey:'test-20261008-travel-B'
});
ok('resubmission retry is idempotent and verifies the matching request audit',
  revisionRetry.duplicate&&revisionRetry.id===trip.id&&revisionRetry.auditRecorded===true);
const resubmissionAudit=auditSheet.rows.find(row=>row[6]===trip.id&&row[4]==='経理再申請');
const actualAuditNote=resubmissionAudit[11];resubmissionAudit[11]='finance-request:OTHER-NONCE';
const wrongRetryAudit=api.resubmitFinanceRequest('STAFF','travel',trip.id,{
  ...travel,outcome:'差戻しを修正した出張報告',requestKey:'test-20261008-travel-B'
});
ok('the correct record id with a wrong resubmission key cannot validate audit',
  wrongRetryAudit.duplicate&&wrongRetryAudit.auditRecorded===false);
resubmissionAudit[11]=actualAuditNote;
ok('resubmission provides confirmed updated values for immediate UI feedback',
  revised.record&&revised.record.outcome==='差戻しを修正した出張報告'&&
  !('requestKey' in revised.record));
denied('pending trip cannot be edited through resubmit endpoint',
 ()=>api.resubmitFinanceRequest('STAFF','travel',trip.id,{
  ...travel,requestKey:'test-20261008-travel-C'}),/差戻/);
ok('resubmitted travel enters approval and can settle',(()=>{
 const approved=api.reviewFinanceRequest('GENERAL','travel',trip.id,'APPROVE','');
 const completed=api.settleFinanceRequest('ACCOUNTING','travel',trip.id,'2026-10-10');
 return approved.status==='承認済'&&completed.status==='精算済';
})());
ok('receipt amount parser tolerates currency display formatting',
 api.financeAmountDisplay_('¥2,500')===2500&&api.financeAmountDisplay_('2,500円')===2500);
ok('date transport normalizes Japanese-style display dates',
 api.financeNormalizeDateText_('2026/10/8')==='2026-10-08');
const linked=api.financeReceiptCrossCheck_(
 [{id:'E-1',receiptRef:'r-123',amount:'2,500',status:'承認待ち'}],
 [{id:'R-1',receiptRef:'R-123',amount:'2500'}]
);
ok('receipt number links a single expense claim to recorded cost',linked['E-1'].status==='MATCHED');
const mismatch=api.financeReceiptCrossCheck_(
 [{id:'E-2',receiptRef:'R-123',amount:'2600',status:'承認待ち'}],
 [{id:'R-2',receiptRef:'R-123',amount:'2500'}]
);
ok('receipt-to-claim mismatch is flagged',mismatch['E-2'].status==='AMOUNT_MISMATCH');
const split=api.financeReceiptCrossCheck_(
 [{id:'E-3',receiptRef:'R-123',amount:'1000',status:'承認待ち'},
  {id:'E-4',receiptRef:'R-123',amount:'1500',status:'承認待ち'}],
 [{id:'R-3',receiptRef:'R-123',amount:'2500'}]
);
ok('multiple claims against one receipt trigger manual review even if combined amount matches',
 split['E-3'].status==='MULTIPLE_CLAIMS'&&split['E-4'].status==='MULTIPLE_CLAIMS'&&
 split['E-3'].claimAmount===2500);
const prioritized=api.financeOutstandingFirst_([
 {id:'old',status:'承認待ち',createdAt:'2025-01-01'},
 {id:'recent',status:'精算済',createdAt:'2026-10-08'}],1);
ok('pending approvals cannot be hidden by newer settled records',prioritized[0].id==='old');
const ownPrioritized=api.financeMyActionFirst_([{id:'recent',status:'承認待ち',createdAt:'2026-10-08'},
  {id:'returned',status:'差戻し',createdAt:'2025-01-01'}],1);
ok('employee returned request stays visible even if a newer request exists',ownPrioritized[0].id==='returned');
ok('schema preflight permits matching existing legacy request headers',(()=>{
 const requestHeaders=['申請ID','申請日','社員ID','氏名','申請種別','対象日開始','対象日終了',
  '申請内容','理由','ステータス','承認者','承認日時','差戻し理由','登録日時',
  '取消理由','取消申請日時','取消判断理由','取消判断者','取消判断日時'];
 const requestSheet=new Sheet(requestHeaders);
 return api.assertDatabaseMigrationSafe_({
  getSheetByName:name=>name==='申請'?requestSheet:null
 })===undefined;
})());
denied('schema preflight rejects unexpected populated columns before modifying any sheet',()=>{
 const requestSheet=new Sheet(['申請ID','申請日','社員ID','氏名','申請種別',
  '対象日開始','対象日終了','申請内容','理由','誤った列名']);
 api.assertDatabaseMigrationSafe_({getSheetByName:name=>name==='申請'?requestSheet:null});
},/既存シート/);

const owned=api.submitFinanceExpense('ACCOUNTING',{...expense,requestKey:'test-20261008-expense-B'});
denied('accountant cannot approve own request',()=>api.reviewFinanceRequest('ACCOUNTING','expense',owned.id,'APPROVE',''),/自分自身/);
const rec=api.saveFinanceReceipt('GENERAL',receipt);
ok('GA can register business receipt',rec.ok&&sheets['経費記録'].rows[1][11]==='架空総務');
ok('receipts provide server-acknowledged record, not an unconfirmed local draft',
  rec.record&&rec.record.id===rec.id&&rec.record.amount===1000&&rec.record.paid==='済');
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

/* 500+ fabricated rows: verify API payload bounded and local owner reads economical. */
const addRecord=(kind,record)=>models[kind].keys.map(key=>record[key]==null?'':record[key]);
for(let i=0;i<320;i++){
  sheets['経費精算申請'].rows.push(addRecord('expense',{
    id:'BULK-'+i,employeeId:'FM-OTHER-'+i,employeeName:'架空担当者'+i,
    createdAt:'2026-10-09 16:00:'+String(i%60).padStart(2,'0'),
    usedOn:'2026-10-09',vendor:'架空企業',item:'検証用備品',amount:'100',
    status:i<180?'承認待ち':'精算済',receiptRef:'TEST-'+i
  }));
}
sheets['経費精算申請'].rows.push(addRecord('expense',{
  id:'SPLIT-VISIBLE',employeeId:'FM-OTHER-A',employeeName:'架空社員',
  createdAt:'2026-10-10 10:00:00',usedOn:'2026-10-10',
  receiptRef:'BULK-SPLIT',amount:'1500',status:'承認待ち'
}));
sheets['経費精算申請'].rows.push(addRecord('expense',{
  id:'SPLIT-HIDDEN',employeeId:'FM-OTHER-B',employeeName:'架空社員',
  createdAt:'2026-10-01 10:00:00',usedOn:'2026-10-01',
  receiptRef:'BULK-SPLIT',amount:'1000',status:'精算済'
}));
sheets['経費記録'].rows.push(addRecord('receipt',{
  id:'BULK-RECEIPT',creatorId:members.GENERAL.employeeId,
  createdAt:'2026-10-10 11:00:00',usedOn:'2026-10-10',
  receiptRef:'BULK-SPLIT',amount:'2500'
}));
for(const sheet of Object.values(sheets)){
  sheet.stats.displayCalls=0;sheet.stats.displayCells=0;sheet.stats.headerReads=0;
}
const large=api.getFinanceOverview('ADMIN',{limit:160});
ok('overview reports processing duration separately from network latency',
 Number.isFinite(large.performance&&large.performance.serverMs)&&large.performance.serverMs>=0);
ok('large overview bounds transferred receipt matches to visible expense IDs',
  large.expenses.length===160&&Object.keys(large.receiptMatches).length===160);
ok('large overview still totals all rows instead of mistaking visible count for total',
  large.totals.expense===sheets['経費精算申請'].rows.length-1&&large.totals.expenseHidden>0);
ok('hidden split claims are included in reconciliation and trigger duplicate warning',
  large.receiptMatches['SPLIT-VISIBLE']?.status==='MULTIPLE_CLAIMS'&&
  large.receiptMatches['SPLIT-VISIBLE']?.claimAmount===2500);
ok('overview reads all 3 sheet headers once, with no second redundant header pass',
  Object.keys(models).every(kind=>sheets[models[kind].sheet].stats.headerReads===1));
for(const sheet of Object.values(sheets)){
  sheet.stats.displayCalls=0;sheet.stats.displayCells=0;sheet.stats.headerReads=0;
}
const focused=api.getMyFinanceItems('STAFF');
ok('only the logged-in employee records are returned with large shared sheets',
  focused.expenses.length===2&&focused.travels.length===1);
ok('personal history reads the owner column and only the matching records',
  sheets['経費精算申請'].stats.displayCells<1100&&
  sheets['経費精算申請'].stats.displayCalls<=4);
const beforeBulkLookup=sheets['経費精算申請'].stats.rawCells;
const byId=vm.runInContext('financeFindRow_("expense","BULK-0")',ctx);
ok('finance row index verifies the selected ID and only reads a full row once',
 byId&&byId.item.id==='BULK-0'&&byId.rowNumber>=2&&
 sheets['経費精算申請'].stats.rawCells-beforeBulkLookup<=models.expense.keys.length);


// An audit logging error must not be misrepresented as an entirely verified save.
const auditBeforeFailure=audits.length;
ctx.auditAvailable=false;
const unlogged=api.submitFinanceExpense('STAFF',{
  ...expense,requestKey:'test-20261010-audit-unavailable',vendor:'架空取引先B'
});
ok('financial record is durable but audit failure is explicitly disclosed',
 unlogged.ok===true&&unlogged.auditRecorded===false&&
 sheets['経費精算申請'].rows.some(row=>row[0]===unlogged.id)&&
 audits.length===auditBeforeFailure);
const unloggedRetry=api.submitFinanceExpense('STAFF',{
 ...expense,requestKey:'test-20261010-audit-unavailable',vendor:'架空取引先B'
});
ok('retry after lost response never hides missing finance audit',
 unloggedRetry.ok&&unloggedRetry.duplicate&&unloggedRetry.id===unlogged.id&&
 unloggedRetry.auditRecorded===false);
ok('audit retry verification never creates a second financial record',
 sheets['経費精算申請'].rows.filter(row=>row[0]===unlogged.id).length===1);
const unloggedApproval=api.reviewFinanceRequest('ACCOUNTING','expense',unlogged.id,'APPROVE','');
ok('approval explicitly reports audit failure without pretending full verification',
 unloggedApproval.ok&&unloggedApproval.auditRecorded===false&&unloggedApproval.status==='承認済');
const unloggedSettlement=api.settleFinanceRequest('GENERAL','expense',unlogged.id,'2026-10-10','2026-10-10');
ok('settlement explicitly reports audit failure for administrator review',
 unloggedSettlement.ok&&unloggedSettlement.auditRecorded===false&&unloggedSettlement.status==='精算済');
ctx.auditAvailable=true;


const ledgerReport=advisor.getFinanceSpendingInsights('ADMIN',{year:2026});
ok('legacy expense report totals all 2026 purchases without combining current expense claims',
 ledgerReport.ok&&ledgerReport.count===2&&ledgerReport.total===4200&&ledgerReport.months.length===2&&
 ledgerReport.payers.length===2&&ledgerReport.records.length===2&&legacyWrites===0);
const previousYear=advisor.getFinanceSpendingInsights('GENERAL',{year:2025});
ok('legacy report year picker isolates earlier entries',previousYear.count===1&&previousYear.total===8000);
ok('per-person monthly buckets match source rows and reconcile to annual totals',
 ledgerReport.payerMonths.length===2&&
 ledgerReport.payerMonths.find(x=>x.month==='2026-09'&&x.payer==='架空社員A')?.amount===1200&&
 ledgerReport.payerMonths.find(x=>x.month==='2026-10'&&x.payer==='架空社員B')?.amount===3000&&
 ledgerReport.payerMonths.reduce((sum,x)=>sum+x.amount,0)===ledgerReport.total);
const reservedKeyReport=advisor.financeSpendingDigest_([
 ['2026/10/05','','__proto__','','試験','¥1,200','','constructor','現金','済']
],2026);
ok('reserved prototype names in vendor and payer cannot corrupt financial aggregates',
 reservedKeyReport.total===1200&&reservedKeyReport.vendors[0].name==='__proto__'&&
 reservedKeyReport.payers[0].name==='constructor');
denied('non-finance employee cannot query other peoples purchases',
 ()=>advisor.getFinanceSpendingInsights('STAFF',{year:2026}),/権限/);
denied('invalid spending report years are rejected',()=>advisor.getFinanceSpendingInsights('ADMIN',{year:1900}),/年/);
const dayQuote=advisor.financeTravelExplanation_({startsOn:'2026-10-01',endsOn:'2026-10-01',startsAt:'08:00',
 endsAt:'17:00',oneWayKm:'120',nights:'0',lodgingArea:'なし'},'代表');
ok('policy basis: representative 120 km day trip yields No.1 5,500 yen',
 dayQuote.status==='REFERENCE'&&dayQuote.daily===5500&&dayQuote.total===5500&&dayQuote.steps[0].amount===5500);
const shortTrip=advisor.financeTravelExplanation_({startsOn:'2026-10-01',endsOn:'2026-10-01',startsAt:'06:30',
 endsAt:'19:00',oneWayKm:'70',nights:'0',lodgingArea:'なし'},'代表');
ok('under 100 km early trip shows 3,000 yen reference but requires company approval, not finalized',
 shortTrip.status==='REVIEW_REQUIRED'&&shortTrip.daily===3000&&shortTrip.total===null&&
 shortTrip.issues.some(x=>x.includes('会社承認')));
const legacyTrip=advisor.financeTravelExplanation_({startsOn:'2026-10-01',endsOn:'2026-10-01',
 startsAt:'08:30',endsAt:'16:00',distanceCategory:'30km以上',nights:'0'},'代表');
ok('historical 30km flag is never interpreted as an eligible 100km day trip',
 legacyTrip.status==='REVIEW_REQUIRED'&&legacyTrip.total===null);
const lodged=advisor.financeTravelExplanation_({startsOn:'2026-10-01',endsOn:'2026-10-02',
 startsAt:'08:00',endsAt:'18:00',nights:'1',oneWayKm:'230',lodgingArea:'指定地域',
 lodgingActual:'12000'},'代表');
ok('overnight: documented 12,000 yen receipt plus 6,500 yen day allowance, not the 20,000 ceiling',
 lodged.total===18500&&lodged.lodging===12000&&lodged.daily===6500);
const tooExpensive=advisor.financeTravelExplanation_({startsOn:'2026-10-01',endsOn:'2026-10-02',
 startsAt:'08:00',endsAt:'18:00',nights:'1',oneWayKm:'230',lodgingArea:'指定地域',
 lodgingActual:'25000'},'代表');
ok('above-lodging-ceiling amount is flagged for manual approval',
 tooExpensive.status==='REVIEW_REQUIRED'&&tooExpensive.total===null);
const roleMismatch=advisor.financeTravelExplanation_({startsOn:'2026-10-01',endsOn:'2026-10-01',
 startsAt:'08:00',endsAt:'17:00',oneWayKm:'130',nights:'0'},'不明');
ok('unknown personnel role cannot yield an invented numeric benefit',
 roleMismatch.status==='REVIEW_REQUIRED'&&roleMismatch.total===null);
denied('malformed invoice numbers rejected before third-party request',
 ()=>advisor.lookupFinanceInvoiceIssuer('ADMIN','T1234'),/13桁/);
const noKey=advisor.lookupFinanceInvoiceIssuer('ADMIN','T1234567890123');
ok('invoice lookup without official API key is not simulated as a successful identification',
 noKey.status==='UNCONFIGURED'&&invoiceFetches===0);
invoiceApiId='1234567890123';
const knownIssuer=advisor.lookupFinanceInvoiceIssuer('ADMIN','T1234567890123');
ok('configured issuer lookup returns only data actually supplied by official API response',
 knownIssuer.status==='FOUND'&&knownIssuer.name==='架空の照会結果'&&
 invoiceFetches===1&&!('apiId' in knownIssuer));
const originalFetch=ctx.UrlFetchApp.fetch,originalConsole=ctx.console,logged=[];
ctx.UrlFetchApp.fetch=()=>{throw Error('transport error: https://example.invalid/?id='+invoiceApiId)};
ctx.console={error:(...args)=>logged.push(args.join(' '))};
const failedIssuer=advisor.lookupFinanceInvoiceIssuer('ADMIN','T9876543210987');
ctx.UrlFetchApp.fetch=originalFetch;ctx.console=originalConsole;
ok('API transport errors never log the private application ID',
 failedIssuer.status==='ERROR'&&!logged.join('\n').includes(invoiceApiId));
denied('ordinary staff cannot perform privileged official issuer lookups',
 ()=>advisor.lookupFinanceInvoiceIssuer('STAFF','T1234567890123'),/権限/);
ok('advisor left all original accounting and source data unchanged',
 legacyWrites===0&&oldLedger.rows.length===4);

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
