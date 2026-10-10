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
const workspace=plain(ctx.getProjectHubWorkspace('E'));
assert.equal(workspace.projects[0].actualMinutes,180,'current and historical names link, deleted worklogs excluded');
assert.equal(workspace.projects[0].progress,40,'8h at 50% plus 2h at 0% = 40%, not effort consumption');
assert.equal(workspace.projects[0].usagePercent,30);
assert.equal(workspace.projects[0].scheduledProgress,90);
assert.equal(workspace.unlinkedWorklogCount,1);
assert.deepEqual(workspace.quoteOptions.map(q=>q.id),['Q1']);
assert.equal(workspace.projects[0].resourceCount,1);
const detail=plain(ctx.getProjectHubDetail('E','PRJ-001'));
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
const keep=sheets['プロジェクト資料'];delete sheets['プロジェクト資料'];assert.equal(ctx.getProjectHubWorkspace('E').setupRequired,true);assert.equal(ctx.getProjectHubWorkspace('E').projects[0].actualMinutes,60);assert.throws(()=>save('A','plan',plan),/DB更新/);sheets['プロジェクト資料']=keep;
keep.rows[0][0]='不一致';assert.throws(()=>ctx.getProjectHubWorkspace('E'),/列構成/);keep.rows[0][0]=specs['プロジェクト資料'][0];
console.log('PASS project backend: real sheets/quote helpers, aggregates, permissions, revisions, duplicate retries, renames and migration gates');

// Client behavior with controlled asynchronous GAS responses.
const calls=[];const runner=(meta={})=>new Proxy({}, {get(_,method){if(method==='withSuccessHandler')return success=>runner({...meta,success});if(method==='withFailureHandler')return failure=>runner({...meta,failure});return (...args)=>calls.push({method,args,...meta});}});
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const client=vm.createContext({state:{page:'projects',sessionToken:'E',data:{today:'2026-10-10',user:users[2],permissions:{}}},google:{script:{run:runner()}},document:{getElementById:()=>null,querySelectorAll:()=>[]},window:{addEventListener:()=>{}},renderPageIfActive:()=>{},showToast:()=>{},escapeHtml,cleanApiErrorMessage:e=>e.message,navigate:()=>{}});
vm.runInContext(fs.readFileSync('src/AppProjectHub.html','utf8').replace(/<\/?script>/g,''),client);
const cr=code=>vm.runInContext(code,client);
client.loadProjectHub();assert.equal(calls.length,1);calls[0].success(workspace);assert.equal(calls.length,2);calls[1].success(detail);
client.loadProjectHub();for(const tab of ['tasks','effort','resources','updates','overview'])client.projectHubTab_(tab);assert.equal(calls.length,2,'cached route and all tabs produce no extra RPC');
assert.ok(cr('projectHubPage()').includes('作業の完成度'));client.projectHubTab_('resources');assert.ok(cr('projectHubPage()').includes('&lt;script&gt;'));
client.projectHubOpenResource_('');client.projectHubField_('body','保存前の本文');const requestKey=cr('projectHubUi.editor.form.requestKey');client.projectHubSave_();const request=calls.at(-1);request.failure(Error('network'));assert.equal(cr('projectHubUi.editor.form.body'),'保存前の本文');client.projectHubSave_();assert.equal(calls.at(-1).args[2].requestKey,requestKey,'failed retry uses same identity');calls.at(-1).success({ok:true});
const fresh=calls.at(-1);fresh.success(workspace);const newDetail=calls.at(-1);newDetail.success(detail);
client.loadProjectHub({force:true});const stale=calls.at(-1);client.projectHubInvalidate_();stale.success(workspace);assert.notEqual(calls.at(-1),stale,'invalidated read triggers fresh request');const replacement=calls.at(-1);
client.resetProjectHubUi();replacement.success(workspace);assert.equal(cr('projectHubUi.data'),null,'old session callback discarded');
client.loadProjectHub();calls.at(-1).success(workspace);calls.at(-1).success(detail);
client.projectHubOpenResource_('');client.projectHubField_('body','ひな形で上書きしない');client.projectHubUseTemplate_();assert.equal(cr('projectHubUi.editor.form.body'),'ひな形で上書きしない');
client.loadProjectHub({force:true});assert.doesNotThrow(()=>cr('projectHubPage()'),'refresh during editing uses retained detail context');calls.at(-1).success(workspace);calls.at(-1).success({...detail,resources:[...detail.resources]});
// A conflict keeps the draft until the employee explicitly adopts the latest revision.
client.resetProjectHubUi();cr('projectHubUi.data='+JSON.stringify(workspace)+';projectHubUi.selected="PRJ-001";projectHubUi.details.set("PRJ-001",{data:'+JSON.stringify(detail)+',at:Date.now()});');client.projectHubOpenResource_(r1.id);client.projectHubField_('body','自分の変更');
cr('projectHubUi.details.get("PRJ-001").data.resources[0].revision=2');assert.ok(cr('projectHubPage()').includes('最新の登録内容を確認'));assert.equal(cr('projectHubUi.editor.form.revision'),1);client.projectHubAcceptLatest_();assert.equal(cr('projectHubUi.editor.form.revision'),2);assert.equal(cr('projectHubUi.editor.form.body'),'自分の変更');
client.resetProjectHubUi();assert.equal(cr('projectHubUi.editor'),null);
console.log('PASS project client: cached tabs/routes, escaped documents, retained failed forms, stable retries, stale-response and session isolation');
export {workspace,detail,escapeHtml};
