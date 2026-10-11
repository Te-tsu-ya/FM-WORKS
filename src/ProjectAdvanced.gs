/* FM WORKS project extensions. Requires an ADMIN-approved, verified v16 schema migration.
 * All reads/writes are scoped by project membership. Files remain private to the
 * Apps Script deployer and are streamed only through session-checked RPCs. */
const PROJECT_ADV_FILE_MIMES=Object.freeze({
 'application/pdf':'.pdf','image/png':'.png','image/jpeg':'.jpg',
 'text/plain':'.txt','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx'
});
const PROJECT_ADV_MAX_FILE_BYTES=1572864;
function projectAdvancedSheet_(name,optional){
 const sheet=getDb_().getSheetByName(name);
 if(!sheet){if(optional)return null;throw new Error('プロジェクト拡張シートがありません。管理者がバックアップ付きDB更新を実施してください: '+name);}
 const expect=DB_SCHEMA_SPECS[name];
 if(!expect||schemaHeaderIssues_(sheet.getRange(1,1,1,expect.length).getDisplayValues()[0],expect).length)throw new Error('プロジェクト拡張シートの列構成が一致しません: '+name);
 return sheet;
}

function projectAdvancedRows_(name,optional,checkedSheet){
 const sheet=checkedSheet||projectAdvancedSheet_(name,optional);
 const last=sheet?sheet.getLastRow():0;if(last<2)return [];
 const width=DB_SCHEMA_SPECS[name].length;
 return sheet.getRange(2,1,last-1,width).getDisplayValues().map((r,i)=>{r._row=i+2;return r;}).filter(r=>r[0]);
}

function projectAdvancedNeed_(sessionToken,projectId,manage){
 const user=requireSession_(sessionToken).employee;
 const project=getProjectsInternal_(true).find(p=>p.projectId===String(projectId||''));
 if(!project)throw new Error('案件が見つかりません。');
 const storage=projectHubStorage_();
 const plans=projectHubRows_('plan',storage.sheets.plan,project.projectId);
 const plan=plans[0]||{};
 const tasks=projectHubRows_('task',storage.sheets.task,project.projectId).filter(t=>t.status!=='非表示');
 const manager=projectHubCanManage_(user,plan);
 const member=manager||tasks.some(t=>t.ownerId===user.employeeId);
 if(!member)throw new Error('この案件の詳細資料を扱う権限がありません。案件責任者に担当設定を依頼してください。');
 if(manage&&!manager)throw new Error('この設定は案件責任者または管理者のみ更新できます。');
 return {user,project,plan,tasks,manager,member};
}

function projectAdvancedReady_(sheets){
 const names=['プロジェクト工数対応','プロジェクト依存','プロジェクト添付','プロジェクト既読','プロジェクト原価','プロジェクト予算'];
 const missing=[];
 names.forEach(n=>{try{const sheet=projectAdvancedSheet_(n,true);if(!sheet)missing.push(n);else if(sheets)sheets[n]=sheet;}catch(err){missing.push(n+'（列不一致）');}});
 return {ready:missing.length===0,missing};
}

