/* FM WORKS | finance analysis. All public entry points enforce ADMIN sessions. */
const CFA = Object.freeze({
 note:{sheet:'資金明細注記',keys:['transactionId','category','tags','note','revision','updatedAt','editorId','requestKey']},
 rule:{sheet:'資金分類ルール',keys:['id','keyword','direction','accountId','category','tags','priority','active','revision','updatedAt','editorId','requestKey']},
 scenario:{sheet:'資金シナリオ',keys:['id','fiscalYear','name','changesJson','revision','updatedAt','editorId','requestKey']},
 check:{sheet:'資金月次照合',keys:['id','fiscalYear','month','accountId','count','inAmount','outAmount','fingerprint','closingBalance','note','revision','updatedAt','editorId','requestKey']}
});
function cfaSheet_(kind,optional){
 const model=CFA[kind],sheet=getDb_().getSheetByName(model.sheet);
 if(!sheet){if(optional)return null;throw Error('資金分類・報告機能のDB更新が必要です。バックアップ付きDB更新を行ってください。');}
 const expected=DB_SCHEMA_SPECS[model.sheet];
 if(!expected||schemaHeaderIssues_(sheet.getRange(1,1,1,expected.length).getDisplayValues()[0],expected).length)
  throw Error(model.sheet+' の列名が一致しません。');
 return sheet;
}
function cfaRows_(kind,optional){
 const sheet=cfaSheet_(kind,optional),model=CFA[kind];if(!sheet)return null;
 return {sheet,rows:sheet.getLastRow()<2?[]:sheet.getRange(2,1,sheet.getLastRow()-1,model.keys.length).getDisplayValues().map((r,i)=>{
  const obj={rowNo:i+2};model.keys.forEach((k,j)=>obj[k]=r[j]||'');return obj;
 }).filter(r=>r[model.keys[0]])};
}
function cfaReady_(){return Object.keys(CFA).every(k=>!!cfaSheet_(k,true));}
function cfaShortText_(value,label,max,required){
 return cfpText_(value,label,max,required);
}
function cfaTags_(value){
 const tags=String(value==null?'':value).split(/[,，]/).map(x=>x.trim()).filter(Boolean);
 if(tags.length>8||tags.some(x=>x.length>30))throw Error('タグは8個以内、1個30文字以内にしてください。');
 return [...new Set(tags.map(x=>cfaShortText_(x,'タグ',30,true)))].join(',');
}
function cfaCategory_(value){
 return cfaShortText_(value,'計上区分',60,true);
}
function cfaWrite_(kind,next,old,sheet){
 const values=CFA[kind].keys.map(k=>next[k]==null?'':next[k]);
 if(old)sheet.getRange(old.rowNo,1,1,values.length).setValues([values]);
 else sheet.appendRow(values);
 SpreadsheetApp.flush();
}
function cfaAudit_(admin,action,kind,key,before,after){
 try{
  appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation:action,
   target:CFA[kind].sheet,targetId:String(key),before:auditJson_(before),after:auditJson_(after),
   source:'WEB',result:'SUCCESS',note:'資金繰り'});
  return true;
 }catch(_){return false;}
}
function cfaRulesSorted_(rows){
 return rows.filter(r=>r.active==='TRUE').sort((a,b)=>Number(b.priority)-Number(a.priority)||String(a.id).localeCompare(String(b.id)));
}
function cfaRuleFor_(transaction,rules){
 const text=String(transaction.description||'').normalize('NFKC').toLowerCase();
 const direction=Number(transaction.incoming)>0?'IN':'OUT';
 return rules.find(r=>(!r.accountId||r.accountId===transaction.accountId)&&
  (r.direction==='ANY'||r.direction===direction)&&text.includes(String(r.keyword).normalize('NFKC').toLowerCase()))||null;
}
function cfaAnnotated_(tx,note,sortedRules){
 const rule=note?null:cfaRuleFor_(tx,sortedRules);
 return {id:tx.id,accountId:tx.accountId,date:tx.date,description:tx.description,
  incoming:Number(tx.incoming)||0,outgoing:Number(tx.outgoing)||0,balance:tx.balance===''?null:Number(tx.balance),
  transfer:tx.transfer==='TRUE',category:note?note.category:rule?rule.category:'未分類',
  tags:note?note.tags:rule?rule.tags:'',note:note?note.note:'',revision:note?Number(note.revision):0,
  reviewed:!!note,suggested:!note&&!!rule,ruleId:rule?rule.id:''};
}

