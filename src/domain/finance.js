/* FM WORKS finance operations.
 * Business records are persisted by the Sites SQL repository.
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
  delete data.requestKey; // Read responses never expose write idempotency keys.
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
  // Reuse the common verified owner index and contiguous-row batching.
  // Reads remain fresh; only matching records cross from Sheets into GAS.
  const source=employeeId&&last>100
    ?readRowsByColumnValues_(sheet,3,cols,[employeeId])
    :sheet.getRange(2,1,last-1,cols).getDisplayValues();
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
      const match=findVerifiedSheetRow_(sheet,keyIndex+1,model.keys.length,key,'finance-'+kind+'-request',true);
      if(match){
        const existing=financeObject_(kind,match.row);
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
    financeInvalidateOverview_();
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
  if(!['30km以上','30km未満','未確認','片道100km以上','片道100km未満'].includes(distance))throw new Error('移動距離区分を確認してください。');
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
const FINANCE_OVERVIEW_CACHE_KEY='fm:finance:overview:v1';
const FINANCE_OVERVIEW_GENERATION_KEY='fm:finance:overview-generation:v1';
function financeOverviewGeneration_(){
  if(typeof cacheJsonGet_!=='function'||typeof cacheJsonPut_!=='function')return '';
  const current=cacheJsonGet_(FINANCE_OVERVIEW_GENERATION_KEY);
  if(typeof current==='string'&&current)return current;
  const generation='finance-'+Utilities.getUuid();
  cacheJsonPut_(FINANCE_OVERVIEW_GENERATION_KEY,generation,21600);
  return generation;
}
function financeInvalidateOverview_(){
  if(typeof cacheJsonPut_==='function'){
    const stored=cacheJsonPut_(FINANCE_OVERVIEW_GENERATION_KEY,'finance-'+Utilities.getUuid(),21600);
    if(stored===false&&typeof cacheRemove_==='function')cacheRemove_(FINANCE_OVERVIEW_GENERATION_KEY);
  }
  if(typeof cacheRemove_==='function')cacheRemove_(FINANCE_OVERVIEW_CACHE_KEY);
}
function financeOverviewSnapshot_(force){
  const generation=financeOverviewGeneration_();
  const cached=!force&&generation&&typeof cacheJsonGetLarge_==='function'
    ?cacheJsonGetLarge_(FINANCE_OVERVIEW_CACHE_KEY):null;
  if(cached&&cached.generation===generation&&
    ['expenses','travels','receipts'].every(key=>Array.isArray(cached[key])))return cached;
  const snapshot={generation:generation,expenses:financeRows_('expense','',0,true),
    travels:financeRows_('travel','',0,true),receipts:financeRows_('receipt','',0,true)};
  // A request started before a save must not republish its old snapshot.
  if(generation&&typeof cacheJsonPutLarge_==='function'&&
    cacheJsonGet_(FINANCE_OVERVIEW_GENERATION_KEY)===generation)
    cacheJsonPutLarge_(FINANCE_OVERVIEW_CACHE_KEY,snapshot,20);
  return snapshot;
}
function getFinanceOverview(sessionToken,params){
  const startedAt=Date.now();
  requireFinanceOperator_(sessionToken);
  const status=financeStorageStatus_();
  if(!status.ready)return {setupRequired:true,expenses:[],travels:[],receipts:[],message:'DB初期設定が必要です。管理者はバックアップ後にDB更新を実施してください。'};
  const snapshot=financeOverviewSnapshot_(!!(params&&params.forceFresh));
  const allExpenses=snapshot.expenses,allTravels=snapshot.travels,allReceipts=snapshot.receipts;
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
    // The same request key must identify exactly one request, not merely
    // a payload of the same employee. Enforce under the existing script lock.
    // The shared reader rechecks literal key equality after TextFinder.
    const keyIndex=model.keys.indexOf('requestKey');
    if(keyIndex<1)throw new Error('経理申請の送信識別子列が見つかりません。');
    const matches=readRowsByColumnValues_(target.sheet,keyIndex+1,model.keys.length,[key])
      .filter(row=>String(row[keyIndex]||'')===key);
    if(matches.length>1||matches.some(row=>String(row[0]||'')!==String(item.id)))
      throw new Error('送信識別子が他の申請に使用されています。再読み込みして新しい送信識別子で再申請してください。');
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
    financeInvalidateOverview_();
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
    financeInvalidateOverview_();
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
    financeInvalidateOverview_();
    const auditRecorded=appendAudit_({employeeId:reviewer.employeeId,employeeName:reviewer.name,operation:'経理精算確認',
      target:kind,targetId:item.id,before:auditJson_({status:item.status}),after:auditJson_({status:next.status,paidAt:paid}),
      source:'WEB',result:'SUCCESS',note:''});
    return {ok:true,id:item.id,status:next.status,auditRecorded:auditRecorded===true};
  });
}


/**
 * Read-only legacy spending analysis, transparent travel allowance estimate
 * and official National Tax Agency invoice issuer lookup.
 * Legacy source: user-shared "事務所で必要なもの" > "経費" columns A:J.
 * NEVER modifies that workbook or merges it into FM WORKS accounting totals.
 */
