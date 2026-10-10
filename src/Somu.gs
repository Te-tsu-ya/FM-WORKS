/* FM WORKS general affairs workspace. Data is stored only in FM WORKS DB.
 * Purchase requests are NOT accounting, payment, or invoice entries.
 * Document entries are metadata/HTTPS links; no files are uploaded.
 */
const SOMU_MODELS=Object.freeze({
  asset:{sheet:'総務備品',keys:['id','code','name','category','maker','model','location','quantity','minimum','status','note','createdAt','updatedAt','updatedBy','revision']},
  loan:{sheet:'総務貸出',keys:['id','assetId','assetCode','borrower','quantity','loanDate','dueDate','returnedAt','status','purpose','creatorId','createdAt','updatedAt','requestKey']},
  purchase:{sheet:'総務購買',keys:['id','name','quantity','estimatedPrice','neededOn','reason','requesterId','requesterName','status','assetId','orderedOn','receivedOn','note','createdAt','updatedAt','requestKey','approvedBy','approvedAt']},
  document:{sheet:'総務書類',keys:['id','name','category','location','url','expiresOn','note','status','creatorId','createdAt','updatedAt','requestKey']},
  contract:{sheet:'総務契約',keys:['id','name','category','vendor','contractNo','startedOn','expiresOn','noticeOn','renewal','annualYen','owner','url','status','note','createdAt','updatedAt','createdBy','updatedBy','revision','requestKey']},
  facility:{sheet:'総務施設設備',keys:['id','code','name','type','location','owner','vendor','lastCheckedOn','nextCheckOn','status','note','createdAt','updatedAt','createdBy','updatedBy','revision','requestKey']},
  ticket:{sheet:'総務依頼',keys:['id','subject','category','priority','requesterName','assignee','dueOn','description','status','resolvedOn','note','createdAt','updatedAt','createdBy','updatedBy','revision','requestKey']}
});
function somuOperator_(token){
  const employee=requireSession_(token).employee;
  assertPermission_(employee,'officeWorkspace');
  return employee;
}
function somuNow_(){return Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd HH:mm:ss');}
function somuToday_(){return Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');}
function somuText_(value,label,max,required){
  const s=safeSheetText_(value,max||200);
  if(required&&!s)throw new Error(label+'を入力してください。');
  return s;
}
function somuCount_(value,label,min,max){
  const text=String(value==null?'':value).trim();
  if(!/^\d{1,7}$/.test(text))throw new Error(label+'は整数で入力してください。');
  const n=Number(text);
  if(n<min||n>max)throw new Error(label+'は'+min+'から'+max+'の範囲で入力してください。');
  return n;
}
function somuDate_(value,label,required){
  const raw=String(value||'').trim();
  if(!raw){if(required)throw new Error(label+'を入力してください。');return '';}
  return normalizeDate_(raw);
}
function somuRequestKey_(value){
  const s=String(value||'').trim();
  if(!/^[a-zA-Z0-9_-]{12,120}$/.test(s))throw new Error('送信識別子を確認できません。フォームを開き直してください。');
  return s;
}
function somuModel_(kind){
  const model=SOMU_MODELS[kind];
  if(!model)throw new Error('総務機能の種類を確認してください。');
  return model;
}
// ScriptCache is an optional, short-lived display accelerator only.
 // Every API still rechecks the real session and office permission.
 // Stock, approval and return mutations always read Sheets under ScriptLock.
const SOMU_VIEW_CACHE_TTL_SECONDS=20;
function somuSnapshotCacheKey_(){
  return 'fm:somu:workspace:v3:'+getDatabaseSpreadsheetId_();
}
function somuInvalidateSnapshot_(){
  if(typeof cacheRemove_==='function')cacheRemove_(somuSnapshotCacheKey_());
  if(typeof somuGrowthInvalidateCache_==='function')somuGrowthInvalidateCache_();
}
function somuGetCachedSnapshot_(){
  if(typeof cacheJsonGet_!=='function')return null;
  const result=cacheJsonGet_(somuSnapshotCacheKey_());
  return result&&result.setupRequired===false&&Array.isArray(result.assets)&&
    Array.isArray(result.loans)&&Array.isArray(result.purchases)&&Array.isArray(result.documents)
    ?result:null;
}
function somuPutCachedSnapshot_(snapshot){
  if(typeof cacheJsonPut_!=='function')return false;
  // CacheService has a 100 KB/item limit. Do not mistake JS UTF-16 length for UTF-8 bytes.
  const raw=JSON.stringify(snapshot);
  const bytes=typeof Utilities.newBlob==='function'
    ?Utilities.newBlob(raw).getBytes().length:raw.length*3;
  if(bytes>85000)return false;
  return cacheJsonPut_(somuSnapshotCacheKey_(),snapshot,SOMU_VIEW_CACHE_TTL_SECONDS);
}
function somuStorageStatus_(){
  const db=getDb_(),missing=[];
  ['asset','loan','purchase','document'].forEach(kind=>{
    const m=SOMU_MODELS[kind],expected=DB_SCHEMA_SPECS[m.sheet],sheet=db.getSheetByName(m.sheet);
    if(!expected||!sheet){missing.push(m.sheet);return;}
    if(schemaHeaderIssues_(sheet.getRange(1,1,1,expected.length).getDisplayValues()[0],expected).length)
      missing.push(m.sheet+'（列構成が一致しません）');
  });
  return {ready:!missing.length,missing:missing};
}
function somuSheet_(kind){
  const m=somuModel_(kind),sheet=getDb_().getSheetByName(m.sheet);
  if(!sheet)throw new Error('総務DBの準備が必要です。管理者がバックアップ後にDB更新を実行してください。');
  const expected=DB_SCHEMA_SPECS[m.sheet];
  if(!expected||schemaHeaderIssues_(sheet.getRange(1,1,1,expected.length).getDisplayValues()[0],expected).length)
    throw new Error('総務DBの列構成が一致しません。管理者にご連絡ください。');
  return sheet;
}
function somuRecord_(kind,row){
  const o={};somuModel_(kind).keys.forEach((key,i)=>{o[key]=row[i]==null?'':row[i];});
  // Japanese Sheets may display date cells with slashes; keep ISO for filters and deadlines.
  ['loanDate','dueDate','returnedAt','neededOn','orderedOn','receivedOn','expiresOn','startedOn','noticeOn','lastCheckedOn','nextCheckOn','resolvedOn'].forEach(key=>{
    if(!Object.prototype.hasOwnProperty.call(o,key))return;
    const raw=String(o[key]||'').trim();
    const match=raw.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
    if(match)o[key]=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
  });
  return o;
}
function somuArray_(kind,item){
  return somuModel_(kind).keys.map(k=>item[k]==null?'':item[k]);
}
function somuPublic_(kind,item){
  const copy=Object.assign({},item);
  delete copy.requestKey;
  return copy;
}
function somuRows_(kind,limit,preverifiedSheet){
  // A previously header-verified sheet skips a second remote header read.
  const m=somuModel_(kind),sheet=preverifiedSheet||somuSheet_(kind),last=sheet.getLastRow();
  if(last<2)return {items:[],total:0,truncated:false};
  const count=Math.max(0,last-1),max=Math.max(1,Math.min(2500,Number(limit)||1500));
  // Keep the newest entries, but do not quietly represent a partial result as complete.
  const start=Math.max(2,last-max+1);
  const items=sheet.getRange(start,1,last-start+1,m.keys.length).getDisplayValues()
    .map(row=>somuPublic_(kind,somuRecord_(kind,row))).filter(r=>r.id);
  return {items:items,total:count,truncated:count>max};
}
function somuFind_(kind,id){
  const m=somuModel_(kind),sheet=somuSheet_(kind),last=sheet.getLastRow();
  if(last<2)throw new Error('対象の記録が見つかりません。');
  const ids=sheet.getRange(2,1,last-1,1).getDisplayValues();
  const idx=ids.findIndex(row=>String(row[0])===String(id));
  if(idx<0)throw new Error('対象の記録が見つかりません。再読込してください。');
  const rowNumber=idx+2;
  return {sheet:sheet,rowNumber:rowNumber,item:somuRecord_(kind,
    sheet.getRange(rowNumber,1,1,m.keys.length).getDisplayValues()[0])};
}
function somuWrite_(kind,target,item){
  target.sheet.getRange(target.rowNumber,1,1,somuModel_(kind).keys.length).setValues([somuArray_(kind,item)]);
  somuInvalidateSnapshot_();
}
function somuNew_(kind,item){
  somuSheet_(kind).appendRow(somuArray_(kind,item));
  somuInvalidateSnapshot_();
}
function somuByRequestKey_(kind,key){
  const m=somuModel_(kind),idx=m.keys.indexOf('requestKey');
  if(idx<0)return null;
  const sheet=somuSheet_(kind),last=sheet.getLastRow();
  if(last<2)return null;
  const keys=sheet.getRange(2,idx+1,last-1,1).getDisplayValues();
  const row=keys.findIndex(entry=>String(entry[0])===key);
  return row<0?null:somuRecord_(kind,sheet.getRange(row+2,1,1,m.keys.length).getDisplayValues()[0]);
}
function somuOpenLoans_(assetId){
  const loans=somuRows_('loan',2500);
  if(loans.truncated)throw new Error('貸出台帳が上限を超えています。管理者に確認してください。');
  return loans.items.filter(x=>x.assetId===assetId&&x.status==='貸出中');
}
function somuAudit_(employee,action,kind,id,before,after){
  appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,
    operation:action,target:'総務'+kind,targetId:id,before:auditJson_(before),
    after:auditJson_(after),source:'WEB',result:'SUCCESS',note:''});
}
function getSomuWorkspace(token,forceFresh,includeGrowth){
  const started=Date.now();
  // The session and permissions are checked even on a hot shared cache hit.
  const employee=somuOperator_(token),canApprove=employee.role==='ADMIN';
  const enrich=snapshot=>includeGrowth?Object.assign({},snapshot,{growth:getSomuGrowthData(token,forceFresh)}):snapshot;
  const cached=forceFresh?null:somuGetCachedSnapshot_();
  if(cached){
    if(typeof logPerformance_==='function')
      logPerformance_('getSomuWorkspace',started,1200,{source:'SCRIPT_CACHE',rows:cached.rowCount||0});
    return enrich(Object.assign({},cached,{canApprove:canApprove,today:somuToday_()}));
  }
  const status=somuStorageStatus_();
  if(!status.ready){
    if(typeof logPerformance_==='function')
      logPerformance_('getSomuWorkspace',started,1200,{source:'SETUP_REQUIRED'});
    return enrich({setupRequired:true,missing:status.missing,
      assets:[],loans:[],purchases:[],documents:[],canApprove:canApprove,today:somuToday_()});
  }
  const db=getDb_();
  // The 4 header checks above are reused. Avoid repeating a header read
  // for every collection, and read the newest rows at most once per sheet.
  const assets=somuRows_('asset',1500,db.getSheetByName(SOMU_MODELS.asset.sheet));
  const loans=somuRows_('loan',2500,db.getSheetByName(SOMU_MODELS.loan.sheet));
  const purchases=somuRows_('purchase',1500,db.getSheetByName(SOMU_MODELS.purchase.sheet));
  const documents=somuRows_('document',1500,db.getSheetByName(SOMU_MODELS.document.sheet));
  const result={setupRequired:false,assets:assets.items,loans:loans.items,
    purchases:purchases.items,documents:documents.items,
    truncated:assets.truncated||loans.truncated||purchases.truncated||documents.truncated,
    rowCount:assets.items.length+loans.items.length+purchases.items.length+documents.items.length};
  const cachedSuccessfully=somuPutCachedSnapshot_(result);
  if(typeof logPerformance_==='function')
    logPerformance_('getSomuWorkspace',started,1200,
      {source:'SHEETS',cacheStored:cachedSuccessfully,rows:result.rowCount});
  return enrich(Object.assign({},result,{canApprove:canApprove,today:somuToday_()}));
}
function somuAssetFields_(p){
  const code=somuText_(p.code,'管理番号',55,true);
  if(!/^[\p{L}\p{N}_./-]{2,55}$/u.test(code))throw new Error('管理番号は英数字・日本語・ハイフン等で2〜55文字にしてください。');
  const status=String(p.status||'利用中');
  if(!['利用中','保管中','廃止'].includes(status))throw new Error('備品状態を確認してください。');
  return {code:code,name:somuText_(p.name,'品名',140,true),
    category:somuText_(p.category,'分類',70,false),maker:somuText_(p.maker,'メーカー',100,false),
    model:somuText_(p.model,'型番',100,false),location:somuText_(p.location,'保管場所',140,false),
    quantity:somuCount_(p.quantity,'保有数',0,99999),
    minimum:somuCount_(p.minimum,'在庫下限',0,99999),
    status:status,note:somuText_(p.note,'備考',500,false)};
}
function saveSomuAsset(token,payload){
  const actor=somuOperator_(token),p=payload||{},fields=somuAssetFields_(p);
  return withScriptLock_(function(){
    somuSheet_('asset');
    const existing=somuRows_('asset',2500);
    if(existing.truncated)throw new Error('備品台帳の件数が上限を超えています。管理者に確認してください。');
    const id=String(p.id||'');
    if(existing.items.some(item=>item.code===fields.code&&item.status!=='廃止'&&item.id!==id))
      throw new Error('同じ管理番号の備品が既に存在します。');
    const now=somuNow_(),target=id?somuFind_('asset',id):null,old=target&&target.item;
    if(old){
      if(Number(old.revision)!==Number(p.revision))throw new Error('別の担当者が備品を更新しました。再読込してください。');
      const active=somuOpenLoans_(id).reduce((sum,item)=>sum+Number(item.quantity||0),0);
      if(fields.quantity<active)throw new Error('保有数を貸出中の数量より少なくできません。');
      if(fields.status==='廃止'&&active)throw new Error('貸出中の備品は廃止できません。返却後に操作してください。');
    }
    const item=Object.assign({},old||{},fields,{
      id:old?old.id:createId_('AST'),createdAt:old?old.createdAt:now,
      updatedAt:now,updatedBy:actor.employeeId,revision:old?Number(old.revision||0)+1:1
    });
    if(old)somuWrite_('asset',target,item);else somuNew_('asset',item);
    somuAudit_(actor,old?'備品更新':'備品登録','備品',item.id,old||'',{code:item.code,quantity:item.quantity,status:item.status});
    return {ok:true,record:somuPublic_('asset',item)};
  },20000);
}
function createSomuLoan(token,payload){
  const actor=somuOperator_(token),p=payload||{},key=somuRequestKey_(p.requestKey);
  const assetId=somuText_(p.assetId,'対象備品',80,true),borrower=somuText_(p.borrower,'貸出先',120,true);
  const count=somuCount_(p.quantity,'貸出数',1,99999);
  const loanDate=somuDate_(p.loanDate,'貸出日',true),dueDate=somuDate_(p.dueDate,'返却予定日',true);
  if(dueDate<loanDate)throw new Error('返却予定日は貸出日以降にしてください。');
  const purpose=somuText_(p.purpose,'使用目的',300,false);
  return withScriptLock_(function(){
    const duplicate=somuByRequestKey_('loan',key);
    if(duplicate){
      if(String(duplicate.creatorId)!==String(actor.employeeId))
        throw new Error('送信識別子の重複が発生しました。再読み込みしてください。');
      return {ok:true,duplicate:true,record:somuPublic_('loan',duplicate)};
    }
    const asset=somuFind_('asset',assetId).item;
    if(asset.status==='廃止')throw new Error('廃止した備品は貸し出せません。');
    const open=somuOpenLoans_(assetId).reduce((sum,item)=>sum+Number(item.quantity||0),0);
    if(count>Number(asset.quantity)-open)throw new Error('貸出可能数が不足しています。画面を更新してください。');
    const now=somuNow_(),item={id:createId_('LON'),assetId:asset.id,assetCode:asset.code,
      borrower:borrower,quantity:count,loanDate:loanDate,dueDate:dueDate,returnedAt:'',
      status:'貸出中',purpose:purpose,creatorId:actor.employeeId,createdAt:now,updatedAt:now,requestKey:key};
    somuNew_('loan',item);
    somuAudit_(actor,'貸出登録','貸出',item.id,'',{assetCode:item.assetCode,borrower:item.borrower,quantity:item.quantity});
    return {ok:true,record:somuPublic_('loan',item)};
  },20000);
}
function returnSomuLoan(token,id){
  const actor=somuOperator_(token);
  return withScriptLock_(function(){
    const target=somuFind_('loan',id),old=target.item;
    if(old.status==='返却済')return {ok:true,duplicate:true,record:somuPublic_('loan',old)};
    if(old.status!=='貸出中')throw new Error('この貸出記録は返却操作できません。');
    const item=Object.assign({},old,{status:'返却済',returnedAt:somuToday_(),updatedAt:somuNow_()});
    somuWrite_('loan',target,item);
    somuAudit_(actor,'返却登録','貸出',item.id,{status:old.status},{status:item.status,returnedAt:item.returnedAt});
    return {ok:true,record:somuPublic_('loan',item)};
  },20000);
}
function somuPurchaseFields_(p){
  p=p||{};
  return {
    name:somuText_(p.name,'購入品目',160,true),
    quantity:somuCount_(p.quantity,'希望数量',1,99999),
    estimatedPrice:somuCount_(p.estimatedPrice||'0','概算単価',0,9999999),
    neededOn:somuDate_(p.neededOn,'希望日',false),
    reason:somuText_(p.reason,'申請理由',500,true),
    assetId:somuText_(p.assetId,'対象備品ID',80,false),
    note:somuText_(p.note,'備考',500,false)
  };
}
function createSomuPurchase(token,payload){
  const actor=somuOperator_(token),p=payload||{},key=somuRequestKey_(p.requestKey);
  const fields=somuPurchaseFields_(p);
  return withScriptLock_(function(){
    const duplicate=somuByRequestKey_('purchase',key);
    if(duplicate){
      if(String(duplicate.requesterId)!==String(actor.employeeId))
        throw new Error('送信識別子の重複が発生しました。再読み込みしてください。');
      return {ok:true,duplicate:true,record:somuPublic_('purchase',duplicate)};
    }
    if(fields.assetId)somuFind_('asset',fields.assetId);
    const now=somuNow_(),item=Object.assign({},fields,{
      id:createId_('PUR'),requesterId:actor.employeeId,requesterName:actor.name,
      status:'申請中',orderedOn:'',receivedOn:'',createdAt:now,updatedAt:now,
      requestKey:key,approvedBy:'',approvedAt:''
    });
    somuNew_('purchase',item);
    somuAudit_(actor,'購買申請','購買',item.id,'',{name:item.name,quantity:item.quantity,status:item.status});
    return {ok:true,record:somuPublic_('purchase',item)};
  },20000);
}
/** Only the original applicant can correct and resubmit a returned purchase.
 * Approved, ordered and received records are immutable from this endpoint.
 */
