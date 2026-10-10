import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// This regression harness contains no live employee, client or company file data.
class Sheet{
 constructor(header,records=[]){this.rows=[header.slice(),...records.map(r=>r.slice())];}
 getLastRow(){return this.rows.length;}
 getRange(row,col,h=1,w=1){
  const self=this;
  return{
   getDisplayValues(){return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>String(self.rows[row+i-1]?.[col+j-1]??'')));},
   setValues(records){records.forEach((r,i)=>{self.rows[row+i-1]??=[];r.forEach((v,j)=>self.rows[row+i-1][col+j-1]=v);});},
   setValue(v){self.rows[row-1][col-1]=v;},
   createTextFinder(needle){return{matchEntireCell(){return this;},findNext(){const n=self.rows.findIndex((r,i)=>i>0&&String(r[col-1])===needle);return n<0?null:{getRow:()=>n+1};}};}
  };
 }
 appendRow(r){this.rows.push(r.slice());}
}
const people={
 A:{employeeId:'A',name:'架空管理者',role:'ADMIN'},
 O:{employeeId:'O',name:'架空案件責任者',role:'MANAGER'},
 U:{employeeId:'U',name:'架空作業担当',role:'EMPLOYEE'},
 Z:{employeeId:'Z',name:'権限のない社員',role:'EMPLOYEE'}
};
const projects=[{projectId:'P',name:'架空のテスト案件',status:'進行中'}];
const plans=[{projectId:'P',ownerId:'O',orderValue:1000000}];
const tasks=[
 {id:'TASK-1',projectId:'P',title:'設計',ownerId:'U',progress:50,status:'進行中',dueDate:'2026-10-11',plannedMinutes:480,startDate:'2026-10-02'},
 {id:'TASK-2',projectId:'P',title:'開発',ownerId:'O',progress:0,status:'進行中',dueDate:'2026-10-20',plannedMinutes:600,startDate:'2026-10-12'}
];
const updates=[{id:'MEMO-1',projectId:'P',kind:'決定事項',body:'次の設計方針',createdBy:'O',createdAt:'2026-10-10 12:00:00'}];
const blobData=new Map();let seq=0;let currentFolder;
const db={};
const gctx=vm.createContext({
 console,Date,Math,Map,Set,JSON,Number,Array,Object,String,RegExp,Boolean,Buffer,
 DB:{timeZone:'Asia/Tokyo'},getDb_:()=>({getSheetByName:n=>db[n]||null}),
 requireSession_:token=>{if(!people[token])throw Error('認証が必要');return{employee:people[token]};},
 withScriptLock_:fn=>fn(),getProjectsInternal_:()=>projects,getEmployees_:()=>Object.values(people),
 projectHubStorage_:()=>({ready:true,sheets:{plan:{},task:{},resource:{},update:{}}}),
 projectHubRows_:kind=>kind==='plan'?plans:kind==='task'?tasks:kind==='update'?updates:[],
 projectHubCanManage_:(u,p)=>u.role==='ADMIN'||p.ownerId===u.employeeId,
 projectHubToday_:()=> '2026-10-10',safeSheetText_:(v,max)=>String(v??'').slice(0,max),
 toTimestamp_:()=> '2026-10-10 13:00:00',createId_:p=>p+'-'+(++seq),
 appendAudit_:()=>{},auditJson_:v=>JSON.stringify(v),
 PropertiesService:{getScriptProperties(){return{getProperty:k=>k==='FM_WORKS_PROJECT_PRIVATE_FILES_FOLDER_ID'?'test-folder':null,setProperty(){}};}},
 DriveApp:{
  createFolder(){return currentFolder;},getFolderById(){return currentFolder;},
  getFileById:id=>{if(!blobData.has(id))throw Error('Drive file missing');return blobData.get(id);}
 },
 Utilities:{
  base64Decode:v=>Array.from(Buffer.from(v,'base64')),
  base64Encode:v=>Buffer.from(v).toString('base64'),
  newBlob:(bytes,mime,name)=>({getBytes:()=>bytes,getContentType:()=>mime,getName:()=>name})
 },
 SpreadsheetApp:{flush(){}}
});
currentFolder={getId:()=> 'test-folder',createFile:blob=>{
 const id='FILE-'+(++seq),file={id,blob,getId:()=>id,getSize:()=>blob.getBytes().length,
  getBlob:()=>blob,setTrashed(v){file.trashed=v;}};
 blobData.set(id,file);return file;
}};
vm.runInContext(fs.readFileSync('src/Schema.gs','utf8'),gctx);
const specs=JSON.parse(JSON.stringify(vm.runInContext('DB_SCHEMA_SPECS',gctx)));
const newSheets=['プロジェクト工数対応','プロジェクト依存','プロジェクト添付','プロジェクト既読','プロジェクト原価','プロジェクト予算'];
for(const name of newSheets)db[name]=new Sheet(specs[name]);
db['工数']=new Sheet(Array.from({length:15},(_,i)=>'H'+i));
vm.runInContext(fs.readFileSync('src/ProjectAdvanced.gs','utf8'),gctx);
const run=expr=>vm.runInContext(expr,gctx);
assert.equal(run('DB_SCHEMA_VERSION'),16);
assert.equal(newSheets.filter(x=>specs[x]).length,6);
assert.equal(gctx.projectAdvancedReady_().ready,true,'all six extension sheets ready');

