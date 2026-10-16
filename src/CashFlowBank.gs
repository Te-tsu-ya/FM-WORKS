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
  appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation,target:CFP[kind].sheet,targetId:id,
    before:auditJson_(before),after:auditJson_(after),source:'WEB',result:'SUCCESS',note:'資金繰り'});
  return true;
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
  const plain=String(value).replace(/[,，\\s￥¥]/g,'');
  return /^-?\\d+$/.test(plain)?String(Number(plain)):'INVALID:'+String(value);
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
  const add=[],at=cfpStamp_();
  normalized.forEach(row=>{
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