function resubmitSomuPurchase(token,id,payload){
  const actor=somuOperator_(token),p=payload||{},key=somuRequestKey_(p.requestKey),fields=somuPurchaseFields_(p);
  return withScriptLock_(function(){
    const target=somuFind_('purchase',id),old=target.item;
    if(String(old.requesterId)!==String(actor.employeeId))
      throw new Error('他の社員の購買申請は再申請できません。');
    if(old.status==='申請中'&&String(old.requestKey)===key)
      return {ok:true,duplicate:true,record:somuPublic_('purchase',old)};
    if(old.status!=='差戻し')throw new Error('差戻された購買申請だけを再申請できます。');
    if(String(old.requestKey)===key)
      throw new Error('再申請には新しい送信識別子が必要です。');
    const collision=somuByRequestKey_('purchase',key);
    if(collision&&String(collision.id)!==String(old.id))
      throw new Error('送信識別子の重複が発生しました。再読み込みしてください。');
    if(fields.assetId)somuFind_('asset',fields.assetId);
    const now=somuNow_();
    const item=Object.assign({},old,fields,{
      status:'申請中',approvedBy:'',approvedAt:'',orderedOn:'',receivedOn:'',
      updatedAt:now,requestKey:key,
      // Preserve the original return reason in the audit trail / note.
      note:String(old.note||'')
    });
    somuWrite_('purchase',target,item);
    somuAudit_(actor,'購買再申請','購買',id,
      {status:old.status,name:old.name,quantity:old.quantity},
      {status:item.status,name:item.name,quantity:item.quantity});
    return {ok:true,duplicate:false,record:somuPublic_('purchase',item)};
  },20000);
}
function advanceSomuPurchase(token,id,action,reason){
  const actor=somuOperator_(token),operation=String(action||''),note=somuText_(reason,'判断理由',400,false);
  const transitions={APPROVE:['申請中','承認済'],RETURN:['申請中','差戻し'],ORDER:['承認済','発注済'],RECEIVE:['発注済','入荷済']};
  if(!Object.prototype.hasOwnProperty.call(transitions,operation))throw new Error('購買操作を確認してください。');
  if((operation==='APPROVE'||operation==='RETURN')&&actor.role!=='ADMIN')
    throw new Error('承認・差戻しは管理者のみ実行できます。');
  if(operation==='RETURN'&&!note)throw new Error('差戻し理由を入力してください。');
  return withScriptLock_(function(){
    const target=somuFind_('purchase',id),old=target.item,t=transitions[operation];
    if(old.status!==t[0])throw new Error('購買の状態が変わりました。再読込してください。');
    if((operation==='APPROVE'||operation==='RETURN')&&old.requesterId===actor.employeeId)
      throw new Error('自分の購買申請は承認・差戻しできません。');
    const today=somuToday_(),now=somuNow_();
    const item=Object.assign({},old,{status:t[1],updatedAt:now});
    if(operation==='APPROVE'||operation==='RETURN'){item.approvedBy=actor.employeeId;item.approvedAt=now;}
    if(operation==='ORDER')item.orderedOn=today;
    if(operation==='RECEIVE')item.receivedOn=today;
    if(note)item.note=String(item.note||'')+'\n'+(operation==='RETURN'?'差戻し理由: ':'管理メモ: ')+note;
    somuWrite_('purchase',target,item);
    somuAudit_(actor,'購買'+t[1],'購買',id,{status:old.status},{status:item.status});
    return {ok:true,record:somuPublic_('purchase',item),inventoryUnchanged:operation==='RECEIVE'};
  },20000);
}
function saveSomuDocument(token,payload){
  const actor=somuOperator_(token),p=payload||{},id=String(p.id||''),key=id?'':somuRequestKey_(p.requestKey);
  const url=String(p.url||'').trim();
  if(url&&(!/^https:\/\/[a-z0-9]/i.test(url)||/\s|["'<>]/.test(url)||url.length>700))
    throw new Error('保管リンクはhttps://で始まるURLだけ登録できます。');
  const status=String(p.status||'有効');
  if(!['有効','保管終了'].includes(status))throw new Error('書類状態を確認してください。');
  const fields={name:somuText_(p.name,'書類名',160,true),
    category:somuText_(p.category,'分類',80,false),
    location:somuText_(p.location,'保管場所',160,false),
    url:url,expiresOn:somuDate_(p.expiresOn,'期限',false),
    note:somuText_(p.note,'備考',500,false),status:status};
  return withScriptLock_(function(){
    if(!id){
      const duplicate=somuByRequestKey_('document',key);
      if(duplicate){
        if(String(duplicate.creatorId)!==String(actor.employeeId))
          throw new Error('送信識別子の重複が発生しました。再読み込みしてください。');
        return {ok:true,duplicate:true,record:somuPublic_('document',duplicate)};
      }
    }
    const target=id?somuFind_('document',id):null,old=target&&target.item;
    if(old&&String(old.updatedAt)!==String(p.updatedAt))throw new Error('別の担当者が書類を更新しました。再読込してください。');
    const now=somuNow_(),item=Object.assign({},old||{},fields,{
      id:old?old.id:createId_('ODC'),creatorId:old?old.creatorId:actor.employeeId,
      createdAt:old?old.createdAt:now,updatedAt:now,requestKey:old?old.requestKey:key});
    if(old)somuWrite_('document',target,item);else somuNew_('document',item);
    somuAudit_(actor,old?'書類更新':'書類登録','書類',item.id,old?{name:old.name,status:old.status}:'',{name:item.name,status:item.status});
    return {ok:true,record:somuPublic_('document',item)};
  },20000);
}