function projectAdvancedJsonList_(value){
 try{const v=JSON.parse(String(value||'[]'));return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch(_){return [];}
}

function projectAdvancedDependencyMap_(rows){
 const map=new Map();
 rows.forEach(row=>map.set(row[0],projectAdvancedJsonList_(row[2])));
 return map;
}

function projectAdvancedDetectCycle_(map){
 const active=new Set(),done=new Set();
 const visit=id=>{
  if(active.has(id))return true;
  if(done.has(id))return false;
  active.add(id);
  for(const dep of map.get(id)||[])if(visit(dep))return true;
  active.delete(id);done.add(id);return false;
 };
 for(const id of map.keys())if(visit(id))return true;
 return false;
}

function getProjectAdvanced(sessionToken,projectId){
 const ctx=projectAdvancedNeed_(sessionToken,projectId,false);
 const sheets={},status=projectAdvancedReady_(sheets),read=name=>projectAdvancedRows_(name,false,sheets[name]);
 if(!status.ready)return {setupRequired:true,missing:status.missing,canManage:ctx.manager,isAdmin:ctx.user.role==='ADMIN'};
 const deps=read('プロジェクト依存').filter(r=>r[1]===ctx.project.projectId);
 const docs=read('プロジェクト添付').filter(r=>r[1]===ctx.project.projectId&&r[8]!=='削除');
 const depsByTask=new Map(deps.map(r=>[r[0],{prerequisites:projectAdvancedJsonList_(r[2]),revision:Number(r[3]||0)}]));
 const taskMap=new Map(ctx.tasks.map(t=>[t.id,t]));
 const graph=ctx.tasks.map(t=>{
  const entry=depsByTask.get(t.id)||{prerequisites:[],revision:0};
  const blocking=entry.prerequisites.filter(id=>taskMap.has(id)&&Number(taskMap.get(id).progress)<100);
  const conflicting=entry.prerequisites.filter(id=>taskMap.has(id)&&t.startDate&&taskMap.get(id).dueDate&&taskMap.get(id).dueDate>t.startDate);
  return {taskId:t.id,title:t.title,prerequisites:entry.prerequisites,revision:entry.revision,blocking,conflicting};
 });
 const latestDocs=docs.map(r=>({id:r[0],projectId:r[1],resourceId:r[2],name:r[3],mime:r[4],bytes:Number(r[5]||0),version:Number(r[7]||1),createdAt:r[9],createdBy:r[10]})).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 const response={setupRequired:false,canManage:ctx.manager,isAdmin:ctx.user.role==='ADMIN',dependencies:graph,attachments:latestDocs,
  taskEffort:projectAdvancedTaskEffort_(ctx.project.projectId,ctx.tasks,sheets['プロジェクト工数対応'],ctx.project,ctx.plan),filesAccess:'案件責任者・案件の作業担当者・管理者のみ'};
 if(ctx.user.role==='ADMIN'){
  const budget=read('プロジェクト予算').find(r=>r[0]===ctx.project.projectId);
  response.budget=budget?{amount:Number(budget[1]||0),note:budget[2],revision:Number(budget[3]||0)}:{amount:null,note:'',revision:0};
  response.costs=read('プロジェクト原価').filter(r=>r[1]===ctx.project.projectId&&r[7]!=='削除')
    .map(r=>({id:r[0],date:r[2],kind:r[3],note:r[4],amount:Number(r[5]||0),revision:Number(r[6]||0)}));
  const orderValue=ctx.plan.orderValue===''||ctx.plan.orderValue==null?null:Number(ctx.plan.orderValue);
  const sum=response.costs.reduce((total,r)=>total+r.amount,0);
  response.financialSummary={orderValue:Number.isFinite(orderValue)?orderValue:null,manualCosts:sum,
   estimateDifference:Number.isFinite(orderValue)?orderValue-sum:null,
   note:'差額は登録済受注金額から手入力原価のみを差し引いた参考値です。会計上の粗利・売上確定額ではありません。'};
 }
 return response;
}

function projectAdvancedTaskEffort_(projectId,tasks,checkedSheet,project,plan){
 const refs=projectAdvancedRows_('プロジェクト工数対応',true,checkedSheet).filter(r=>r[1]===projectId&&r[2]);
 if(!refs.length)return [];
 project=project||getProjectsInternal_(true).find(p=>p.projectId===projectId);
 if(!project)return [];
 if(!plan)plan=projectHubRows_('plan',projectHubStorage_().sheets.plan,projectId)[0]||{};
 const names=new Set([project.name,...projectHubAliases_(plan)].map(projectHubName_));
 const linked=new Map(refs.map(r=>[r[0],r[2]]));
 const rows=projectHubWorklogRows_(false);
 const totals=new Map(tasks.map(t=>[t.id,0]));
 rows.forEach(r=>{
  const taskId=linked.get(r[0]);
  if(!taskId||r[12]==='削除'||!totals.has(taskId)||!names.has(projectHubName_(r[4])))return;
  const val=Number(r[9]||0);
  if(Number.isFinite(val)&&val>0)totals.set(taskId,totals.get(taskId)+val);
 });
 return tasks.map(t=>({taskId:t.id,plannedMinutes:Number(t.plannedMinutes)||0,actualMinutes:totals.get(t.id)||0}));
}

function saveProjectDependencies(sessionToken,projectId,taskId,prerequisites,expectedRevision){
 return withScriptLock_(function(){
  const ctx=projectAdvancedNeed_(sessionToken,projectId,true);
  projectAdvancedSheet_('プロジェクト依存');
  const task=ctx.tasks.find(t=>t.id===String(taskId));
  if(!task)throw new Error('作業が見つかりません。');
  if(!Array.isArray(prerequisites)||prerequisites.length>15)throw new Error('先行作業は最大15件まで選択してください。');
  const list=[...new Set(prerequisites.map(x=>String(x||'')))];
  if(list.some(x=>x===task.id||!ctx.tasks.some(t=>t.id===x)))throw new Error('同一案件の別作業のみ指定できます。');
  const rows=projectAdvancedRows_('プロジェクト依存',false).filter(r=>r[1]===ctx.project.projectId);
  const record=rows.find(r=>r[0]===task.id),rev=Number(record&&record[3]||0);
  if(rev!==Number(expectedRevision||0))throw new Error('別の人が作業依存を変更しました。再読込してください。');
  const map=projectAdvancedDependencyMap_(rows);map.set(task.id,list);
  if(projectAdvancedDetectCycle_(map))throw new Error('依存関係が循環しています。作業の順序を確認してください。');
  const entry=[task.id,ctx.project.projectId,JSON.stringify(list),rev+1,toTimestamp_(new Date()),ctx.user.employeeId];
  const sheet=projectAdvancedSheet_('プロジェクト依存');
  const rowNo=record?record._row:null;
  if(rowNo)sheet.getRange(rowNo,1,1,entry.length).setValues([entry]);
  else sheet.appendRow(entry);
  try{appendAudit_({employeeId:ctx.user.employeeId,employeeName:ctx.user.name,operation:'工程依存更新',target:'プロジェクト依存',targetId:task.id,before:record&&record[2]||'[]',after:JSON.stringify(list),source:'WEB',result:'SUCCESS',note:ctx.project.name});}catch(_){/* record saved; audit retry must not mutate dependency graph */}
  return {ok:true,revision:rev+1};
 });
}

function projectAdvancedUploadFolder_(){
 const props=PropertiesService.getScriptProperties(),key='FM_WORKS_PROJECT_PRIVATE_FILES_FOLDER_ID',id=props.getProperty(key);
 if(id)return DriveApp.getFolderById(id);
 const created=DriveApp.createFolder('FM WORKS - Private Project Attachments');
 props.setProperty(key,created.getId());
 return created;
}

function projectAdvancedFileBytes_(mime,base64,name){
 const ext=PROJECT_ADV_FILE_MIMES[mime];
 if(!ext||!(String(name||'').toLowerCase().endsWith(ext)||(mime==='image/jpeg'&&String(name||'').toLowerCase().endsWith('.jpeg'))))throw new Error('対応していないファイル形式です。PDF・画像・テキスト・DOCX・XLSXに限定しています。');
 if(!/^[a-zA-Z0-9+/]*={0,2}$/.test(base64||'')||!base64||base64.length>PROJECT_ADV_MAX_FILE_BYTES*1.4)throw new Error('ファイル形式またはサイズが不正です。');
 const bytes=Utilities.base64Decode(base64);
 if(!bytes.length||bytes.length>PROJECT_ADV_MAX_FILE_BYTES)throw new Error('ファイルは1.5MB以下にしてください。');
 const first=bytes.slice(0,8).map(b=>(b+256)%256);
 if(mime==='application/pdf'&&String.fromCharCode(...first.slice(0,4))!=='%PDF')throw new Error('PDFの内容が拡張子と一致しません。');
 if(mime==='image/png'&&first.slice(0,4).join(',')!=='137,80,78,71')throw new Error('PNGの内容が拡張子と一致しません。');
 if(mime==='image/jpeg'&&first.slice(0,2).join(',')!=='255,216')throw new Error('JPEGの内容が拡張子と一致しません。');
 if((mime.includes('officedocument'))&&first.slice(0,2).join(',')!=='80,75')throw new Error('Office文書の内容が拡張子と一致しません。');
 return bytes;
}

function uploadProjectAttachment(sessionToken,payload){
 const p=payload||{};
 return withScriptLock_(function(){
  const ctx=projectAdvancedNeed_(sessionToken,p.projectId,false);
  const sh=projectAdvancedSheet_('プロジェクト添付');
  const key=String(p.requestKey||'');
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(key))throw new Error('アップロード識別子が不正です。');
  const filename=String(p.name||'').trim();
  if(!filename||filename.length>130||/[\/\\<>:\x00-\x1f]/.test(filename))throw new Error('ファイル名を確認してください。');
  const mime=String(p.mime||'').trim();
  const existing=projectAdvancedRows_('プロジェクト添付',false).find(r=>r[11]===key);
  const resourceId=String(p.resourceId||'');
  if(existing){
   if(existing[1]!==ctx.project.projectId||existing[10]!==ctx.user.employeeId||existing[3]!==filename||existing[2]!==resourceId||existing[4]!==mime||existing[8]!=='有効')
    throw new Error('識別子が既存の別ファイルに使用されています。');
   const currentBytes=projectAdvancedFileBytes_(mime,String(p.base64||''),filename);
   const savedBytes=DriveApp.getFileById(existing[6]).getBlob().getBytes();
   if(currentBytes.length!==savedBytes.length||currentBytes.some((v,i)=>v!==savedBytes[i]))
    throw new Error('同じ送信識別子で異なるファイル内容を保存できません。');
   return {ok:true,duplicate:true,id:existing[0]};
  }
  if(resourceId){
   const storage=projectHubStorage_(),resource=projectHubRows_('resource',storage.sheets.resource,ctx.project.projectId).find(x=>x.id===resourceId);
   if(!resource||resource.status==='非表示')throw new Error('ひも付け先の資料が見つかりません。');
  }
  const bytes=projectAdvancedFileBytes_(mime,String(p.base64||''),filename);
  const rows=projectAdvancedRows_('プロジェクト添付',false),version=rows.filter(r=>r[1]===ctx.project.projectId&&r[2]===resourceId&&r[3]===filename).length+1;
  const blob=Utilities.newBlob(bytes,mime,filename),folder=projectAdvancedUploadFolder_();
  const driveFile=folder.createFile(blob),id=createId_('PHF');
  try{
   // The deployer's Google Drive remains private. Do not publish or return a raw Drive URL.
   sh.appendRow([id,ctx.project.projectId,resourceId,filename,mime,bytes.length,driveFile.getId(),version,'有効',toTimestamp_(new Date()),ctx.user.employeeId,key]);
  }catch(err){try{driveFile.setTrashed(true);}catch(_){}throw err;}
  try{appendAudit_({employeeId:ctx.user.employeeId,employeeName:ctx.user.name,operation:'案件添付登録',target:'プロジェクト添付',targetId:id,before:'',after:auditJson_({fileName:filename,bytes:bytes.length,version}),source:'WEB',result:'SUCCESS',note:ctx.project.name});}catch(_){}
  return {ok:true,id,version};
 });
}

