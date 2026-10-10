import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Sheet {
 constructor(rows){this.rows=rows;this.reads=[];}
 getLastRow(){return this.rows.length;}
 getRange(row,col,n=1,width=1){const sheet=this;return {
 getDisplayValues(){sheet.reads.push({row,col,n,width});return Array.from({length:n},(_,i)=>Array.from({length:width},(_,j)=>String(sheet.rows[row+i-1]?.[col+j-1]??'')));},
 setValues(values){values.forEach((r,i)=>{while(sheet.rows.length<row+i)sheet.rows.push([]);r.forEach((v,j)=>sheet.rows[row+i-1][col+j-1]=v);});}
 };}
}
const users=[{employeeId:'A',name:'管理者',role:'ADMIN'},{employeeId:'M',name:'上司',role:'MANAGER'},{employeeId:'E',name:'担当',role:'EMPLOYEE',managerId:'M'},{employeeId:'X',name:'別担当',role:'EMPLOYEE'}];
const sheets={},cache=new Map();let seq=0,auditFails=false;
const ctx=vm.createContext({console,DB:{timeZone:'Asia/Tokyo',sheets:{projects:'プロジェクト'}},getDb_:()=>({getSheetByName:name=>sheets[name]||null}),
 requireSession_:token=>{const employee=users.find(u=>u.employeeId===token);if(!employee)throw Error('認証が必要');return {employee};},
 requireAdminSession_:token=>{if(token!=='A')throw Error('管理者のみ');return {employee:users[0]};},getEmployees_:()=>users,
 withScriptLock_:fn=>fn(),cacheJsonGet_:key=>cache.get(key)||null,cacheJsonPut_:(key,v)=>cache.set(key,v),cacheRemove_:key=>cache.delete(key),
 Utilities:{formatDate:()=> '2026-10-10'},SpreadsheetApp:{flush:()=>{}},createId_:prefix=>prefix+'-'+(++seq),toTimestamp_:()=> '2026-10-10 12:00:00',
 safeSheetText_:(v,max)=>{let s=String(v??'').trim();if(s.length>max)throw Error('長すぎます');if(/^[=+@-]/.test(s))s="'"+s;return s;},
 normalizeDate_:v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('日付不正');return v;},
 auditJson_:v=>JSON.stringify(v),appendAudit_:()=>{if(auditFails)throw Error('audit unavailable');}
});
for(const file of ['Schema.gs','Quotes.gs','CompanyDocs.gs','Projects.gs','ProjectHub.gs'])vm.runInContext(fs.readFileSync('src/'+file,'utf8'),ctx,{filename:file});
const run=code=>vm.runInContext(code,ctx),plain=value=>JSON.parse(JSON.stringify(value));
const specs=plain(run('DB_SCHEMA_SPECS')),models=plain(run('PROJECT_HUB_MODELS'));
for(const m of Object.values(models))sheets[m.sheet]=new Sheet([specs[m.sheet]]);
sheets['プロジェクト']=new Sheet([['ID','案件','顧客','状態','開始','終了','備考','更新者','日時'],['PRJ-001','現案件','顧客','進行中','2026-10-01','2026-10-31','','',''],['PRJ-002','別案件','別顧客','進行中','','','','','']]);
const log=(id,employee,project,minutes,status='有効')=>[id,'2026-10-09',employee,users.find(u=>u.employeeId===employee)?.name,project,'開発','作業-'+employee,'09:00','10:00',minutes,'','',''+status,'',''];
sheets['工数']=new Sheet([Array(15).fill('header'),log('L1','E','現案件',60),log('L2','X','旧案件',120),log('L3','E','現案件',999,'削除'),log('L4','X','未紐付',30)]);
const qkeys=plain(run('QUOTE_MODEL.header.keys'));sheets['見積ヘッダー']=new Sheet([specs['見積ヘッダー'],...[
 {id:'Q1',ownerId:'E',status:'発行済',number:'Q-1',subject:'正式',total:110000},
 {id:'Q2',ownerId:'X',status:'発行済',number:'Q-2',total:99000},
 {id:'Q3',ownerId:'E',status:'下書き',total:100}
].map(q=>qkeys.map(k=>q[k]??''))]);
const save=(token,kind,payload)=>ctx.saveProjectHubRecord(token,kind,payload);
let keySeq=0;const key=()=> 'TEST-request-'+(++keySeq);
const plan={projectId:'PRJ-001',plannedHours:10,ownerId:'M',quoteId:'Q1',orderNo:'O-1',receivedOn:'2026-10-02',orderStatus:'受注済',orderValue:110000,note:'概要',requestKey:key(),revision:0};
assert.throws(()=>ctx.getProjectHubWorkspace('bad'),/認証/);
assert.throws(()=>save('E','plan',plan),/責任者/);
assert.throws(()=>save('A','plan',{...plan,receivedOn:''}),/受注日/);
save('A','plan',plan);
assert.equal(save('A','plan',plan).duplicate,true,'lost create response does not duplicate plan');
assert.throws(()=>save('M','plan',{...plan,quoteId:'Q2',revision:1,requestKey:key()}),/閲覧/);
assert.throws(()=>save('M','plan',{...plan,quoteId:'Q3',revision:1,requestKey:key()}),/正式/);
const task={projectId:'PRJ-001',title:'開発',ownerId:'E',startDate:'2026-10-01',dueDate:'2026-10-11',plannedHours:8,progress:50,status:'進行中',note:'',revision:0,requestKey:key()};
const t1=save('M','task',task);
assert.equal(save('M','task',task).duplicate,true);
assert.throws(()=>save('M','task',{...task,title:'違う内容'}),/送信識別子/);
save('M','task',{...task,title:'確認',plannedHours:2,progress:0,ownerId:'X',requestKey:key()});
assert.throws(()=>save('X','task',{...task,requestKey:key()}),/権限/);
assert.throws(()=>save('E','task',{...task,id:t1.id,revision:1,plannedHours:9}),/進捗/);
assert.throws(()=>save('M','task',{...task,id:'UNKNOWN'}),/見つかりません/);
const resource={projectId:'PRJ-001',title:'要件 <script>',resourceKind:'要件定義書',body:'=secret',url:'https://example.com/spec',status:'共有',revision:0,requestKey:key()};
const r1=save('E','resource',resource);
assert.equal(save('E','resource',resource).duplicate,true);
assert.throws(()=>save('E','resource',{...resource,url:'javascript:alert(1)',requestKey:key()}),/HTTPS/);
assert.throws(()=>save('X','resource',{...resource,id:r1.id,revision:1}),/権限/);
assert.throws(()=>save('E','resource',{...resource,id:r1.id,body:'changed',revision:0}),/別の人/);
auditFails=true;const upd={projectId:'PRJ-001',updateKind:'決定事項',body:'仕様を決定',requestKey:key()};assert.equal(save('E','update',upd).auditRecorded,false);auditFails=false;
assert.equal(save('E','update',upd).duplicate,true);
ctx.projectHubRememberRename_('PRJ-001','旧案件','現案件',users[0]);
ctx.projectHubInvalidateWorklogs_();
save('X','resource',{...resource,projectId:'PRJ-002',title:'別案件の本文',body:'other-project-body',requestKey:key()});sheets['プロジェクト資料'].reads=[];
const workspace=plain(ctx.getProjectHubWorkspace('E'));
assert.ok(sheets['プロジェクト資料'].reads.every(r=>r.row===1||!(r.col<=6&&r.col+r.width>6)),'workspace does not fetch document bodies');
assert.equal(workspace.projects[0].actualMinutes,180,'current and historical names link, deleted worklogs excluded');
assert.equal(workspace.projects[0].progress,40,'8h at 50% plus 2h at 0% = 40%, not effort consumption');
assert.equal(workspace.projects[0].usagePercent,30);
assert.equal(workspace.projects[0].scheduledProgress,90);
assert.equal(workspace.unlinkedWorklogCount,1);
assert.deepEqual(workspace.quoteOptions.map(q=>q.id),['Q1']);
assert.equal(workspace.projects[0].resourceCount,1);
sheets['プロジェクト資料'].reads=[];const detail=plain(ctx.getProjectHubDetail('E','PRJ-001'));
assert.ok(sheets['プロジェクト資料'].reads.filter(r=>r.row>=2&&r.col===1&&r.width>6).every(r=>r.row===2&&r.n===1),'detail fetches only selected project document bodies');
assert.equal(detail.worklogs.length,1);assert.equal(detail.byPerson.length,1);assert.equal(detail.metrics.actualMinutes,180);
assert.equal(detail.canSeeOrderValue,true);assert.equal(detail.resources[0].body,"'=secret");
assert.equal(ctx.getProjectHubDetail('M','PRJ-001').worklogs.length,1);
assert.equal(ctx.getProjectHubDetail('A','PRJ-001').worklogs.length,2);
assert.equal(ctx.getProjectHubDetail('X','PRJ-001').plan.orderValue,undefined,'foreign quote money stays private');
assert.throws(()=>ctx.getProjectHubDetail('E','unknown'),/見つかりません/);
assert.throws(()=>ctx.projectHubValidateName_('PRJ-002',' 旧案件 '),/過去/);
const updateTask={...task,id:t1.id,revision:1,progress:75};save('E','task',updateTask);
assert.equal(save('E','task',updateTask).duplicate,true,'lost update response accepts exact same stale revision');
assert.throws(()=>save('E','task',{...updateTask,progress:80}),/別の人/);
assert.equal(ctx.projectHubMetrics_({status:'進行中'},{},[],[], '2026-10-10').progress,null);
const completed=save('M','task',{...task,title:'誤登録',progress:100,status:'完了',requestKey:key()});save('M','task',{...task,id:completed.id,title:'誤登録',progress:100,status:'非表示',revision:1,requestKey:key()});assert.ok(!ctx.getProjectHubDetail('A','PRJ-001').tasks.some(t=>t.id===completed.id),'completed erroneous task can be hidden');
const keep=sheets['プロジェクト資料'];delete sheets['プロジェクト資料'];assert.equal(ctx.getProjectHubWorkspace('E').setupRequired,true);assert.equal(ctx.getProjectHubWorkspace('E').projects[0].actualMinutes,60);assert.throws(()=>save('A','plan',plan),/DB更新/);sheets['プロジェクト資料']=keep;
keep.rows[0][0]='不一致';assert.throws(()=>ctx.getProjectHubWorkspace('E'),/列構成/);keep.rows[0][0]=specs['プロジェクト資料'][0];

