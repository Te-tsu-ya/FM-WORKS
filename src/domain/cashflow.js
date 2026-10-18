/* November-close annual cash flow. Manual cash-basis inputs; only ADMIN may read or write. */
const CASH_FLOW_SHEET='資金繰り年間';
const CASH_FLOW_FIELDS=['planIn','planOut','actualIn','actualOut'];
function cashFlowYear_(input){
 const raw=String(input==null?'':input).trim(),year=Number(raw);
 if(!/^\d{4}$/.test(raw)||!Number.isInteger(year)||year<2000||year>2100)throw new Error('決算年度を確認してください（2000～2100年）。');
 return year;
}
function cashFlowMonths_(year){
 const y=cashFlowYear_(year),a=[];
 for(let i=0;i<12;i++)a.push(String(i?y:y-1)+'-'+String(i||12).padStart(2,'0'));
 return a;
}
function cashFlowMoney_(value,label,negative,optional){
 if(value===null||value===undefined||String(value).trim()===''){
  if(optional)return null;
  throw new Error(label+'を入力してください。');
 }
 const raw=String(value).trim(),rule=negative?/^-?(0|[1-9]\d{0,11})$/:/^(0|[1-9]\d{0,11})$/;
 if(!rule.test(raw))throw new Error(label+'は整数の円単位で入力してください（上限9999億9999万9999円）。');
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||Math.abs(n)>999999999999)throw new Error(label+'の金額が大きすぎます。');
 return n;
}
function cashFlowMonthsValidate_(year,records){
 const months=cashFlowMonths_(year);
 if(!Array.isArray(records)||records.length!==12)throw new Error('月別データは12か月分必要です。');
 return months.map((month,i)=>{
  const row=records[i];
  if(!row||typeof row!=='object'||Array.isArray(row)||String(row.month||'')!==month)throw new Error('月の並びを確認してください: '+month);
  const result={month};
  CASH_FLOW_FIELDS.forEach(key=>result[key]=cashFlowMoney_(row[key],month+'の'+key,false,true));
  const note=String(row.note==null?'':row.note).replace(/\r\n?/g,'\n').trim();
  if(note.length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(note))throw new Error(month+'の備考は300文字以内にしてください。');
  result.note=note;
  return result;
 });
}
function cashFlowBlank_(year){return cashFlowMonths_(year).map(month=>({month,planIn:null,planOut:null,actualIn:null,actualOut:null,note:''}));}
function cashFlowSummary_(opening,months){
 const totals={planIn:0,planOut:0,actualIn:0,actualOut:0},counts={plan:0,actual:0};
 let plan=opening,actual=opening,forecast=opening,lowest=opening,firstNegative='';
 const rows=months.map(row=>{
  CASH_FLOW_FIELDS.forEach(key=>{if(row[key]!=null)totals[key]+=Number(row[key]);});
  const hp=row.planIn!=null&&row.planOut!=null,ha=row.actualIn!=null&&row.actualOut!=null;
  if(hp)counts.plan++;if(ha)counts.actual++;
  plan=plan!==null&&hp?plan+(row.planIn||0)-(row.planOut||0):null;
  actual=actual!==null&&ha?actual+(row.actualIn||0)-(row.actualOut||0):null;
  forecast=forecast!==null&&(ha||hp)?forecast+(ha?row.actualIn||0:row.planIn||0)-(ha?row.actualOut||0:row.planOut||0):null;
  if(forecast!==null){if(lowest===null||forecast<lowest)lowest=forecast;if(forecast<0&&!firstNegative)firstNegative=row.month;}
  return {month:row.month,planEnd:plan,actualEnd:actual,forecastEnd:forecast,source:ha?'実績':hp?'計画':'未入力'};
 });
 return {months:rows,totals,counts,forecastYearEnd:forecast,lowestForecast:lowest,firstShortage:firstNegative};
}
function cashFlowSheet_(optional){
 const sh=getDb_().getSheetByName(CASH_FLOW_SHEET);
 if(!sh){if(optional)return null;throw new Error('資金繰り表が未作成です。管理者がバックアップ付きDB更新を実行してください。');}
 if(schemaHeaderIssues_(sh.getRange(1,1,1,7).getDisplayValues()[0],DB_SCHEMA_SPECS[CASH_FLOW_SHEET]).length)
  throw new Error('資金繰り表の列名が正しくありません。管理者が確認してください。');
 return sh;
}
function cashFlowRows_(sheet){
 if(!sheet||sheet.getLastRow()<2)return [];
 return sheet.getRange(2,1,sheet.getLastRow()-1,7).getDisplayValues().map((row,i)=>({row,rowNo:i+2})).filter(e=>e.row[0]);
}
function cashFlowSaved_(entry,year){
 if(!entry)return {openingBalance:null,months:cashFlowBlank_(year),revision:0,updatedAt:'',exists:false};
 try{
  const r=entry.row,opening=cashFlowMoney_(String(r[1]).replace(/,/g,''),'期首残高',true,false);
  const months=cashFlowMonthsValidate_(year,JSON.parse(String(r[2]||''))),revision=Number(r[3]);
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('revision');
  return {openingBalance:opening,months,revision,updatedAt:String(r[4]||''),exists:true};
 }catch(_){throw new Error('保存済み資金繰り表を読めません。管理者がデータを確認してください。');}
}
function getCashFlowYear(sessionToken,fiscalYear){
 requireAdminSession_(sessionToken);
 const year=cashFlowYear_(fiscalYear),sheet=cashFlowSheet_(true),empty=cashFlowSaved_(null,year);
 if(!sheet)return {ok:true,setupRequired:true,fiscalYear:year,periodStart:(year-1)+'-12-01',periodEnd:year+'-11-30',record:empty,availableYears:[],summary:cashFlowSummary_(null,empty.months)};
 const rows=cashFlowRows_(sheet),matches=rows.filter(x=>String(x.row[0])===String(year));
 if(matches.length>1)throw new Error('同じ年度のレコードが重複しています。');
 const record=cashFlowSaved_(matches[0]||null,year);
 const years=[...new Set(rows.map(r=>Number(r.row[0])).filter(v=>Number.isInteger(v)&&v>=2000&&v<=2100))].sort((a,b)=>b-a);
 return {ok:true,setupRequired:false,fiscalYear:year,periodStart:(year-1)+'-12-01',periodEnd:year+'-11-30',record,availableYears:years,summary:cashFlowSummary_(record.openingBalance,record.months)};
}
function saveCashFlowYear(sessionToken,payload){
 const admin=requireAdminSession_(sessionToken).employee,p=payload||{},year=cashFlowYear_(p.fiscalYear);
 const opening=cashFlowMoney_(p.openingBalance,'期首残高',true,false);
 const months=cashFlowMonthsValidate_(year,p.months),json=JSON.stringify(months),key=String(p.requestKey||''),expected=Number(p.revision);
 if(!/^[A-Za-z0-9_-]{16,100}$/.test(key))throw new Error('保存識別子が正しくありません。');
 if(!Number.isSafeInteger(expected)||expected<0)throw new Error('改訂番号が正しくありません。');
 return withScriptLock_(function(){
  const sheet=cashFlowSheet_(false),matches=cashFlowRows_(sheet).filter(e=>String(e.row[0])===String(year));
  if(matches.length>1)throw new Error('同じ年度のレコードが重複しています。');
  const current=matches[0]||null,stored=current?cashFlowSaved_(current,year):null;
  if(current&&String(current.row[6])===key){
   if(stored.openingBalance===opening&&JSON.stringify(stored.months)===json)return {ok:true,duplicate:true,revision:stored.revision,auditRecorded:null};
   throw new Error('同じ保存識別子で金額の異なる内容は保存できません。');
  }
  const previous=stored?stored.revision:0;
  if(previous!==expected)throw new Error('別の人が更新しました。再読み込みしてから保存してください。');
  const at=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd HH:mm:ss');
  const next=[String(year),opening,json,previous+1,at,admin.employeeId,key];
  if(current)sheet.getRange(current.rowNo,1,1,7).setValues([next]);else sheet.appendRow(next);
  SpreadsheetApp.flush();
  const observed=sheet.getRange(current?current.rowNo:sheet.getLastRow(),1,1,7).getDisplayValues()[0];
  if(String(observed[0])!==String(year)||Number(String(observed[1]).replace(/,/g,''))!==opening||
     String(observed[2])!==json||Number(observed[3])!==previous+1)
   throw new Error('保存後の読み取り検証に失敗しました。再送する前に再読み込みしてください。');
  let auditRecorded=false;
  try{
   auditRecorded=appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation:'年間資金繰り保存',target:CASH_FLOW_SHEET,targetId:String(year),
    before:auditJson_({revision:previous,openingBalance:stored?stored.openingBalance:null}),
    after:auditJson_({revision:previous+1,openingBalance:opening}),source:'WEB',result:'SUCCESS',note:'11月決算'})===true;
  }catch(err){auditRecorded=false;console.warn('Cash flow saved, audit failed: '+String(err&&err.message||err));}
  return {ok:true,revision:previous+1,duplicate:false,auditRecorded};
 },30000);
}