function downloadProjectAttachment(sessionToken,attachmentId){
 const u=requireSession_(sessionToken).employee;
 const sh=projectAdvancedSheet_('プロジェクト添付'),rows=projectAdvancedRows_('プロジェクト添付',false);
 const r=rows.find(x=>x[0]===String(attachmentId)&&x[8]==='有効');
 if(!r)throw new Error('ファイルが見つかりません。');
 const ctx=projectAdvancedNeed_(sessionToken,r[1],false);
 if(ctx.user.employeeId!==u.employeeId)throw new Error('権限がありません。');
 const file=DriveApp.getFileById(r[6]),size=file.getSize();
 if(size>PROJECT_ADV_MAX_FILE_BYTES)throw new Error('ダウンロード制限を超えています。');
 const content=file.getBlob().getBytes();
 if(content.length>PROJECT_ADV_MAX_FILE_BYTES)throw new Error('ファイルサイズを確認してください。');
 return {name:r[3],mime:r[4],base64:Utilities.base64Encode(content),bytes:content.length};
}

function deleteProjectAttachment(sessionToken,attachmentId){
 return withScriptLock_(function(){
  const rows=projectAdvancedRows_('プロジェクト添付',false),record=rows.find(r=>r[0]===String(attachmentId));
  if(!record||record[8]!=='有効')throw new Error('対象ファイルがありません。');
  const ctx=projectAdvancedNeed_(sessionToken,record[1],false);
  if(!ctx.manager&&record[10]!==ctx.user.employeeId)throw new Error('削除できるのは登録者または案件責任者です。');
  projectAdvancedSheet_('プロジェクト添付').getRange(record._row,9).setValue('削除');
  // Keep the private Drive file for recovery; never auto-trash document history.
  try{appendAudit_({employeeId:ctx.user.employeeId,employeeName:ctx.user.name,operation:'案件添付非表示',target:'プロジェクト添付',targetId:record[0],before:'有効',after:'削除',source:'WEB',result:'SUCCESS',note:ctx.project.name});}catch(_){}
  return {ok:true};
 });
}