// Large workspace regression: index projects, aliases, tasks and worklogs without changing totals.
const preservedProjectRows=sheets['プロジェクト'].rows.slice();
const preservedLogRows=sheets['工数'].rows.slice();
for(let i=1;i<=90;i++){
 const id='PRJ-LOAD-'+String(i).padStart(3,'0');
 const name='架空負荷案件 '+String(i).padStart(3,'0');
 sheets['プロジェクト'].rows.push([id,name,'架空顧客','進行中','','','','','']);
 for(let j=0;j<12;j++)sheets['工数'].rows.push(log('LOAD-'+i+'-'+j,'E',name,30));
}
ctx.invalidateProjectCache_();ctx.projectHubInvalidateWorklogs_();
const largeWorkspace=plain(ctx.getProjectHubWorkspace('A',true));
assert.equal(largeWorkspace.projects.length,92,'all 90 synthetic projects are included');
for(let i=1;i<=90;i++){
 const id='PRJ-LOAD-'+String(i).padStart(3,'0');
 assert.equal(largeWorkspace.projects.find(p=>p.projectId===id).actualMinutes,360,'all project worklogs remain correctly grouped');
}
assert.equal(largeWorkspace.unlinkedWorklogCount,1,'unlinked legacy worklogs are counted once');
sheets['プロジェクト'].rows=preservedProjectRows;sheets['工数'].rows=preservedLogRows;
ctx.invalidateProjectCache_();ctx.projectHubInvalidateWorklogs_();
const invalidDateMetric=plain(ctx.projectHubMetrics_({status:'進行中'},{},[{plannedMinutes:60,progress:35,startDate:'2026-99-99',dueDate:'2026-10-11'}],[], '2026-10-10'));
assert.equal(invalidDateMetric.scheduledProgress,null,'invalid imported dates never become NaN schedule percentages');