/* FM WORKS bank cash ledger + scheduled receipts/payments, Nov fiscal close.
 * Every public API is ADMIN-only. Bank CSV is locally parsed and validated before import.
 * The original Excel, accounting workbooks and bank websites are never modified.
 */
const CFP={
 account:{sheet:'資金口座',keys:['id','bank','branch','name','last4','active','revision','updatedAt','editorId','requestKey']},
 plan:{sheet:'資金予定',keys:['id','title','direction','amount','accountId','category','frequency','startMonth','endMonth','day','active','note','revision','updatedAt','editorId','requestKey']},
 tx:{sheet:'資金取引',keys:['id','accountId','date','incoming','outgoing','description','balance','externalId','occurrence','fingerprint','transfer','sourceFile','importedAt','editorId','revision']},
 close:{sheet:'資金月次確定',keys:['fiscalYear','through','revision','updatedAt','editorId','requestKey']}
};
function cfpText_(value,label,limit,required){
 const s=String(value==null?'':value).trim();
 if(required&&!s)throw Error(label+'を入力してください。');
 if(s.length>limit)throw Error(label+'は'+limit+'文字以下にしてください。');
 return safeSheetText_(s,limit);
}
function cfpMonth_(v,label,optional){
 const s=String(v==null?'':v).trim();
 if(optional&&!s)return '';
 const m=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
 if(!m||Number(m[1])<2000||Number(m[1])>2100)throw Error(label+'はYYYY-MMで入力してください。');
 return s;
}
function cfpDate_(input){
 const s=String(input||'').trim().replace(/年|[/.]/g,'-').replace(/月/g,'-').replace(/日/g,'');
 let m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
 if(!m){const c=/^(\d{4})(\d{2})(\d{2})$/.exec(s);if(c)m=c;}
 if(!m)throw Error('取引日を西暦YYYY/MM/DDで入力してください。');
 const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
 if(y<2000||y>2100||month<1||month>12||day<1||day>31||
    new Date(Date.UTC(y,month-1,day)).toISOString().slice(0,10)!==y+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'))
   throw Error('存在しない取引日です。');
 return y+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
}
function cfpSheet_(kind,optional){
 const model=CFP[kind],sh=getDb_().getSheetByName(model.sheet);
 if(!sh){if(optional)return null;throw Error('資金管理用のDBが未設定です。管理者は初回セットアップを実行してください。');}
 const cols=DB_SCHEMA_SPECS[model.sheet];
 if(!cols||schemaHeaderIssues_(sh.getRange(1,1,1,cols.length).getDisplayValues()[0],cols).length)
  throw Error(model.sheet+' のヘッダーが一致しません。');
 return sh;
}
function cfpRows_(kind,optional,checkedSheet){
 const model=CFP[kind],sh=checkedSheet||cfpSheet_(kind,optional);
 if(!sh)return null;
 const last=sh.getLastRow(),cols=model.keys.length;
 return {sheet:sh,rows:last<2?[]:sh.getRange(2,1,last-1,cols).getDisplayValues().map((row,i)=>{
  const item={rowNo:i+2};
  model.keys.forEach((key,j)=>{item[key]=row[j]||'';});
  return item;
 }).filter(x=>x[model.keys[0]])};
}
function cfpStamp_(){return Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd HH:mm:ss');}
function cfpId_(){return Utilities.getUuid();}
function cfpKey_(k){
 const key=String(k||'');
 if(!/^[A-Za-z0-9_-]{12,100}$/.test(key))throw Error('保存識別子が不正です。画面を再読み込みしてください。');
 return key;
}
function cfpRevision_(value){
 const v=Number(value);
 if(!Number.isSafeInteger(v)||v<0)throw Error('改訂番号が不正です。');
 return v;
}
function cfpAudit_(admin,operation,kind,id,before,after){
 try{
  return appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation,target:CFP[kind].sheet,targetId:id,
    before:auditJson_(before),after:auditJson_(after),source:'WEB',result:'SUCCESS',note:'資金繰り'})===true;
 }catch(e){console.warn('CFP audit failed: '+String(e.message||e));return false;}
}
function cfpWrite_(kind,entry,existing,sh){
 const values=CFP[kind].keys.map(key=>entry[key]==null?'':entry[key]);
 if(existing)sh.getRange(existing.rowNo,1,1,values.length).setValues([values]);
 else sh.appendRow(values);
 SpreadsheetApp.flush();
 return values;
}
function cfpUpsert_(kind,admin,p,normalize){
 const values=normalize(p),id=String(p.id||''),key=cfpKey_(p.requestKey),revision=cfpRevision_(p.revision);
 return withScriptLock_(()=>{
  const source=cfpRows_(kind,false),rows=source.rows;
  const reused=rows.find(r=>String(r.requestKey||'')===key);
  const expected=Object.assign({},values);
  if(reused){
   if((!id||String(reused.id)===id)&&Object.keys(expected).every(k=>String(reused[k])===String(expected[k])))
    return {ok:true,id:reused.id,revision:Number(reused.revision),duplicate:true,auditRecorded:null};
   throw Error('送信識別子が他のデータに使われています。');
  }
  const original=id?rows.find(r=>String(r.id)===id):null;
  if(id&&!original)throw Error('更新対象が見つかりません。再読込してください。');
  if(original&&Number(original.revision)!==revision||!original&&revision!==0)
   throw Error('他の利用者が内容を変更しました。再読込してください。');
  const next=Object.assign({},values,{id:original?original.id:cfpId_(),revision:revision+1,
   updatedAt:cfpStamp_(),editorId:admin.employeeId,requestKey:key});
  cfpWrite_(kind,next,original,source.sheet);
  return {ok:true,id:next.id,revision:next.revision,duplicate:false,
   auditRecorded:cfpAudit_(admin,kind==='account'?'資金口座保存':'定期資金予定保存',kind,next.id,
    original?{revision:original.revision}:null,{revision:next.revision})};
 },30000);
}
function saveCashFlowBankAccount(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{};
 return cfpUpsert_('account',admin,p,q=>{
  const last4=String(q.last4||'').trim();
  if(last4&&!/^\d{4}$/.test(last4))throw Error('口座末尾は4桁だけ入力してください。');
  return {bank:cfpText_(q.bank,'金融機関名',80,true),branch:cfpText_(q.branch,'支店名',80,false),
   name:cfpText_(q.name,'口座表示名',80,true),last4,active:q.active!==false&&q.active!=='false'?'TRUE':'FALSE'};
 });
}
function saveCashFlowScheduledItem(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{};
 return cfpUpsert_('plan',admin,p,q=>{
  const direction=String(q.direction||''),frequency=String(q.frequency||'');
  if(!['IN','OUT'].includes(direction))throw Error('入金か出金を選択してください。');
  if(!['ONCE','MONTHLY','QUARTERLY','YEARLY'].includes(frequency))throw Error('繰り返し方法が不正です。');
  const startMonth=cfpMonth_(q.startMonth,'開始月',false),endMonth=cfpMonth_(q.endMonth,'終了月',true);
  if(endMonth&&endMonth<startMonth)throw Error('終了月は開始月以降にしてください。');
  const day=Number(q.day);
  if(!Number.isInteger(day)||day<1||day>31)throw Error('毎月の予定日は1～31で指定してください。');
  const accountId=String(q.accountId||'');
  if(accountId&&!cfpRows_('account',false).rows.some(a=>a.id===accountId))throw Error('金融機関の登録が見つかりません。');
  return {title:cfpText_(q.title,'予定名',120,true),direction,amount:cashFlowMoney_(q.amount,'予定金額',false,false),
   accountId,category:cfpText_(q.category,'分類',80,false),frequency,startMonth,endMonth,day,
   active:q.active!==false&&q.active!=='false'?'TRUE':'FALSE',note:cfpText_(q.note,'備考',300,false)};
 });
}
function cfpPlannedMonth_(plan,month){
 if(plan.active!=='TRUE'||month<plan.startMonth||(plan.endMonth&&month>plan.endMonth))return false;
 const a=Number(plan.startMonth.slice(0,4))*12+Number(plan.startMonth.slice(5)),b=Number(month.slice(0,4))*12+Number(month.slice(5));
 const delta=b-a;
 return delta>=0&&(plan.frequency==='MONTHLY'||plan.frequency==='ONCE'&&delta===0||
   plan.frequency==='QUARTERLY'&&delta%3===0||plan.frequency==='YEARLY'&&delta%12===0);
}
function cfpHash_(text){
 const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8);
 return digest.map(n=>(n<0?n+256:n).toString(16).padStart(2,'0')).join('');
}
function cfpTxValidate_(entry,accountId){
 const p=entry||{},incoming=cashFlowMoney_(p.incoming,'入金額',false,true),
  outgoing=cashFlowMoney_(p.outgoing,'出金額',false,true);
 if((incoming||0)>0&&(outgoing||0)>0||(!incoming&&!outgoing))throw Error('入金か出金のいずれかに1円以上が必要です。');
 const date=cfpDate_(p.date),description=cfpText_(p.description,'摘要',240,true);
 const ext=cfpText_(p.externalId,'取引番号',100,false);
 const occurrence=Number(p.occurrence||1);
 if(!Number.isInteger(occurrence)||occurrence<1||occurrence>100000)throw Error('同一取引の連番が不正です。');
 const balance=cashFlowMoney_(p.balance,'明細残高',true,true);
 const fingerprint=cfpHash_([accountId,date,incoming||0,outgoing||0,
   description,ext?'ID:'+ext:'BAL:'+String(balance),ext?0:occurrence].join('\u001f'));
 return {accountId,date,incoming:incoming||0,outgoing:outgoing||0,description,balance:balance===null?'':balance,
  externalId:ext,occurrence,fingerprint,transfer:p.transfer===true?'TRUE':'FALSE'};
}
// A bank's external transaction ID alone does not prove that two statement
// rows are the same: the historical fingerprint intentionally omits balance
// and occurrence when externalId exists. Never silently discard conflicting
// statement rows as duplicates. Transfer classification is user-maintained and
// is deliberately excluded from this source-identity comparison.
function cfpSameImportedFingerprint_(prior,next){
 const balance=value=>{
  if(value==null||String(value).trim()==='')return '';
  const plain=String(value).replace(/[,，\s￥¥]/g,'');
  return /^-?\d+$/.test(plain)?String(Number(plain)):'INVALID:'+String(value);
 };
 return balance(prior.balance)===balance(next.balance)&&
  (!String(next.externalId||'')||Number(prior.occurrence||1)===Number(next.occurrence||1));
}
function importCashFlowBankRows(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{},key=cfpKey_(p.requestKey);
 const accountId=String(p.accountId||''),rows=p.rows,sourceFile=cfpText_(p.fileName,'取込ファイル名',130,true);
 if(!Array.isArray(rows)||!rows.length||rows.length>250)throw Error('銀行明細は1回1～250行で読み込んでください。');
 const normalized=rows.map(row=>cfpTxValidate_(row,accountId));
 return withScriptLock_(()=>{
  const accounts=cfpRows_('account',false).rows;
  if(!accounts.some(a=>a.id===accountId))throw Error('金融機関が見つかりません。');
  const source=cfpRows_('tx',false),known=new Map(
    source.rows.filter(row=>row.fingerprint).map(row=>[row.fingerprint,row]));
  // Reserve LEDGER- for manual-entry request keys. Their uniqueness is
  // global across accounts and must be checked INSIDE this write lock.
  const manualKeys=new Map();
  source.rows.forEach(old=>{
   const ext=String(old.externalId||'');
   if(!ext.startsWith('LEDGER-'))return;
   if(!manualKeys.has(ext))manualKeys.set(ext,[]);
   manualKeys.get(ext).push(old);
  });
  const add=[],at=cfpStamp_();
  normalized.forEach(row=>{
   if(row.externalId.startsWith('LEDGER-')){
    const saved=manualKeys.get(row.externalId)||[];
    if(saved.length>1||saved.some(old=>old.accountId!==accountId||
      old.fingerprint!==row.fingerprint||!cfpSameImportedFingerprint_(old,row)))
     throw Error('手入力台帳の送信識別子が別口座または異なる取引に使用されています。保存せず確認してください。');
    if(!saved.length)manualKeys.set(row.externalId,[row]);
   }
   const prior=known.get(row.fingerprint);
   if(prior){
    if(!cfpSameImportedFingerprint_(prior,row))
     throw Error('銀行明細の重複判定で残高または連番が一致しません。保存せず取込内容を確認してください。');
    return;
   }
   known.set(row.fingerprint,row);
   add.push(Object.assign({},row,{id:cfpId_(),sourceFile,importedAt:at,editorId:admin.employeeId,revision:1}));
  });
  if(add.length){
   if(typeof cfaReady_==='function'&&cfaReady_())add.forEach(row=>cfaAssertUnlocked_(row.date));
   // Duplicate file uploads are idempotent by account + transaction fingerprint, not by filename.
   const start=source.sheet.getLastRow()+1,end=start+add.length-1,maxRows=source.sheet.getMaxRows();
   if(end>maxRows)source.sheet.insertRowsAfter(maxRows,end-maxRows);
   source.sheet.getRange(start,1,add.length,CFP.tx.keys.length).setValues(add.map(row=>CFP.tx.keys.map(k=>row[k]==null?'':row[k])));
   SpreadsheetApp.flush();
  }
  return {ok:true,added:add.length,skipped:normalized.length-add.length,received:normalized.length,
   auditRecorded:add.length?cfpAudit_(admin,'銀行明細取込','tx',accountId,{count:source.rows.length},
    {added:add.length,skipped:normalized.length-add.length,requestKey:key}):null};
 },30000);
}
function setCashFlowTransfer(token,id,value,revision){
 const admin=requireAdminSession_(token).employee,recordId=String(id||''),expected=cfpRevision_(revision);
 return withScriptLock_(()=>{
  const source=cfpRows_('tx',false),target=source.rows.find(r=>r.id===recordId);
  if(!target)throw Error('銀行明細が見つかりません。');
  if(Number(target.revision)!==expected)throw Error('他の利用者が明細を更新しました。再読込してください。');
  if(typeof cfaReady_==='function'&&cfaReady_())cfaAssertUnlocked_(target.date);
  const updated=Object.assign({},target,{transfer:value===true?'TRUE':'FALSE',revision:expected+1,editorId:admin.employeeId});
  cfpWrite_('tx',updated,target,source.sheet);
  return {ok:true,id:recordId,revision:updated.revision,
   auditRecorded:cfpAudit_(admin,'内部振替区分変更','tx',recordId,{transfer:target.transfer},{transfer:updated.transfer})};
 },30000);
}
function saveCashFlowClosedThrough(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{},year=cashFlowYear_(p.fiscalYear),through=cfpMonth_(p.through,'確定月',true);
 if(through&&!cashFlowMonths_(year).includes(through))throw Error('確定月は対象決算年度の期間内から選択してください。');
 const revision=cfpRevision_(p.revision),key=cfpKey_(p.requestKey);
 return withScriptLock_(()=>{
  if(through&&typeof cfaReady_==='function'&&cfaReady_()){
   const accounts=cfpRows_('account',false).rows,transactions=cfpRows_('tx',false).rows,checks=cfaRows_('check',false).rows;
    if(!accounts.some(account=>account.active==='TRUE'))throw Error('実績確定には有効な金融機関口座が必要です。');
   cashFlowMonths_(year).filter(m=>m<=through).forEach(month=>{
    if(cfaReviewMonth_(year,month,accounts,transactions,checks).some(result=>!result.verified))
     throw Error(month+'の金融機関別明細の照合が完了していません。先にすべての口座を照合してください。');
   });
  }
  const source=cfpRows_('close',false),matches=source.rows.filter(r=>String(r.fiscalYear)===String(year));
  if(matches.length>1)throw Error('決算年度の月次確定設定が重複しています。');
  const old=matches[0]||null;
  if(old&&old.requestKey===key&&old.through===through)return {ok:true,revision:Number(old.revision),duplicate:true,auditRecorded:null};
  if(old&&old.requestKey===key)throw Error('同じ送信識別子で異なる確定月を登録できません。');
  if((old?Number(old.revision):0)!==revision)throw Error('確定月が変更されています。再読込してください。');
  const record={fiscalYear:String(year),through,revision:revision+1,updatedAt:cfpStamp_(),editorId:admin.employeeId,requestKey:key};
  cfpWrite_('close',record,old,source.sheet);
  return {ok:true,revision:record.revision,
   auditRecorded:cfpAudit_(admin,'資金月次確定変更','close',String(year),old?{through:old.through}:null,{through})};
 },30000);
}
// Read-only hints: never silently mark transfers as reconciled or modify source bank rows.
// Indexed by amount and calendar day to avoid comparing every transfer with every other one.
function cfpTransferPairReview_(rows,eligibleIds){
 const all=[],invalid=[];
 (rows||[]).forEach(r=>{
  if(r.transfer!=='TRUE')return;
  const id=String(r.id||''),accountId=String(r.accountId||''),date=String(r.date||'');
  const incoming=Number(r.incoming||0),outgoing=Number(r.outgoing||0);
  const day=/^\d{4}-\d{2}-\d{2}$/.test(date)?Date.parse(date+'T00:00:00Z'):NaN;
  if(!id||!accountId||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==date||
     !Number.isSafeInteger(incoming)||!Number.isSafeInteger(outgoing)||incoming<0||outgoing<0||
     (incoming>0)===(outgoing>0)){
   invalid.push({id,accountId,date,amount:0,direction:'',reason:'振替明細の金額または日付が不正です。'});
   return;
  }
  all.push({id,accountId,date,day,amount:incoming||outgoing,direction:incoming>0?'IN':'OUT'});
 });
 function index(direction){
  const buckets=new Map();
  all.filter(r=>r.direction===direction).forEach(r=>{
   const key=r.amount+'|'+r.date;
   let b=buckets.get(key);
   if(!b){b={total:0,accounts:new Map(),first:null,secondAccount:null};buckets.set(key,b);}
   b.total++;
   b.accounts.set(r.accountId,(b.accounts.get(r.accountId)||0)+1);
   if(!b.first)b.first=r;
   else if(!b.secondAccount&&b.first.accountId!==r.accountId)b.secondAccount=r;
  });
  return buckets;
 }
 const incomingIndex=index('IN'),outgoingIndex=index('OUT');
 function lookup(r,otherIndex){
  let count=0,otherId='';
  for(let offset=-3;offset<=3;offset++){
   const day=new Date(r.day+offset*86400000).toISOString().slice(0,10);
   const b=otherIndex.get(r.amount+'|'+day);
   if(!b)continue;
   const available=b.total-(b.accounts.get(r.accountId)||0);
   if(available===1){
    const found=b.first.accountId!==r.accountId?b.first:b.secondAccount;
    if(found)otherId=found.id;
   }
   count+=available;
   if(count>1)return {count:2,otherId:''};
  }
  return {count,otherId:count===1?otherId:''};
 }
 const hits=new Map();
 all.forEach(r=>hits.set(r.id,lookup(r,r.direction==='OUT'?incomingIndex:outgoingIndex)));
 const byId=new Map(all.map(r=>[r.id,r])), paired=new Set(),candidates=[];
 let candidateCount=0;
 all.filter(r=>r.direction==='OUT').forEach(r=>{
  const hit=hits.get(r.id);
  if(!hit||hit.count!==1)return;
  const other=byId.get(hit.otherId),back=other&&hits.get(other.id);
  if(!other||other.direction!=='IN'||!back||back.count!==1||back.otherId!==r.id)return;
  if(eligibleIds&&!eligibleIds.has(r.id)&&!eligibleIds.has(other.id))return;
  candidateCount++;paired.add(r.id);paired.add(other.id);
  if(candidates.length<12)candidates.push({outId:r.id,inId:other.id,
   fromAccountId:r.accountId,toAccountId:other.accountId,amount:r.amount,
   fromDate:r.date,toDate:other.date});
 });
 const attention=[];let missingCount=0,ambiguousCount=0,invalidCount=0,total=0;
 const attentionAdd=item=>{if(attention.length<12)attention.push(item);};
 all.forEach(r=>{
  if(eligibleIds&&!eligibleIds.has(r.id))return;
  total++;if(paired.has(r.id))return;
  const hit=hits.get(r.id),missing=!hit||hit.count===0;
  if(missing)missingCount++;else ambiguousCount++;
  attentionAdd({transactionId:r.id,accountId:r.accountId,date:r.date,amount:r.amount,
   direction:r.direction,reason:missing?'相手側の振替明細がありません。':'同額・近接日の候補が重複しています。'});
 });
 invalid.forEach(r=>{
  if(eligibleIds&&!eligibleIds.has(r.id))return;
  total++;invalidCount++;attentionAdd({transactionId:r.id,accountId:r.accountId,
   date:r.date,amount:0,direction:'',reason:r.reason});
 });
 return {total,candidateCount,missingCount,ambiguousCount,invalidCount,
  attentionCount:missingCount+ambiguousCount+invalidCount,candidates,attention,
  confirmed:false,windowDays:3};
}