assert.throws(()=>gctx.getProjectAdvanced('Z','P'),/権限/);
const staff=gctx.getProjectAdvanced('U','P');
assert.equal(staff.isAdmin,false);
assert.equal(Object.hasOwn(staff,'budget'),false,'staff response must never expose financial budget');
assert.equal(Object.hasOwn(staff,'costs'),false,'staff response must never expose manual cost records');
const admin=gctx.getProjectAdvanced('A','P');
assert.equal(admin.isAdmin,true);

assert.throws(()=>gctx.saveProjectDependencies('U','P','TASK-1',['TASK-2'],0),/責任者/);
assert.throws(()=>gctx.saveProjectDependencies('O','P','TASK-1',['TASK-1'],0),/同一案件/);
assert.throws(()=>gctx.saveProjectDependencies('O','P','TASK-1',['OTHER'],0),/同一案件/);
assert.equal(gctx.saveProjectDependencies('O','P','TASK-1',['TASK-2'],0).ok,true);
assert.throws(()=>gctx.saveProjectDependencies('O','P','TASK-2',['TASK-1'],0),/循環/);
assert.throws(()=>gctx.saveProjectDependencies('O','P','TASK-1',[],0),/別の人/);
assert.equal(gctx.getProjectAdvanced('O','P').dependencies.find(x=>x.taskId==='TASK-1').revision,1);

assert.throws(()=>gctx.saveProjectBudget('O','P',{amount:500000,revision:0}),/経営管理者/);
assert.equal(gctx.saveProjectBudget('A','P',{amount:500000,note:'架空予算',revision:0}).revision,1);
assert.throws(()=>gctx.saveProjectBudget('A','P',{amount:600000,revision:0}),/別の人/);
const cost={date:'2026-10-09',kind:'外注',note:'架空原価',amount:120000,requestKey:'COST-unique-key-12345'};
assert.throws(()=>gctx.saveProjectCost('O','P',cost),/経営管理者/);
const cost1=gctx.saveProjectCost('A','P',cost);
assert.equal(gctx.saveProjectCost('A','P',cost).duplicate,true,'same request cannot duplicate cost');
assert.throws(()=>gctx.saveProjectCost('A','P',{...cost,amount:110000}),/一致しません/);
assert.throws(()=>gctx.saveProjectCost('A','P',{...cost,date:'2026-10-08'}),/一致しません/,'same key cannot create cost with alternate date');
assert.throws(()=>gctx.saveProjectCost('A','P',{...cost,note:'書き換え'}),/一致しません/,'same key cannot alter cost description');
const finance=gctx.getProjectAdvanced('A','P');
assert.equal(finance.budget.amount,500000);
assert.equal(finance.financialSummary.manualCosts,120000);
assert.equal(finance.financialSummary.estimateDifference,880000);
assert.equal(Object.hasOwn(gctx.getProjectAdvanced('U','P'),'financialSummary'),false);