console.log('PASS project backend: real sheets/quote helpers, aggregates, permissions, revisions, duplicate retries, renames and migration gates');

// Client behavior with controlled asynchronous GAS responses.
const calls=[];const runner=(meta={})=>new Proxy({}, {get(_,method){if(method==='withSuccessHandler')return success=>runner({...meta,success});if(method==='withFailureHandler')return failure=>runner({...meta,failure});return (...args)=>calls.push({method,args,...meta});}});
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const client=vm.createContext({state:{page:'projects',sessionToken:'E',data:{today:'2026-10-10',user:users[2],permissions:{}}},google:{script:{run:runner()}},document:{getElementById:()=>null,querySelectorAll:()=>[]},window:{addEventListener:()=>{}},renderPageIfActive:()=>{},showToast:()=>{},openConfirmDialog:(_t,_m,_l,callback)=>callback(),escapeHtml,cleanApiErrorMessage:e=>e.message,navigate:()=>{}});
vm.runInContext(fs.readFileSync('src/AppProjectHub.html','utf8').replace(/<\/?script>/g,''),client);
const cr=code=>vm.runInContext(code,client);
client.loadProjectHub();assert.equal(calls.length,1);calls[0].success(workspace);assert.equal(calls.length,1,'portfolio opening never preloads unrelated project details');client.projectHubSelect_('PRJ-001');assert.equal(calls.length,2,'selected record loads one detail');calls[1].success(detail);
client.loadProjectHub();for(const tab of ['tasks','effort','resources','updates','overview'])client.projectHubTab_(tab);client.projectHubTogglePicker_();assert.equal(cr('projectHubUi.pickerOpen'),true);client.projectHubTogglePicker_();assert.equal(calls.length,2,'cached route, project selector and all tabs produce no extra RPC');
assert.ok(cr('projectHubPage()').includes('作業の完成度'));client.projectHubTab_('resources');assert.ok(cr('projectHubPage()').includes('&lt;script&gt;'));
client.projectHubOpenResource_('');client.projectHubField_('body','保存前の本文');const requestKey=cr('projectHubUi.editor.form.requestKey');client.projectHubSave_();const request=calls.at(-1);request.failure(Error('network'));assert.equal(cr('projectHubUi.editor.form.body'),'保存前の本文');client.projectHubSave_();assert.equal(calls.at(-1).args[2].requestKey,requestKey,'failed retry uses same identity');calls.at(-1).success({ok:true});
const fresh=calls.at(-1);fresh.success(workspace);const newDetail=calls.at(-1);newDetail.success(detail);
client.loadProjectHub({force:true});const stale=calls.at(-1);client.projectHubInvalidate_();stale.success(workspace);assert.notEqual(calls.at(-1),stale,'invalidated read triggers fresh request');const replacement=calls.at(-1);
client.resetProjectHubUi();replacement.success(workspace);assert.equal(cr('projectHubUi.data'),null,'old session callback discarded');
client.loadProjectHub();calls.at(-1).success(workspace);client.projectHubSelect_('PRJ-001');calls.at(-1).success(detail);
client.projectHubOpenResource_('');client.projectHubField_('body','ひな形で上書きしない');client.projectHubUseTemplate_();assert.equal(cr('projectHubUi.editor.form.body'),'ひな形で上書きしない');
client.loadProjectHub({force:true});assert.doesNotThrow(()=>cr('projectHubPage()'),'refresh during editing uses retained detail context');calls.at(-1).success(workspace);calls.at(-1).success({...detail,resources:[...detail.resources]});
// A conflict keeps the draft until the employee explicitly adopts the latest revision.
client.resetProjectHubUi();cr('projectHubUi.data='+JSON.stringify(workspace)+';projectHubUi.selected="PRJ-001";projectHubUi.details.set("PRJ-001",{data:'+JSON.stringify(detail)+',at:Date.now()});');client.projectHubOpenResource_(r1.id);client.projectHubField_('body','自分の変更');
cr('projectHubUi.details.get("PRJ-001").data.resources[0].revision=2');assert.ok(cr('projectHubPage()').includes('最新の登録内容を確認'));assert.equal(cr('projectHubUi.editor.form.revision'),1);client.projectHubAcceptLatest_();assert.equal(cr('projectHubUi.editor.form.revision'),2);assert.equal(cr('projectHubUi.editor.form.body'),'自分の変更');
client.resetProjectHubUi();assert.equal(cr('projectHubUi.editor'),null);
cr('projectHubUi.data='+JSON.stringify(workspace)+';projectHubUi.selected="PRJ-001";projectHubUi.details.set("PRJ-001",{data:'+JSON.stringify(detail)+',at:Date.now()});');
client.projectHubHideResource_(r1.id);assert.equal(calls.at(-1).args[2].status,'非表示');calls.at(-1).failure(Error('network'));client.projectHubSave_();assert.equal(calls.at(-1).args[2].status,'非表示','failed hide retry keeps confirmed operation');client.resetProjectHubUi();
cr('projectHubUi.data='+JSON.stringify(workspace)+';projectHubUi.selected="PRJ-001";projectHubUi.details.set("PRJ-001",{data:'+JSON.stringify({...detail,canSeeOrderValue:false,plan:{...detail.plan,quoteId:'Q2',orderValue:undefined}})+',at:Date.now()});');client.projectHubOpenPlan_();assert.ok(!cr('projectHubPage()').includes('id="ph-orderValue"'));client.projectHubField_('quoteId','Q1');assert.ok(cr('projectHubPage()').includes('id="ph-orderValue"'),'selecting a visible quote exposes its order amount field');client.resetProjectHubUi();
// Portfolio and manager screens are client-only, secure and reusable across routes.
cr('projectHubUi.data='+JSON.stringify(workspace)+';projectHubUi.selected="PRJ-001";projectHubUi.view="list";');
assert.ok(cr('projectHubPage()').includes('案件一覧'),'portfolio is default daily entry');
assert.ok(cr('projectHubPage()').includes('期限が近い順'),'portfolio has deadline sorting');
client.projectHubSelect_('PRJ-001');assert.equal(cr('projectHubUi.view'),'detail','opening a project uses the record page');
client.projectHubOpenList_();assert.equal(cr('projectHubUi.view'),'list','breadcrumb returns to portfolio');
client.projectHubFilter_('risk');assert.equal(cr('projectHubUi.filter'),'risk');
client.projectHubFilter_('all');
assert.ok(!cr('projectHubPage()').includes('管理者ダッシュボード'),'employee cannot see manager tab');
client.projectHubOpenManagement_();assert.equal(cr('projectHubUi.view'),'list','employee cannot enter manager mode');
client.projectHubSearch_('<script>');assert.ok(!cr('projectHubPage()').includes('<script>'),'project search stays escaped');
client.projectHubSearch_('');