function getCashFlowBankWorkspace(token,fiscalYear){
 requireAdminSession_(token);
 const year=cashFlowYear_(fiscalYear),months=cashFlowMonths_(year),data={ok:true,year,setupRequired:false,accounts:[],plans:[],transactions:[],monthly:[],closing:{through:'',revision:0}};
 const sheets={};Object.keys(CFP).forEach(k=>sheets[k]=cfpSheet_(k,true));
 const setup=Object.keys(CFP).some(k=>!sheets[k])||!cashFlowSheet_(true);
 if(setup){data.setupRequired=true;return data;}
 const accountRows=cfpRows_('account',false,sheets.account).rows,planRows=cfpRows_('plan',false,sheets.plan).rows,txRows=cfpRows_('tx',false,sheets.tx).rows,close=cfpRows_('close',false,sheets.close).rows;
 data.accounts=accountRows.map(a=>({id:a.id,bank:a.bank,branch:a.branch,name:a.name,last4:a.last4,
   active:a.active==='TRUE',revision:Number(a.revision),updatedAt:a.updatedAt}));
 data.plans=planRows.map(p=>({id:p.id,title:p.title,direction:p.direction,amount:Number(p.amount),accountId:p.accountId,
   category:p.category,frequency:p.frequency,startMonth:p.startMonth,endMonth:p.endMonth,day:Number(p.day),
   active:p.active==='TRUE',note:p.note,revision:Number(p.revision)}));
 const closings=close.filter(r=>String(r.fiscalYear)===String(year));
 if(closings.length>1)throw Error('確定月のレコードが重複しています。');
 if(closings.length)data.closing={through:closings[0].through,revision:Number(closings[0].revision)};
 const monthMap=new Map(months.map(m=>[m,{month:m,scheduledIn:0,scheduledOut:0,actualIn:0,actualOut:0,
    transferIn:0,transferOut:0,importedCount:0,scheduledCount:0}]));
 planRows.forEach(p=>months.forEach(m=>{
  if(!cfpPlannedMonth_(p,m))return;
  const s=monthMap.get(m),amount=Number(p.amount);
  if(p.direction==='IN')s.scheduledIn+=amount;else s.scheduledOut+=amount;
  s.scheduledCount++;
 }));
 const byBank=new Map(data.accounts.map(a=>[a.id,{accountId:a.id,bank:a.bank,name:a.name,incoming:0,outgoing:0,statementIn:0,statementOut:0,transferIn:0,transferOut:0,
   importedCount:0,latestBalance:null,latestDate:''}]));
 const fiscalTx=txRows.filter(r=>monthMap.has(String(r.date).slice(0,7)));
 data.transferReview=cfpTransferPairReview_(txRows,new Set(fiscalTx.map(r=>r.id)));
 fiscalTx.forEach(r=>{
  const s=monthMap.get(String(r.date).slice(0,7)),bank=byBank.get(r.accountId),incoming=Number(r.incoming||0),outgoing=Number(r.outgoing||0);
  if(!s||!bank)throw Error('銀行明細の口座情報が一致しません。');
  s.importedCount++;bank.importedCount++;
  bank.statementIn+=incoming;bank.statementOut+=outgoing;
  if(!Number.isSafeInteger(bank.statementIn)||!Number.isSafeInteger(bank.statementOut))
   throw Error('銀行別明細の合計が安全な整数範囲を超えました。');
  if(r.transfer==='TRUE'){
   s.transferIn+=incoming;s.transferOut+=outgoing;bank.transferIn+=incoming;bank.transferOut+=outgoing;
  }
  else{s.actualIn+=incoming;s.actualOut+=outgoing;bank.incoming+=incoming;bank.outgoing+=outgoing;}
  if(r.balance!==''&&(!bank.latestDate||r.date>=bank.latestDate)){
   bank.latestDate=r.date;bank.latestBalance=Number(r.balance);
  }
 });
 data.bankSummaries=[...byBank.values()];
 data.monthly=months.map(m=>monthMap.get(m));
 // A previously saved fiscal close is never proof that its bank rows were reconciled.
 if(typeof cfaSheet_==='function'&&cfaSheet_('check',true)){
  const checks=cfaRows_('check',false).rows,activeAccounts=accountRows.filter(a=>a.active==='TRUE');
  data.monthly.forEach(row=>{
   const results=cfaReviewMonth_(year,row.month,accountRows,txRows,checks);
   row.reconciled=activeAccounts.length>0&&results.every(r=>r.verified);
  });
 }
 data.transactions=fiscalTx.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.rowNo-a.rowNo).slice(0,120)
  .map(r=>({id:r.id,accountId:r.accountId,date:r.date,incoming:Number(r.incoming||0),outgoing:Number(r.outgoing||0),
    description:r.description,balance:r.balance===''?null:Number(r.balance),transfer:r.transfer==='TRUE',revision:Number(r.revision)}));
 data.importedCount=fiscalTx.length;
 return data;
}