const pdf=Buffer.from('%PDF-1.4\nThis is a synthetic internal test file.','utf8').toString('base64');
const upload={projectId:'P',resourceId:'',name:'sample.pdf',mime:'application/pdf',base64:pdf,requestKey:'UPLOAD-request-key-123456789'};
assert.throws(()=>gctx.uploadProjectAttachment('Z',upload),/権限/);
assert.throws(()=>gctx.uploadProjectAttachment('U',{...upload,name:'bad.exe'}),/対応していない/);
assert.throws(()=>gctx.uploadProjectAttachment('U',{...upload,base64:Buffer.from('notPDF').toString('base64')}),/一致/);
const saved=gctx.uploadProjectAttachment('U',upload);
assert.equal(saved.ok,true);
assert.equal(gctx.uploadProjectAttachment('U',upload).duplicate,true);
assert.throws(()=>gctx.uploadProjectAttachment('U',{...upload,base64:Buffer.from('%PDF-1.4\nDIFFERENT','utf8').toString('base64')}),/異なるファイル内容/,'tampered file payload under same key is rejected');
assert.throws(()=>gctx.downloadProjectAttachment('Z',saved.id),/権限/);
const downloaded=gctx.downloadProjectAttachment('U',saved.id);
assert.equal(downloaded.base64,pdf);
assert.ok(!JSON.stringify(gctx.getProjectAdvanced('U','P')).includes('FILE-'),'Drive file IDs are not in workspace payload');
assert.equal(gctx.deleteProjectAttachment('U',saved.id).ok,true);
assert.equal(gctx.getProjectAdvanced('U','P').attachments.length,0);
assert.throws(()=>gctx.downloadProjectAttachment('U',saved.id),/見つかりません/);

const link={taskId:'TASK-1',requestKey:'WORKLOG-request-key-1234567'};
const prepared=gctx.projectAdvancedWorklogPrepare_(link,{projectId:'P'},people.U,'W-1');
gctx.projectAdvancedWorklogCommit_(prepared,'W-1',{projectId:'P'},people.U);
db['工数'].appendRow(['W-1','2026-10-10','U','架空作業担当','架空のテスト案件','開発','設計','09:00','10:00',60,'','2026-10-10','有効','','']);
assert.equal(gctx.projectAdvancedWorklogPrepare_(link,{projectId:'P'},people.U,'W-2').duplicateId,'W-1');
assert.throws(()=>gctx.projectAdvancedWorklogPrepare_({...link,taskId:'TASK-2'},{projectId:'P'},people.U,'W-2'),/送信識別子/);
assert.throws(()=>gctx.projectAdvancedWorklogPrepare_({...link,taskId:'OTHER',requestKey:'WORKLOG-another-unique-key'},{projectId:'P'},people.U,'W-2'),/存在しません/);
assert.throws(()=>gctx.projectAdvancedWorklogPrepare_({taskId:'TASK-2',requestKey:'WORKLOG-unauthorized-1234'},{projectId:'P'},people.U,'W-2'),/担当外/,'staff cannot attach hours to someone else task');
assert.equal(gctx.projectAdvancedTaskEffort_('P',tasks).find(t=>t.taskId==='TASK-1').actualMinutes,60);

const alerts=gctx.projectAdvancedAlerts_(people.U,false);
assert.ok(alerts.some(x=>x.notificationId.startsWith('TASK-TASK-1-20261011-SOON')));
assert.ok(alerts.some(x=>x.notificationId==='MEMO-MEMO-1'));
const alert=alerts.find(x=>x.notificationId==='MEMO-MEMO-1');
assert.equal(gctx.markProjectAlertRead('U',alert.notificationId).ok,true);
assert.equal(gctx.markProjectAlertRead('U',alert.notificationId).duplicate,true);
assert.equal(gctx.projectAdvancedAlerts_(people.U,false).some(x=>x.notificationId===alert.notificationId),false);
assert.throws(()=>gctx.markProjectAlertRead('Z','TASK-TASK-1-20261011-SOON'),/権限/);

for(let i=0;i<16;i++){
 const id='MEMO-BULK-'+i;
 updates.push({id,projectId:'P',kind:'共有',body:'架空の共有メモ'+i,createdBy:'O',createdAt:'2026-10-11 10:'+String(i).padStart(2,'0')+':00'});
}
const firstUnread=gctx.projectAdvancedAlerts_(people.U,false);
const oldTop=firstUnread.find(x=>x.notificationId.startsWith('MEMO-'));
assert.ok(oldTop,'new updates are visible');
for(const item of firstUnread.filter(x=>x.notificationId.startsWith('MEMO-')))gctx.markProjectAlertRead('U',item.notificationId);
const laterUnread=gctx.projectAdvancedAlerts_(people.U,false).find(x=>x.notificationId.startsWith('MEMO-'));
assert.ok(laterUnread,'an unread notification remains after prior ones are read');
assert.equal(gctx.markProjectAlertRead('U',laterUnread.notificationId).ok,true,'marking a later notification must not be blocked by previously-read items');