// Project workspace tabs must remain client-side and preserve server permissions.
cr('projectHubUi.data='+JSON.stringify(workspace)+';projectHubUi.selected="PRJ-001";projectHubUi.view="detail";projectHubUi.details.set("PRJ-001",{data:'+JSON.stringify(detail)+',at:Date.now()});');
const projectRequestsBefore=calls.length;
client.projectHubTab_('tasks');
client.projectHubTaskView_('board');
assert.ok(cr('projectHubPage()').includes('ph-kanban-board'),'tasks board displays existing records');
client.projectHubTaskView_('timeline');
assert.ok(cr('projectHubPage()').includes('ph-timeline-scroll'),'dated tasks render a timeline');
client.projectHubTaskView_('list');
assert.ok(cr('projectHubPage()').includes('ph-task-list'),'task list still available');
assert.equal(calls.length,projectRequestsBefore,'task view changes do not fetch new data');
client.projectHubTab_('effort');
assert.ok(cr('projectHubPage()').includes('工数消化率'),'effort view explicitly separates consumption');
assert.ok(cr('projectHubPage()').includes('本人のみ'),'personal worklog scope is explained');
client.projectHubTab_('resources');
client.projectHubResourceFilter_('要件定義書');
assert.equal(cr('projectHubResourceMatches_(projectHubDetail_()).length'),1,'resource category filter');
client.projectHubResourceQuery_('<script>');
assert.ok(cr('projectHubPage()').includes('&lt;script&gt;'),'document title remains escaped after text search');
assert.ok(!cr('projectHubPage()').includes('href="javascript:'),'resource links cannot gain javascript URL');
client.projectHubResourceQuery_('not-found');
assert.equal(cr('projectHubResourceMatches_(projectHubDetail_()).length'),0,'resource search handles empty results');
client.projectHubResourceQuery_('');
client.projectHubCreateResourceKind_('議事録');
assert.equal(cr('projectHubUi.editor.form.resourceKind'),'議事録','document shortcut selects correct category');
client.resetProjectHubUi();
cr('projectHubUi.data='+JSON.stringify(workspace)+';projectHubUi.selected="PRJ-001";projectHubUi.view="detail";projectHubUi.details.set("PRJ-001",{data:'+JSON.stringify(detail)+',at:Date.now()});');
client.projectHubTab_('updates');client.projectHubUpdateType_('決定事項');
assert.equal(cr('projectHubUpdateVisible_(projectHubDetail_()).length'),1,'decision type filtering');
client.projectHubUpdateQuery_('仕様');assert.equal(cr('projectHubUpdateVisible_(projectHubDetail_()).length'),1,'decision keyword search');
client.projectHubUpdateQuery_('<script>');assert.equal(cr('projectHubUpdateVisible_(projectHubDetail_()).length'),0,'no XSS executed via search');
client.projectHubUpdateQuick_('相談');
assert.equal(cr('projectHubUi.editor.form.updateKind'),'相談','shared memo shortcut selects actual type');
client.resetProjectHubUi();
assert.equal(calls.length,projectRequestsBefore,'local tab/filter operations trigger no extra RPC');

