/*
 * FM WORKS v0.14.0 - company estimates, accessible to all authenticated staff.
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
function quoteStorageStatus_(){
  const missing=[];
  Object.keys(QUOTE_MODEL).forEach(k=>{
    const name=QUOTE_MODEL[k].sheet,sh=getDb_().getSheetByName(name);
    if(!sh){missing.push(name);return;}
    if(schemaHeaderIssues_(sh.getRange(1,1,1,QUOTE_MODEL[k].keys.length).getDisplayValues()[0],
          DB_SCHEMA_SPECS[name]).length)missing.push(name+'（列不一致）');
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
function quoteRows_(model){
  const sh=quoteModelSheet_(model),length=QUOTE_MODEL[model].keys.length,last=sh.getLastRow();
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
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0||n>100000||Math.round(n*1000)!==n*1000)
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
  const user=quoteUser_(sessionToken),status=quoteStorageStatus_();
  const docsReady=typeof documentStorageStatus_==='function'&&documentStorageStatus_().ready;
  if(!status.ready)return {setupRequired:true,missing:status.missing,vendors:[],quotes:[],relatedDocs:[],documentsSetupRequired:!docsReady,canConfigure:quoteIsAdmin_(user)};
  const vendors=quoteRows_('vendor').filter(x=>x.active==='有効')
    .map(({code,name,invoice,address,industry})=>({code,name,invoice,address,industry}));
  const headers=quoteRows_('header').filter(h=>quoteVisible_(user,h));
  headers.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const codes=quoteRows_('sequence').filter(x=>x.verified==='確認済').map(x=>x.vendorCode);
  return {setupRequired:false,vendors,quotes:headers.slice(0,200),
    relatedDocs:docsReady?documentListForUser_(user):[],documentsSetupRequired:!docsReady,
    sequencesReady:codes,canConfigure:quoteIsAdmin_(user),
    total:headers.length,displayLimit:200};
}
function getQuote(sessionToken,id){
  const user=quoteUser_(sessionToken),header=quoteForUser_(user,quoteFind_('header',id).data);
  return quoteHeaderAndLines_(header);
}
function quoteReplaceDetails_(id,lines){
  const sh=quoteModelSheet_('detail'),model=QUOTE_MODEL.detail,last=sh.getLastRow();
  if(last>1){
    const all=sh.getRange(2,1,last-1,model.keys.length).getDisplayValues();
    for(let i=all.length-1;i>=0;i--){
      if(all[i][0]===id)sh.deleteRow(i+2);
    }
  }
  if(lines.length){
    const start=sh.getLastRow()+1;
    sh.getRange(start,1,lines.length,model.keys.length).setValues(lines.map(x=>quoteRowArray_('detail',Object.assign({quoteId:id},x))));
  }
}
function quoteUniqueRequest_(rows,key,user){
  const existing=rows.find(x=>x.requestKey===key);
  if(existing&&String(existing.ownerId)!==String(user.employeeId))
    throw new Error('送信識別子が他の申請と重複しています。');
  return existing||null;
}
function saveQuoteDraft(sessionToken,payload){
  const user=quoteUser_(sessionToken),p=payload||{};
  const key=quoteKey_(p.requestKey),model=quoteNormalize_(p);
  return withScriptLock_(function(){
    const sh=quoteModelSheet_('header'),rows=quoteRows_('header');
    const duplicate=quoteUniqueRequest_(rows,key,user);
    if(duplicate)return {ok:true,id:duplicate.id,status:duplicate.status,revision:Number(duplicate.revision),duplicate:true};
    const now=quoteNow_(),id=p.id?String(p.id):Utilities.getUuid();
    let header,existing=null,at=null;
    if(p.id){
      at=quoteFind_('header',id);
      existing=quoteForUser_(user,at.data);
      if(existing.status!=='下書き')throw new Error('発行済みまたは発行中の見積は編集できません。複製して新しい見積を作成してください。');
      if(Number(existing.revision)!==Number(p.revision))throw new Error('別の画面で更新されています。最新の見積を読み込んでください。');
    }
    header=Object.assign({},existing||{},{id,createdAt:existing?existing.createdAt:now,
      updatedAt:now,ownerId:existing?existing.ownerId:user.employeeId,
      ownerName:existing?existing.ownerName:user.name,status:'下書き',
      number:'',issuedAt:'',revision:existing?Number(existing.revision)+1:1,
      pdfFileId:'',xlsxFileId:'',requestKey:key},model);
    delete header.lines;
    const row=quoteRowArray_('header',header);
    if(at)at.sheet.getRange(at.rowNumber,1,1,row.length).setValues([row]);
    else sh.appendRow(row);
    quoteReplaceDetails_(id,model.lines);
    appendAudit_({employeeId:user.employeeId,employeeName:user.name,operation:'見積下書き保存',
      target:'見積',targetId:id,before:auditJson_({revision:existing&&existing.revision||0}),
      after:auditJson_({revision:header.revision,total:header.total}),source:'WEB',result:'SUCCESS',note:''});
    return {ok:true,id,status:header.status,revision:header.revision,duplicate:false};
  },30000);
}
function quoteNumberFor_(code,next){
  if(!Number.isInteger(next)||next<1||next>9999)throw new Error('見積番号の4桁採番枠を使い切りました。管理者に連絡してください。');
  return code+'-'+String(next).padStart(4,'0');
}
function issueQuote(sessionToken,id,revision){
  const user=quoteUser_(sessionToken);
  const reserve=withScriptLock_(function(){
    const found=quoteFind_('header',id),h=quoteForUser_(user,found.data);
    if(h.status==='発行済'&&h.pdfFileId&&h.xlsxFileId)
      return {already:true,header:h};
    const stale=h.status==='発行処理中'&&
      (Date.now()-new Date(String(h.updatedAt).replace(' ','T')+'+09:00').getTime())>900000;
    if(h.status!=='下書き'&&h.status!=='出力失敗'&&!stale)
      throw new Error('現在この見積は発行できません。しばらく待って再確認してください。');
    if(Number(h.revision)!==Number(revision))throw new Error('保存内容が更新されています。再読込してください。');
    let number=h.number||'';
    if(!number){
      const seq=quoteFind_('sequence',h.vendorCode,'vendorCode'),current=seq.data;
      if(current.verified!=='確認済')throw new Error('この取引先の既存見積番号が未確認です。管理者が採番開始番号を設定してください。');
      const next=Number(current.lastNumber)+1;
      number=quoteNumberFor_(h.vendorCode,next);
      const used=quoteRows_('header').some(x=>x.number===number);
      if(used)throw new Error('採番済みの見積番号と重複しています。');
      current.lastNumber=next;current.updatedAt=quoteNow_();current.updatedBy=user.employeeId;
      seq.sheet.getRange(seq.rowNumber,1,1,QUOTE_MODEL.sequence.keys.length)
        .setValues([quoteRowArray_('sequence',current)]);
    }
    h.number=number;h.status='発行処理中';h.updatedAt=quoteNow_();
    found.sheet.getRange(found.rowNumber,1,1,QUOTE_MODEL.header.keys.length)
      .setValues([quoteRowArray_('header',h)]);
    return {already:false,header:h};
  },30000);
  if(reserve.already)return {ok:true,issued:true,number:reserve.header.number,id};
  let outputs;
  try{
    const packageData=quoteHeaderAndLines_(reserve.header);
    outputs=quoteCreateFiles_(packageData);
  }catch(e){
    withScriptLock_(function(){
      const current=quoteFind_('header',id),h=current.data;
      if(h.status==='発行処理中'&&h.number===reserve.header.number){
        h.status='出力失敗';h.updatedAt=quoteNow_();
        current.sheet.getRange(current.rowNumber,1,1,QUOTE_MODEL.header.keys.length)
          .setValues([quoteRowArray_('header',h)]);
      }
    },30000);
    throw new Error('PDF・Excelの生成に失敗しました。採番は保持されています。同じ見積から再試行してください。詳細：'+String(e.message||e));
  }
  return withScriptLock_(function(){
    const current=quoteFind_('header',id),h=current.data;
    if(h.number!==reserve.header.number||h.status!=='発行処理中')
      throw new Error('発行状態が変更されています。管理者にご連絡ください。');
    h.status='発行済';h.issuedAt=quoteNow_();h.updatedAt=h.issuedAt;
    h.pdfFileId=outputs.pdfFileId;h.xlsxFileId=outputs.xlsxFileId;
    current.sheet.getRange(current.rowNumber,1,1,QUOTE_MODEL.header.keys.length)
      .setValues([quoteRowArray_('header',h)]);
    appendAudit_({employeeId:user.employeeId,employeeName:user.name,operation:'見積正式発行',
      target:'見積',targetId:id,before:auditJson_({status:reserve.header.status}),
      after:auditJson_({number:h.number,total:h.total,status:h.status}),
      source:'WEB',result:'SUCCESS',note:''});
    return {ok:true,issued:true,id,number:h.number};
  },30000);
}
function quoteFileFolder_(){
  const rootName='FM WORKS 正式見積書';
  const matches=DriveApp.getFoldersByName(rootName);
  return matches.hasNext()?matches.next():DriveApp.createFolder(rootName);
}
function quoteCreateFiles_(record){
  const h=record.header,ss=SpreadsheetApp.create('FM_WORKS_OUTPUT_'+h.id);
  const tempId=ss.getId(),sh=ss.getSheets()[0];
  const folder=quoteFileFolder_(),baseName=h.number+'_見積書';
  let pdfFile=null,xlsxFile=null;
  try{
    sh.setName('見積書');
    quotePaintSheet_(sh,h,record.lines);
    SpreadsheetApp.flush();
    const base='https://docs.google.com/spreadsheets/d/'+tempId+'/export?';
    const token=ScriptApp.getOAuthToken();
    const pdfUrl=base+'format=pdf&size=7&portrait=true&fitw=true&gridlines=false&sheetnames=false&printtitle=false&fzr=false&top_margin=0.35&bottom_margin=0.35&left_margin=0.35&right_margin=0.35&gid='+sh.getSheetId();
    const xlsxUrl=base+'format=xlsx';
    const fetch=function(url,expectedStart,mime){
      const response=UrlFetchApp.fetch(url,{method:'get',headers:{Authorization:'Bearer '+token},muteHttpExceptions:true});
      if(response.getResponseCode()!==200)throw new Error('Google Sheetsの帳票出力に失敗しました（HTTP '+response.getResponseCode()+'）');
      const bytes=response.getContent();
      if(!bytes||bytes.length<100||bytes[0]!==expectedStart[0]||bytes[1]!==expectedStart[1])
        throw new Error('帳票ファイル形式が正しくありません。');
      return response.getBlob().setContentType(mime);
    };
    pdfFile=folder.createFile(fetch(pdfUrl,[37,80],'application/pdf').setName(baseName+'.pdf'));
    xlsxFile=folder.createFile(fetch(xlsxUrl,[80,75],'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setName(baseName+'.xlsx'));
    return {pdfFileId:pdfFile.getId(),xlsxFileId:xlsxFile.getId()};
  }catch(e){
    if(pdfFile)pdfFile.setTrashed(true);
    if(xlsxFile)xlsxFile.setTrashed(true);
    throw e;
  }finally{
    DriveApp.getFileById(tempId).setTrashed(true);
  }
}
function quotePaintSheet_(sh,h,lines){
  sh.setHiddenGridlines(true);
  sh.setColumnWidths(1,9,92);
  sh.setColumnWidth(1,26);sh.setColumnWidth(2,138);sh.setColumnWidth(3,140);
  sh.setColumnWidth(4,70);sh.setColumnWidth(5,62);sh.setColumnWidth(6,55);
  sh.setColumnWidth(7,92);sh.setColumnWidth(8,96);sh.setColumnWidth(9,113);
  sh.getRange('A1:I49').setFontFamily('Noto Sans JP').setFontSize(10).setVerticalAlignment('middle');
  sh.getRange('A1:I49').setBackground('#ffffff');
  sh.getRange('B1:E2').merge().setValue('見積書').setFontSize(23).setFontColor('#888888');
  sh.getRange('B3:I3').setBackground('#33369a');sh.setRowHeight(3,6);
  sh.getRange('H2:I2').merge().setValue('見積番号：'+h.number).setHorizontalAlignment('right').setFontSize(9);
  sh.getRange('F2:G2').merge().setValue('見積日：'+h.quoteDate).setHorizontalAlignment('right').setFontSize(8);
  sh.getRange('B5:E6').merge().setValue(h.vendorName+' 御中').setFontSize(16).setFontWeight('bold');
  sh.getRange('G5:I5').merge().setValue('Fusion Mind 株式会社').setFontWeight('bold');
  sh.getRange('G6:I6').merge().setValue('〒958-0854').setFontSize(8);
  sh.getRange('G7:I7').merge().setValue('新潟県村上市田端町14-7 きどビル1階').setFontSize(8);
  sh.getRange('B7:E7').merge().setValue(h.vendorAddress||'').setFontSize(9).setWrap(true);
  sh.getRange('B8:E8').merge().setValue('下記の通りお見積もり申し上げます。');
  sh.getRange('B12:E12').merge().setValue('件名：'+(h.subject||'')).setFontWeight('bold').setWrap(true);
  sh.getRange('G8:I8').merge().setValue('登録番号：T2110001038035').setFontSize(8);
  sh.getRange('G9:I9').merge().setValue('TEL：0254-62-7852').setFontSize(8);
  sh.getRange('G10:I10').merge().setValue('FAX：0254-62-7852').setFontSize(8);
  sh.getRange('G11:I11').merge().setValue('E-Mail：t-sakai@fusionmind.co.jp').setFontSize(8);
  sh.getRange('G12:I12').merge().setValue('担当：'+(h.contact||h.ownerName)).setFontSize(8);
  sh.getRange('B9').setValue('納期');sh.getRange('C9:E9').merge().setValue(h.delivery);
  sh.getRange('B10').setValue('支払条件');sh.getRange('C10:E10').merge().setValue(h.payment);
  sh.getRange('B11').setValue('有効期限');sh.getRange('C11:E11').merge().setValue(h.expires);
  
  sh.getRange('B13:I14').setBackground('#efefef');
  sh.getRange('B13:E14').merge().setValue('お見積金額').setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange('F13:H14').merge().setValue(h.total).setNumberFormat('¥#,##0').setFontSize(17).setFontWeight('bold').setHorizontalAlignment('right');
  sh.getRange('I13:I14').merge().setValue('（税込）').setFontSize(10);
  sh.getRange('B16:I16').setValues([['品番・品名','','','','数量','単位','単価','金額']]).setFontColor('#33369a').setFontWeight('bold');
  sh.getRange('B16:E16').merge();
  const start=17,max=QUOTE_MAX_LINES;
  const values=Array.from({length:max},(_,i)=>{
    const line=lines[i];
    if(!line)return ['','','','','','','',''];
    const noteOnly=!Number(line.quantity);
    return [line.description||'','','','',noteOnly?'':Number(line.quantity),
      noteOnly?'':String(line.unit||''),noteOnly?'':Number(line.price),noteOnly?'':Number(line.amount)];
  });
  // One batch write instead of four per-line writes (preserves zero-yen items).
  sh.getRange('B17:I37').setValues(values).setBackground('#f2f2f2');
  sh.getRange('H17:I37').setNumberFormat('¥#,##0;[Red](¥#,##0);¥0');
  sh.setRowHeights(17,21,25);
  for(let i=0;i<max;i++){
    const row=start+i;
    sh.getRange(row,2,1,4).merge();
    if(i%2===1)sh.getRange(row,2,1,8).setBackground('#ffffff');
    if(lines[i]&&String(lines[i].description||'').length>38)sh.setRowHeight(row,40);
  }
  sh.getRange('B17:E37').setWrap(true);
  sh.getRange('G38:H38').merge().setValue('小計');sh.getRange('I38').setValue(Number(h.subtotal));
  sh.getRange('G39:H39').merge().setValue('消費税（10%）');sh.getRange('I39').setValue(Number(h.taxAmount));
  sh.getRange('G40:H40').merge().setValue('合計金額');sh.getRange('I40').setValue(Number(h.total));
  sh.getRange('G38:I40').setNumberFormat('¥#,##0');
  sh.getRange('G40:I40').setBackground('#dcebf9').setFontWeight('bold');
  sh.getRange('B43:I43').setBackground('#33369a');sh.setRowHeight(43,5);
  sh.getRange('B45:I45').merge().setValue(h.note||'いつもご利用いただきありがとうございます。')
    .setWrap(true);
  sh.getRange('B46:I46').merge().setValue('振込先：'+(h.bank||'お見積もり時にご案内します。')).setFontSize(9).setWrap(true);
  sh.getRange('B47:I47').merge().setValue('お振込み手数料は御社ご負担にてお願いいたします。').setFontSize(9);
  sh.getRange('B48:I48').setBackground('#33369a');sh.setRowHeight(48,5);
  sh.getRange('B5:I47').setVerticalAlignment('middle');
  sh.getRange('B16:I16').setBorder(null,null,true,null,null,null,'#33369a',SpreadsheetApp.BorderStyle.SOLID);
  sh.setRowHeight(45,52);sh.setRowHeight(46,30);
  sh.getRange('B1:I48').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sh.getRange('B7:E7').setWrap(true);sh.getRange('B12:E12').setWrap(true);
  sh.getRange('B17:E37').setWrap(true);sh.getRange('B45:I46').setWrap(true);
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