const FINANCE_LEGACY_SPEND_ID='1jLC5gBcNrimWz57E3GKUNjQAeTqRdYshQB6zwdAoWeI';
const FINANCE_NTA_PUBLIC_URL='https://www.invoice-kohyo.nta.go.jp/';
const FINANCE_TRAVEL_RULES=Object.freeze({
  '代表':{day:5500,overnight:6500,early:3000,late:4500,both:6000,cap:8500,lodgingCity:20000,lodgingOther:18000},
  '役員':{day:3500,overnight:4000,early:2500,late:4000,both:5500,cap:7000,lodgingCity:18000,lodgingOther:16000},
  '部長':{day:2500,overnight:3500,early:2000,late:3500,both:5000,cap:6000,lodgingCity:14000,lodgingOther:12000},
  '課長':{day:2200,overnight:3000,early:1500,late:3000,both:4500,cap:5500,lodgingCity:12000,lodgingOther:10000},
  '係長':{day:2000,overnight:2500,early:1500,late:2500,both:4000,cap:5000,lodgingCity:10000,lodgingOther:8000},
  '主任':{day:1500,overnight:2000,early:1300,late:2000,both:3300,cap:4000,lodgingCity:10000,lodgingOther:8000},
  '係':{day:1000,overnight:1500,early:1000,late:1500,both:2500,cap:3000,lodgingCity:10000,lodgingOther:8000}
});
function financeAdvisorNumber_(value){
  const text=String(value==null?'':value).trim().replace(/[¥￥円,\s]/g,'');
  if(!text||!/^-?\d+(?:\.\d+)?$/.test(text))return null;
  const n=Number(text);
  return Number.isFinite(n)?n:null;
}
function financeSpendingDigest_(rows,year){
  const totals={months:Object.create(null),payers:Object.create(null),vendors:Object.create(null),items:Object.create(null),payerMonths:Object.create(null)},records=[];
  let count=0,total=0,skipped=0;
  (rows||[]).forEach(row=>{
    const dateText=String(row[0]||'').trim();
    const m=dateText.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
    if(!m||Number(m[1])!==year)return;
    const month=Number(m[2]),day=Number(m[3]);
    // Reject impossible dates: JavaScript otherwise normalizes Feb 30 into March.
    if(month<1||month>12||day<1||
       day>new Date(Date.UTC(year,month,0)).getUTCDate())return;
    const amount=financeAdvisorNumber_(row[5]);
    if(amount===null){skipped++;return;}
    const ym=m[1]+'-'+m[2].padStart(2,'0');
    const payer=String(row[7]||'未設定').trim().slice(0,90)||'未設定';
    const vendor=String(row[2]||'未設定').trim().slice(0,100)||'未設定';
    const item=String(row[4]||'未記入').trim().slice(0,120)||'未記入';
    [[totals.months,ym],[totals.payers,payer],[totals.vendors,vendor],[totals.items,item]].forEach(([obj,key])=>{
      const entry=obj[key]||(obj[key]={name:key,amount:0,count:0});
      entry.amount+=amount;entry.count++;
    });
    const payerMonthKey=ym+'|'+payer;
    if(!totals.payerMonths[payerMonthKey])totals.payerMonths[payerMonthKey]={month:ym,payer,amount:0,count:0};
    totals.payerMonths[payerMonthKey].amount+=amount;
    totals.payerMonths[payerMonthKey].count++;
    count++;total+=amount;
    // Only a bounded preview is sent. Summary counts reflect *all* rows.
    records.push({date:m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'),
      payer,vendor,item,amount,method:String(row[8]||'').slice(0,70),
      invoiceNo:String(row[3]||'').slice(0,32),note:String(row[6]||'').slice(0,140)});
  });
  const rank=map=>Object.values(map).sort((a,b)=>b.amount-a.amount||a.name.localeCompare(b.name,'ja'));
  const topPayers=rank(totals.payers).slice(0,30),selected=new Set(topPayers.map(x=>x.name));
  const payerMonths=Object.values(totals.payerMonths)
    .filter(x=>selected.has(x.payer)).sort((a,b)=>a.month.localeCompare(b.month)||a.payer.localeCompare(b.payer,'ja'));
  return {year,count,total,skipped,months:rank(totals.months).sort((a,b)=>a.name.localeCompare(b.name)),
    payers:topPayers,payerMonths,vendors:rank(totals.vendors).slice(0,30),
    items:rank(totals.items).slice(0,30),
    records:records.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,160),truncated:count>160,
    source:'LEGACY_ONLY',sourceLabel:'旧・事務所経費台帳（読み取り専用）'};
}
function getFinanceSpendingInsights(sessionToken,params){
  requireFinanceOperator_(sessionToken);
  const year=Number((params||{}).year||new Date().getFullYear());
  if(!Number.isInteger(year)||year<2023||year>new Date().getFullYear()+1)
    throw new Error('表示する年を確認してください。');
  const props=PropertiesService.getScriptProperties();
  const spreadsheetId=String(props.getProperty('FM_LEGACY_EXPENSE_SPREADSHEET_ID')||FINANCE_LEGACY_SPEND_ID).trim();
  const key='finspend:v1:'+year+':'+spreadsheetId.slice(-12);
  let cache=null;
  // The cache is optional. A quota/service failure must never hide a valid
  // read-only legacy spending report from an authorized finance operator.
  try{
    cache=CacheService.getScriptCache();
    const hit=cache.get(key);
    if(hit){
      try{
        const parsed=JSON.parse(hit);
        // Cache data is advisory. A stale/malformed value must not look like
        // a successful financial report (JSON "null" is valid but not a report).
        if(parsed&&parsed.ok===true&&parsed.source==='LEGACY_ONLY'&&
           parsed.year===year&&typeof parsed.total==='number'&&Number.isFinite(parsed.total))
          return parsed;
      }catch(_e){/* Corrupt cache entry: read the authoritative sheet. */}
    }
  }catch(cacheError){
    console.warn('legacy expense cache unavailable; reading source directly',cacheError);
    cache=null;
  }
  try{
    const ss=SpreadsheetApp.openById(spreadsheetId),sheet=ss.getSheetByName('経費');
    if(!sheet)throw new Error('SOURCE_SHEET_MISSING');
    const header=sheet.getRange(1,1,1,10).getDisplayValues()[0];
    if(header[0]!=='利用日'||header[2]!=='取引先'||header[5]!=='利用金額'||header[7]!=='支払者')
      throw new Error('SOURCE_SCHEMA_CHANGED');
    const last=sheet.getLastRow();
    const rows=last<2?[]:sheet.getRange(2,1,last-1,10).getDisplayValues();
    const report=Object.assign({ok:true},financeSpendingDigest_(rows,year));
    const json=JSON.stringify(report);
    // CacheService limits are UTF-8 bytes, not JS character counts. A long
    // Japanese report can be <90k characters but exceed the byte quota.
    if(cache&&utf8Bytes_(json)<=90000){
      try{cache.put(key,json,120);}
      catch(cacheError){console.warn('legacy expense cache write skipped',cacheError);}
    }
    return report;
  }catch(e){
    console.error('legacy expense report unavailable',e);
    return {ok:false,year,source:'LEGACY_ONLY',message:'旧経費台帳を読み込めませんでした。元シートの閲覧権限と列名をご確認ください。'};
  }
}
function financeTravelRole_(value){
  const text=String(value||'').trim();
  if(/代表/.test(text))return '代表';
  if(/役員|取締役/.test(text))return '役員';
  for(const role of ['部長','課長','係長','主任'])if(text.includes(role))return role;
  if(text==='係'||/一般社員|従業員/.test(text))return '係';
  return '';
}
function financeTravelExplanation_(data,role){
  const p=data||{},position=financeTravelRole_(role),
    rules=FINANCE_TRAVEL_RULES[position],issues=[],steps=[];
  const nRaw=p.nights==null?'':String(p.nights).trim();
  const nights=nRaw===''?0:financeAdvisorNumber_(nRaw);
  const validNights=nights!==null&&Number.isInteger(nights)&&nights>=0&&nights<=365;
  if(!validNights)issues.push('宿泊日数は0～365の整数で入力してください。');
  if(!rules)issues.push('役職が確認できません。社内の社員情報を確認してください。');
  const kmRaw=String(p.oneWayKm==null?'':p.oneWayKm).trim(),km=kmRaw===''?null:financeAdvisorNumber_(kmRaw);
  const category=String(p.distanceCategory||'未確認');
  const far=km!==null&&km>=100||km===null&&category==='片道100km以上';
  const near=km!==null&&km>=0&&km<100||km===null&&category==='片道100km未満';
  if(km!==null&&(km<0||km>30000))issues.push('片道距離は0～30,000kmで入力してください。');
  if(km===null&&!far&&!near)issues.push('旧シートの「30km以上」は100km以上と同義ではありません。片道距離を確認してください。');
  const time=(v)=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(v||''))?String(v):null;
  const start=time(p.startsAt),end=time(p.endsAt);
  if(!start||!end)issues.push('早朝・夜間手当の判定には出発時刻と帰着時刻が必要です。');
  const early=!!start&&start<'07:00',late=!!end&&end>='20:00';
  const timeCode=early&&late?'both':early?'early':late?'late':'';
  const overnight=validNights&&nights>0;
  const dateValid=/^\d{4}-\d{2}-\d{2}$/.test(String(p.startsOn||''))&&/^\d{4}-\d{2}-\d{2}$/.test(String(p.endsOn||''));
  if(dateValid&&String(p.endsOn)<String(p.startsOn))issues.push('帰着日が出発日より前です。');
  if(dateValid&&validNights){
    const days=Math.round((Date.parse(p.endsOn+'T00:00:00Z')-Date.parse(p.startsOn+'T00:00:00Z'))/86400000);
    if(nights>days)issues.push('宿泊日数が出張期間より多くなっています。');
  }
  let daily=null,lodging=null,total=null;
  if(rules&&validNights){
    const base=overnight?rules.overnight*nights:far?rules.day:0;
    const extra=timeCode?rules[timeCode]:0;
    const cap=rules.cap*Math.max(1,nights);
    daily=Math.min(base+extra,cap);
    steps.push({label:overnight?'宿泊出張日当':'日帰り出張日当',
      equation:overnight?rules.overnight.toLocaleString('ja-JP')+'円 × '+nights+'泊':
       far?rules.day.toLocaleString('ja-JP')+'円（片道100km以上）':
       near?'0円（片道100km未満・日帰り）':'0円（距離が未確認）',amount:base});
    steps.push({label:'早朝・夜間の手当',equation:timeCode?
      (early&&late?'午前7時前と午後8時以降':early?'午前7時前の出発':'午後8時以降の帰着'):
      '該当なし',amount:extra});
    steps.push({label:'日当の上限適用',equation:'min('+(base+extra).toLocaleString('ja-JP')+'円, '+rules.cap.toLocaleString('ja-JP')+
      '円 × '+Math.max(1,nights)+'日〈参考〉)',amount:daily});
    if(overnight&&timeCode)issues.push('宿泊日数がある場合、早朝・夜間手当の適用日と日ごとの上限を承認者が確認してください。');
    if(!overnight&&!far&&!near)issues.push('片道100kmを確認するまで日帰り日当は確定できません。');
    if(!overnight&&near&&timeCode)issues.push('片道100km未満の早朝・夜間出張は業務理由、移動経路、会社承認の確認が必要です。');
    if(!overnight&&near&&!timeCode)issues.push('100km未満かつ早朝・夜間なしの場合、通常の出張日当対象外です。');
    if(overnight){
      const raw=String(p.lodgingActual==null?'':p.lodgingActual).trim();
      const cost=raw===''?null:financeAdvisorNumber_(raw);
      const area=String(p.lodgingArea||'').trim();
      const maxPerNight=area==='指定地域'?rules.lodgingCity:area==='指定地域外'?rules.lodgingOther:null;
      if(cost===null||cost<0||!Number.isInteger(cost))issues.push('宿泊費は領収書に記載された実費（円）を入力してください。');
      else lodging=cost;
      if(maxPerNight===null)issues.push('宿泊地域（指定地域／指定地域外）が未確定です。');
      if(maxPerNight!==null&&lodging!==null&&lodging>maxPerNight*nights)
        issues.push('宿泊費が規程の上限を超えています。会社の事前承認を確認してください。');
      steps.push({label:'宿泊実費',equation:lodging===null?'領収書未入力':
        lodging.toLocaleString('ja-JP')+'円（上限'+
        (maxPerNight===null?'地域未判定':(maxPerNight*nights).toLocaleString('ja-JP')+'円')+'）',
        amount:lodging});
    }else lodging=0;
    if(lodging!==null&&issues.length===0)total=daily+lodging;
  }
  return {policy:'Fusion Mind旅費規程 2025-12-01',role:position||'未確認',
    status:issues.length?'REVIEW_REQUIRED':'REFERENCE',issues,steps,daily,lodging,total,
    note:total===null?'':('[旅費試算2025-12-01/参考] '+position+
      '・片道'+(km===null?(far?'100km以上':near?'100km未満':'未確認'):km+'km')+
      '：'+steps.map(step=>step.label+' '+step.equation+' ='+step.amount+'円').join('；')+
      '。日当'+daily+'円＋宿泊実費'+lodging+'円＝参考合計'+total+'円。承認時は規程と領収書を照合。')};
}
function getFinanceTravelExplanation(sessionToken,params){
  const employee=requireSession_(sessionToken).employee;
  const data=params||{};
  // Admin/accounting may inspect a different role; employees cannot self-elevate it.
  const role=financeOperatorAllowed_(employee)&&data.roleOverride?
    String(data.roleOverride):String(employee.title||'');
  return financeTravelExplanation_(data,role);
}
function financeInvoiceNumber_(number){
  const clean=String(number||'').replace(/[\s　-]/g,'').toUpperCase();
  if(!/^T\d{13}$/.test(clean))throw new Error('適格請求書番号はT＋13桁で入力してください。');
  return clean;
}
function lookupFinanceInvoiceIssuer(sessionToken,number){
  requireFinanceOperator_(sessionToken);
  const normalized=financeInvoiceNumber_(number);
  const props=PropertiesService.getScriptProperties();
  const appId=String(props.getProperty('NTA_INVOICE_API_ID')||'').trim();
  if(!appId)return {status:'UNCONFIGURED',number:normalized,
    message:'国税庁Web-APIのアプリケーションIDが未設定です。発行申請後にスクリプトプロパティへ設定してください。',
    source:FINANCE_NTA_PUBLIC_URL};
  if(!/^\d{13}$/.test(appId))return {status:'UNCONFIGURED',number:normalized,
    message:'国税庁Web-APIの設定値が不正です。管理者に確認してください。',source:FINANCE_NTA_PUBLIC_URL};
  const cache=CacheService.getScriptCache(),key='fin-invoice-v1:'+normalized;
  const cached=cache.get(key);
  if(cached){try{return JSON.parse(cached);}catch(_e){}}
  const endpoint='https://web-api.invoice-kohyo.nta.go.jp/1/num?id='+encodeURIComponent(appId)+
    '&number='+normalized+'&type=21&history=0';
  try{
    const response=UrlFetchApp.fetch(endpoint,{method:'get',muteHttpExceptions:true,followRedirects:false});
    if(response.getResponseCode()!==200)throw new Error('NTA_HTTP_ERROR');
    const body=JSON.parse(response.getContentText('UTF-8'));
    const announcements=Array.isArray(body.announcement)?body.announcement:[];
    const record=announcements.find(x=>String(x.registratedNumber||'')===normalized);
    const result=record?{status:'FOUND',number:normalized,
      name:String(record.name||record.tradeName||record.popularName_previousName||''),address:String(record.address||record.addressRequest||''),
      registeredOn:String(record.registrationDate||''),cancelledOn:String(record.disposalDate||''),
      expiredOn:String(record.expireDate||''),checkedOn:Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd'),
      source:FINANCE_NTA_PUBLIC_URL,
      disclaimer:'国税庁公表情報をもとに取得した結果です。取引日の登録状況や請求書の内容は別途確認してください。'}:
      {status:'NOT_FOUND',number:normalized,source:FINANCE_NTA_PUBLIC_URL,
       message:'登録番号に対応する公表情報は見つかりませんでした。'};
    cache.put(key,JSON.stringify(result),21600);
    return result;
  }catch(e){
    // Network errors may contain the request URL, including the private application ID.
    // Never log the exception text or the full URL.
    console.error('NTA invoice lookup failed (transport or response validation)');
    return {status:'ERROR',number:normalized,source:FINANCE_NTA_PUBLIC_URL,
      message:'国税庁の情報取得に失敗しました。公式サイトから確認してください。'};
  }
}


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
