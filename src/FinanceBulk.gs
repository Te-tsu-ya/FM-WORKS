/* FM WORKS - accounting ledger multi-row import.
 * FinanceBulk is deliberately separate from cash-flow bank transactions.
 * No financial record is changed until validation and a permitted explicit save.
 */
const FINANCE_BULK_LIMIT=20;

function financeBulkReceiptNormalize_(source) {
  const p=source||{},paid=String(p.paid||'未').trim();
  if(!['未','済'].includes(paid))throw new Error('支払有無は「未」または「済」を選択してください。');
  return {
    usedOn:financeDate_(p.usedOn,'利用日',true),
    category:financeText_(p.category||'未分類','経費種別',60,true),
    vendor:financeText_(p.vendor,'取引先',120,true),
    invoiceNo:financeText_(p.invoiceNo,'適格請求書番号',32,false),
    item:financeText_(p.item,'品目',200,true),
    amount:financeAmount_(p.amount,'金額',true),
    note:financeText_(p.note,'備考',500,false),
    payer:financeText_(p.payer,'支払者',120,true),
    paymentMethod:financeText_(p.paymentMethod,'支払方法',80,true),
    paid:paid,
    receiptRef:financeText_(p.receiptRef,'証憑整理番号',160,false),
    requestKey:financeRequestKey_(p.requestKey)
  };
}

/* Each row gets its own persistent requestKey. A lost RPC response can be
 * retried with the exact same keys; partially committed rows will be detected.
 * Entire incoming chunk is validated BEFORE any database write.
 */
function saveFinanceReceiptsBulk(sessionToken,payload) {
  const employee=requireFinanceOperator_(sessionToken);
  const submitted=payload&&payload.rows;
  if(!Array.isArray(submitted)||submitted.length<1||submitted.length>FINANCE_BULK_LIMIT)
    throw new Error('一度に登録できる経費記録は1～'+FINANCE_BULK_LIMIT+'件です。');
  const rows=submitted.map((value,index)=>{
    try {
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('入力形式が不正です。');
      return financeBulkReceiptNormalize_(value);
    } catch(error) {
      throw new Error((index+1)+'行目：'+String(error&&error.message||error));
    }
  });
  const unique=new Set(rows.map(row=>row.requestKey));
  if(unique.size!==rows.length)throw new Error('同じ送信識別子が複数行にあります。登録を中止しました。');

  return withScriptLock_(function(){
    const model=FINANCE_MODELS.receipt,sheet=financeSheet_('receipt');
    const last=sheet.getLastRow(),keyCol=model.keys.indexOf('requestKey')+1;
    const existing=new Map();
    if(last>=2){
      const matches=readRowsByColumnValues_(sheet,keyCol,model.keys.length,rows.map(row=>row.requestKey),false,true);
      matches.forEach(match=>{
        const key=String(match.values[keyCol-1]||'');
        if(key&&!existing.has(key))existing.set(key,match);
      });
    }
    const now=financeNow_(),pending=[],results=[];
    for(const submittedRow of rows){
      const row=Object.assign({},submittedRow),previous=existing.get(row.requestKey);
      if(previous){
        const old=financeObject_('receipt',previous.values);
        if(String(old.creatorId)!==String(employee.employeeId)||
           !financeSameSubmittedRecord_('receipt',old,row))
          throw new Error('以前の登録内容と異なる行があります。重複登録を防ぐため、履歴を確認してください。');
        results.push({id:String(old.id),duplicate:true,auditRecorded:false});
      } else {
        row.id=createId_('REC');
        row.createdAt=now;row.updatedAt=now;
        row.creatorId=employee.employeeId;row.creatorName=employee.name;
        pending.push(row);
        results.push({id:String(row.id),duplicate:false,auditRecorded:false});
      }
    }
    // Commit the whole new portion in one Sheets range call. Retry keys also
    // defend the case where Sheets succeeded but the browser saw a timeout.
    if(pending.length){
      sheet.getRange(last+1,1,pending.length,model.keys.length)
        .setValues(pending.map(row=>financeArray_('receipt',row)));
      financeInvalidateOverview_();
    }
    let newIndex=0;
    for(let i=0;i<rows.length;i++){
      if(results[i].duplicate){
        results[i].auditRecorded=financeAuditConfirmedForRetry_('receipt',results[i].id,'経理新規登録',rows[i].requestKey);
        continue;
      }
      const row=pending[newIndex++];
      try{
        results[i].auditRecorded=appendAudit_({
          employeeId:employee.employeeId,employeeName:employee.name,operation:'経理新規登録',
          target:'receipt',targetId:row.id,before:'',
          after:auditJson_({kind:'receipt',id:row.id}),source:'WEB',result:'SUCCESS',
          note:financeAuditRequestNote_(row.requestKey)
        })===true;
      }catch(_){
        // The receipt was already committed. Never reinsert it just because
        // an audit append failed; surface the uncertainty to the operator.
        results[i].auditRecorded=false;
      }
    }
    return {ok:true,results:results,added:pending.length,
      duplicateCount:results.filter(row=>row.duplicate).length,
      auditRecorded:results.every(row=>row.auditRecorded)};
  });
}