// Exercise the simplified master form without making any real DB writes.
let modalNode={innerHTML:''};
const fieldNodes={
 prjName:{value:'  案件テスト  ',focus:()=>{}},prjClient:{value:'顧客A'},prjStatus:{value:'進行中'},
 prjStart:{value:'2026-11-02'},prjEnd:{value:'2026-10-10',focus:()=>{}},prjNote:{value:'任意の詳細'},
 prjSaveButton:{disabled:false,textContent:'登録して案件を開く'},projectMasterError:{textContent:''}
};
const modalContext=vm.createContext({
 state:{page:'projects',sessionToken:'A',authAdmin:{projects:[]},data:{permissions:{adminConsole:true}}},
 ensureModal:()=>modalNode,escapeHtml,showToast:()=>{},google:{script:{run:runner()}},
 document:{getElementById:id=>fieldNodes[id]||null},cleanApiErrorMessage:e=>e.message
});
vm.runInContext(fs.readFileSync('src/AppAdmin.html','utf8').replace(/<\/?script>/g,''),modalContext);
modalContext.openProjectModal('');
assert.ok(modalNode.innerHTML.includes('project-master-more'),'optional fields are collapsed on first registration');
assert.ok(modalNode.innerHTML.includes('required'),'project name is required');
const callsBeforeInvalid=calls.length;
modalContext.saveProjectFromModal('');
assert.equal(calls.length,callsBeforeInvalid,'invalid date range is rejected before RPC');
assert.match(fieldNodes.projectMasterError.textContent,/終了予定日/);
fieldNodes.prjEnd.value='2026-12-10';
modalContext.saveProjectFromModal('');
assert.equal(calls.at(-1).method,'saveProject');
assert.equal(calls.at(-1).args[1].name,'案件テスト','registration trims project name');
assert.equal(fieldNodes.prjSaveButton.disabled,true,'duplicate submission blocked while saving');
calls.at(-1).failure(Error('network'));
assert.equal(fieldNodes.prjSaveButton.disabled,false,'failed save restores the form');
const invalidSchedule={...detail,tasks:[{...detail.tasks[0],startDate:'2026-99-99',dueDate:'2026-10-31'}]};
assert.doesNotThrow(()=>client.projectHubTaskTimeline_(invalidSchedule),'malformed imported schedule cannot crash timeline');
assert.ok(client.projectHubTaskTimeline_(invalidSchedule).includes('開始予定日'),'invalid schedule is treated as unscheduled');
console.log('PASS project UX: tasks board/timeline/list, effort split, document filters, shared memo filters, simple master form and failed save recovery');


