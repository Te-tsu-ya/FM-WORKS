/* Account-first vertical ledger; uses the existing bank/plan/annotation tables. */
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
  const old=prior.find(x=>x.accountId===accountId&&x.externalId===r.tx.externalId);
  if(old&&old.fingerprint!==r.tx.fingerprint)throw Error('同じ送信識別子で台帳の内容を変更できません。');
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
 const all=cfpRows_('tx',false).rows.filter(r=>r.accountId===accountId&&months.includes(r.date.slice(0,7)));
 const notes=new Map(cfaRows_('note',false).rows.map(n=>[n.transactionId,n]));
 const rows=all.map(r=>{const n=notes.get(r.id);return {id:r.id,date:r.date,description:r.description,incoming:Number(r.incoming),outgoing:Number(r.outgoing),
  balance:r.balance===''?null:Number(r.balance),category:n?n.category:r.transfer==='TRUE'?'内部振替':'未分類',note:n?n.note:'',kind:'ACTUAL'};});
 const plans=cfpRows_('plan',false).rows;
 plans.filter(r=>r.accountId===accountId).forEach(r=>months.forEach(month=>{if(!cfpPlannedMonth_(r,month))return;
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