/* Account-first vertical ledger; uses the existing bank/plan/annotation tables. */
function cflRowsByValues_(model,sheet,key,values){
 const column=model.keys.indexOf(key)+1;
 if(!column)throw Error('台帳の検索列が不正です。');
 return readRowsByColumnValues_(sheet,column,model.keys.length,values,false,true).map(hit=>{
  const row={rowNo:hit.rowNumber};
  model.keys.forEach((field,i)=>{row[field]=hit.values[i]||'';});
  return row;
 }).filter(row=>row[model.keys[0]]);
}
function cashFlowLedgerNormalize_(row,accountId){
 const p=row||{},date=cfpDate_(p.date),kind=String(p.kind||'ACTUAL');
 if(!['ACTUAL','PLAN'].includes(kind))throw Error('実績または予定を選択してください。');
 const requestKey=cfpKey_(p.requestKey);
 if(requestKey.length>80)throw Error('台帳の送信識別子が長すぎます。');
 const description=cfpText_(p.description,'摘要',120,true),category=cfpText_(p.category,'分類',60,true),note=cfpText_(p.note,'メモ',300,false);
 const tx=cfpTxValidate_({...p,date,description,externalId:'LEDGER-'+requestKey,occurrence:1,transfer:category==='内部振替'},accountId);
 return {kind,requestKey,category,note,tx};
}
function saveCashFlowLedgerRows(token,payload){
 requireAdminSession_(token);const p=payload||{},accountId=String(p.accountId||'');
 if(!Array.isArray(p.rows)||!p.rows.length||p.rows.length>20)throw Error('入力台帳は1回1～20行で登録してください。');
 const account=cfpRows_('account',false).rows.find(a=>a.id===accountId&&a.active==='TRUE');
 if(!account)throw Error('有効な金融機関を選択してください。');
 const rows=p.rows.map(r=>cashFlowLedgerNormalize_(r,accountId));
 if(new Set(rows.map(r=>r.requestKey)).size!==rows.length)throw Error('台帳の送信識別子が重複しています。');
 // Validate the entire payload before writes. A interrupted batch is resumed
 // with the same per-row keys; completed rows are never silently duplicated.
 const prior=cfpRows_('tx',false).rows;
 const plans=cfpRows_('plan',false).rows;
 const notes=cfaRows_('note',false).rows;
 rows.forEach(r=>{
  if(r.kind==='ACTUAL'&&plans.some(x=>x.requestKey===r.requestKey)||r.kind==='PLAN'&&prior.some(x=>x.externalId===r.tx.externalId))
   throw Error('同じ送信識別子で実績と予定を変更できません。');
  if(r.kind!=='ACTUAL')return;cfaAssertUnlocked_(r.tx.date);
  // A manual request key belongs to one entry across all bank accounts.
  // Preflight the entire chunk; the importer also rechecks under script lock.
  const matched=prior.filter(x=>x.externalId===r.tx.externalId);
  if(matched.length>1||matched.some(x=>x.accountId!==accountId))
   throw Error('同じ送信識別子が別口座または複数の台帳記録に存在します。登録せず確認してください。');
  const old=matched[0];
  if(old&&(old.fingerprint!==r.tx.fingerprint||!cfpSameImportedFingerprint_(old,r.tx)))
   throw Error('同じ送信識別子で台帳の内容を変更できません。');
  const annotation=old&&notes.find(n=>n.transactionId===old.id);
  if(annotation&&(annotation.requestKey!==r.requestKey+'-NOTE'||annotation.category!==r.category||annotation.note!==r.note))
   throw Error('保存済みの分類・メモが変更されています。再読込してください。');
 });
 const results=[];
 for(const r of rows){
  if(r.kind==='PLAN'){
   const result=saveCashFlowScheduledItem(token,{title:r.tx.description,direction:r.tx.incoming?'IN':'OUT',amount:r.tx.incoming||r.tx.outgoing,
    accountId,category:r.category,note:r.note,frequency:'ONCE',startMonth:r.tx.date.slice(0,7),endMonth:r.tx.date.slice(0,7),
    day:Number(r.tx.date.slice(8)),active:true,revision:0,requestKey:r.requestKey});
   results.push({kind:r.kind,id:result.id,auditRecorded:result.auditRecorded});
  }else{
   const result=importCashFlowBankRows(token,{accountId,fileName:'手入力台帳',requestKey:r.requestKey,rows:[r.tx]});
   const tx=cfpRows_('tx',false).rows.find(t=>t.accountId===accountId&&t.externalId===r.tx.externalId&&t.fingerprint===r.tx.fingerprint);
   if(!tx)throw Error('台帳の保存結果を確認できません。同じ入力で再試行してください。');
   const annotation=saveCashFlowAnnotation(token,{transactionId:tx.id,category:r.category,tags:'',note:r.note,revision:0,requestKey:r.requestKey+'-NOTE'});
   results.push({kind:r.kind,id:tx.id,auditRecorded:result.auditRecorded===false||annotation.auditRecorded===false?false:result.auditRecorded===true&&annotation.auditRecorded===true?true:null});
  }
 }
 return {ok:true,results,auditRecorded:results.some(r=>r.auditRecorded===false)?false:results.every(r=>r.auditRecorded===true)?true:null};
}
function getCashFlowLedgerRows(token,payload){
 requireAdminSession_(token);const p=payload||{},year=cashFlowYear_(p.year),months=cashFlowMonths_(year),accountId=String(p.accountId||'');
 if(p.kind&&!['ALL','ACTUAL','PLAN'].includes(p.kind))throw Error('実績・予定の表示区分が不正です。');
 if(p.offset!==undefined&&(!Number.isSafeInteger(Number(p.offset))||Number(p.offset)<0))throw Error('台帳の表示位置が不正です。');
 const account=cfpRows_('account',false).rows.find(a=>a.id===accountId);if(!account)throw Error('金融機関が見つかりません。');
 const all=cflRowsByValues_(CFP.tx,cfpSheet_('tx',false),'accountId',[accountId]).filter(r=>months.includes(r.date.slice(0,7)));
 const txIds=new Set();
 all.forEach(r=>{
  if(txIds.has(r.id))throw Error('同じ銀行明細IDが複数登録されています。管理者に確認してください。');
  txIds.add(r.id);
 });
 const noteSheet=cfaSheet_('note',false);
 const noteRows=all.length?cflRowsByValues_(CFA.note,noteSheet,'transactionId',all.map(r=>r.id)):[];
 const notes=new Map();
 noteRows.forEach(n=>{
  if(notes.has(n.transactionId))throw Error('同じ銀行明細に分類・メモが複数登録されています。管理者に確認してください。');
  notes.set(n.transactionId,n);
 });
 const rows=all.map(r=>{const n=notes.get(r.id);return {id:r.id,date:r.date,description:r.description,incoming:Number(r.incoming),outgoing:Number(r.outgoing),
  balance:r.balance===''?null:Number(r.balance),category:n?n.category:r.transfer==='TRUE'?'内部振替':'未分類',note:n?n.note:'',kind:'ACTUAL'};});
 const plans=cflRowsByValues_(CFP.plan,cfpSheet_('plan',false),'accountId',[accountId]);
 const planIds=new Set();
 plans.forEach(r=>{
  if(planIds.has(r.id))throw Error('同じ入出金予定IDが複数登録されています。管理者に確認してください。');
  planIds.add(r.id);
 });
 plans.forEach(r=>months.forEach(month=>{if(!cfpPlannedMonth_(r,month))return;
  const day=Math.min(Number(r.day),new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate());
  rows.push({id:r.id+'@'+month,date:month+'-'+String(day).padStart(2,'0'),description:r.title,category:r.category,note:r.note,kind:'PLAN',balance:null,
   incoming:r.direction==='IN'?Number(r.amount):0,outgoing:r.direction==='OUT'?Number(r.amount):0});
 }));
 const latest=all.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.rowNo-a.rowNo)[0];
 const balanceAnchor=latest&&latest.balance!==''?{date:latest.date,balance:Number(latest.balance)}:null;
 const totals={actualIn:0,actualOut:0,plannedIn:0,plannedOut:0};
 rows.forEach(r=>{const prefix=r.kind==='ACTUAL'?'actual':'planned';totals[prefix+'In']+=r.incoming;totals[prefix+'Out']+=r.outgoing;});
 const selected=rows.filter(r=>!p.kind||p.kind==='ALL'||r.kind===p.kind).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const offset=Math.max(0,Math.floor(Number(p.offset)||0)),limit=50;
 return {ok:true,year,accountId,total:selected.length,rows:selected.slice(offset,offset+limit),offset,limit,totals,balanceAnchor};
}


