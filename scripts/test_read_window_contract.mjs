import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync('src/Code.gs','utf8');
const worklog=fs.readFileSync('src/Worklog.gs','utf8');
const section=(text,startName,endName)=>{
  const start=text.indexOf('function '+startName+'('),end=text.indexOf('function '+endName+'(',start+9);
  assert.ok(start>=0&&end>start,'missing function boundaries '+startName);
  return text.slice(start,end);
};
const win=section(code,'assertReadWindow_','normalizeTime_');
const scheduled=section(code,'getScheduleBundleForViewer_','saveSchedule');
const worklogs=section(worklog,'getWorklogs','saveWorklog');
const c=vm.createContext({Date,Number,String,Error,Math,Array,Set,Map,
  Utilities:{formatDate:()=> '2026-10-15'},DB:{timeZone:'Asia/Tokyo',sheets:{schedule:'schedule'}},
  normalizeDate_:v=>String(v),
  requireSession_:()=>({employee:{employeeId:'FM9001'}}),
  PERFORMANCE_BUDGETS:{scheduleBundle:1000,worklogs:1000},
  getCompanyCalendarRange_:()=>[],employeeDirectoryForViewer_:()=>[],
  logPerformance_:()=>{},
  getProjectsInternal_:()=>[],projectAdvancedTaskOptions_:()=>[],
});
vm.runInContext(win+'\n'+scheduled+'\n'+worklogs,c);

const start='2026-01-01';
const plus=days=>new Date(Date.UTC(2026,0,1+days)).toISOString().slice(0,10);
assert.doesNotThrow(()=>c.assertReadWindow_(start,plus(399),400),
  '400 calendar dates inclusive must remain valid');
assert.throws(()=>c.assertReadWindow_(start,plus(400),400),/400日/);
assert.doesNotThrow(()=>c.assertReadWindow_('2024-01-01','2024-12-31',400),
  '366-day leap calendar must remain available');
assert.throws(()=>c.assertReadWindow_(start,'9999-12-31',400),/400日/);
assert.throws(()=>c.assertReadWindow_(plus(20),start,400),/400日/);

let databaseReads=0;
c.getDb_=()=>{databaseReads++;return{getSheetByName:()=>({getLastRow:()=>1})}};
assert.throws(()=>c.getScheduleBundleForViewer_({employeeId:'FM9001'},{
  start,end:'2090-12-31',includeEmployees:false}),/400日/);
assert.equal(databaseReads,0,'invalid schedule window rejected before Sheets I/O');
assert.throws(()=>c.getWorklogs('test',{start,end:'2090-12-31',includeProjects:false}),/400日/);
assert.equal(databaseReads,0,'invalid worklog window rejected before Sheets I/O');

const schedule=c.getScheduleBundleForViewer_({employeeId:'FM9001'},
 {start:'2026-10-01',end:'2026-10-31',includeEmployees:false});
assert.equal(schedule.events.length,0);
const time=c.getWorklogs('test',{start:'2026-10-01',end:'2026-10-31',includeProjects:false});
assert.equal(time.items.length,0);
assert.equal(time.totalMinutes,0);
console.log('PASS read-window guard: 400-day boundary, leap year, invalid orders and zero DB reads for oversized RPCs');
