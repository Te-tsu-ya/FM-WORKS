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
   appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,
    operation:status==='APPROVED'?'資金予定・銀行明細の照合承認':'資金予定・銀行明細の照合解除',
    target:CFML.sheet,targetId:transactionId,
    before:auditJson_(old?{status:old.status,planId:old.planId,plannedDate:old.plannedDate,revision:old.revision}:null),
    after:auditJson_({status,planId,plannedDate,reason,revision:next.revision}),
    source:'WEB',result:'SUCCESS',note:'会計仕訳・銀行照合とは別の確認記録'});
   auditRecorded=true;
  }catch(e){console.warn('CFML audit failed. Admin review required.');}
  return {ok:true,status,revision:next.revision,auditRecorded};
 },30000);
}