function saveProjectBudget(sessionToken,projectId,payload){
 return withScriptLock_(function(){
  const ctx=projectAdvancedNeed_(sessionToken,projectId,true);
  if(ctx.user.role!=='ADMIN')throw new Error('案件予算は経営管理者のみ変更できます。');
  const sheet=projectAdvancedSheet_('プロジェクト予算'),p=payload||{},value=Number(p.amount);
  if(!Number.isSafeInteger(value)||value<0||value>100000000000)throw new Error('予算額を円単位で入力してください。');
  const note=safeSheetText_(p.note,500),rows=projectAdvancedRows_('プロジェクト予算',false);
  const record=rows.find(r=>r[0]===ctx.project.projectId),revision=record?Number(record[3]||0):0;
  if(revision!==Number(p.revision||0))throw new Error('別の人が予算を更新しました。再読込してください。');
  const next=[ctx.project.projectId,value,note,revision+1,toTimestamp_(new Date()),ctx.user.employeeId];
  if(record)sheet.getRange(record._row,1,1,next.length).setValues([next]);else sheet.appendRow(next);
  try{appendAudit_({employeeId:ctx.user.employeeId,employeeName:ctx.user.name,operation:'案件予算変更',target:'プロジェクト予算',targetId:ctx.project.projectId,before:record&&record[1]||'',after:String(value),source:'WEB',result:'SUCCESS',note:ctx.project.name});}catch(_){}
  return {ok:true,revision:revision+1};
 });
}

