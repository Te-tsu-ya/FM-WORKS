/* FM WORKS v0.13.0 - finance operations.
 * Source workbooks are read-only references: application data belongs to FM WORKS DB.
 * Receipt references are NOT electronic record retention or binary uploads.
 */
const FINANCE_MODELS=Object.freeze({
  receipt:{sheet:'経費記録',keys:['id','createdAt','creatorId','creatorName','usedOn','category','vendor','invoiceNo','item','amount','note','payer','paymentMethod','paid','receiptRef','updatedAt','requestKey']},
  expense:{sheet:'経費精算申請',keys:['id','createdAt','employeeId','employeeName','usedOn','vendor','item','category','amount','purpose','paymentMethod','receiptRef','status','decidedBy','decidedAt','returnReason','paidAt','receivedAt','updatedAt','requestKey']},
  travel:{sheet:'出張報告',keys:['id','createdAt','employeeId','employeeName','title','startsOn','startsAt','endsOn','endsAt','destination','purpose','outcome','distanceCategory','spentAmount','lodgingArea','nights','timeAllowance','dailyCategory','requestedAllowance','note','status','decidedBy','decidedAt','returnReason','updatedAt','paidAt','requestKey']}
});
function financeOperatorAllowed_(employee){
  if(!employee)return false;
  if(String(employee.role||'').toUpperCase()==='ADMIN')return true;
  return financeDepartmentAllowed_(employee.department);
}
function requireFinanceOperator_(token){
  const employee=requireSession_(token).employee;
  if(!financeOperatorAllowed_(employee))throw new Error('経理機能の操作権限がありません。');
  return employee;
}
function financeText_(value,label,limit,required){
  const raw=String(value==null?'':value).trim();
  const maximum=Number(limit||200);
  if(required&&!raw)throw new Error(label+'を入力してください。');
  // Do not silently truncate financial records. Reject overlong values before any write.
  if(raw.length>maximum)throw new Error(label+'は'+maximum+'文字以内で入力してください。');
  return safeSheetText_(raw,maximum);
}
function financeAmount_(value,label,required){
  const raw=String(value==null?'':value).trim();
  if(!raw){if(required)throw new Error(label+'を入力してください。');return 0;}
  if(!/^\d{1,9}$/.test(raw))throw new Error(label+'は0以上999,999,999以下の円単位で入力してください。');
  const n=Number(raw);
  if(required&&n===0)throw new Error(label+'は1円以上を入力してください。');
  return n;
}
function financeDate_(value,label,required){
  const raw=String(value||'').trim();
  if(!raw){if(required)throw new Error(label+'を入力してください。');return '';}
  return normalizeDate_(raw);
}
function financeRequestKey_(value){
  const key=String(value||'').trim();
  if(!/^[A-Za-z0-9_-]{12,100}$/.test(key))throw new Error('送信識別子が不正です。画面を開き直してください。');
  return key;
}
function financeNow_(){
  return Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd HH:mm:ss');
}
function financeStorageStatus_(){
  const db=getDb_();
  const missing=[];
  Object.keys(FINANCE_MODELS).forEach(kind=>{
    const model=FINANCE_MODELS[kind],sheet=db.getSheetByName(model.sheet);
    const expected=DB_SCHEMA_SPECS[model.sheet];
    if(!sheet||!expected){missing.push(model.sheet);return;}
    const actual=sheet.getRange(1,1,1,expected.length).getDisplayValues()[0];
    if(schemaHeaderIssues_(actual,expected).length)missing.push(model.sheet+'（見出し不一致）');
  });
  return {ready:missing.length===0,missing:missing};
}
function financeSheet_(kind){
  const model=FINANCE_MODELS[kind];
  if(!model)throw new Error('経理データの種類を確認してください。');
  const sheet=getDb_().getSheetByName(model.sheet);
  if(!sheet)throw new Error('経理シートが未初期化です。管理者はバックアップ後に「DB更新」を実施してください。');
  const expected=DB_SCHEMA_SPECS[model.sheet];
  const header=sheet.getRange(1,1,1,expected.length).getDisplayValues()[0];
  if(schemaHeaderIssues_(header,expected).length)throw new Error('経理シートの列構成が一致しません。管理者にご連絡ください。');
  return sheet;
}
function financeObject_(kind,row){
  const o={};
  FINANCE_MODELS[kind].keys.forEach((key,i)=>{o[key]=row[i]==null?'':row[i];});
  return o;
}
function financeArray_(kind,entry){
  return FINANCE_MODELS[kind].keys.map(key=>entry[key]==null?'':entry[key]);
}
function financeConfirmedRecord_(entry){
  // Send only the saved, server-validated business record to the active browser.
  // The idempotency key stays on the server-side record, not in the response.
  const record=Object.assign({},entry);
  Object.keys(record).forEach(key=>{
    if(record[key] instanceof Date){
      record[key]=Utilities.formatDate(record[key],DB.timeZone,
        /^(createdAt|updatedAt|decidedAt)$/.test(key)?'yyyy-MM-dd HH:mm:ss':'yyyy-MM-dd');
    }
  });
  delete record.requestKey;
  return record;
}
function financeNormalizeDateText_(value){
  const m=String(value||'').trim().match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  return m?m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'):String(value||'');
}
function financeTransportRow_(kind,row){
  const data=financeObject_(kind,row);
  ['usedOn','startsOn','endsOn','paidAt','receivedAt'].forEach(field=>{
    if(Object.prototype.hasOwnProperty.call(data,field))data[field]=financeNormalizeDateText_(data[field]);
  });
  return data;
}
function financeRows_(kind,employeeId,limit,verified){
  // The surrounding overview/my-items request already validates all 3 headers.
  // Do not issue three redundant header reads again in the same request.
  const model=FINANCE_MODELS[kind];
  const sheet=verified?getDb_().getSheetByName(model.sheet):financeSheet_(kind);
  if(!sheet)throw new Error('経理シートが見つかりません。再読込してください。');
  const last=sheet.getLastRow(),cols=model.keys.length;
  if(last<2)return [];
  let source=null;
  // Personal history: scan the inexpensive owner-ID column first. On a large
  // shared sheet with only a few owned records, fetch those exact rows only.
  if(employeeId&&last>100){
    const owners=sheet.getRange(2,3,last-1,1).getDisplayValues(),numbers=[];
    owners.forEach((row,i)=>{if(String(row[0])===String(employeeId))numbers.push(i+2);});
    if(numbers.length<=10){
      source=numbers.map(n=>sheet.getRange(n,1,1,cols).getDisplayValues()[0]);
    }
  }
  if(source===null)source=sheet.getRange(2,1,last-1,cols).getDisplayValues();
  const rows=source.map(row=>financeTransportRow_(kind,row))
    .filter(item=>item.id&&(!employeeId||item.employeeId===employeeId));
  rows.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  if(limit===0)return rows;
  return rows.slice(0,Math.max(1,Math.min(200,Number(limit)||80)));
}
function financeFindRow_(kind,id){
  const sheet=financeSheet_(kind),cols=FINANCE_MODELS[kind].keys.length;
  // Reuse the verified row-number hint used by authentication. A hint never
  // grants access or changes a status: the row is freshly read and ID checked.
  const found=findVerifiedSheetRow_(sheet,1,cols,String(id||''),'finance-'+kind,false);
  if(!found)throw new Error('対象の申請が見つかりません。');
  return {sheet:sheet,rowNumber:found.rowNumber,values:found.row,item:financeObject_(kind,found.row)};
}

