/*
 * FM WORKS - company estimates, accessible to all authenticated staff.
 * Source: FI-0001-0001 workbook + vendor-code workbook supplied 2026-10-08.
 * The two source Excel workbooks and customer list are not checked in to GitHub.
 * Quote rows and vendor registry are stored only in FM WORKS DB.
 */
const QUOTE_MODEL=Object.freeze({
  vendor:{sheet:'見積取引先',keys:['code','name','invoice','address','industry','active','updatedAt']},
  header:{sheet:'見積ヘッダー',keys:['id','createdAt','updatedAt','ownerId','ownerName',
    'vendorCode','vendorName','vendorAddress','vendorInvoice','quoteDate','subject',
    'delivery','payment','expires','contact','note','bank','status','number',
    'issuedAt','taxRate','subtotal','taxAmount','total','revision','requestKey',
    'pdfFileId','xlsxFileId']},
  detail:{sheet:'見積明細',keys:['quoteId','position','description','quantity','unit','price','amount']},
  sequence:{sheet:'見積採番',keys:['vendorCode','lastNumber','verified','updatedAt','updatedBy']}
});
const QUOTE_MAX_LINES=21;
function quoteNow_(){return Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd HH:mm:ss');}
function quoteUser_(token){return requireSession_(token).employee;}
function quoteIsAdmin_(employee){return String(employee.role||'').toUpperCase()==='ADMIN';}
function quoteNeedAdmin_(token){
  const e=quoteUser_(token);
  if(!quoteIsAdmin_(e))throw new Error('取引先と採番の設定は管理者のみ操作できます。');
  return e;
}
function quoteModelSheet_(model){
  const def=QUOTE_MODEL[model];if(!def)throw new Error('見積データ種別が不正です。');
  const sh=getDb_().getSheetByName(def.sheet);
  if(!sh)throw new Error('見積DBが未初期化です。管理者がバックアップ付きDB更新を実施してください。');
  const headers=sh.getRange(1,1,1,def.keys.length).getDisplayValues()[0];
  if(schemaHeaderIssues_(headers,DB_SCHEMA_SPECS[def.sheet]).length)
    throw new Error(def.sheet+'の見出しが一致しません。管理者に確認してください。');
  return sh;
}
function quoteStorageStatus_(validatedSheets){
  const missing=[];
  Object.keys(QUOTE_MODEL).forEach(k=>{
    const name=QUOTE_MODEL[k].sheet,sh=getDb_().getSheetByName(name);
    if(!sh){missing.push(name);return;}
    const issues=schemaHeaderIssues_(sh.getRange(1,1,1,QUOTE_MODEL[k].keys.length).getDisplayValues()[0],
      DB_SCHEMA_SPECS[name]);
    if(issues.length)missing.push(name+'（列不一致）');
    else if(validatedSheets)validatedSheets[k]=sh;
  });
  return {ready:!missing.length,missing};
}
function quoteRowObject_(model,values){
  const out={};QUOTE_MODEL[model].keys.forEach((k,i)=>out[k]=values[i]==null?'':values[i]);
  return out;
}
function quoteRowArray_(model,data){
  return QUOTE_MODEL[model].keys.map(k=>data[k]==null?'':data[k]);
}
function quoteRows_(model,validatedSheet){
  const definition=QUOTE_MODEL[model];
  if(!definition)throw new Error('見積データ種別が不正です。');
  const sh=validatedSheet||quoteModelSheet_(model),length=definition.keys.length,last=sh.getLastRow();
  if(last<2)return [];
  return sh.getRange(2,1,last-1,length).getDisplayValues().map(r=>quoteRowObject_(model,r));
}
function quoteFind_(model,id,key='id'){
  const sh=quoteModelSheet_(model),last=sh.getLastRow(),width=QUOTE_MODEL[model].keys.length;
  if(last<2)throw new Error('指定した見積が存在しません。');
  const idx=QUOTE_MODEL[model].keys.indexOf(key),col=idx+1;
  const values=sh.getRange(2,col,last-1,1).getDisplayValues();
  const found=values.findIndex(r=>String(r[0])===String(id));
  if(found<0)throw new Error('指定した見積が存在しません。');
  const row=sh.getRange(found+2,1,1,width).getDisplayValues()[0];
  return {sheet:sh,rowNumber:found+2,data:quoteRowObject_(model,row)};
}
function quoteText_(value,label,limit,required){
  const out=safeSheetText_(value,limit||150).trim();
  if(required&&!out)throw new Error(label+'を入力してください。');
  return out;
}
function quoteKey_(value){
  const s=String(value||'');
  if(!/^[A-Za-z0-9_-]{12,100}$/.test(s))throw new Error('送信識別子が不正です。');
  return s;
}
function quoteCode_(value){
  const s=String(value||'').trim().toUpperCase();
  if(!/^[A-Z]{2}-\d{4}$/.test(s))throw new Error('ベンダーコードが不正です。');
  return s;
}
function quoteMoney_(value,label,negative){
  const s=String(value==null?'':value).replace(/,/g,'').trim();
  if(!/^-?\d{1,10}$/.test(s))throw new Error(label+'は円単位で入力してください。');
  const n=Number(s);
  if(!Number.isSafeInteger(n)||Math.abs(n)>9999999999||(!negative&&n<0))
    throw new Error(label+'が許容範囲を超えています。');
  return n;
}
function quoteQuantity_(value){
  const text=String(value==null?'':value).trim(),n=Number(text);
  if(!/^\d+(?:\.\d{1,3})?$/.test(text)||!Number.isFinite(n)||n<=0||n>100000)
    throw new Error('数量は0より大きい数値で小数第3位まで入力してください。');
  return n;
}
function quoteNormalize_(payload){
  const p=payload||{};
  const vendorCode=quoteCode_(p.vendorCode);
  const vendor=quoteRows_('vendor').find(v=>v.code===vendorCode&&v.active==='有効');
  if(!vendor)throw new Error('有効な取引先を選択してください。');
  const source=Array.isArray(p.lines)?p.lines:[];
  if(source.length<1||source.length>QUOTE_MAX_LINES)throw new Error('明細は1〜21行で入力してください。');
  const lines=source.map((row,i)=>{
    const description=quoteText_(row.description,'品名',240,true);
    const noteOnly=(row.noteOnly===true||row.noteOnly==='true');
    const quantity=noteOnly?0:quoteQuantity_(row.quantity);
    const price=noteOnly?0:quoteMoney_(row.price,'単価',true);
    const amount=noteOnly?0:Math.round(quantity*price);
    if(!Number.isSafeInteger(amount)||Math.abs(amount)>9999999999)throw new Error('明細金額が上限を超えています。');
    return {position:i+1,description,quantity,unit:noteOnly?'':quoteText_(row.unit,'単位',20,true),price,amount};
  });
  const subtotal=lines.reduce((sum,row)=>sum+row.amount,0);
  if(!Number.isSafeInteger(subtotal)||subtotal<0||subtotal>999999999999)
    throw new Error('見積の小計は0円以上である必要があります。');
  const rate=p.taxRate==null||p.taxRate===''?10:Number(p.taxRate);
  if(rate!==10)throw new Error('現在のテンプレートでは税率10%のみ対応しています。');
  const taxAmount=Math.round(subtotal*0.1);
  const total=subtotal+taxAmount;
  if(total<=0)throw new Error('正式な見積の合計は1円以上にしてください。');
  return {vendorCode,vendorName:vendor.name,vendorInvoice:vendor.invoice,
    vendorAddress:vendor.address,quoteDate:financeDate_(p.quoteDate,'見積日',true),
    subject:quoteText_(p.subject,'件名',120,false),
    delivery:quoteText_(p.delivery,'納期',80,false)||'ご相談',
    payment:quoteText_(p.payment,'支払条件',80,false)||'銀行振込',
    expires:quoteText_(p.expires,'有効期限',80,false)||'見積日から1か月',
    contact:quoteText_(p.contact,'担当者',100,false),
    note:quoteText_(p.note,'備考',850,false),
    bank:quoteText_(p.bank,'振込先',200,false),
    taxRate:10,subtotal,taxAmount,total,lines};
}
function quoteHeaderAndLines_(header){
  const rows=quoteRows_('detail').filter(x=>x.quoteId===header.id)
    .map(x=>({position:Number(String(x.position).replace(/,/g,'')),description:x.description,
      quantity:Number(String(x.quantity).replace(/,/g,'')),unit:x.unit,
      price:Number(String(x.price).replace(/,/g,'')),amount:Number(String(x.amount).replace(/,/g,'')),
      noteOnly:!Number(String(x.quantity).replace(/,/g,''))}));
  rows.sort((a,b)=>a.position-b.position);
  return {header,lines:rows};
}
function quoteVisible_(user,header){
  return quoteIsAdmin_(user)||String(header.ownerId)===String(user.employeeId);
}
function quoteForUser_(user,header){
  if(!quoteVisible_(user,header))throw new Error('この見積を閲覧する権限がありません。');
  return header;
}
function getQuoteWorkspace(sessionToken){
  const started=Date.now(),user=quoteUser_(sessionToken),validated={};
  const status=quoteStorageStatus_(validated);
  const docsReady=typeof documentStorageStatus_==='function'&&documentStorageStatus_().ready;
  if(!status.ready)return {setupRequired:true,missing:status.missing,vendors:[],quotes:[],relatedDocs:[],documentsSetupRequired:!docsReady,canConfigure:quoteIsAdmin_(user)};
  // These sheet handles were validated inside this same request. Never cache across logins or executions.
  const vendors=quoteRows_('vendor',validated.vendor).filter(x=>x.active==='有効')
    .map(({code,name,invoice,address,industry})=>({code,name,invoice,address,industry}));
  const headers=quoteRows_('header',validated.header).filter(h=>quoteVisible_(user,h));
  headers.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const codes=quoteRows_('sequence',validated.sequence).filter(x=>x.verified==='確認済').map(x=>x.vendorCode);
  const result={setupRequired:false,vendors,quotes:headers.slice(0,200),
    relatedDocs:docsReady?documentListForUser_(user,true):[],documentsSetupRequired:!docsReady,
    sequencesReady:codes,canConfigure:quoteIsAdmin_(user),
    total:headers.length,displayLimit:200};
  if(typeof logPerformance_==='function')
    logPerformance_('quoteWorkspace',started,1200,{quoteCount:result.quotes.length,documentCount:result.relatedDocs.length,vendorCount:vendors.length});
  return result;
}
function getQuote(sessionToken,id){
  const user=quoteUser_(sessionToken),header=quoteForUser_(user,quoteFind_('header',id).data);
  return quoteHeaderAndLines_(header);
}
function quoteReplaceDetails_(id,lines){
  const sh=quoteModelSheet_('detail'),width=QUOTE_MODEL.detail.keys.length,last=sh.getLastRow();
  const started=Date.now(),matched=[];
  // Scan only the ID column. Keep unrelated quotes untouched even when rows are interleaved.
  if(last>1){
    sh.getRange(2,1,last-1,1).getDisplayValues().forEach((row,i)=>{
      if(String(row[0])===String(id))matched.push(i+2);
    });
  }
  const rows=lines.map(x=>quoteRowArray_('detail',Object.assign({quoteId:id},x)));
  const kept=Math.min(matched.length,rows.length);
  let writeBlocks=0,deleteBlocks=0;
  // Reuse existing positions instead of deleting and appending every row on every save.
  for(let i=0;i<kept;){
    let j=i+1;
    while(j<kept&&matched[j]===matched[j-1]+1)j++;
    sh.getRange(matched[i],1,j-i,width).setValues(rows.slice(i,j));
    writeBlocks++;i=j;
  }
  // Delete only the surplus owned rows, in reverse contiguous blocks so positions remain valid.
  const surplus=matched.slice(kept);
  for(let i=surplus.length-1;i>=0;){
    const endRow=surplus[i];let firstRow=endRow;
    while(i>0&&surplus[i-1]===firstRow-1){i--;firstRow--;}
    sh.deleteRows(firstRow,endRow-firstRow+1);
    deleteBlocks++;i--;
  }
  // Growing a quote adds only the additional rows in one batch.
  if(rows.length>kept){
    sh.getRange(sh.getLastRow()+1,1,rows.length-kept,width).setValues(rows.slice(kept));
    writeBlocks++;
  }
  if(typeof logPerformance_==='function')
    logPerformance_('quoteDetailSave',started,800,{previous:matched.length,current:rows.length,writeBlocks,deleteBlocks});
}
function quoteUniqueRequest_(rows,key,user){
  const matches=rows.filter(x=>String(x.requestKey).split(':')[0]===key);
  if(matches.length>1)throw new Error('送信識別子の記録が重複しています。管理者に確認してください。');
  const existing=matches[0];
  // New tokens bind the actor as well as the intended content. Legacy tokens
  // have no actor fingerprint, so retain their original owner-only retry rule.
  if(existing&&!String(existing.requestKey).includes(':')&&String(existing.ownerId)!==String(user.employeeId))
    throw new Error('送信識別子が他の申請と重複しています。');
  return existing||null;
}
function quoteHash_(text){
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8)
    .map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
}
function quoteRequestToken_(key,user,model){
  return key+':'+quoteHash_(JSON.stringify([String(user.employeeId),model]));
}
function quoteDraftMatches_(record,model){
  const numeric=['taxRate','subtotal','taxAmount','total'];
  const number=v=>Number(String(v).replace(/,/g,''));
  // Sheets consumes one leading apostrophe used to store literal text. Accept
  // its displayed form as well as the unformatted value used by adapters.
  const textMatches=(got,want)=>String(got??'')===String(want)||String(got??'')===String(want).replace(/^'/,'');
  if(Object.keys(model).some(k=>k!=='lines'&&(numeric.includes(k)
    ?number(record.header[k])!==model[k]:!textMatches(record.header[k],model[k]))))return false;
  const keys=['position','description','quantity','unit','price','amount'];
  return record.lines.length===model.lines.length&&record.lines.every((row,i)=>keys.every(k=>
    ['position','quantity','price','amount'].includes(k)?number(row[k])===model.lines[i][k]:textMatches(row[k],model.lines[i][k])));
}
function quoteAssertIntegrity_(record){
  const h=record.header,lines=record.lines;
  const number=v=>Number(String(v).replace(/,/g,''));
  const bad=()=>{throw new Error('見積のヘッダーと明細が一致しません。下書きを確認して保存し直してください。');};
  if(!lines.length||lines.length>QUOTE_MAX_LINES)bad();
  let subtotal=0;
  lines.forEach((r,i)=>{
    const quantity=number(r.quantity),price=number(r.price),amount=number(r.amount);
    if(number(r.position)!==i+1||!String(r.description||'').trim()||!Number.isFinite(quantity)||quantity<0||quantity>100000||
      !/^\d+(?:\.\d{1,3})?$/.test(String(quantity))||!Number.isSafeInteger(price)||Math.abs(price)>9999999999||
      !Number.isSafeInteger(amount)||amount!==Math.round(quantity*price)||Math.abs(amount)>9999999999||
      (quantity>0&&!String(r.unit||'').trim())||(quantity===0&&(price!==0||amount!==0)))bad();
    subtotal+=amount;
  });
  const tax=Math.round(subtotal*0.1);
  if(!Number.isSafeInteger(subtotal)||subtotal<0||subtotal>999999999999||number(h.taxRate)!==10||
    number(h.subtotal)!==subtotal||number(h.taxAmount)!==tax||number(h.total)!==subtotal+tax||subtotal+tax<=0)bad();
}
function quoteAuditDraftSave_(user,header,mode){
  try{return appendAudit_({employeeId:user.employeeId,employeeName:user.name,operation:mode==='REPLAY'?'見積下書き保存確認':'見積下書き保存',
    target:'見積',targetId:header.id,before:auditJson_({revision:Number(header.revision)-1}),
    after:auditJson_({revision:Number(header.revision),total:Number(header.total)}),
    source:'WEB',result:'SUCCESS',note:mode==='RECOVERED'?'途中保存から復旧':mode==='REPLAY'?'同一送信の完了内容を再確認':''})===true;
  }catch(_){return false;}
}
function saveQuoteDraft(sessionToken,payload){
  const user=quoteUser_(sessionToken),p=payload||{};
  const key=quoteKey_(p.requestKey),model=quoteNormalize_(p);
  return withScriptLock_(function(){
    const sh=quoteModelSheet_('header'),rows=quoteRows_('header');
    const duplicate=quoteUniqueRequest_(rows,key,user),token=quoteRequestToken_(key,user,model);
    if(duplicate){
      if((p.id&&String(p.id)!==String(duplicate.id))||
        (String(duplicate.requestKey).includes(':')&&duplicate.requestKey!==token))
        throw new Error('送信識別子が他の内容と重複しています。最新の見積を確認してください。');
      quoteForUser_(user,duplicate);
      if(duplicate.status==='保存処理中'){
        if(duplicate.requestKey!==token)throw new Error('保存途中の内容を確認してください。');
        const pending=quoteFind_('header',duplicate.id);
        if(!quoteDraftMatches_({header:pending.data,lines:model.lines},model))
          throw new Error('保存途中の内容が送信した内容と一致しません。管理者に確認してください。');
        quoteReplaceDetails_(duplicate.id,model.lines);
        quoteAssertIntegrity_(quoteHeaderAndLines_(pending.data));
        pending.data.status='下書き';pending.data.updatedAt=quoteNow_();
        pending.sheet.getRange(pending.rowNumber,1,1,QUOTE_MODEL.header.keys.length)
          .setValues([quoteRowArray_('header',pending.data)]);
        const auditRecorded=quoteAuditDraftSave_(user,pending.data,'RECOVERED');
        return {ok:true,id:duplicate.id,status:'下書き',revision:Number(duplicate.revision),duplicate:false,recovered:true,auditRecorded};
      }
      const record=quoteHeaderAndLines_(duplicate);
      if(!quoteDraftMatches_(record,model))throw new Error('送信識別子が他の内容と重複しています。最新の見積を確認してください。');
      quoteAssertIntegrity_(record);
      const auditRecorded=quoteAuditDraftSave_(user,duplicate,'REPLAY');
      return {ok:true,id:duplicate.id,status:duplicate.status,revision:Number(duplicate.revision),duplicate:true,auditRecorded};
    }
    // A delayed original create retry must not create another draft after a
    // later edit has replaced its latest requestKey. Existing IDs stay intact.
    const now=quoteNow_(),id=p.id?String(p.id):'QUOTE-'+quoteHash_(JSON.stringify([String(user.employeeId),key]));
    if(!p.id&&rows.some(h=>String(h.id)===id))
      throw new Error('この下書きはその後更新されています。書類一覧から最新の見積を開いてください。');
    let header,existing=null,at=null;
    if(p.id){
      at=quoteFind_('header',id);
      existing=quoteForUser_(user,at.data);
      if(!['下書き','保存処理中'].includes(existing.status))throw new Error('発行済みまたは発行中の見積は編集できません。複製して新しい見積を作成してください。');
      if(Number(existing.revision)!==Number(p.revision))throw new Error('別の画面で更新されています。最新の見積を読み込んでください。');
    }
    header=Object.assign({},existing||{},{id,createdAt:existing?existing.createdAt:now,
      updatedAt:now,ownerId:existing?existing.ownerId:user.employeeId,
      ownerName:existing?existing.ownerName:user.name,status:'保存処理中',
      number:'',issuedAt:'',revision:existing?Number(existing.revision)+1:1,
      pdfFileId:'',xlsxFileId:'',requestKey:token},model);
    delete header.lines;
    const row=quoteRowArray_('header',header);
    if(at)at.sheet.getRange(at.rowNumber,1,1,row.length).setValues([row]);
    else sh.appendRow(row);
    quoteReplaceDetails_(id,model.lines);
    quoteAssertIntegrity_(quoteHeaderAndLines_(header));
    header.status='下書き';header.updatedAt=quoteNow_();
    const saved=at||quoteFind_('header',id);
    saved.sheet.getRange(saved.rowNumber,1,1,QUOTE_MODEL.header.keys.length)
      .setValues([quoteRowArray_('header',header)]);
    const auditRecorded=quoteAuditDraftSave_(user,header,'SAVE');
    return {ok:true,id,status:header.status,revision:header.revision,duplicate:false,auditRecorded};
  },30000);
}
function getQuoteDocument(sessionToken,id,format){
  const e=quoteUser_(sessionToken),h=quoteForUser_(e,quoteFind_('header',id).data);
  if(h.status!=='発行済')throw new Error('正式発行が完了していません。');
  if(format!=='pdf'&&format!=='xlsx')throw new Error('ファイル形式が不正です。');
  const fileId=format==='pdf'?h.pdfFileId:h.xlsxFileId;
  if(!fileId)throw new Error('ファイルが保存されていません。');
  const file=DriveApp.getFileById(fileId);
  return {name:file.getName(),mimeType:file.getMimeType(),
    base64:Utilities.base64Encode(file.getBlob().getBytes())};
}
function importQuoteVendors(sessionToken,rows){
  const admin=quoteNeedAdmin_(sessionToken);
  if(!Array.isArray(rows)||!rows.length||rows.length>150)throw new Error('取引先は1～150件で登録してください。');
  const cleaned=rows.map(v=>({
    code:quoteCode_(v.code),name:quoteText_(v.name,'取引先名',140,true),
    invoice:quoteText_(v.invoice,'インボイス番号',24,false),
    address:quoteText_(v.address,'所在地',220,false),
    industry:quoteText_(v.industry,'業種',75,false),active:'有効',updatedAt:quoteNow_()
  }));
  if(new Set(cleaned.map(x=>x.code)).size!==cleaned.length)
    throw new Error('ベンダーコードが入力内で重複しています。');
  return withScriptLock_(function(){
    const vendor=quoteModelSheet_('vendor'),sequence=quoteModelSheet_('sequence');
    const registered=quoteRows_('vendor'),byCode={};registered.forEach(x=>{byCode[x.code]=x;});
    const seq=quoteRows_('sequence'),seqCodes=new Set(seq.map(x=>x.vendorCode));
    let created=0,updated=0;
    cleaned.forEach(record=>{
      if(byCode[record.code]){
        const index=registered.findIndex(x=>x.code===record.code);
        const row=Object.assign({},byCode[record.code],record);
        vendor.getRange(index+2,1,1,QUOTE_MODEL.vendor.keys.length)
          .setValues([quoteRowArray_('vendor',row)]);updated++;
      }else{
        vendor.appendRow(quoteRowArray_('vendor',record));created++;
      }
      if(!seqCodes.has(record.code)){
        sequence.appendRow(quoteRowArray_('sequence',{vendorCode:record.code,lastNumber:0,
          verified:'未確認',updatedAt:quoteNow_(),updatedBy:admin.employeeId}));
        seqCodes.add(record.code);
      }
    });
    appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,
      operation:'見積取引先インポート',target:'見積取引先',targetId:'bulk',
      before:'',after:auditJson_({created,updated}),source:'WEB',result:'SUCCESS',note:'採番設定は別操作'});
    return {ok:true,created,updated,numberingNeedsReview:true};
  },30000);
}
function configureQuoteSequence(sessionToken,vendorCode,lastIssued){
  const admin=quoteNeedAdmin_(sessionToken),code=quoteCode_(vendorCode);
  const count=Number(lastIssued);
  if(!Number.isInteger(count)||count<0||count>9998)throw new Error('過去に発行した最大の末尾番号（0～9998）を入力してください。');
  return withScriptLock_(function(){
    const record=quoteFind_('sequence',code,'vendorCode'),current=Number(record.data.lastNumber);
    if(count<current)throw new Error('現在の採番番号より小さい数字には設定できません。');
    const issued=quoteRows_('header').filter(h=>h.vendorCode===code&&h.number)
      .reduce((max,h)=>Math.max(max,Number(h.number.slice(-4))||0),0);
    if(count<issued)throw new Error('すでに発行済みの番号より小さい値には変更できません。');
    const row=Object.assign({},record.data,{lastNumber:count,verified:'確認済',
      updatedAt:quoteNow_(),updatedBy:admin.employeeId});
    record.sheet.getRange(record.rowNumber,1,1,QUOTE_MODEL.sequence.keys.length)
      .setValues([quoteRowArray_('sequence',row)]);
    appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation:'見積採番確認',
      target:'見積採番',targetId:code,before:auditJson_({lastNumber:current}),
      after:auditJson_({lastNumber:count}),source:'WEB',result:'SUCCESS',note:'既存帳票との重複確認を管理者が実施'});
    return {ok:true,vendorCode:code,lastNumber:count};
  },30000);
}


