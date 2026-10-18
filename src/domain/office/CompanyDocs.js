/* FM WORKS - Company document library and stable two-level business taxonomy.
 * A:P are unchanged legacy columns. Q=folderId, R=search tags.
 * Form values and visibility are always validated on the server.
 */
const COMPANY_DOC_SHEET='社内文書';
const COMPANY_DOC_BASE_HEADERS=Object.freeze([
  '文書ID','文書名','分類','概要','施行日','公開状態','改訂番号','更新日時','更新者ID',
  '参照URL','登録日時','登録者ID','削除日時','削除者ID','送信識別子','本文'
]);
const COMPANY_DOC_HEADERS=Object.freeze(COMPANY_DOC_BASE_HEADERS.concat(['業務フォルダID','タグ']));
const COMPANY_DOC_CATEGORIES=Object.freeze(['就業規則','社内規程','マニュアル','その他']);
const COMPANY_DOC_STATUSES=Object.freeze(['下書き','公開']);
const COMPANY_DOC_FOLDERS=Object.freeze([
  {id:'hr',parentId:'',name:'人事・労務'},
  {id:'hr/work',parentId:'hr',name:'就業・勤怠'},
  {id:'hr/leave',parentId:'hr',name:'休暇・福利厚生'},
  {id:'hr/onboarding',parentId:'hr',name:'採用・入退社'},
  {id:'general',parentId:'',name:'総務・設備'},
  {id:'general/equipment',parentId:'general',name:'備品・貸出'},
  {id:'general/purchase',parentId:'general',name:'購買・施設'},
  {id:'finance',parentId:'',name:'経理・出張'},
  {id:'finance/expenses',parentId:'finance',name:'経費精算'},
  {id:'finance/travel',parentId:'finance',name:'出張・旅費'},
  {id:'safety',parentId:'',name:'安全・衛生'},
  {id:'safety/health',parentId:'safety',name:'衛生・健康'},
  {id:'safety/emergency',parentId:'safety',name:'防災・緊急時'},
  {id:'information',parentId:'',name:'情報管理'},
  {id:'information/security',parentId:'information',name:'セキュリティ'},
  {id:'information/privacy',parentId:'information',name:'個人情報'},
  {id:'information/systems',parentId:'information',name:'社内システム'},
  {id:'other',parentId:'',name:'その他'},
  {id:'other/general',parentId:'other',name:'その他の文書'}
]);
function companyDocsManager_(employee){
  if(String(employee&&employee.role||'').toUpperCase()==='ADMIN')return true;
  const department=String(employee&&employee.department||'').replace(/\s+/g,'').replace(/[／/]/g,'・');
  return department.split('・').some(part=>/^総務(?:部|課|室|担当|チーム)?$/.test(part));
}
function companyDocsValidId_(value){
  return /^CD-[A-Za-z0-9-]{12,100}$/.test(String(value||''));
}
function companyDocsLeaf_(id){
  return COMPANY_DOC_FOLDERS.some(f=>f.id===id&&!!f.parentId);
}
function companyDocsIndexReady_(sheet){
  if(sheet.getMaxColumns()<COMPANY_DOC_HEADERS.length)return false;
  const headers=sheet.getRange(1,17,1,2).getDisplayValues()[0];
  if(headers[0]==='業務フォルダID'&&headers[1]==='タグ')return true;
  if(!String(headers[0]||'').trim()&&!String(headers[1]||'').trim())return false;
  throw new Error('社内文書の分類列が一致しません。管理者へご連絡ください。');
}
function companyDocsSheet_(optional){
  const sheet=getDb_().getSheetByName(COMPANY_DOC_SHEET);
  if(!sheet){
    if(optional)return null;
    throw new Error('社内文書の保存先が未準備です。Sites SQLのスキーマを確認してください。');
  }
  const found=sheet.getRange(1,1,1,COMPANY_DOC_BASE_HEADERS.length).getDisplayValues()[0];
  if(schemaHeaderIssues_(found,COMPANY_DOC_BASE_HEADERS).length)
    throw new Error('社内文書シートの列構成が異なります。既存データは変更せず管理者へご連絡ください。');
  return sheet;
}
function companyDocsTagsFromStorage_(text){
  return String(text||'').split(',').map(s=>s.trim()).filter(Boolean);
}
function companyDocsRow_(row,withBody){
  const rawFolder=String(row[16]||'');
  const result={
    id:String(row[0]||''),title:String(row[1]||''),category:String(row[2]||''),
    summary:String(row[3]||''),effectiveOn:String(row[4]||''),
    status:String(row[5]||''),revision:Number(row[6]||0),
    updatedAt:String(row[7]||''),editorId:String(row[8]||''),url:String(row[9]||''),
    folderId:companyDocsLeaf_(rawFolder)?rawFolder:'other/general',
    tags:companyDocsTagsFromStorage_(row[17])
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
  const rowNumber=offset+2,ready=companyDocsIndexReady_(sheet);
  const row=sheet.getRange(rowNumber,1,1,ready?COMPANY_DOC_HEADERS.length:COMPANY_DOC_BASE_HEADERS.length).getDisplayValues()[0];
  if(row[12])throw new Error('この文書は削除されています。');
  return {rowNumber,row,ready};
}
function companyDocsNow_(){return Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd HH:mm:ss');}
function companyDocsText_(value,label,max,required){
  const raw=String(value==null?'':value).trim();
  if(raw.length>max)throw new Error(label+'は'+max+'文字以内で入力してください。');
  const text=safeSheetText_(raw,max);
  if(required&&!text)throw new Error(label+'を入力してください。');
  return text;
}
function companyDocsUrl_(value){
  const url=String(value||'').trim();
  if(!url)return '';
  if(url.length>2000||!/^https:\/\/[A-Za-z0-9.-]+(?::443)?(?:[/?#][^\s]*)?$/i.test(url))
    throw new Error('参照URLはHTTPSリンクを入力してください。');
  return safeSheetText_(url,2000);
}
function companyDocsTags_(value){
  const text=Array.isArray(value)?value.join(','):String(value||'');
  if(text.length>320)throw new Error('タグの入力が長すぎます。');
  const parts=text.split(/[,、，]/).map(v=>v.trim()).filter(Boolean);
  const normalized=[];
  parts.forEach(tag=>{
    if(tag.length>30||/[\r\n]/.test(tag))throw new Error('タグは1つ30文字以内で入力してください。');
    const clean=safeSheetText_(tag,30);
    if(!normalized.includes(clean))normalized.push(clean);
  });
  if(normalized.length>8)throw new Error('タグは最大8個まで登録できます。');
  return normalized;
}
function companyDocsForm_(payload){
  const p=payload||{};
  const category=String(p.category||'その他'),status=String(p.status||'下書き');
  const folderId=String(p.folderId||'other/general').trim();
  if(!COMPANY_DOC_CATEGORIES.includes(category))throw new Error('文書種類が正しくありません。');
  if(!COMPANY_DOC_STATUSES.includes(status))throw new Error('公開状態が正しくありません。');
  if(!companyDocsLeaf_(folderId))throw new Error('業務フォルダの選択が正しくありません。');
  const date=String(p.effectiveOn||'').trim();
  return {
    title:companyDocsText_(p.title,'文書名',120,true),
    category,summary:companyDocsText_(p.summary,'概要',300,false),
    body:companyDocsText_(p.body,'本文',20000,false),
    url:companyDocsUrl_(p.url),
    effectiveOn:date?normalizeDate_(date):'',status,folderId,tags:companyDocsTags_(p.tags)
  };
}
function companyDocsMatchesPayload_(row,form){
  // Request keys are idempotent only when the actor and every persisted field
  // agree. A changed draft with a reused key is a conflict, not a success.
  return String(row[1]||'')===form.title &&
    String(row[2]||'')===form.category &&
    String(row[3]||'')===form.summary &&
    String(row[4]||'')===form.effectiveOn &&
    String(row[5]||'')===form.status &&
    String(row[9]||'')===form.url &&
    String(row[15]||'')===form.body &&
    String(row[16]||'')===form.folderId &&
    String(row[17]||'')===form.tags.join(',');
}
function companyDocsKey_(value){
  const key=String(value||'').trim();
  if(!/^[A-Za-z0-9_-]{12,100}$/.test(key))throw new Error('送信識別子が不正です。画面を開き直してください。');
  return key;
}
function getCompanyDocuments(sessionToken){
  const employee=requireSession_(sessionToken).employee;
  const canManage=companyDocsManager_(employee);
  const sheet=companyDocsSheet_(true);
  const base={ok:true,canManage,canInitialize:false,
    folders:COMPANY_DOC_FOLDERS,categories:COMPANY_DOC_CATEGORIES,items:[]};
  if(!sheet)return Object.assign(base,{setupRequired:true,needsUpgrade:false});
  const needsUpgrade=!companyDocsIndexReady_(sheet);
  const count=sheet.getLastRow()-1;
  // Never load the long-text body (P) for a list request.
  const rows=count>0?sheet.getRange(2,1,count,15).getDisplayValues():[];
  const index=(!needsUpgrade&&count>0)?sheet.getRange(2,17,count,2).getDisplayValues():[];
  const items=rows.map((row,i)=>{
    if(row[12]||!companyDocsValidId_(row[0])||(!canManage&&String(row[5])!=='公開'))return null;
    return companyDocsRow_(row.concat(['',index[i]&&index[i][0]||'',index[i]&&index[i][1]||'']),false);
  }).filter(Boolean).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
  return Object.assign(base,{setupRequired:false,needsUpgrade,items});
}
function getCompanyDocument(sessionToken,documentId){
  const employee=requireSession_(sessionToken).employee;
  const id=String(documentId||'').trim();
  if(!/^CD-[A-Za-z0-9-]{12,100}$/.test(id))throw new Error('文書IDが正しくありません。');
  const found=companyDocsFind_(companyDocsSheet_(false),id);
  if(found.row[5]!=='公開'&&!companyDocsManager_(employee))
    throw new Error('この文書を閲覧する権限がありません。');
  return {ok:true,document:companyDocsRow_(found.row,true)};
}
function searchCompanyDocumentBodies(sessionToken,keyword){
  const employee=requireSession_(sessionToken).employee;
  const q=String(keyword||'').trim();
  if(q.length<2||q.length>80)return {ok:true,matchedIds:[],truncated:false};
  const terms=[...new Set(q.split(/\s+/).filter(Boolean))];
  if(terms.length>8)throw new Error('検索語は最大8語まで指定してください。');
  const sheet=companyDocsSheet_(true);
  if(!sheet||sheet.getLastRow()<2)return {ok:true,matchedIds:[],truncated:false};
  const count=sheet.getLastRow()-1;
  const meta=sheet.getRange(2,1,count,15).getDisplayValues();
  const index=companyDocsIndexReady_(sheet)?sheet.getRange(2,17,count,2).getDisplayValues():[];
  const canManage=companyDocsManager_(employee);
  const allowedIndexes=[];
  const searchableMeta=[];
  for(let i=0;i<meta.length;i++){
    const row=meta[i];
    if(row[12]||!companyDocsValidId_(row[0])||(!canManage&&row[5]!=='公開'))continue;
    allowedIndexes.push(i);
    const folderId=index[i]&&String(index[i][0]||'')||'other/general';
    const folder=COMPANY_DOC_FOLDERS.find(f=>f.id===folderId);
    const parent=folder&&COMPANY_DOC_FOLDERS.find(f=>f.id===folder.parentId);
    searchableMeta[i]=[row[1],row[2],row[3],folderId,
      folder&&folder.name||'',parent&&parent.name||'',index[i]&&index[i][1]||'']
      .join(' ').toLocaleLowerCase('ja-JP');
  }
  if(!allowedIndexes.length)return {ok:true,matchedIds:[],truncated:false};
  const bodyRange=sheet.getRange(2,16,count,1);
  let matchedRows=null;
  for(const term of terms){
    // Search each word in the same document across metadata and body.
    // Treat punctuation literally: a user search must never become a regex.
    const bodyHits=bodyRange.createTextFinder(term).matchCase(false)
      .useRegularExpression(false).findAll();
    const positions=new Set(bodyHits.map(cell=>cell.getRow()));
    const lower=term.toLocaleLowerCase('ja-JP');
    for(const i of allowedIndexes){
      if(searchableMeta[i].includes(lower))positions.add(i+2);
    }
    if(matchedRows===null)matchedRows=positions;
    else matchedRows=new Set([...matchedRows].filter(row=>positions.has(row)));
    if(!matchedRows.size)return {ok:true,matchedIds:[],truncated:false};
  }
  const matchedIds=[];
  for(const i of allowedIndexes){
    if(!matchedRows.has(i+2))continue;
    matchedIds.push(String(meta[i][0]));
    if(matchedIds.length>250)
      return {ok:true,matchedIds:matchedIds.slice(0,250),truncated:true};
  }
  return {ok:true,matchedIds,truncated:false};
}
function saveCompanyDocument(sessionToken,payload){
  const employee=requireSession_(sessionToken).employee;
  if(!companyDocsManager_(employee))throw new Error('社内文書の登録・修正権限がありません。');
  const p=payload||{},form=companyDocsForm_(p),key=companyDocsKey_(p.requestKey);
  const id=String(p.id||'').trim(),revision=Number(p.revision||0);
  if(id&&!/^CD-[A-Za-z0-9-]{12,100}$/.test(id))throw new Error('文書IDが正しくありません。');
  return withScriptLock_(function(){
    const sheet=companyDocsSheet_(false),now=companyDocsNow_();
    if(!companyDocsIndexReady_(sheet))
      throw new Error('社内文書の分類列が未準備です。管理者はDB更新を行ってください。');
    if(id){
      const found=companyDocsFind_(sheet,id),row=found.row;
      if(String(row[14]||'')===key){
        if(String(row[8]||'')!==String(employee.employeeId)||!companyDocsMatchesPayload_(row,form))
          throw new Error('送信識別子の内容が一致しません。再読み込みしてください。');
        return {ok:true,duplicate:true,document:companyDocsRow_(row,true)};
      }
      if(!Number.isInteger(revision)||revision<1||Number(row[6])!==revision)
        throw new Error('別の担当者が文書を更新しました。再読み込みして内容を確認してください。');
      const before={revision:Number(row[6]),status:String(row[5]),folderId:String(row[16])};
      row[1]=form.title;row[2]=form.category;row[3]=form.summary;row[4]=form.effectiveOn;
      row[5]=form.status;row[6]=revision+1;row[7]=now;row[8]=employee.employeeId;row[9]=form.url;
      row[14]=key;row[15]=form.body;row[16]=form.folderId;row[17]=form.tags.join(',');
      sheet.getRange(found.rowNumber,1,1,COMPANY_DOC_HEADERS.length).setValues([row]);
      appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'社内文書改訂',
        target:COMPANY_DOC_SHEET,targetId:id,before:auditJson_(before),
        after:auditJson_({revision:revision+1,status:form.status,title:form.title,folderId:form.folderId}),
        source:'WEB',result:'SUCCESS',note:''});
      return {ok:true,document:companyDocsRow_(row,true)};
    }
    const count=sheet.getLastRow()-1;
    if(count>0){
      const keys=sheet.getRange(2,15,count,1).getDisplayValues();
      const i=keys.findIndex(r=>r[0]===key);
      if(i>=0){
        const row=sheet.getRange(i+2,1,1,COMPANY_DOC_HEADERS.length).getDisplayValues()[0];
        if(row[12])throw new Error('同じ送信の文書はすでに削除されています。');
        if(Number(row[6])!==1||String(row[11]||'')!==String(employee.employeeId)||
           !companyDocsMatchesPayload_(row,form))
          throw new Error('送信識別子の内容が一致しません。再読み込みしてください。');
        return {ok:true,duplicate:true,document:companyDocsRow_(row,true)};
      }
    }
    const newId=createId_('CD'),row=[
      newId,form.title,form.category,form.summary,form.effectiveOn,form.status,1,now,employee.employeeId,
      form.url,now,employee.employeeId,'','',key,form.body,form.folderId,form.tags.join(',')
    ];
    sheet.appendRow(row);
    appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'社内文書登録',
      target:COMPANY_DOC_SHEET,targetId:newId,before:'',
      after:auditJson_({title:form.title,status:form.status,revision:1,folderId:form.folderId}),
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
    sheet.getRange(found.rowNumber,1,1,found.ready?COMPANY_DOC_HEADERS.length:COMPANY_DOC_BASE_HEADERS.length)
      .setValues([row]);
    appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'社内文書削除',
      target:COMPANY_DOC_SHEET,targetId:id,before:auditJson_(before),
      after:auditJson_({softDeleted:true}),source:'WEB',result:'SUCCESS',note:'履歴保持'});
    return {ok:true,id,deleted:true};
  },30000);
}