// P0 read-only suggestions. Never writes to financial schedules or bank transactions.
function cfaPlanOccurrences_(plans,month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return [];
 const year=Number(month.slice(0,4)),numberMonth=Number(month.slice(5));
 const neighboring=[-1,0,1].map(offset=>{
  const d=new Date(Date.UTC(year,numberMonth-1+offset,1));
  const y=d.getUTCFullYear(),m=d.getUTCMonth()+1;
  return {month:y+'-'+String(m).padStart(2,'0'),year:y,numberMonth:m};
 });
 const occurrences=[];
 (plans||[]).forEach(p=>{
  const amount=Number(p.amount),day=Number(p.day);
  if(p.active!=='TRUE'||!['IN','OUT'].includes(p.direction)||
   !Number.isSafeInteger(amount)||amount<=0||!Number.isInteger(day)||day<1||day>31)return;
  neighboring.forEach(m=>{
   if(!cfpPlannedMonth_(p,m.month))return;
   const last=new Date(Date.UTC(m.year,m.numberMonth,0)).getUTCDate();
   const plannedDay=Math.min(day,last);
   occurrences.push({planId:String(p.id),title:String(p.title||''),accountId:String(p.accountId||''),
    direction:p.direction,amount,plannedDate:m.month+'-'+String(plannedDay).padStart(2,'0'),
    epoch:Date.UTC(m.year,m.numberMonth-1,plannedDay)});
  });
 });
 return occurrences;
}
function cfaPlanMatch_(tx,occurrences){
 const empty={status:'NONE',total:0,candidates:[]};
 if(tx.transfer==='TRUE')return {status:'TRANSFER',total:0,candidates:[]};
 const date=String(tx.date||'');
 if(!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date))
  return {status:'INVALID_DATE',total:0,candidates:[]};
 const epoch=Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7))-1,Number(date.slice(8,10)));
 if(new Date(epoch).toISOString().slice(0,10)!==date)
  return {status:'INVALID_DATE',total:0,candidates:[]};
 const incoming=Number(tx.incoming)||0,outgoing=Number(tx.outgoing)||0;
 const direction=incoming>0&&outgoing===0?'IN':outgoing>0&&incoming===0?'OUT':'';
 const amount=direction==='IN'?incoming:outgoing;
 if(!direction||!Number.isSafeInteger(amount))return empty;
 const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
 const description=normalize(tx.description),matched=[];
 (occurrences||[]).forEach(p=>{
  if(p.direction!==direction||p.amount!==amount||
   (p.accountId&&p.accountId!==String(tx.accountId)))return;
  const gapDays=Math.abs(epoch-p.epoch)/86400000;
  if(gapDays>3)return;
  const title=normalize(p.title),descriptionMatch=title.length>=2&&description.includes(title);
  matched.push({planId:p.planId,title:p.title,plannedDate:p.plannedDate,amount:p.amount,
   accountId:p.accountId,gapDays,descriptionMatch,accountSpecified:!!p.accountId});
 });
 matched.sort((a,b)=>Number(b.descriptionMatch)-Number(a.descriptionMatch)||
  Number(b.accountSpecified)-Number(a.accountSpecified)||a.gapDays-b.gapDays||
  a.plannedDate.localeCompare(b.plannedDate)||a.planId.localeCompare(b.planId));
 return {status:matched.length>1?'AMBIGUOUS':matched.length===1?'POSSIBLE':'NONE',
  total:matched.length,candidates:matched.slice(0,3).map(({accountSpecified,...p})=>p)};
}