/* FM WORKS: related invoice, delivery and receipt documents.
   Only immutable issued quotations can be converted; no quote format mutation. */
const DOCUMENT_TYPES=Object.freeze({invoice:{label:'請求書',prefix:'INV'},delivery:{label:'納品書',prefix:'DEL'},receipt:{label:'領収書',prefix:'REC'}});
const DOCUMENT_KEYS=['id','kind','quoteId','requestKey','ownerId','ownerName','vendorCode','vendorName','vendorAddress','vendorInvoice','subject','quoteDate','documentDate','dueDate','paidDate','delivery','payment','expires','contact','note','bank','subtotal','taxAmount','total','linesJson','status','number','issuedAt','pdfFileId','xlsxFileId','updatedAt','confirmedBy'];
function documentStorageStatus_(){const names=['関連書類','関連書類採番'],missing=[];names.forEach(name=>{const sh=getDb_().getSheetByName(name),headers=DB_SCHEMA_SPECS[name];if(!sh||schemaHeaderIssues_(sh.getRange(1,1,1,headers.length).getDisplayValues()[0],headers).length)missing.push(name);});return {ready:!missing.length,missing};}
function documentSheet_(name){const sh=getDb_().getSheetByName(name),spec=DB_SCHEMA_SPECS[name];if(!sh||schemaHeaderIssues_(sh.getRange(1,1,1,spec.length).getDisplayValues()[0],spec).length)throw new Error('関連書類のDB更新が必要です。管理者がバックアップ付きDB更新を実施してください。');return sh;}
function documentObject_(values){const o={};DOCUMENT_KEYS.forEach((key,i)=>o[key]=values[i]==null?'':values[i]);return o;}
function documentRows_(){const sh=documentSheet_('関連書類'),last=sh.getLastRow();return last<2?[]:sh.getRange(2,1,last-1,DOCUMENT_KEYS.length).getDisplayValues().map(documentObject_);}
function documentFind_(id){const sh=documentSheet_('関連書類'),last=sh.getLastRow();if(last<2)throw new Error('書類が見つかりません。');const found=sh.getRange(2,1,last-1,1).createTextFinder(String(id)).matchEntireCell(true).findNext();if(!found)throw new Error('書類が見つかりません。');const rowNumber=found.getRow(),raw=sh.getRange(rowNumber,1,1,DOCUMENT_KEYS.length).getDisplayValues()[0];if(raw[0]!==id)throw new Error('書類が移動されました。もう一度お試しください。');return {sheet:sh,rowNumber,record:documentObject_(raw)};}
function documentForUser_(user,record){if(!quoteIsAdmin_(user)&&String(record.ownerId)!==String(user.employeeId))throw new Error('この書類の閲覧権限がありません。');return record;}
function documentListForUser_(user,storageAlreadyValidated){
  if(!storageAlreadyValidated&&!documentStorageStatus_().ready)return [];
  return documentRows_().filter(x=>quoteIsAdmin_(user)||x.ownerId===user.employeeId)
    .sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,250)
    .map(x=>{const {linesJson,...y}=x;return y;});
}
function documentSnapshot_(record){let lines;try{lines=JSON.parse(record.linesJson);}catch(_){throw new Error('明細の読み込みに失敗しました。');}if(!Array.isArray(lines)||!lines.length||lines.length>QUOTE_MAX_LINES)throw new Error('明細の保存内容が不正です。');return {header:record,lines};}
function getRelatedDocument(sessionToken,id){const user=quoteUser_(sessionToken);return documentSnapshot_(documentForUser_(user,documentFind_(String(id)).record));}