const invalidDependency=[...tasks,{id:'TASK-3',projectId:'P',title:'検査',ownerId:'U',progress:0,status:'未着手'}];
assert.equal(gctx.projectAdvancedDetectCycle_(new Map([['TASK-1',['TASK-2']],['TASK-2',['TASK-3']],['TASK-3',['TASK-1']]])),true);
assert.equal(gctx.projectAdvancedDetectCycle_(new Map([['TASK-1',[]],['TASK-2',['TASK-1']]])),false);

// Exercise the actual existing Worklog.gs save/restore flow against v16 mapping.
Object.assign(gctx,{
 normalizeDate_:v=>String(v),normalizeTime_:v=>String(v),assertMonthOpenForDate_:()=>{},
 logPerformance_:()=>{},PERFORMANCE_BUDGETS:{worklogs:1200},
 getProjectByName_:name=>projects.find(p=>p.name===name)||null,
 getEmployee_:id=>({...people[id],active:true}),
 readRowsByDateRange_:(sheet,col,width,start,end)=>sheet.rows.slice(1).filter(r=>String(r[1])>=start&&String(r[1])<=end).map(r=>r.map(x=>String(x??'')))
});
vm.runInContext(fs.readFileSync('src/Worklog.gs','utf8'),gctx);
const worklogPayload={date:'2026-10-10',project:'架空のテスト案件',taskId:'TASK-1',category:'設計',
 description:'新規設計',start:'13:00',end:'14:00',note:'',requestKey:'WORKLOG-full-save-123456'};
const savedWorklog=gctx.saveWorklog('U',worklogPayload);
assert.equal(savedWorklog.ok,true,'worklog save succeeds with server-validated task');
assert.equal(gctx.saveWorklog('U',worklogPayload).duplicate,true,'retry does not create another worklog row');
assert.throws(()=>gctx.saveWorklog('U',{...worklogPayload,description:'別の作業内容'}),/異なる工数内容/);
assert.equal(gctx.getWorklogs('U',{start:'2026-10-10',end:'2026-10-10',includeProjects:false}).items.find(x=>x.id===savedWorklog.id).taskId,'TASK-1');
const mapSheet=db['プロジェクト工数対応'],savedAppend=mapSheet.appendRow.bind(mapSheet);
mapSheet.appendRow=()=>{throw Error('Synthetic sheet-write failure');};
const rowsBefore=db['工数'].rows.length;
assert.throws(()=>gctx.saveWorklog('U',{...worklogPayload,start:'14:00',end:'15:00',requestKey:'WORKLOG-partial-failure-1234'}),/取り消しました/);
assert.equal(db['工数'].rows.length,rowsBefore+1);
assert.equal(db['工数'].rows.at(-1)[12],'削除','half-saved worklog is tombstoned and excluded from totals');
mapSheet.appendRow=savedAppend;
assert.equal(db['プロジェクト工数対応'].rows.filter(r=>r[5]==='WORKLOG-partial-failure-1234').length,0);


// Closing the session must clear financial and private project buffers from shared kiosk memory.
const clientCtx=vm.createContext({console,Date,Map,Set,Math,JSON,Number,String,
 state:{sessionToken:'A',data:{user:{employeeId:'A'}}},
 window:{addEventListener:()=>{}},document:{getElementById:()=>null}});
vm.runInContext(fs.readFileSync('src/AppProjectAdvanced.html','utf8').replace(/<\/?script>/g,''),clientCtx);
assert.equal(vm.runInContext('projectAdvancedUi.data={financialSummary:{orderValue:9999999}};resetProjectAdvancedUi_();projectAdvancedUi.data',clientCtx),null,
 'logout must purge confidential budget and file metadata');

console.log('PASS: v16 extension storage, admin/member/outsider ACL, dependency cycle and revision, cost/budget, private file lifecycle, stable task-worklog links, per-user notifications');