function cfaTxMonth_(tx,month){return String(tx.date||'').slice(0,7)===month;}
function cfaTxFingerprint_(txRows){
 return cfpHash_(txRows.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))
   .map(r=>[r.id,r.fingerprint,r.transfer,r.incoming,r.outgoing,r.balance].join(':')).join('|'));
}
function cfaBankMonth_(txRows,month,accountId){
 const rows=txRows.filter(r=>cfaTxMonth_(r,month)&&r.accountId===accountId);
 let last=null;
 rows.forEach(r=>{if(r.balance!==''&&(!last||String(r.date)>String(last.date)||r.date===last.date&&r.rowNo>last.rowNo))last=r;});
 // Bank-by-bank reconciliation must use gross statement movements, including internal transfers.
 // Company-level actual inflows/outflows exclude transfers in CashFlowBank.gs.
 const total=field=>rows.reduce((sum,row)=>{
  const next=sum+(Number(row[field])||0);
  if(!Number.isSafeInteger(next))throw Error('銀行口座別の入出金合計が整数上限を超えました。');
  return next;
 },0);
 return {count:rows.length,inAmount:total('incoming'),
  outAmount:total('outgoing'),
  fingerprint:cfaTxFingerprint_(rows),latestBalance:last?Number(last.balance):null};
}
function cfaReviewMonth_(year,month,accounts,allTx,checks){
 const result=[];accounts.filter(a=>a.active==='TRUE').forEach(account=>{
  const actual=cfaBankMonth_(allTx,month,account.id);
  const stored=checks.find(c=>String(c.fiscalYear)===String(year)&&c.month===month&&c.accountId===account.id);
  const verified=!!stored&&Number(stored.count)===actual.count&&
   Number(stored.inAmount)===actual.inAmount&&Number(stored.outAmount)===actual.outAmount&&
   stored.fingerprint===actual.fingerprint&&
   (actual.latestBalance===null||Number(stored.closingBalance)===actual.latestBalance);
  result.push({accountId:account.id,accountName:account.name,month,importedCount:actual.count,
   actualIn:actual.inAmount,actualOut:actual.outAmount,latestBalance:actual.latestBalance,
   closingBalance:stored?Number(stored.closingBalance):null,
   revision:stored?Number(stored.revision):0,verified,note:stored?stored.note:'',outdated:!!stored&&!verified});
 });
 return result;
}
function cfaAssertUnlocked_(date){
 const month=String(date).slice(0,7);
 const closes=cfpRows_('close',false).rows;
 if(closes.some(c=>c.through&&c.through>=month&&cashFlowMonths_(Number(c.fiscalYear)).includes(month)))
  throw Error('実績確定済みの月です。確定月を戻してから修正してください。');
}
function saveCashFlowAnnotation(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{},transactionId=String(p.transactionId||'');
 const category=cfaCategory_(p.category),tags=cfaTags_(p.tags),note=cfaShortText_(p.note,'明細メモ',800,false);
 const expected=cfpRevision_(p.revision),key=cfpKey_(p.requestKey);
 return withScriptLock_(()=>{
  const tx=cfpRows_('tx',false).rows.find(r=>r.id===transactionId);
  if(!tx)throw Error('明細が見つかりません。');cfaAssertUnlocked_(tx.date);
  const source=cfaRows_('note',false),old=source.rows.find(r=>r.transactionId===transactionId);
  if(old&&old.requestKey===key){
   if(old.category===category&&old.tags===tags&&old.note===note)
    return {ok:true,revision:Number(old.revision),duplicate:true,auditRecorded:null};
   throw Error('同じ送信識別子で異なる分類を保存できません。');
  }
  if((old?Number(old.revision):0)!==expected)throw Error('明細が変更されています。再読込してください。');
  const next={transactionId,category,tags,note,revision:expected+1,updatedAt:cfpStamp_(),editorId:admin.employeeId,requestKey:key};
  cfaWrite_('note',next,old,source.sheet);
  return {ok:true,revision:next.revision,auditRecorded:cfaAudit_(admin,'資金明細分類・メモ','note',transactionId,
   old?{category:old.category,revision:old.revision}:null,{category:next.category,revision:next.revision})};
 },30000);
}
function saveCashFlowRule(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{},keyword=cfaShortText_(p.keyword,'一致キーワード',80,true);
 if(keyword.length<2)throw Error('判定キーワードは2文字以上にしてください。');
 const direction=String(p.direction||'ANY');if(!['ANY','IN','OUT'].includes(direction))throw Error('入出金区分を確認してください。');
 const accountId=String(p.accountId||'');
 if(accountId&&!cfpRows_('account',false).rows.some(r=>r.id===accountId))throw Error('指定された口座がありません。');
 const priority=Number(p.priority||50);if(!Number.isInteger(priority)||priority<1||priority>100)throw Error('優先度は1～100で指定してください。');
 const values={keyword,direction,accountId,priority,category:cfaCategory_(p.category),tags:cfaTags_(p.tags),
  active:p.active===false?'FALSE':'TRUE'};
 const id=String(p.id||''),rev=cfpRevision_(p.revision),key=cfpKey_(p.requestKey);
 return withScriptLock_(()=>{
  const src=cfaRows_('rule',false),old=id?src.rows.find(r=>r.id===id):null;
  if(id&&!old)throw Error('分類ルールが見つかりません。');
  const reused=src.rows.find(r=>r.requestKey===key);
  if(reused){
   if(reused.id===(id||reused.id)&&Object.keys(values).every(k=>String(reused[k])===String(values[k])))
    return {ok:true,id:reused.id,revision:Number(reused.revision),duplicate:true};
   throw Error('送信識別子が重複しました。');
  }
  if((old?Number(old.revision):0)!==rev)throw Error('ルールが変更されています。再読込してください。');
  const next=Object.assign({id:old?old.id:cfpId_()},values,{revision:rev+1,updatedAt:cfpStamp_(),editorId:admin.employeeId,requestKey:key});
  cfaWrite_('rule',next,old,src.sheet);
  return {ok:true,id:next.id,revision:next.revision,auditRecorded:cfaAudit_(admin,'資金自動分類ルール','rule',next.id,
   old?{revision:old.revision}:null,{revision:next.revision})};
 },30000);
}
function applyCashFlowRules(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{},ids=p.transactionIds;
 if(!Array.isArray(ids)||ids.length<1||ids.length>100||new Set(ids).size!==ids.length)throw Error('明細は1回100件以内で選択してください。');
 cfpKey_(p.requestKey);
 return withScriptLock_(()=>{
  const allTx=cfpRows_('tx',false).rows,txById=new Map(allTx.map(r=>[r.id,r]));
  const rules=cfaRulesSorted_(cfaRows_('rule',false).rows);
  const src=cfaRows_('note',false),existing=new Set(src.rows.map(r=>r.transactionId));
  const add=[];
  ids.forEach(id=>{
   const tx=txById.get(String(id));if(!tx)throw Error('対象の銀行明細が見つかりません。');
   cfaAssertUnlocked_(tx.date);
   if(existing.has(tx.id))return;
   const rule=cfaRuleFor_(tx,rules);if(!rule)return;
   add.push({transactionId:tx.id,category:rule.category,tags:rule.tags,note:'',
    revision:1,updatedAt:cfpStamp_(),editorId:admin.employeeId,requestKey:String(p.requestKey).slice(0,70)+'-'+add.length});
   existing.add(tx.id);
  });
  if(add.length){
   const start=src.sheet.getLastRow()+1,end=start+add.length-1,max=src.sheet.getMaxRows();
   if(end>max)src.sheet.insertRowsAfter(max,end-max);
   src.sheet.getRange(start,1,add.length,CFA.note.keys.length).setValues(add.map(x=>CFA.note.keys.map(k=>x[k])));
   SpreadsheetApp.flush();
  }
  return {ok:true,added:add.length,skipped:ids.length-add.length,
   auditRecorded:add.length?cfaAudit_(admin,'資金分類ルール一括反映','note',p.requestKey,null,{added:add.length}):null};
 },30000);
}
function cfaScenarioChanges_(changes,year,plans){
 const months=cashFlowMonths_(year),planMap=new Map(plans.map(p=>[p.id,p])),seen=new Set();
 if(!Array.isArray(changes)||changes.length>30)throw Error('変更条件は最大30件までです。');
 return changes.map((raw,i)=>{
  const p=raw||{},type=String(p.type||''),month=cfpMonth_(p.month,'条件の対象月',false);
  if(!months.includes(month))throw Error('条件'+(i+1)+'の対象月は決算年度内から選択してください。');
  if(type==='EXTRA'){
   const direction=String(p.direction||'');if(!['IN','OUT'].includes(direction))throw Error('臨時入出金の方向を選択してください。');
   return {type,month,direction,amount:cashFlowMoney_(p.amount,'臨時入出金額',false,false),title:cfaShortText_(p.title,'臨時予定名',90,true)};
  }
  if(!['SHIFT','OMIT','SCALE'].includes(type))throw Error('シナリオの条件種別を確認してください。');
  const planId=String(p.planId||''),plan=planMap.get(planId);
  if(!plan)throw Error('条件の入出金予定が見つかりません。');
  if(!cfpPlannedMonth_(Object.assign({},plan,{active:plan.active===true?'TRUE':plan.active}),month))
   throw Error('指定した月に対象の入出金予定はありません。予定日と繰り返しを確認してください。');
  const collision=planId+'|'+month;
  if(seen.has(collision))throw Error('同じ予定・同じ月には条件を1つだけ指定してください。');
  seen.add(collision);
  if(type==='SHIFT'){
   const delay=Number(p.monthsDelta);
   if(!Number.isInteger(delay)||delay<-6||delay>6||!delay)throw Error('移動月数は-6～6（0以外）で入力してください。');
   const src=months.indexOf(month),to=src+delay;
   if(to<0||to>=months.length)throw Error('移動先が決算年度外です。年度をまたぐ条件は別年度の計画で管理してください。');
   return {type,month,planId,monthsDelta:delay};
  }
  if(type==='SCALE'){
   const percent=Number(p.percent);
   if(!Number.isInteger(percent)||percent<0||percent>200)throw Error('比率は0～200％で指定してください。');
   return {type,month,planId,percent};
  }
  return {type,month,planId};
 });
}
function saveCashFlowScenario(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{},year=cashFlowYear_(p.fiscalYear),name=cfaShortText_(p.name,'シナリオ名',100,true);
 const changes=cfaScenarioChanges_(p.changes,year,cfpRows_('plan',false).rows);
 const id=String(p.id||''),rev=cfpRevision_(p.revision),key=cfpKey_(p.requestKey),changesJson=JSON.stringify(changes);
 return withScriptLock_(()=>{
  const source=cfaRows_('scenario',false),old=id?source.rows.find(r=>r.id===id):null;
  if(id&&(!old||Number(old.fiscalYear)!==year))throw Error('対象のシナリオがありません。');
  const dup=source.rows.find(r=>r.requestKey===key);
  if(dup){
   if((!id||dup.id===id)&&dup.name===name&&dup.changesJson===changesJson&&Number(dup.fiscalYear)===year)
    return {ok:true,id:dup.id,revision:Number(dup.revision),duplicate:true};
   throw Error('送信識別子が重複しています。');
  }
  if((old?Number(old.revision):0)!==rev)throw Error('シナリオが変更されています。再読込してください。');
  const next={id:old?old.id:cfpId_(),fiscalYear:String(year),name,changesJson,revision:rev+1,updatedAt:cfpStamp_(),editorId:admin.employeeId,requestKey:key};
  cfaWrite_('scenario',next,old,source.sheet);
  return {ok:true,id:next.id,revision:next.revision,auditRecorded:cfaAudit_(admin,'資金シナリオ保存','scenario',next.id,
   old?{revision:old.revision}:null,{revision:next.revision})};
 },30000);
}
function saveCashFlowBankReconciliation(token,payload){
 const admin=requireAdminSession_(token).employee,p=payload||{},year=cashFlowYear_(p.fiscalYear);
 const month=cfpMonth_(p.month,'対象月',false),accountId=String(p.accountId||'');
 if(!cashFlowMonths_(year).includes(month))throw Error('対象月が決算年度外です。');
 const closingBalance=cashFlowMoney_(p.closingBalance,'銀行月末残高',true,false);
 const note=cfaShortText_(p.note,'照合根拠',500,false),rev=cfpRevision_(p.revision),key=cfpKey_(p.requestKey);
 return withScriptLock_(()=>{
  const accounts=cfpRows_('account',false).rows;
  if(!accounts.some(a=>a.id===accountId&&a.active==='TRUE'))throw Error('有効な金融機関口座を選択してください。');
  const actual=cfaBankMonth_(cfpRows_('tx',false).rows,month,accountId);
  if(actual.latestBalance!==null&&actual.latestBalance!==closingBalance)
   throw Error('取込明細の最終残高と照合残高が異なります。明細を確認してください。');
  if(!actual.count&&!note)throw Error('取引がない月は、明細が0件である確認根拠を記載してください。');
  const src=cfaRows_('check',false),old=src.rows.find(c=>Number(c.fiscalYear)===year&&c.month===month&&c.accountId===accountId);
  if(old&&old.requestKey===key){
   if(Number(old.closingBalance)===closingBalance&&old.fingerprint===actual.fingerprint&&old.note===note)
    return {ok:true,revision:Number(old.revision),duplicate:true};
   throw Error('同じ送信識別子で異なる照合内容を保存できません。');
  }
  if((old?Number(old.revision):0)!==rev)throw Error('照合状態が変更されています。再読込してください。');
  const next={id:old?old.id:cfpId_(),fiscalYear:String(year),month,accountId,count:actual.count,
   inAmount:actual.inAmount,outAmount:actual.outAmount,fingerprint:actual.fingerprint,
   closingBalance,note,revision:rev+1,updatedAt:cfpStamp_(),editorId:admin.employeeId,requestKey:key};
  cfaWrite_('check',next,old,src.sheet);
  return {ok:true,revision:next.revision,auditRecorded:cfaAudit_(admin,'銀行明細月次照合','check',next.id,
   old?{revision:old.revision}:null,{month,accountId,count:actual.count,revision:next.revision})};
 },30000);
}
function getCashFlowAnalysisWorkspace(token,fiscalYear){
 requireAdminSession_(token);
 const year=cashFlowYear_(fiscalYear),months=cashFlowMonths_(year);
 if(!cfaReady_())return {ok:true,setupRequired:true,year,rules:[],scenarios:[],checks:[]};
 const notes=cfaRows_('note',false).rows,rules=cfaRows_('rule',false).rows,scenarios=cfaRows_('scenario',false).rows;
 const accounts=cfpRows_('account',false).rows,tx=cfpRows_('tx',false).rows,checks=cfaRows_('check',false).rows;
 const current=tx.filter(r=>months.includes(String(r.date).slice(0,7))),annotated=new Set(notes.map(r=>r.transactionId));
 const review=months.flatMap(month=>cfaReviewMonth_(year,month,accounts,tx,checks));
 return {ok:true,setupRequired:false,year,
  rules:rules.map(r=>({id:r.id,keyword:r.keyword,direction:r.direction,accountId:r.accountId,category:r.category,
   tags:r.tags,priority:Number(r.priority),active:r.active==='TRUE',revision:Number(r.revision)})),
  scenarios:scenarios.filter(s=>Number(s.fiscalYear)===year).map(s=>({id:s.id,name:s.name,
   changes:JSON.parse(s.changesJson||'[]'),revision:Number(s.revision)})),
  checks:review,transactionsCount:current.length,unreviewedCount:current.filter(r=>r.transfer!=='TRUE'&&!annotated.has(r.id)).length,
  accounts:accounts.filter(a=>a.active==='TRUE').map(a=>({id:a.id,name:a.name,bank:a.bank})),
  months};
}
function getCashFlowAnalysisMonth(token,payload){
 requireAdminSession_(token);
 const p=payload||{},year=cashFlowYear_(p.fiscalYear),month=cfpMonth_(p.month,'対象月',false),page=Number(p.page||0);
 if(!cashFlowMonths_(year).includes(month)||!Number.isInteger(page)||page<0||page>10000)throw Error('対象月・ページを確認してください。');
 if(p.onlyUnreviewed!==undefined&&typeof p.onlyUnreviewed!=='boolean')throw Error('表示条件が不正です。');
 if(!cfaReady_())return {ok:true,setupRequired:true,rows:[],total:0};
 const notes=new Map(cfaRows_('note',false).rows.map(r=>[r.transactionId,r]));
 const tx=cfpRows_('tx',false).rows.filter(r=>cfaTxMonth_(r,month)&&
  (p.onlyUnreviewed!==true||(r.transfer!=='TRUE'&&!notes.has(r.id))))
  .sort((a,b)=>String(b.date).localeCompare(String(a.date))||b.rowNo-a.rowNo);
 const rules=cfaRulesSorted_(cfaRows_('rule',false).rows);
 const plans=tx.length?cfpRows_('plan',false).rows:[],occurrences=cfaPlanOccurrences_(plans,month);
 const linkSource=cfmlRows_(true),links=new Map((linkSource?linkSource.rows:[]).map(r=>[r.transactionId,r]));
 return {ok:true,month,page,total:tx.length,linkReady:!!linkSource,rows:tx.slice(page*100,(page+1)*100).map(r=>{
  const row=cfaAnnotated_(r,notes.get(r.id),rules);
  row.planMatch=cfaPlanMatch_(r,occurrences);
  row.planLink=cfmlReadLink_(links.get(r.id),r,plans);
  return row;
 })};
}