/* FM WORKS | Human-approved links between bank records and scheduled cashflow.
 * Links are separate records; they are NOT bank reconciliation or ledger entries.
 * No raw transaction, schedule, or forecast entry is ever modified here.
 */
const CFML=Object.freeze({sheet:'資金予定照合',
 keys:['transactionId','planId','plannedDate','status','txFingerprint','planFingerprint',
  'reason','revision','updatedAt','editorId','requestKey']});
function cfmlSheet_(optional){
 const sheet=getDb_().getSheetByName(CFML.sheet);
 if(!sheet){if(optional)return null;throw Error('予定と明細の承認記録はDB v20への更新後に使用できます。');}
 const headers=DB_SCHEMA_SPECS[CFML.sheet];
 if(!headers||schemaHeaderIssues_(sheet.getRange(1,1,1,headers.length).getDisplayValues()[0],headers).length)
  throw Error('資金予定照合の列名が一致しません。');
 return sheet;
}
function cfmlRows_(optional){
 const sheet=cfmlSheet_(optional);
 if(!sheet)return null;
 return {sheet,rows:sheet.getLastRow()<2?[]:sheet.getRange(2,1,sheet.getLastRow()-1,CFML.keys.length)
  .getDisplayValues().map((arr,i)=>{
   const row={rowNo:i+2};
   CFML.keys.forEach((key,j)=>row[key]=arr[j]||'');
   return row;
  }).filter(r=>r.transactionId)};
}
function cfmlLinksByTransaction_(rows){
 const found=new Map(),byKey=new Map(),byPlanOccurrence=new Map(),conflicts=new Set();
 (rows||[]).forEach(row=>{
  if(found.has(row.transactionId))conflicts.add(row.transactionId);
  else found.set(row.transactionId,row);
  if(row.requestKey){
   const previous=byKey.get(row.requestKey);
   if(previous){conflicts.add(previous.transactionId);conflicts.add(row.transactionId);}
   else byKey.set(row.requestKey,row);
  }
  // A single planned occurrence cannot be approved by two bank records.
  // Historical collisions are displayed as conflicts, never as settled.
  if(row.status==='APPROVED'&&row.planId&&row.plannedDate){
   const occurrenceKey=JSON.stringify([row.planId,row.plannedDate]);
   const previous=byPlanOccurrence.get(occurrenceKey);
   if(previous){conflicts.add(previous.transactionId);conflicts.add(row.transactionId);}
   else byPlanOccurrence.set(occurrenceKey,row);
  }
 });
 conflicts.forEach(id=>{const row=found.get(id);if(row)found.set(id,{...row,status:'CONFLICT'});});
 return found;
}
function cfmlTxFingerprint_(tx){
 return cfpHash_([tx.id,tx.accountId,tx.date,tx.incoming,tx.outgoing,
  tx.description,tx.balance,tx.externalId,tx.fingerprint,tx.transfer].map(x=>String(x??'')).join('\u001f'));
}
function cfmlPlanFingerprint_(plan,occurrence){
 return cfpHash_([plan.id,plan.title,plan.direction,plan.amount,plan.accountId,
  plan.frequency,plan.startMonth,plan.endMonth,plan.day,plan.active,occurrence.plannedDate]
  .map(x=>String(x??'')).join('\u001f'));
}
function cfmlReadLink_(link,tx,plans){
 const base={status:'NONE',revision:link?Number(link.revision):0};
 if(link&&link.status==='CONFLICT')return {status:'CONFLICT',revision:Number(link.revision)||0};
 if(!link||link.status!=='APPROVED')return base;
 const plan=(plans||[]).find(x=>x.id===link.planId);
 const occurrence=plan?cfaPlanOccurrences_([plan],String(tx.date).slice(0,7))
  .find(x=>x.planId===link.planId&&x.plannedDate===link.plannedDate):null;
 const valid=!!occurrence&&cfaPlanMatch_(tx,[occurrence]).total===1&&
  cfmlTxFingerprint_(tx)===link.txFingerprint&&
  cfmlPlanFingerprint_(plan,occurrence)===link.planFingerprint;
 return {status:valid?'APPROVED':'STALE',revision:Number(link.revision),
  planId:link.planId,plannedDate:link.plannedDate,
  title:plan?String(plan.title):'登録済み予定が見つかりません',
  reason:link.reason||'',updatedAt:link.updatedAt||'',editorId:link.editorId||''};
}
function saveCashFlowPlanLink(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{};
 const transactionId=String(p.transactionId||''),action=String(p.action||'');
 if(!['APPROVE','UNLINK'].includes(action))throw Error('照合操作を確認してください。');
 const revision=cfpRevision_(p.revision),requestKey=cfpKey_(p.requestKey);
 const reason=cfpText_(p.reason,'確認・解除の理由',160,true);
 const requestedPlanId=String(p.planId||''),requestedDate=String(p.plannedDate||'');
 return withScriptLock_(()=>{
  const source=cfmlRows_(false);
  // A corrupted/partial ledger must never make an idempotent replay
  // ambiguous. Validate both identities before any early success return.
  const transactionMatches=source.rows.filter(r=>r.transactionId===transactionId);
  const keyMatches=source.rows.filter(r=>r.requestKey===requestKey);
  if(transactionMatches.length>1)
   throw Error('同じ銀行明細に照合記録が複数存在します。管理者に確認してください。');
  if(keyMatches.length>1)
   throw Error('送信識別子が複数の照合記録に重複しています。管理者に確認してください。');
  const old=transactionMatches[0];
  const tx=cfpRows_('tx',false).rows.find(r=>r.id===transactionId);
  if(!tx)throw Error('銀行明細が存在しません。');cfaAssertUnlocked_(tx.date);
  if((old?Number(old.revision):0)!==revision&&(!old||old.requestKey!==requestKey))
   throw Error('他の担当者が照合を変更しました。再読み込みしてください。');
  let planId='',plannedDate='',txFingerprint='',planFingerprint='',status='';
  if(action==='APPROVE'){
   if(old&&old.status==='APPROVED'&&old.requestKey!==requestKey)
    throw Error('承認済みの予定を変更するには先に紐づけを解除してください。');
   const plan=cfpRows_('plan',false).rows.find(r=>r.id===requestedPlanId);
   if(!plan)throw Error('予定が見つかりません。');
   const match=cfaPlanOccurrences_([plan],String(tx.date).slice(0,7))
    .find(r=>r.plannedDate===requestedDate);
   if(!match||cfaPlanMatch_(tx,[match]).total!==1)
    throw Error('金額・口座・予定日が一致しません。取引と予定を再確認してください。');
   if(source.rows.some(r=>r.transactionId!==transactionId&&r.status==='APPROVED'&&
    r.planId===plan.id&&r.plannedDate===requestedDate))
    throw Error('同じ予定日と予定の組合せは、別の明細で承認済みです。');
   planId=plan.id;plannedDate=requestedDate;status='APPROVED';
   txFingerprint=cfmlTxFingerprint_(tx);planFingerprint=cfmlPlanFingerprint_(plan,match);
  }else{
   if(old&&old.status==='UNLINKED'&&old.requestKey===requestKey){
    if(old.reason===reason)return {ok:true,status:'UNLINKED',revision:Number(old.revision),duplicate:true,auditRecorded:null};
    throw Error('同じ送信識別子で異なる解除理由を保存できません。');
   }
   if(!old||old.status!=='APPROVED')throw Error('解除できる承認済みの紐づけがありません。');
   planId=old.planId;plannedDate=old.plannedDate;status='UNLINKED';
   txFingerprint=old.txFingerprint;planFingerprint=old.planFingerprint;
  }
  const reused=keyMatches[0];
  if(reused){
   if(reused.transactionId===transactionId&&reused.status===status&&reused.planId===planId&&
    reused.plannedDate===plannedDate&&reused.reason===reason){
    // An unchanged requestKey cannot re-confirm a link whose source
    // transaction or scheduled occurrence has changed since approval.
    if(status==='APPROVED'&&
      (reused.txFingerprint!==txFingerprint||reused.planFingerprint!==planFingerprint))
     throw Error('銀行明細または入出金予定が承認時から変更されています。照合を再読み込みして確認してください。');
    return {ok:true,status,revision:Number(reused.revision),duplicate:true,auditRecorded:null};
   }
   throw Error('同じ送信識別子を異なる照合操作に使用できません。');
  }
  if((old?Number(old.revision):0)!==revision)throw Error('照合が変更されています。再読み込みしてください。');
  const next={transactionId,planId,plannedDate,status,txFingerprint,planFingerprint,reason,
   revision:revision+1,updatedAt:cfpStamp_(),editorId:admin.employeeId,requestKey};
  const values=CFML.keys.map(k=>next[k]??'');
  if(old)source.sheet.getRange(old.rowNo,1,1,values.length).setValues([values]);
  else source.sheet.appendRow(values);
  SpreadsheetApp.flush();
  let auditRecorded=false;
  try{
   auditRecorded=appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,
    operation:status==='APPROVED'?'資金予定・銀行明細の照合承認':'資金予定・銀行明細の照合解除',
    target:CFML.sheet,targetId:transactionId,
    before:auditJson_(old?{status:old.status,planId:old.planId,plannedDate:old.plannedDate,revision:old.revision}:null),
    after:auditJson_({status,planId,plannedDate,reason,revision:next.revision}),
    source:'WEB',result:'SUCCESS',note:'会計仕訳・銀行照合とは別の確認記録'})===true;
  }catch(e){console.warn('CFML audit failed. Admin review required.');}
  return {ok:true,status,revision:next.revision,auditRecorded};
 },30000);
}
