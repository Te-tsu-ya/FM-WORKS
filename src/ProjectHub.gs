/* Shared project cockpit. Legacy projects/worklogs/quotes remain authoritative.
 * Project-wide totals are shared; individual worklog details keep existing HR scope.
 * No record is inferred from a similar customer/project name. */
const PROJECT_HUB_MODELS=Object.freeze({
 plan:{sheet:'プロジェクト計画',keys:['projectId','plannedMinutes','ownerId','quoteId','orderNo','receivedOn','orderValue','orderStatus','note','aliases','revision','createdAt','updatedAt','createdBy','updatedBy','requestKey']},
 task:{sheet:'プロジェクト作業',keys:['id','projectId','title','ownerId','startDate','dueDate','plannedMinutes','progress','status','note','revision','createdAt','updatedAt','createdBy','updatedBy','requestKey']},
 resource:{sheet:'プロジェクト資料',keys:['id','projectId','title','kind','url','body','status','revision','createdAt','updatedAt','createdBy','updatedBy','requestKey']},
 update:{sheet:'プロジェクト共有',keys:['id','projectId','kind','body','createdAt','createdBy','authorName','requestKey']}
});
function projectHubToday_(){return Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');}
function projectHubStorage_(){
 const db=getDb_(),sheets={},missing=[];
 Object.keys(PROJECT_HUB_MODELS).forEach(kind=>{
  const m=PROJECT_HUB_MODELS[kind],sh=db.getSheetByName(m.sheet);if(!sh){missing.push(m.sheet);return;}
  const expected=DB_SCHEMA_SPECS[m.sheet];
  if(schemaHeaderIssues_(sh.getRange(1,1,1,expected.length).getDisplayValues()[0],expected).length)throw new Error(m.sheet+'の列構成が一致しません。管理者に確認してください。');
  sheets[kind]=sh;
 });
 return {ready:missing.length===0,missing,sheets};
}
function projectHubRows_(kind,sh,projectId){
 if(!sh||sh.getLastRow()<2)return [];
 const keys=PROJECT_HUB_MODELS[kind].keys,n=sh.getLastRow()-1;
 const convert=(rows,start)=>rows.map((r,index)=>{const o={_row:start+index};keys.forEach((k,i)=>o[k]=r[i]||'');return o;}).filter(r=>r[keys[0]]);
 if(!projectId)return convert(sh.getRange(2,1,n,keys.length).getDisplayValues(),2);
 // Index the project column first; fetch document bodies only for this project.
 const ids=sh.getRange(2,kind==='plan'?1:2,n,1).getDisplayValues(),blocks=[];
 ids.forEach((r,i)=>{if(r[0]!==projectId)return;const row=i+2,last=blocks[blocks.length-1];if(last&&last.end===row-1)last.end=row;else blocks.push({start:row,end:row});});
 return blocks.flatMap(b=>convert(sh.getRange(b.start,1,b.end-b.start+1,keys.length).getDisplayValues(),b.start));
}
function projectHubRead_(force,detail){
 const storage=projectHubStorage_(),result={storage,plans:[],tasks:[],resources:[],updates:[],worklogs:[],projects:getProjectsInternal_(true)};
 if(storage.ready){
  result.plans=projectHubRows_('plan',storage.sheets.plan);
  result.tasks=projectHubRows_('task',storage.sheets.task).filter(x=>x.status!=='非表示');
  if(detail){result.resources=projectHubRows_('resource',storage.sheets.resource,detail).filter(x=>x.status!=='非表示');result.updates=projectHubRows_('update',storage.sheets.update,detail);}
  else{const sh=storage.sheets.resource,n=sh.getLastRow()-1;if(n>0){const ids=sh.getRange(2,1,n,2).getDisplayValues(),status=sh.getRange(2,7,n,1).getDisplayValues();result.resources=ids.map((r,i)=>({id:r[0],projectId:r[1],status:status[i][0]})).filter(r=>r.id&&r.status!=='非表示');}}
 }
 const key='fm:projectHub:worklog:v1';let rows=force?null:cacheJsonGet_(key);
 if(!rows){const sh=getDb_().getSheetByName('工数');rows=sh&&sh.getLastRow()>1?sh.getRange(2,2,sh.getLastRow()-1,12).getDisplayValues():[];cacheJsonPut_(key,rows,20);}
 result.worklogs=rows.filter(r=>r[11]!=='削除'&&Number.isFinite(Number(r[8]))&&Number(r[8])>0);
 return result;
}
function projectHubName_(value){return String(value||'').trim().toLowerCase();}
function projectHubAliases_(plan){try{const a=JSON.parse(plan&&plan.aliases||'[]');return Array.isArray(a)?a.filter(x=>typeof x==='string'):[];}catch(_){return [];}}
function projectHubCanManage_(u,plan){return u.role==='ADMIN'||!!(plan&&plan.ownerId&&plan.ownerId===u.employeeId);}
function projectHubMetrics_(project,plan,tasks,worklogs,today){
 const weights=tasks.map(t=>Math.max(0,Number(t.plannedMinutes)||0)),taskBudget=weights.reduce((a,b)=>a+b,0);
 const plannedMinutes=Number(plan&&plan.plannedMinutes)||taskBudget||null;
 const actualMinutes=worklogs.reduce((s,r)=>s+Number(r[8]),0);
 const progress=taskBudget>0?Math.round(tasks.reduce((s,t,i)=>s+weights[i]*Math.max(0,Math.min(100,Number(t.progress)||0)),0)/taskBudget):null;
 const completeSchedule=tasks.length>0&&tasks.every(t=>t.startDate&&t.dueDate&&t.startDate<=t.dueDate);
 const days=s=>Date.parse(s+'T00:00:00Z');
 const scheduledProgress=completeSchedule&&taskBudget>0?Math.round(tasks.reduce((s,t,i)=>{
  const span=days(t.dueDate)-days(t.startDate);const ratio=span<=0?(today>=t.dueDate?1:0):Math.max(0,Math.min(1,(days(today)-days(t.startDate))/span));return s+weights[i]*ratio;
 },0)/taskBudget*100):null;
 const overdue=tasks.filter(t=>t.dueDate&&t.dueDate<today&&Number(t.progress)<100).length;
 return {plannedMinutes,actualMinutes,remainingMinutes:plannedMinutes===null?null:plannedMinutes-actualMinutes,
 usagePercent:plannedMinutes===null?null:Math.round(actualMinutes/plannedMinutes*100),progress,scheduledProgress,
 progressGap:progress===null||scheduledProgress===null?null:progress-scheduledProgress,overdue,
 completeTasks:tasks.filter(t=>Number(t.progress)===100).length,totalTasks:tasks.length,
 health:project.status==='完了'?'完了':project.status==='停止'?'停止':overdue||plannedMinutes!==null&&actualMinutes>plannedMinutes?'要対応':progress===null?'計画未設定':'進行中'};
}
function projectHubQuoteOptions_(u){
 const sh=getDb_().getSheetByName('見積ヘッダー');if(!sh)return [];
 return quoteRows_('header',quoteModelSheet_('header')).filter(h=>quoteVisible_(u,h)&&h.status==='発行済').map(h=>({id:h.id,number:h.number,subject:h.subject,vendorName:h.vendorName,total:Number(h.total)||0}));
}
function getProjectHubWorkspace(sessionToken,force){
 const u=requireSession_(sessionToken).employee,r=projectHubRead_(!!force),today=projectHubToday_();
 const projects=r.projects.map(p=>{
  const plan=r.plans.find(x=>x.projectId===p.projectId)||{},names=[p.name,...projectHubAliases_(plan)],logs=r.worklogs.filter(w=>names.map(projectHubName_).includes(projectHubName_(w[3])));
  const tasks=r.tasks.filter(t=>t.projectId===p.projectId),metrics=projectHubMetrics_(p,plan,tasks,logs,today);
  return {...p,...metrics,ownerId:plan.ownerId||'',orderStatus:plan.orderStatus||'未登録',receivedOn:plan.receivedOn||'',canManage:projectHubCanManage_(u,plan),resourceCount:r.resources.filter(x=>x.projectId===p.projectId).length};
 });
 const assignedNames=new Set(r.projects.flatMap(p=>[p.name,...projectHubAliases_(r.plans.find(x=>x.projectId===p.projectId))]).map(projectHubName_));
 return {projects,today,setupRequired:!r.storage.ready,missing:r.storage.missing,canCreate:u.role==='ADMIN',
  unlinkedWorklogCount:r.worklogs.filter(w=>!assignedNames.has(projectHubName_(w[3]))).length,
  employees:getEmployees_().map(e=>({employeeId:e.employeeId,name:e.displayName||e.name})),quoteOptions:projectHubQuoteOptions_(u)};
}
function getProjectHubDetail(sessionToken,projectId,force){
 const u=requireSession_(sessionToken).employee,r=projectHubRead_(!!force,String(projectId)),p=r.projects.find(x=>x.projectId===String(projectId));
 if(!p)throw new Error('指定したプロジェクトが見つかりません。');
 const rawPlan=r.plans.find(x=>x.projectId===p.projectId)||{},plan={...rawPlan};delete plan._row;
 const canManage=projectHubCanManage_(u,plan),quotes=projectHubQuoteOptions_(u),quote=quotes.find(x=>x.id===plan.quoteId)||null;
 const canSeeOrderValue=u.role==='ADMIN'||!!quote;
 if(!canSeeOrderValue)delete plan.orderValue;
 const names=[p.name,...projectHubAliases_(plan)],logs=r.worklogs.filter(w=>names.map(projectHubName_).includes(projectHubName_(w[3]))),employees=getEmployees_();
 const canViewPerson=id=>u.employeeId===id||u.role==='ADMIN'||u.role==='MANAGER'&&employees.some(e=>e.employeeId===id&&e.managerId===u.employeeId);
 const tasks=r.tasks.filter(x=>x.projectId===p.projectId).map(x=>({...x,canEdit:canManage||x.ownerId===u.employeeId}));
 const resources=r.resources.filter(x=>x.projectId===p.projectId).map(x=>({...x,canEdit:canManage||x.createdBy===u.employeeId}));
 const detailLogs=logs.filter(w=>canViewPerson(w[1])).sort((a,b)=>String(b[0]).localeCompare(String(a[0])));
 const byCategory=Object.create(null),byPerson=Object.create(null),byMonth=Object.create(null);
 logs.forEach(w=>{const cat=w[4]||'未分類',month=String(w[0]).slice(0,7);byCategory[cat]=(byCategory[cat]||0)+Number(w[8]);byMonth[month]=(byMonth[month]||0)+Number(w[8]);if(canViewPerson(w[1])){const key=w[1];if(!byPerson[key])byPerson[key]={employeeId:key,name:w[2],minutes:0};byPerson[key].minutes+=Number(w[8]);}});
 return {project:p,plan,quote,canSeeOrderValue,canManage,setupRequired:!r.storage.ready,missing:r.storage.missing,
  metrics:projectHubMetrics_(p,plan,tasks,logs,projectHubToday_()),tasks,resources,
  updates:r.updates.filter(x=>x.projectId===p.projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,60),
  worklogs:detailLogs.slice(0,100).map(w=>({date:w[0],name:w[2],category:w[4],description:w[5],minutes:Number(w[8])})),
  worklogDetailCount:detailLogs.length,byCategory,byPerson:Object.values(byPerson),byMonth,
  worklogScope:u.role==='ADMIN'?'全社員':u.role==='MANAGER'?'本人・直属メンバー':'本人のみ',today:projectHubToday_()};
}
function projectHubText_(v,label,max,required){const s=String(v==null?'':v).trim();if(s.length>max)throw new Error(label+'は'+max+'文字以内で入力してください。');if(required&&!s)throw new Error(label+'を入力してください。');return safeSheetText_(s,max);}
function projectHubMinutes_(v,required){if(!required&&(v===''||v==null))return '';const hours=Number(v);if(!Number.isFinite(hours)||hours<=0||hours>100000||!Number.isInteger(hours*60))throw new Error('予定工数は0より大きい時間で、分単位まで入力してください。');return Math.round(hours*60);}
function projectHubDate_(v){return v?normalizeDate_(v):'';}
function projectHubSaveRow_(kind,sh,row){const keys=PROJECT_HUB_MODELS[kind].keys;const n=row._row||Math.max(2,sh.getLastRow()+1);sh.getRange(n,1,1,keys.length).setValues([keys.map(k=>row[k]==null?'':row[k])]);}
function saveProjectHubRecord(sessionToken,kind,payload){
 const u=requireSession_(sessionToken).employee,p=payload||{};
 if(!Object.prototype.hasOwnProperty.call(PROJECT_HUB_MODELS,kind))throw new Error('保存種別が不正です。');
 return withScriptLock_(function(){
  const storage=projectHubStorage_();if(!storage.ready)throw new Error('管理者がバックアップ付きDB更新を行ってください。');
  const project=getProjectsInternal_(true).find(x=>x.projectId===String(p.projectId));if(!project)throw new Error('プロジェクトが見つかりません。');
  const plans=projectHubRows_('plan',storage.sheets.plan),plan=plans.find(x=>x.projectId===project.projectId)||{},manager=projectHubCanManage_(u,plan);
  const rows=kind==='plan'?plans:projectHubRows_(kind,storage.sheets[kind]),id=kind==='plan'?project.projectId:String(p.id||''),existing=rows.find(x=>(kind==='plan'?x.projectId:x.id)===id);
  if(kind!=='plan'&&p.id&&!existing)throw new Error('対象の記録が見つかりません。');
  if(existing&&existing.projectId!==project.projectId)throw new Error('別のプロジェクトへ移動することはできません。');
  if(kind==='plan'&&!manager)throw new Error('計画・受注を変更できるのは管理者と案件責任者です。');
  if(kind==='task'&&!manager&&(!existing||existing.ownerId!==u.employeeId))throw new Error('作業計画の作成・編集権限がありません。');
  if(kind==='resource'&&existing&&!manager&&existing.createdBy!==u.employeeId)throw new Error('この資料を編集する権限がありません。');
  if(kind==='update'&&p.id)throw new Error('共有メモは追記方式です。');
  const data={projectId:project.projectId};
  if(kind==='plan'){
   data.plannedMinutes=projectHubMinutes_(p.plannedHours,false);data.ownerId=u.role==='ADMIN'?String(p.ownerId||''):plan.ownerId;
   if(data.ownerId&&!getEmployees_().some(e=>e.employeeId===data.ownerId))throw new Error('責任者を確認してください。');
   data.quoteId=String(p.quoteId||'');
   if(data.quoteId!==String(plan.quoteId||'')){
    const h=data.quoteId?quoteFind_('header',data.quoteId).data:null;
    if(h&&(!quoteVisible_(u,h)||h.status!=='発行済'))throw new Error('正式発行済みで閲覧できる見積を指定してください。');
   }
   data.orderNo=projectHubText_(p.orderNo,'受注番号',100,false);data.receivedOn=projectHubDate_(p.receivedOn);
   data.orderStatus=String(p.orderStatus||'未登録');if(!['未登録','商談中','受注済','保留','終了'].includes(data.orderStatus))throw new Error('受注状態を確認してください。');
   if(data.orderStatus==='受注済'&&!data.receivedOn)throw new Error('受注済にする場合は受注日を入力してください。');
   const linked=data.quoteId?quoteFind_('header',data.quoteId).data:null;
   const canSee=u.role==='ADMIN'||linked&&quoteVisible_(u,linked);
   data.orderValue=canSee?(p.orderValue===''||p.orderValue==null?'':quoteMoney_(p.orderValue,'受注金額',false)):(plan.orderValue||'');
   data.note=projectHubText_(p.note,'案件概要',2000,false);data.aliases=plan.aliases||'[]';
  }else if(kind==='task'){
   data.title=projectHubText_(p.title,'作業名',150,true);data.ownerId=String(p.ownerId||'');
   if(data.ownerId&&!getEmployees_().some(e=>e.employeeId===data.ownerId))throw new Error('作業担当者を確認してください。');
   data.startDate=projectHubDate_(p.startDate);data.dueDate=projectHubDate_(p.dueDate);
   if(data.startDate&&data.dueDate&&data.startDate>data.dueDate)throw new Error('作業の終了日は開始日以降に設定してください。');
   data.plannedMinutes=projectHubMinutes_(p.plannedHours,true);data.progress=Number(p.progress);
   if(!Number.isFinite(data.progress)||data.progress<0||data.progress>100)throw new Error('進捗率は0〜100で入力してください。');
   data.status=String(p.status||'未着手');if(!['未着手','進行中','確認待ち','完了','保留','非表示'].includes(data.status))throw new Error('作業状態を確認してください。');
   if(data.status==='完了')data.progress=100;if(data.progress===100&&data.status!=='非表示')data.status='完了';
   data.note=projectHubText_(p.note,'作業メモ',2000,false);
   if(!manager){['title','ownerId','startDate','dueDate','plannedMinutes'].forEach(k=>{if(String(data[k])!==String(existing[k]))throw new Error('担当者が変更できるのは進捗・状態・メモのみです。');});if(data.status==='非表示')throw new Error('作業を非表示にできるのは案件管理者です。');}
  }else if(kind==='resource'){
   data.title=projectHubText_(p.title,'資料名',150,true);data.kind=String(p.resourceKind||'その他');
   if(!['要件定義書','技術設計書','議事録','契約・受注','成果物','その他'].includes(data.kind))throw new Error('資料種別を確認してください。');
   data.url=companyDocsUrl_(p.url);data.body=projectHubText_(p.body,'資料本文',25000,false);if(!data.url&&!data.body)throw new Error('本文か資料リンクを入力してください。');
   data.status=String(p.status||'共有');if(!['共有','非表示'].includes(data.status))throw new Error('資料状態が不正です。');
  }else{
   data.kind=String(p.updateKind||'共有');if(!['共有','進捗','相談','決定事項'].includes(data.kind))throw new Error('共有種別を確認してください。');
   data.body=projectHubText_(p.body,'共有内容',3000,true);
  }
  const key=String(p.requestKey||'');if(!/^[A-Za-z0-9_-]{12,100}$/.test(key))throw new Error('送信識別子を確認してください。');
  const duplicate=!existing&&rows.find(x=>x.requestKey===key);
  if(duplicate){if(duplicate.createdBy!==u.employeeId||duplicate.projectId!==project.projectId||!Object.keys(data).every(k=>String(duplicate[k]||'')===String(data[k]||'')))throw new Error('同じ送信識別子で別の内容は保存できません。');return {ok:true,duplicate:true,id:duplicate.id||duplicate.projectId};}
  if(existing&&Number(p.revision)!==Number(existing.revision)){
   if(Object.keys(data).every(k=>String(existing[k]||'')===String(data[k]||'')))return {ok:true,duplicate:true,id:id};
   throw new Error('別の人が更新しました。最新情報を確認してから保存してください。');
  }
  const now=toTimestamp_(new Date()),record={...existing,...data,requestKey:existing?existing.requestKey:key};
  if(kind!=='plan')record.id=existing?existing.id:createId_('PH');
  record.createdAt=existing?existing.createdAt:now;record.createdBy=existing?existing.createdBy:u.employeeId;
  record.updatedAt=now;record.updatedBy=u.employeeId;record.revision=Number(existing&&existing.revision||0)+1;
  if(kind==='update')record.authorName=u.displayName||u.name;
  projectHubSaveRow_(kind,storage.sheets[kind],record);SpreadsheetApp.flush();
  let auditRecorded=true;try{appendAudit_({employeeId:u.employeeId,employeeName:u.name,operation:'プロジェクト'+(existing?'更新':'登録'),target:PROJECT_HUB_MODELS[kind].sheet,targetId:record.id||record.projectId,before:existing?auditJson_({revision:existing.revision}):'',after:auditJson_({revision:record.revision}),source:'WEB',result:'SUCCESS',note:project.name});}catch(_){auditRecorded=false;}
  return {ok:true,id:record.id||record.projectId,revision:record.revision,auditRecorded};
 });
}
function projectHubInvalidateWorklogs_(){cacheRemove_('fm:projectHub:worklog:v1');}
function projectHubRememberRename_(projectId,oldName,newName,admin){
 const storage=projectHubStorage_();if(!storage.ready)throw new Error('工数との連携を保つため、案件名を変更する前にバックアップ付きDB更新を行ってください。');
 const rows=projectHubRows_('plan',storage.sheets.plan);if(rows.some(p=>p.projectId!==projectId&&projectHubAliases_(p).includes(newName)))throw new Error('過去の別案件名と同じ名前は使えません。');
 const now=toTimestamp_(new Date()),old=rows.find(x=>x.projectId===projectId),record=old||{projectId,plannedMinutes:'',ownerId:'',quoteId:'',orderNo:'',receivedOn:'',orderValue:'',orderStatus:'未登録',note:'',createdAt:now,createdBy:admin.employeeId,requestKey:createId_('RENAME')};
 record.aliases=JSON.stringify([...new Set([...projectHubAliases_(record),oldName])]);record.updatedAt=now;record.updatedBy=admin.employeeId;record.revision=Number(record.revision||0)+1;projectHubSaveRow_('plan',storage.sheets.plan,record);
}

function projectHubValidateName_(projectId,name){
 const sh=getDb_().getSheetByName(PROJECT_HUB_MODELS.plan.sheet);if(!sh)return;
 if(projectHubRows_('plan',sh).some(p=>p.projectId!==projectId&&projectHubAliases_(p).some(a=>projectHubName_(a)===projectHubName_(name))))throw new Error('過去の別案件名と同じ名前は使えません。');
}