function saveProjectCost(sessionToken,projectId,payload){
 return withScriptLock_(function(){
  const ctx=projectAdvancedNeed_(sessionToken,projectId,true);
  if(ctx.user.role!=='ADMIN')throw new Error('案件原価は経営管理者のみ登録できます。');
  const p=payload||{},sheet=projectAdvancedSheet_('プロジェクト原価'),rows=projectAdvancedRows_('プロジェクト原価',false);
  const amount=Number(p.amount),date=String(p.date||'');
  if(!Number.isSafeInteger(amount)||amount<0||amount>10000000000)throw new Error('原価を円単位で入力してください。');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('原価発生日を確認してください。');
  const kind=String(p.kind||'その他');if(!['外注','材料','交通','社内人件費','その他'].includes(kind))throw new Error('原価区分を確認してください。');
  const note=safeSheetText_(p.note,400),key=String(p.requestKey||'');
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(key))throw new Error('送信識別子が不正です。');
  const match=rows.find(r=>r[10]===key);
  if(match){if(match[1]!==ctx.project.projectId||match[9]!==ctx.user.employeeId||match[7]!=='有効'||match[2]!==date||match[3]!==kind||match[4]!==note||Number(match[5])!==amount)throw new Error('送信識別子の内容が一致しません。');return {ok:true,id:match[0],duplicate:true};}
  const id=createId_('PHC');
  sheet.appendRow([id,ctx.project.projectId,date,kind,note,amount,1,'有効',toTimestamp_(new Date()),ctx.user.employeeId,key]);
  try{appendAudit_({employeeId:ctx.user.employeeId,employeeName:ctx.user.name,operation:'案件原価登録',target:'プロジェクト原価',targetId:id,before:'',after:auditJson_({date,kind,amount}),source:'WEB',result:'SUCCESS',note:ctx.project.name});}catch(_){}
  return {ok:true,id};
 });
}

