/* FM WORKS: internal company policies and manuals (concept implementation).
 * Independent from issued commercial documents and the General Affairs document index.
 * All access checks are repeated on the Apps Script server.
 */
const COMPANY_DOC_SHEET='社内文書';
const COMPANY_DOC_HEADERS=Object.freeze([
  '文書ID','文書名','分類','概要','施行日','公開状態','改訂番号','更新日時','更新者ID',
  '参照URL','登録日時','登録者ID','削除日時','削除者ID','送信識別子','本文'
]);
const COMPANY_DOC_CATEGORIES=Object.freeze(['就業規則','社内規程','マニュアル','その他']);
const COMPANY_DOC_STATUSES=Object.freeze(['下書き','公開']);
function companyDocsManager_(employee){
  if(String(employee&&employee.role||'').toUpperCase()==='ADMIN')return true;
  const department=String(employee&&employee.department||'').replace(/\s+/g,'').replace(/[／/]/g,'・');
  return department.split('・').some(part=>/^総務(?:部|課|室|担当|チーム)?$/.test(part));
}
function companyDocsSheet_(optional){
  const sheet=getDb_().getSheetByName(COMPANY_DOC_SHEET);
  if(!sheet){
    if(optional)return null;
    throw new Error('社内文書の保存先が未準備です。管理者はバックアップ後に初期化してください。');
  }
  const found=sheet.getRange(1,1,1,COMPANY_DOC_HEADERS.length).getDisplayValues()[0];
  if(schemaHeaderIssues_(found,COMPANY_DOC_HEADERS).length)throw new Error('社内文書シートの列構成が異なります。既存データは変更せず管理者へご連絡ください。');
  return sheet;
}
function companyDocsRow_(row,withBody){
  const result={
    id:String(row[0]||''),title:String(row[1]||''),category:String(row[2]||''),
    summary:String(row[3]||''),effectiveOn:String(row[4]||''),
    status:String(row[5]||''),revision:Number(row[6]||0),updatedAt:String(row[7]||''),
    editorId:String(row[8]||''),url:String(row[9]||'')
  };
  if(withBody)result.body=String(row[15]||'');
  return result;
}
function companyDocsFind_(sheet,id){
  const last=sheet.getLastRow();
  if(last<2)throw new Error('指定された文書が見つかりません。');
  const ids=sheet.getRange(2,1,last-1,1).getDisplayValues();
  const offset=ids.findIndex(row=>String(row[0]||'')===id);
  if(offset<0)throw new Error('指定された文書が見つかりません。');
  const rowNumber=offset+2;
  const row=sheet.getRange(rowNumber,1,1,COMPANY_DOC_HEADERS.length).getDisplayValues()[0];
  if(row[12])throw new Error('この文書は削除されています。');
  return {rowNumber,row};
}
function companyDocsNow_(){return Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd HH:mm:ss');}
function companyDocsText_(value,label,max,required){
  const text=safeSheetText_(value,max);
  if(required&&!text)throw new Error(label+'を入力してください。');
  if(String(value==null?'':value).trim().length>max)throw new Error(label+'は'+max+'文字以内で入力してください。');
  return text;
}
function companyDocsUrl_(value){
  const url=String(value||'').trim();
  if(!url)return '';
  if(url.length>2000||!/^https:\/\/[A-Za-z0-9.-]+(?::443)?(?:[/?#][^\s]*)?$/i.test(url))throw new Error('参照URLはHTTPSリンクを入力してください。');
  return safeSheetText_(url,2000);
}
function companyDocsForm_(payload){
  const p=payload||{};
  const category=String(p.category||'その他'),status=String(p.status||'下書き');
  if(!COMPANY_DOC_CATEGORIES.includes(category))throw new Error('分類が正しくありません。');
  if(!COMPANY_DOC_STATUSES.includes(status))throw new Error('公開状態が正しくありません。');
  const date=String(p.effectiveOn||'').trim();
  return {
    title:companyDocsText_(p.title,'文書名',120,true),
    category:category,summary:companyDocsText_(p.summary,'概要',300,false),
    body:companyDocsText_(p.body,'本文',20000,false),
    url:companyDocsUrl_(p.url),
    effectiveOn:date?normalizeDate_(date):'',status:status
  };
}
function companyDocsKey_(value){
  const key=String(value||'').trim();
  if(!/^[A-Za-z0-9_-]{12,100}$/.test(key))throw new Error('送信識別子が不正です。画面を開き直してください。');
  return key;
}
// List reads only the small metadata columns, never all long text bodies.
function getCompanyDocuments(sessionToken){
  const employee=requireSession_(sessionToken).employee;
  const canManage=companyDocsManager_(employee);
  const sheet=companyDocsSheet_(true);
  if(!sheet)return {ok:true,setupRequired:true,canManage:canManage,canInitialize:String(employee.role||'').toUpperCase()==='ADMIN',items:[],categories:COMPANY_DOC_CATEGORIES};
  const count=sheet.getLastRow()-1;
  const rows=count>0?sheet.getRange(2,1,count,15).getDisplayValues():[];
  const items=rows.filter(row=>!row[12]&&(canManage||String(row[5])==='公開')).map(row=>companyDocsRow_(row,false))
    .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  return {ok:true,setupRequired:false,canManage:canManage,canInitialize:false,items:items,categories:COMPANY_DOC_CATEGORIES};
}
function getCompanyDocument(sessionToken,documentId){
  const employee=requireSession_(sessionToken).employee;
  const id=String(documentId||'').trim();
  if(!/^CD-[A-Za-z0-9-]{12,100}$/.test(id))throw new Error('文書IDが正しくありません。');
  const found=companyDocsFind_(companyDocsSheet_(false),id);
  if(found.row[5]!=='公開'&&!companyDocsManager_(employee))throw new Error('この文書を閲覧する権限がありません。');
  return {ok:true,document:companyDocsRow_(found.row,true)};
}
function initializeCompanyDocuments(sessionToken){
  const employee=requireAdminSession_(sessionToken).employee;
  return withScriptLock_(function(){
    const existing=companyDocsSheet_(true);
    if(existing)return {ok:true,changed:false};
    // Existing company data is never reset; backup must succeed before creating a sheet.
    const backup=createDatabaseBackup_(employee);
    ensureSchemaSheet_(getDb_(),COMPANY_DOC_SHEET,COMPANY_DOC_HEADERS);
    appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'社内文書保存先準備',
      target:COMPANY_DOC_SHEET,targetId:'',before:'',after:'シート作成',source:'WEB',result:'SUCCESS',note:backup&&backup.name||''});
    return {ok:true,changed:true};
  },30000);
}
function saveCompanyDocument(sessionToken,payload){
  const employee=requireSession_(sessionToken).employee;
  if(!companyDocsManager_(employee))throw new Error('社内文書の登録・修正権限がありません。');
  const p=payload||{},form=companyDocsForm_(p),key=companyDocsKey_(p.requestKey);
  const id=String(p.id||'').trim(),revision=Number(p.revision||0);
  if(id&&!/^CD-[A-Za-z0-9-]{12,100}$/.test(id))throw new Error('文書IDが正しくありません。');
  return withScriptLock_(function(){
    const sheet=companyDocsSheet_(false),now=companyDocsNow_();
    if(id){
      const found=companyDocsFind_(sheet,id),row=found.row;
      if(String(row[14]||'')===key)return {ok:true,duplicate:true,document:companyDocsRow_(row,true)};
      if(!Number.isInteger(revision)||revision<1||Number(row[6])!==revision)
        throw new Error('別の担当者が文書を更新しました。再読み込みして内容を確認してください。');
      row[1]=form.title;row[2]=form.category;row[3]=form.summary;row[4]=form.effectiveOn;
      row[5]=form.status;row[6]=revision+1;row[7]=now;row[8]=employee.employeeId;row[9]=form.url;
      row[14]=key;row[15]=form.body;
      sheet.getRange(found.rowNumber,1,1,COMPANY_DOC_HEADERS.length).setValues([row]);
      appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'社内文書改訂',
        target:COMPANY_DOC_SHEET,targetId:id,before:auditJson_({revision,status:found.row[5]}),
        after:auditJson_({revision:revision+1,status:form.status,title:form.title}),source:'WEB',result:'SUCCESS',note:''});
      return {ok:true,document:companyDocsRow_(row,true)};
    }
    const count=sheet.getLastRow()-1;
    if(count>0){
      const keys=sheet.getRange(2,15,count,1).getDisplayValues();
      const i=keys.findIndex(r=>r[0]===key);
      if(i>=0){
        const row=sheet.getRange(i+2,1,1,COMPANY_DOC_HEADERS.length).getDisplayValues()[0];
        if(row[12])throw new Error('同じ送信の文書はすでに削除されています。');
        return {ok:true,duplicate:true,document:companyDocsRow_(row,true)};
      }
    }
    const newId=createId_('CD'),row=[
      newId,form.title,form.category,form.summary,form.effectiveOn,form.status,1,now,employee.employeeId,
      form.url,now,employee.employeeId,'','',key,form.body
    ];
    sheet.appendRow(row);
    appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'社内文書登録',
      target:COMPANY_DOC_SHEET,targetId:newId,before:'',after:auditJson_({title:form.title,status:form.status,revision:1}),
      source:'WEB',result:'SUCCESS',note:''});
    return {ok:true,document:companyDocsRow_(row,true)};
  },30000);
}
function deleteCompanyDocument(sessionToken,documentId,expectedRevision){
  const employee=requireSession_(sessionToken).employee;
  if(!companyDocsManager_(employee))throw new Error('社内文書を削除する権限がありません。');
  const id=String(documentId||'').trim();
  if(!/^CD-[A-Za-z0-9-]{12,100}$/.test(id))throw new Error('文書IDが正しくありません。');
  return withScriptLock_(function(){
    const sheet=companyDocsSheet_(false),found=companyDocsFind_(sheet,id),row=found.row;
    if(!Number.isInteger(Number(expectedRevision))||Number(expectedRevision)!==Number(row[6]))
      throw new Error('別の担当者が文書を更新しました。再読み込みしてください。');
    const before={title:row[1],status:row[5],revision:row[6]};
    row[5]='削除';row[6]=Number(row[6])+1;row[7]=companyDocsNow_();
    row[8]=employee.employeeId;row[12]=row[7];row[13]=employee.employeeId;
    sheet.getRange(found.rowNumber,1,1,COMPANY_DOC_HEADERS.length).setValues([row]);
    appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'社内文書削除',
      target:COMPANY_DOC_SHEET,targetId:id,before:auditJson_(before),after:auditJson_({softDeleted:true}),
      source:'WEB',result:'SUCCESS',note:'履歴保持'});
    return {ok:true,id:id,deleted:true};
  },30000);
}