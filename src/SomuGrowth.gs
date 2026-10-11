/* General Affairs growth modules: optional until DB schema v14 is migrated.
 * No document bytes are stored here. Links are metadata to existing document storage.
 * Every read/write authenticates and verifies the officeWorkspace permission.
 */
const SOMU_GROWTH_KINDS=Object.freeze(['contract','facility','ticket']);
const SOMU_GROWTH_CACHE_SECONDS=20;
function somuGrowthKey_(){return 'fm:somu:growth:v1:'+getDatabaseSpreadsheetId_();}
function somuGrowthInvalidateCache_(){
  if(typeof cacheRemove_==='function')cacheRemove_(somuGrowthKey_());
}
function somuGrowthStorageStatus_(){
  const db=getDb_(),missing=[],sheets={};
  SOMU_GROWTH_KINDS.forEach(kind=>{
    const m=somuModel_(kind),headers=DB_SCHEMA_SPECS[m.sheet],sheet=db.getSheetByName(m.sheet);
    if(!sheet||!headers){missing.push(m.sheet);return;}
    const actual=sheet.getRange(1,1,1,headers.length).getDisplayValues()[0];
    if(schemaHeaderIssues_(actual,headers).length){missing.push(m.sheet+'（列構成を確認してください）');return;}
    sheets[kind]=sheet;
  });
  return {ready:missing.length===0,missing:missing,sheets:sheets};
}
function somuGrowthCached_(){
  if(typeof cacheJsonGet_!=='function')return null;
  const snapshot=cacheJsonGet_(somuGrowthKey_());
  if(!snapshot||snapshot.ready!==true||
    !Array.isArray(snapshot.contracts)||!Array.isArray(snapshot.facilities)||!Array.isArray(snapshot.tickets))
    return null;
  return snapshot;
}
function somuGrowthCachePut_(data){
  if(typeof cacheJsonPut_!=='function')return false;
  const text=JSON.stringify(data);
  const bytes=typeof Utilities.newBlob==='function'?Utilities.newBlob(text).getBytes().length:text.length*3;
  if(bytes>85000)return false;
  return cacheJsonPut_(somuGrowthKey_(),data,SOMU_GROWTH_CACHE_SECONDS);
}
function getSomuGrowthData(token,forceFresh){
  const started=Date.now();
  somuOperator_(token);  // Must run even on a shared cache hit.
  const cached=forceFresh?null:somuGrowthCached_();
  if(cached){
    if(typeof logPerformance_==='function')logPerformance_('getSomuGrowthData',started,1300,{source:'SCRIPT_CACHE'});
    return cached;
  }
  const status=somuGrowthStorageStatus_();
  if(!status.ready){
    return {ready:false,missing:status.missing,contracts:[],facilities:[],tickets:[],
      truncated:false,today:somuToday_()};
  }
  const contracts=somuRows_('contract',1500,status.sheets.contract);
  const facilities=somuRows_('facility',1500,status.sheets.facility);
  const tickets=somuRows_('ticket',1500,status.sheets.ticket);
  const data={ready:true,contracts:contracts.items,facilities:facilities.items,tickets:tickets.items,
    truncated:contracts.truncated||facilities.truncated||tickets.truncated,today:somuToday_()};
  const stored=somuGrowthCachePut_(data);
  if(typeof logPerformance_==='function')logPerformance_('getSomuGrowthData',started,1300,
    {source:'SHEETS',cacheStored:stored,rows:contracts.items.length+facilities.items.length+tickets.items.length});
  return data;
}
function somuGrowthUrl_(value){
  const url=String(value||'').trim();
  if(!url)return '';
  if(url.length>700||!/^(https:\/\/)[a-z0-9]/i.test(url)||/[\s"'<>]/.test(url))
    throw new Error('原本リンクにはhttps://で始まる安全なURLを入力してください。');
  return url;
}
function somuGrowthEnum_(value,values,label){
  const text=String(value||values[0]);
  if(!values.includes(text))throw new Error(label+'が正しくありません。');
  return text;
}
function somuGrowthContractFields_(p){
  const start=somuDate_(p.startedOn,'契約開始日',false);
  const end=somuDate_(p.expiresOn,'満了日',false);
  const notice=somuDate_(p.noticeOn,'解約・更新通知期限',false);
  if(start&&end&&start>end)throw new Error('満了日は開始日以降にしてください。');
  if(notice&&end&&notice>end)throw new Error('通知期限は満了日以前にしてください。');
  return {
    name:somuText_(p.name,'契約名',150,true),
    category:somuGrowthEnum_(p.category,['サービス','保守','リース','保険','その他'],'契約分類'),
    vendor:somuText_(p.vendor,'契約先',150,true),
    contractNo:somuText_(p.contractNo,'契約番号',90,false),
    startedOn:start,expiresOn:end,noticeOn:notice,
    renewal:somuGrowthEnum_(p.renewal,['要確認','自動更新あり','自動更新なし'],'更新条件'),
    annualYen:somuCount_(p.annualYen===undefined||p.annualYen===''?0:p.annualYen,'年額',0,9999999),
    owner:somuText_(p.owner,'管理担当',100,false),
    url:somuGrowthUrl_(p.url),
    status:somuGrowthEnum_(p.status,['有効','更新確認中','終了'],'契約状態'),
    note:somuText_(p.note,'備考',700,false)
  };
}
function somuGrowthFacilityFields_(p){
  const code=somuText_(p.code,'管理番号',55,true);
  if(!/^[\p{L}\p{N}_./-]{2,55}$/u.test(code))throw new Error('管理番号の形式が正しくありません。');
  const checked=somuDate_(p.lastCheckedOn,'最終点検日',false);
  const next=somuDate_(p.nextCheckOn,'次回点検日',false);
  if(checked&&next&&checked>next)throw new Error('次回点検日は最終点検日以降にしてください。');
  return {code:code,name:somuText_(p.name,'名称',150,true),
    type:somuGrowthEnum_(p.type,['オフィス設備','車両','IT設備','その他'],'設備種別'),
    location:somuText_(p.location,'設置・保管場所',150,false),
    owner:somuText_(p.owner,'管理担当',100,false),
    vendor:somuText_(p.vendor,'保守先',150,false),
    lastCheckedOn:checked,nextCheckOn:next,
    status:somuGrowthEnum_(p.status,['稼働中','要点検','休止','廃止'],'設備状態'),
    note:somuText_(p.note,'備考',700,false)};
}
function somuGrowthTicketFields_(p,actor,existing){
  const status=somuGrowthEnum_(p.status,['未着手','対応中','完了'],'対応状態');
  return {
    subject:somuText_(p.subject,'依頼件名',160,true),
    category:somuGrowthEnum_(p.category,['備品・購買','設備・修理','契約・書類','その他'],'依頼種別'),
    priority:somuGrowthEnum_(p.priority,['通常','高','緊急'],'優先度'),
    requesterName:existing?existing.requesterName:actor.name,
    assignee:somuText_(p.assignee,'対応担当',100,false),
    dueOn:somuDate_(p.dueOn,'対応期限',false),
    description:somuText_(p.description,'依頼内容',800,true),
    status:status,
    resolvedOn:status==='完了'?(existing&&existing.status==='完了'?existing.resolvedOn:somuToday_()):'',
    note:somuText_(p.note,'対応メモ',800,false)
  };
}
function saveSomuGrowthRecord(token,kind,payload){
  const actor=somuOperator_(token),p=payload||{};
  if(!SOMU_GROWTH_KINDS.includes(kind))throw new Error('総務台帳の種類が正しくありません。');
  const id=String(p.id||'').trim(),key=id?'':somuRequestKey_(p.requestKey);
  return withScriptLock_(function(){
    // Confirm optional schema after acquiring lock, never create an incomplete record.
    const status=somuGrowthStorageStatus_();
    if(!status.ready)throw new Error('新しい総務台帳のDB更新が必要です。管理者がバックアップ付きDB更新を実行してください。');
    const target=id?somuFind_(kind,id):null,old=target&&target.item;
    if(old&&Number(old.revision)!==Number(p.revision))
      throw new Error('別の担当者が更新しました。再読み込みしてください。');
    if(!old){
      const duplicate=somuByRequestKey_(kind,key);
      if(duplicate){
        if(String(duplicate.createdBy)!==String(actor.employeeId))
          throw new Error('送信識別子が重複しています。再読み込みしてください。');
        return {ok:true,duplicate:true,record:somuPublic_(kind,duplicate)};
      }
    }
    const fields=kind==='contract'?somuGrowthContractFields_(p):
      kind==='facility'?somuGrowthFacilityFields_(p):somuGrowthTicketFields_(p,actor,old);
    if(kind==='facility'){
      const duplicate=readRowsByColumnValues_(status.sheets.facility,2,SOMU_MODELS.facility.keys.length,[fields.code])
        .some(row=>String(row[0]||'')&&String(row[0])!==id&&
          String(row[1]||'')===fields.code&&String(row[9]||'')!=='廃止');
      if(duplicate)throw new Error('同じ管理番号が既に登録されています。');
    }
    const now=somuNow_();
    const record=Object.assign({},old||{},fields,{
      id:old?old.id:createId_(kind==='contract'?'CTR':kind==='facility'?'FCL':'TKT'),
      createdAt:old?old.createdAt:now,updatedAt:now,
      createdBy:old?old.createdBy:actor.employeeId,updatedBy:actor.employeeId,
      revision:old?Number(old.revision||0)+1:1,
      requestKey:old?old.requestKey:key
    });
    if(old)somuWrite_(kind,target,record);else somuNew_(kind,record);
    somuAudit_(actor,old?'管理台帳更新':'管理台帳登録',kind,record.id,
      old?{status:old.status,revision:old.revision}:'',
      {status:record.status,revision:record.revision});
    return {ok:true,record:somuPublic_(kind,record)};
  },20000);
}