function projectAdvancedWorklogPrepare_(payload,project,actor,recordId){
 const taskId=String(payload&&payload.taskId||'').trim(),key=String(payload&&payload.requestKey||'').trim();
 const existingSheet=projectAdvancedSheet_('プロジェクト工数対応',true);
 if(!existingSheet){
  if(taskId)throw new Error('作業別工数連携を使うには管理者によるバックアップ付きDB更新が必要です。');
  return {sheet:null,taskId:'',requestKey:''};
 }
 if(key&&!/^[A-Za-z0-9_-]{16,100}$/.test(key))throw new Error('工数送信識別子が不正です。');
 const rows=projectAdvancedRows_('プロジェクト工数対応',false);
 const duplicate=key?rows.find(r=>r[5]===key):null;
 if(duplicate){
  if(duplicate[1]!==String(project.projectId)||duplicate[4]!==actor.employeeId||duplicate[2]!==taskId)throw new Error('送信識別子が別の工数内容に使われています。');
  return {sheet:existingSheet,taskId,requestKey:key,duplicateId:duplicate[0]};
 }
 if(taskId){
  if(!project.projectId)throw new Error('関連先の案件IDが見つかりません。');
  const storage=projectHubStorage_();
  const data=projectHubRows_('task',storage.sheets.task,String(project.projectId));
  const task=data.find(t=>t.id===taskId&&t.status!=='非表示');
  if(!task)throw new Error('選択した作業は案件に存在しません。');
  const plan=projectHubRows_('plan',storage.sheets.plan,String(project.projectId))[0]||{};
  if(actor.role!=='ADMIN'&&plan.ownerId!==actor.employeeId&&task.ownerId!==actor.employeeId)
    throw new Error('担当外の作業には工数を関連付けできません。案件全体の工数として記録してください。');
 }
 return {sheet:existingSheet,taskId,requestKey:key,rows,recordId};
}

function projectAdvancedWorklogCommit_(prepared,recordId,project,actor){
 if(!prepared||!prepared.sheet)return;
 const row=prepared.rows.find(r=>r[0]===recordId);
 const entry=[recordId,String(project.projectId||''),prepared.taskId,toTimestamp_(new Date()),actor.employeeId,prepared.requestKey||row&&row[5]||''];
 if(row)prepared.sheet.getRange(row._row,1,1,entry.length).setValues([entry]);
 else prepared.sheet.appendRow(entry);
}

function projectAdvancedWorklogIds_(items){
 const scoped=Array.isArray(items)?items:[];
 // In particular, opening an empty day must not read the full worklog-task link sheet.
 if(!scoped.length)return [];
 const sheet=projectAdvancedSheet_('プロジェクト工数対応',true);
 if(!sheet)return scoped.map(item=>({...item,taskId:''}));
 const ids=[...new Set(scoped.map(item=>String(item&&item.id||'').trim()).filter(Boolean))];
 // Use a narrow indexed read for sparse visible worklogs in a large link sheet.
 // Large result sets and small sheets retain the existing full read semantics.
 const count=sheet.getLastRow();
 const rows=ids.length&&ids.length<=24&&count>250
  ?readRowsByColumnValues_(sheet,1,DB_SCHEMA_SPECS['プロジェクト工数対応'].length,ids)
  :projectAdvancedRows_('プロジェクト工数対応',false,sheet);
 const map=new Map(rows.map(r=>[r[0],r[2]]));
 return scoped.map(item=>({...item,taskId:map.get(item.id)||''}));
}

function projectAdvancedTaskOptions_(user){
 if(!projectAdvancedSheet_('プロジェクト工数対応',true))return [];
 const status=projectHubStorage_();if(!status.ready)return [];
 const plans=projectHubRows_('plan',status.sheets.plan),tasks=projectHubRows_('task',status.sheets.task);
 const managers=new Set(plans.filter(p=>p.ownerId===user.employeeId).map(p=>p.projectId));
 const projects=new Map(getProjectsInternal_(false).filter(p=>p.status==='進行中').map(p=>[p.projectId,p]));
 return tasks.filter(t=>t.status!=='非表示'&&projects.has(t.projectId)&&(user.role==='ADMIN'||managers.has(t.projectId)||t.ownerId===user.employeeId))
  .map(t=>({id:t.id,projectId:t.projectId,project:projects.get(t.projectId).name,title:t.title,status:t.status}));
}