// Retry safety: the same request key may only confirm the *same* submitted contents.
// Otherwise an earlier successful save could be incorrectly presented as a new edit.
const FINANCE_INPUT_FIELDS=Object.freeze({
  expense:['usedOn','vendor','item','category','amount','purpose','paymentMethod','receiptRef'],
  travel:['startsOn','startsAt','endsOn','endsAt','destination','purpose','outcome','distanceCategory',
    'spentAmount','lodgingArea','nights','timeAllowance','dailyCategory','requestedAllowance','note'],
  receipt:['usedOn','category','vendor','invoiceNo','item','amount','note','payer','paymentMethod','paid','receiptRef']
});
function financeSameSubmittedRecord_(kind,stored,submitted){
  const numbers=['amount','spentAmount','nights','requestedAllowance'];
  const dates=['usedOn','startsOn','endsOn'];
  return FINANCE_INPUT_FIELDS[kind].every(field=>{
    let oldValue=String(stored[field]==null?'':stored[field]).trim();
    let newValue=String(submitted[field]==null?'':submitted[field]).trim();
    if(numbers.includes(field)){
      const amount=v=>v===''?0:Number(v.replace(/[¥￥,\s円]/g,''));
      return Number.isFinite(amount(oldValue))&&amount(oldValue)===amount(newValue);
    }
    if(dates.includes(field)){
      const dateString=value=>value instanceof Date?
        Utilities.formatDate(value,DB.timeZone,'yyyy-MM-dd'):financeNormalizeDateText_(value);
      return dateString(stored[field])===dateString(submitted[field]);
    }
    if(/^'[=+\-@]/.test(oldValue))oldValue=oldValue.slice(1);
    if(/^'[=+\-@]/.test(newValue))newValue=newValue.slice(1);
    return oldValue===newValue;
  });
}

function financeAuditRequestNote_(key){
  // The same idempotency value is already stored in the financial record.
  // It is not a login credential; the audit sheet is admin-restricted.
  return 'finance-request:'+String(key||'');
}
function financeAuditConfirmedForRetry_(kind,id,operation,key){
  // Only called on an actual retry. Do not introduce another Sheets roundtrip
  // into first-time submissions or the normal finance overview.
  try {
    const sheet=getDb_().getSheetByName(DB.sheets.audit);
    const last=sheet&&sheet.getLastRow();
    if(!last||last<2)return false;
    const matches=sheet.getRange(2,7,last-1,1)
      .createTextFinder(String(id)).matchEntireCell(true).findAll();
    return matches.some(cell=>{
      const row=sheet.getRange(cell.getRow(),5,1,8).getDisplayValues()[0]||[];
      return String(row[0])===String(operation)&&
        String(row[1])===String(kind)&&String(row[2])===String(id)&&
        String(row[6])==='SUCCESS'&&
        (operation==='経理新規登録'||String(row[7])===financeAuditRequestNote_(key));
    });
  }catch(error){
    // A missing or unreadable audit cannot be declared successful.
    console.error('finance retry audit verification failed',error);
    return false;
  }
}

function financeWriteNew_(kind,record,employee){
  const key=financeRequestKey_(record.requestKey);
  return withScriptLock_(function(){
    const sheet=financeSheet_(kind),model=FINANCE_MODELS[kind];
    const keyIndex=model.keys.indexOf('requestKey');
    const last=sheet.getLastRow();
    if(last>=2){
      const keys=sheet.getRange(2,keyIndex+1,last-1,1).getDisplayValues();
      const match=keys.findIndex(x=>x[0]===key);
      if(match!==-1){
        const existing=financeObject_(kind,sheet.getRange(match+2,1,1,model.keys.length).getDisplayValues()[0]);
        if(String(existing.employeeId||existing.creatorId)!==String(employee.employeeId))throw new Error('送信識別子が重複しています。');
        if(!financeSameSubmittedRecord_(kind,existing,record))
          throw new Error('前回と異なる内容で再送されています。登録履歴を確認してから新しい申請を作成してください。');
        return {ok:true,id:existing.id,duplicate:true,record:financeConfirmedRecord_(existing),
          auditRecorded:financeAuditConfirmedForRetry_(kind,existing.id,'経理新規登録',key)};
      }
    }
    const now=financeNow_();
    record.id=createId_({receipt:'REC',expense:'EXP',travel:'TRP'}[kind]);
    record.createdAt=now;
    record.updatedAt=now;
    record.requestKey=key;
    if(kind==='receipt'){record.creatorId=employee.employeeId;record.creatorName=employee.name;}
    else {record.employeeId=employee.employeeId;record.employeeName=employee.name;record.status='承認待ち';}
    sheet.appendRow(financeArray_(kind,record));
    const auditRecorded=appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'経理新規登録',target:kind,
      targetId:record.id,before:'',after:auditJson_({kind:kind,id:record.id}),source:'WEB',result:'SUCCESS',note:financeAuditRequestNote_(key)});
    return {ok:true,id:record.id,duplicate:false,record:financeConfirmedRecord_(record),auditRecorded:auditRecorded===true};
  });
}
function financeExpensePayload_(payload){
  const p=payload||{};
  return {
    usedOn:financeDate_(p.usedOn,'使用日',true),
    vendor:financeText_(p.vendor,'取引先',120,true),
    item:financeText_(p.item,'商品・サービス名',200,true),
    category:financeText_(p.category||'その他','経費種別',60,true),
    amount:financeAmount_(p.amount,'申請額',true),
    purpose:financeText_(p.purpose,'申請理由',500,true),
    paymentMethod:financeText_(p.paymentMethod,'支払方法',60,false),
    receiptRef:financeText_(p.receiptRef,'証憑の管理番号',160,false),
    requestKey:p.requestKey
  };
}
function financeTravelPayload_(payload,employee){
  const p=payload||{},startsOn=financeDate_(p.startsOn,'出発日',true),endsOn=financeDate_(p.endsOn,'帰着日',true);
  if(endsOn<startsOn)throw new Error('帰着日は出発日以降にしてください。');
  const startsAt=normalizeTime_(p.startsAt),endsAt=normalizeTime_(p.endsAt);
  if(endsOn===startsOn&&startsAt&&endsAt&&endsAt<startsAt)throw new Error('帰着時刻は出発時刻以降にしてください。');
  const distance=String(p.distanceCategory||'未確認');
  if(!['30km以上','30km未満','未確認'].includes(distance))throw new Error('移動距離区分を確認してください。');
  const nights=financeAmount_(p.nights,'宿泊日数',false);
  if(nights>365)throw new Error('宿泊日数は365以下で入力してください。');
  return {
    title:financeText_(employee.title||'','役職',80,false),
    startsOn:startsOn,startsAt:startsAt,endsOn:endsOn,endsAt:endsAt,
    destination:financeText_(p.destination,'出張先',160,true),
    purpose:financeText_(p.purpose,'出張内容',600,true),
    outcome:financeText_(p.outcome,'出張報告・成果',1000,true),
    distanceCategory:distance,spentAmount:financeAmount_(p.spentAmount,'実際の使用金額',false),
    lodgingArea:financeText_(p.lodgingArea,'宿泊地域',90,false),
    nights:nights,timeAllowance:financeText_(p.timeAllowance,'時間帯手当',80,false),
    dailyCategory:financeText_(p.dailyCategory,'日当区分',60,false),
    requestedAllowance:financeAmount_(p.requestedAllowance,'支給希望額',false),
    note:financeText_(p.note,'備考',500,false),requestKey:p.requestKey
  };
}
function submitFinanceExpense(sessionToken,payload){
  const employee=requireSession_(sessionToken).employee;
  return financeWriteNew_('expense',financeExpensePayload_(payload),employee);
}
function submitFinanceTravel(sessionToken,payload){
  const employee=requireSession_(sessionToken).employee;
  return financeWriteNew_('travel',financeTravelPayload_(payload,employee),employee);
}
function saveFinanceReceipt(sessionToken,payload){
  const employee=requireFinanceOperator_(sessionToken),p=payload||{};
  const paid=String(p.paid||'未');
  if(!['未','済'].includes(paid))throw new Error('支払有無を確認してください。');
  return financeWriteNew_('receipt',{
    usedOn:financeDate_(p.usedOn,'利用日',true),
    category:financeText_(p.category||'その他','経費種別',60,true),
    vendor:financeText_(p.vendor,'取引先',120,true),
    invoiceNo:financeText_(p.invoiceNo,'適格請求書番号',32,false),
    item:financeText_(p.item,'商品名',200,true),
    amount:financeAmount_(p.amount,'利用金額',true),
    note:financeText_(p.note,'備考',500,false),
    payer:financeText_(p.payer,'支払者',120,true),
    paymentMethod:financeText_(p.paymentMethod,'支払方法',80,true),
    paid:paid,receiptRef:financeText_(p.receiptRef,'証憑管理番号',160,false),
    requestKey:p.requestKey
  },employee);
}
function financeMyActionFirst_(rows,max){
  // Returned requests stay accessible even after many other submissions.
  return (rows||[]).slice().sort((a,b)=>{
    const ar=a.status==='差戻し'?0:1,br=b.status==='差戻し'?0:1;
    return ar-br||String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''));
  }).slice(0,max);
}
function getMyFinanceItems(sessionToken){
  const employee=requireSession_(sessionToken).employee;
  const status=financeStorageStatus_();
  if(!status.ready)return {setupRequired:true,expenses:[],travels:[],message:'管理者によるDB初期設定が必要です。'};
  return {setupRequired:false,expenses:financeMyActionFirst_(financeRows_('expense',employee.employeeId,0,true),80),
    travels:financeMyActionFirst_(financeRows_('travel',employee.employeeId,0,true),80)};
}
function financeAmountDisplay_(value){
  const raw=String(value==null?'':value).replace(/[¥￥,\s円]/g,'').trim();
  if(!/^\d+$/.test(raw))return null;
  const n=Number(raw);
  return Number.isSafeInteger(n)?n:null;
}
function financeReceiptCrossCheck_(expenses,receipts,visibleExpenses){
  // Read-only reconciliation by the shared receipt reference. Do not auto-post expenses.
  const byReference={};
  (receipts||[]).forEach(r=>{
    const key=String(r.receiptRef||'').trim().toUpperCase();
    if(key)(byReference[key]||(byReference[key]=[])).push(r);
  });
  const claimSums={},claimCounts={};
  (expenses||[]).filter(x=>x.status!=='差戻し').forEach(x=>{
    const key=String(x.receiptRef||'').trim().toUpperCase();
    const n=financeAmountDisplay_(x.amount);
    if(key){
      claimCounts[key]=(claimCounts[key]||0)+1;
      if(n!==null)claimSums[key]=(claimSums[key]||0)+n;
    }
  });
  const matches={};
  (visibleExpenses||expenses||[]).forEach(x=>{
    const ref=String(x.receiptRef||'').trim().toUpperCase();
    const matchesRows=ref?(byReference[ref]||[]):[];
    if(!ref){matches[x.id]={status:'NO_REFERENCE',label:'証憑番号なし'};return;}
    if(!matchesRows.length){matches[x.id]={status:'NO_RECORD',label:'経費記録が未登録'};return;}
    const amounts=matchesRows.map(r=>financeAmountDisplay_(r.amount));
    const declared=claimSums[ref]||0;
    if(amounts.some(n=>n===null)){
      matches[x.id]={status:'UNVERIFIED',label:'金額形式の確認が必要'};return;
    }
    if(matchesRows.length!==1){
      matches[x.id]={status:'MULTIPLE',label:'同じ証憑番号の経費記録が複数件（要確認）',
        recordedAmount:amounts.reduce((a,b)=>a+b,0),claimAmount:declared};return;
    }
    if((claimCounts[ref]||0)>1){
      matches[x.id]={status:'MULTIPLE_CLAIMS',label:'同じ証憑番号の申請が複数件（重複精算に注意）',
        recordedAmount:amounts[0],claimAmount:declared};return;
    }
    const amount=amounts[0];
    matches[x.id]={status:amount===declared?'MATCHED':'AMOUNT_MISMATCH',
      label:amount===declared?'金額一致（番号照合）':'金額に差異あり',
      recordedAmount:amount,claimAmount:declared};
  });
  return matches;
}
function financeOutstandingFirst_(rows,max){
  const priority={承認待ち:0,承認済:1,差戻し:2,精算済:3};
  const ordered=(rows||[]).slice().sort((a,b)=>{
    const rankA=Object.prototype.hasOwnProperty.call(priority,a.status)?priority[a.status]:4;
    const rankB=Object.prototype.hasOwnProperty.call(priority,b.status)?priority[b.status]:4;
    return rankA-rankB||String(b.createdAt||'').localeCompare(String(a.createdAt||''));
  });
  return ordered.slice(0,max);
}
function getFinanceOverview(sessionToken,params){
  const startedAt=Date.now();
  requireFinanceOperator_(sessionToken);
  const status=financeStorageStatus_();
  if(!status.ready)return {setupRequired:true,expenses:[],travels:[],receipts:[],message:'DB初期設定が必要です。管理者はバックアップ後にDB更新を実施してください。'};
  const allExpenses=financeRows_('expense','',0,true);
  const allTravels=financeRows_('travel','',0,true);
  const allReceipts=financeRows_('receipt','',0,true);
  const max=Math.max(1,Math.min(1000,Number(params&&params.limit)||160));
  const expenses=financeOutstandingFirst_(allExpenses,max);
  const travels=financeOutstandingFirst_(allTravels,max);
  const receipts=allReceipts.slice(0,max);
  return {
    setupRequired:false,expenses:expenses,travels:travels,receipts:receipts,
    performance:{serverMs:Math.max(0,Date.now()-startedAt)},
    receiptMatches:financeReceiptCrossCheck_(allExpenses,allReceipts,expenses),
    totals:{
      expense:allExpenses.length,travel:allTravels.length,receipt:allReceipts.length,
      expensePending:allExpenses.filter(x=>x.status==='承認待ち').length,
      travelPending:allTravels.filter(x=>x.status==='承認待ち').length,
      expenseToSettle:allExpenses.filter(x=>x.status==='承認済').length,
      travelToSettle:allTravels.filter(x=>x.status==='承認済').length,
      expenseHidden:Math.max(0,allExpenses.length-expenses.length),
      travelHidden:Math.max(0,allTravels.length-travels.length),
      receiptHidden:Math.max(0,allReceipts.length-receipts.length)
    }
  };
}
function resubmitFinanceRequest(sessionToken,kind,id,payload){
  const employee=requireSession_(sessionToken).employee;
  if(!['expense','travel'].includes(kind))throw new Error('申請区分が不正です。');
  const values=kind==='expense'?financeExpensePayload_(payload):
    financeTravelPayload_(payload,employee);
  const key=financeRequestKey_(values.requestKey);
  return withScriptLock_(function(){
    const target=financeFindRow_(kind,id),item=target.item,model=FINANCE_MODELS[kind];
    if(String(item.employeeId)!==String(employee.employeeId))
      throw new Error('他の社員の申請は修正できません。');
    if(item.status==='承認待ち'&&item.requestKey===key){
      if(!financeSameSubmittedRecord_(kind,item,values))
        throw new Error('前回と異なる内容で再送されています。申請履歴を確認してください。');
      return {ok:true,id:item.id,status:item.status,duplicate:true,record:financeConfirmedRecord_(item),
        auditRecorded:financeAuditConfirmedForRetry_(kind,item.id,'経理再申請',key)};
    }
    if(item.status!=='差戻し')throw new Error('差戻された申請だけを修正・再申請できます。');
    if(item.requestKey===key)throw new Error('再申請には新しい送信識別子が必要です。');
    const now=financeNow_();
    const updated=Object.assign({},item,values,{
      requestKey:key,status:'承認待ち',decidedBy:'',decidedAt:'',returnReason:'',updatedAt:now
    });
    target.sheet.getRange(target.rowNumber,1,1,model.keys.length)
      .setValues([financeArray_(kind,updated)]);
    const auditRecorded=appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,
      operation:'経理再申請',target:kind,targetId:item.id,
      before:auditJson_({status:item.status,amount:item.amount||item.spentAmount,returnReason:item.returnReason}),
      after:auditJson_({status:updated.status,amount:updated.amount||updated.spentAmount}),
      source:'WEB',result:'SUCCESS',note:financeAuditRequestNote_(key)});
    return {ok:true,id:item.id,status:updated.status,duplicate:false,record:financeConfirmedRecord_(updated),auditRecorded:auditRecorded===true};
  });
}
function financeReview_(sessionToken,kind,id,decision,reason){
  const reviewer=requireFinanceOperator_(sessionToken);
  if(!['expense','travel'].includes(kind))throw new Error('申請区分が不正です。');
  if(!['APPROVE','RETURN'].includes(decision))throw new Error('判断を確認してください。');
  const comment=financeText_(reason,'差戻し理由',500,decision==='RETURN');
  return withScriptLock_(function(){
    const target=financeFindRow_(kind,id),item=target.item,model=FINANCE_MODELS[kind];
    if(String(item.employeeId)===String(reviewer.employeeId))throw new Error('自分自身の経費・出張報告は承認できません。');
    if(item.status!=='承認待ち')throw new Error('申請の状態が変更されています。再読込してください。');
    const now=financeNow_(),next=Object.assign({},item,{
      status:decision==='APPROVE'?'承認済':'差戻し',
      decidedBy:reviewer.employeeId,decidedAt:now,returnReason:comment,updatedAt:now
    });
    target.sheet.getRange(target.rowNumber,1,1,model.keys.length).setValues([financeArray_(kind,next)]);
    const auditRecorded=appendAudit_({employeeId:reviewer.employeeId,employeeName:reviewer.name,operation:decision==='APPROVE'?'経理承認':'経理差戻し',
      target:kind,targetId:item.id,before:auditJson_({status:item.status}),after:auditJson_({status:next.status,reason:comment}),
      source:'WEB',result:'SUCCESS',note:''});
    return {ok:true,id:item.id,status:next.status,auditRecorded:auditRecorded===true};
  });
}
function reviewFinanceRequest(sessionToken,kind,id,decision,reason){
  return financeReview_(sessionToken,kind,id,decision,reason);
}
function settleFinanceRequest(sessionToken,kind,id,paidOn,receivedOn){
  const reviewer=requireFinanceOperator_(sessionToken);
  if(!['expense','travel'].includes(kind))throw new Error('精算対象を確認してください。');
  const paid=financeDate_(paidOn,'出金・精算日',true);
  const received=kind==='expense'?financeDate_(receivedOn,'立替者受取日',false):'';
  if(received&&received<paid)throw new Error('立替者受取日は出金日以降にしてください。');
  return withScriptLock_(function(){
    const target=financeFindRow_(kind,id),item=target.item,model=FINANCE_MODELS[kind];
    if(item.status!=='承認済')throw new Error('承認済みの申請だけ精算済みにできます。');
    if(String(item.employeeId)===String(reviewer.employeeId))throw new Error('自分自身の申請の精算確定はできません。');
    const now=financeNow_(),next=Object.assign({},item,{status:'精算済',paidAt:paid,receivedAt:received,updatedAt:now});
    target.sheet.getRange(target.rowNumber,1,1,model.keys.length).setValues([financeArray_(kind,next)]);
    const auditRecorded=appendAudit_({employeeId:reviewer.employeeId,employeeName:reviewer.name,operation:'経理精算確認',
      target:kind,targetId:item.id,before:auditJson_({status:item.status}),after:auditJson_({status:next.status,paidAt:paid}),
      source:'WEB',result:'SUCCESS',note:''});
    return {ok:true,id:item.id,status:next.status,auditRecorded:auditRecorded===true};
  });
}