// Worklog cross-route intent: late DOM rendering and pre-existing drafts are both safe.
const opSource=fs.readFileSync('src/AppOperations.html','utf8');
const intentStart=opSource.indexOf('const WORKLOG_QUICK_FIELDS=');
const intentEnd=opSource.indexOf('const worklogWindowCache=',intentStart);
assert.ok(intentStart>0&&intentEnd>intentStart,'real worklog intent code can be located');
const nodes={
 wlQuickProject:{value:'別案件',disabled:false,options:[{value:'別案件'},{value:'現案件'}],closest:()=>({})},
 wlQuickCategory:{value:'開発'},wlQuickStart:{value:'09:00'},wlQuickEnd:{value:'10:00'},
 wlQuickDescription:{value:''},worklogProjectIntentBanner:{remove:()=>{}}
};
const intentState={sessionToken:'E',page:'projects',worklog:{date:'2026-10-10',renderedDate:null},data:{today:'2026-10-10',user:{employeeId:'E'}}};
const intentCtx=vm.createContext({state:intentState,document:{getElementById:id=>nodes[id]||null},escapeHtml,renderPageIfActive:()=>{}});
intentCtx.worklogWindowIdentity=()=>intentState.sessionToken+'|'+intentState.data.user.employeeId;
vm.runInContext(intentCtx.worklogWindowIdentity.toString(),intentCtx); // normal script globals behave as deployed
vm.runInContext(opSource.slice(intentStart,intentEnd),intentCtx);
assert.equal(intentCtx.queueProjectWorklogIntent('現案件','設計'),true);
intentState.page='worklog';
intentCtx.restoreWorklogQuickDraft();
assert.equal(nodes.wlQuickProject.value,'別案件','early render without form does not overwrite input');
intentState.worklog.renderedDate='2026-10-10';
intentCtx.restoreWorklogQuickDraft();
assert.equal(nodes.wlQuickProject.value,'現案件','project prefill survives late worklog render');
assert.equal(nodes.wlQuickDescription.value,'設計','task name is copied to description only');
nodes.wlQuickProject.value='別案件';nodes.wlQuickDescription.value='既存の作業内容';nodes.wlQuickStart.value='13:00';
intentCtx.rememberWorklogQuickDraft();
intentCtx.queueProjectWorklogIntent('現案件','テスト');
intentCtx.restoreWorklogQuickDraft();
assert.equal(nodes.wlQuickDescription.value,'既存の作業内容','existing unsaved worklog remains intact');
assert.equal(intentCtx.applyProjectWorklogIntent_(true),true,'explicit confirmation transfers task');
assert.equal(nodes.wlQuickDescription.value,'テスト');
assert.equal(nodes.wlQuickStart.value,'13:00','intent does not change time range');
intentCtx.queueProjectWorklogIntent('<script>alert(1)</script>','');
assert.ok(intentCtx.worklogProjectIntentBanner_().includes('&lt;script&gt;'),'intent banner escapes untrusted names');
intentCtx.clearWorklogQuickDrafts();
assert.equal(intentCtx.applyProjectWorklogIntent_(true),false,'logout reset removes pending worklog intent');
assert.ok(client.projectHubTaskBoard_(detail).includes('工数を記録'),'task board exposes the worklog shortcut');

console.log('PASS project client: cached tabs/routes, escaped documents, retained failed forms, stable retries, stale-response and session isolation');
export {workspace,detail,escapeHtml};
