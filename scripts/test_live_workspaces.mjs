import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const select=(initial=[])=>{
 let options=initial.map(value=>({value})),value=options[0]?.value||'';
 return {get options(){return options;},get value(){return value;},set value(v){value=options.some(o=>o.value===v)?v:'';},
  set innerHTML(html){options=[...html.matchAll(/<option value="([^"]*)"/g)].map(m=>({value:m[1]}));value=options[0]?.value||'';},
  closest:()=>({}),setAttribute(){}};
};
const fields={wlQuickProject:select(['案件A','案件B']),wlQuickTask:select(['','TA']),
 wlQuickCategory:{value:'開発'},wlQuickStart:{value:'09:00'},wlQuickEnd:{value:'10:00'},wlQuickDescription:{value:'実際の作業内容'}};
const state={page:'worklog',sessionToken:'LIVE-TEST',data:{today:'2026-10-13',user:{employeeId:'ME'},permissions:{adminConsole:true},projects:[],attendance:{state:'off',workedMinutes:0,history:[]}},
 worklog:{date:'2026-10-13',loadedDate:'2026-10-13',renderedDate:'2026-10-13',items:[],totalMinutes:0,
 taskOptions:[{id:'TA',project:'案件A',title:'設計'},{id:'TB',project:'案件B',title:'開発'}]},attendancePreview:{data:null,key:'',loading:true,error:''}};
const ctx=vm.createContext({state,console,Date,Math,Map,Set,Array,Object,String,Number,JSON,
 document:{getElementById:id=>fields[id]||null},escapeHtml:v=>String(v??''),
 liveWorkedMinutes:a=>a.workedMinutes,renderPageIfActive(){},showToast(){}});
vm.runInContext(fs.readFileSync('src/AppOperations.html','utf8').replace(/<\/?script>/g,''),ctx);
const run=code=>vm.runInContext(code,ctx);
const empty=ctx.worklogDisplayData();assert.equal(empty.totalMinutes,0);assert.equal(empty.items.length,0);assert.equal(empty.sample,false);
assert.equal(ctx.attendanceDisplayPreview(),null,'an unreceived preview cannot become fabricated attendance');
assert.ok(!ctx.attendanceAlerts(null).includes('確認が必要な勤怠はありません'),'unknown monthly status cannot be reported as no issues');
const form=ctx.worklogQuickForm(empty);assert.ok(form.includes('プロジェクトが未登録です'));assert.ok(!form.includes('サンプル案件'));
assert.match(form,/id='wlQuickSaveButton'[^>]*disabled/,'no active projects disables registration');
state.data.projects=[{name:'案件A',status:'進行中'},{name:'案件B',status:'進行中'}];
fields.wlQuickProject.value='案件B';ctx.refreshWorklogTaskChoices_('wlQuickProject','wlQuickTask');fields.wlQuickTask.value='TB';
ctx.rememberWorklogQuickDraft();
fields.wlQuickProject.value='案件A';ctx.refreshWorklogTaskChoices_('wlQuickProject','wlQuickTask');fields.wlQuickDescription.value='';
ctx.restoreWorklogQuickDraft();assert.equal(fields.wlQuickProject.value,'案件B');assert.equal(fields.wlQuickTask.value,'TB','restoring a project rebuilds task options before restoring its task');
assert.equal(fields.wlQuickDescription.value,'実際の作業内容');
state.worklog.taskOptions=state.worklog.taskOptions.filter(x=>x.id!=='TB');ctx.restoreWorklogQuickDraft();assert.equal(fields.wlQuickTask.value,'','removed task cannot carry over to another project');
fields.wlQuickProject=select(['案件A']);ctx.restoreWorklogQuickDraft();assert.equal(fields.wlQuickProject.value,'','removed project cannot silently become the first different project');
state.sessionToken='OTHER';fields.wlQuickDescription.value='別の社員の入力';ctx.restoreWorklogQuickDraft();assert.equal(fields.wlQuickDescription.value,'別の社員の入力');
console.log('PASS live workspaces: no invented attendance/effort, unknown status, honest empty state, no-project guard, real DOM select semantics, task restoration/removal and session isolation');