function projectAdvancedAlerts_(employee,includeRead){
 const ready=projectAdvancedReady_();if(!ready.ready)return [];
 const storage=projectHubStorage_();if(!storage.ready)return [];
 const projects=new Map(getProjectsInternal_(false).map(p=>[p.projectId,p]));
 const plans=projectHubRows_('plan',storage.sheets.plan);
 const tasks=projectHubRows_('task',storage.sheets.task).filter(t=>t.status!=='非表示');
 const memberProjects=new Set(plans.filter(p=>p.ownerId===employee.employeeId).map(p=>p.projectId));
 tasks.filter(t=>t.ownerId===employee.employeeId).forEach(t=>memberProjects.add(t.projectId));
 if(employee.role==='ADMIN')projects.forEach((_,id)=>memberProjects.add(id));
 const seen=new Set(projectAdvancedRows_('プロジェクト既読',false).filter(r=>r[0]===employee.employeeId).map(r=>r[1]));
 const today=projectHubToday_(),until=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
 const result=[];
 tasks.filter(t=>t.ownerId===employee.employeeId&&t.status!=='完了'&&Number(t.progress)<100&&t.dueDate&&t.dueDate<=until&&projects.has(t.projectId))
  .forEach(t=>{
   const event='TASK-'+t.id+'-'+String(t.dueDate).replace(/-/g,'')+'-'+(t.dueDate<today?'LATE':'SOON');
   if(seen.has(event)&&!includeRead)return;
   result.push({type:'案件作業',title:t.title,subtitle:(projects.get(t.projectId).name||'案件')+' / 期限 '+t.dueDate,
    route:'projects',projectId:t.projectId,notificationId:event,priority:t.dueDate<today?'danger':'warning'});
  });
 const updates=projectHubRows_('update',storage.sheets.update).filter(u=>memberProjects.has(u.projectId)&&u.createdBy!==employee.employeeId&&projects.has(u.projectId));
 updates.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
 updates.slice(0,30).forEach(u=>{
  const event='MEMO-'+u.id;
  if(seen.has(event)&&!includeRead)return;
  result.push({type:'案件共有',title:u.kind==='決定事項'?'案件の決定事項':'案件の共有メモ',
    subtitle:projects.get(u.projectId).name+' / '+String(u.body||'').slice(0,80),route:'projects',
    projectId:u.projectId,notificationId:event,priority:u.kind==='決定事項'?'warning':'normal'});
 });
 return includeRead?result:result.slice(0,12);
}

function markProjectAlertRead(sessionToken,notificationId){
 return withScriptLock_(function(){
  const employee=requireSession_(sessionToken).employee,id=String(notificationId||'');
  if(!/^(TASK|MEMO)-[A-Za-z0-9_-]{3,100}$/.test(id))throw new Error('通知IDが不正です。');
  const alerts=projectAdvancedAlerts_(employee,true);
  if(!alerts.some(item=>item.notificationId===id))throw new Error('通知の閲覧権限がありません。');
  const sheet=projectAdvancedSheet_('プロジェクト既読');
  const existing=projectAdvancedRows_('プロジェクト既読',false).find(r=>r[0]===employee.employeeId&&r[1]===id);
  if(existing)return {ok:true,duplicate:true};
  sheet.appendRow([employee.employeeId,id,toTimestamp_(new Date())]);
  return {ok:true};
 });
}

function deleteProjectCost(sessionToken,projectId,costId){
 return withScriptLock_(function(){
  const ctx=projectAdvancedNeed_(sessionToken,projectId,true);
  if(ctx.user.role!=='ADMIN')throw new Error('経営管理者のみ原価記録を修正できます。');
  const record=projectAdvancedRows_('プロジェクト原価',false).find(r=>r[0]===String(costId)&&r[1]===ctx.project.projectId);
  if(!record||record[7]==='削除')throw new Error('原価記録が見つかりません。');
  const sh=projectAdvancedSheet_('プロジェクト原価'),next=record.slice(0,11);
  next[7]='削除';next[6]=Number(record[6]||0)+1;next[8]=toTimestamp_(new Date());next[9]=ctx.user.employeeId;
  sh.getRange(record._row,1,1,11).setValues([next]);
  try{appendAudit_({employeeId:ctx.user.employeeId,employeeName:ctx.user.name,operation:'案件原価取消',target:'プロジェクト原価',targetId:record[0],before:record[5],after:'削除',source:'WEB',result:'SUCCESS',note:ctx.project.name});}catch(_){}
  return {ok:true};
 });
}
