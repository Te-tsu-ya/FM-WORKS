import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const text=fs.readFileSync('src/Monthly.gs','utf8');
function section(name){
  const from=text.indexOf('function '+name+'(');
  assert.ok(from>=0,name+' not found');
  const next=/\nfunction\s+\w+\s*\(/g;
  next.lastIndex=from+10;
  const match=next.exec(text);
  return text.slice(from,match?match.index:text.length);
}
const code=[section('normalizeYearMonth_'),section('getMonthlySummary'),section('createTeamMonthlyExport')].join('\n');
assert.match(section('getMonthlySummary'),/\bconst ym\s*=\s*normalizeYearMonth_\(yearMonth\)/,
  'monthly summary must use the shared calendar month validator');
assert.match(section('createTeamMonthlyExport'),/\bconst ym\s*=\s*normalizeYearMonth_\(yearMonth\)/,
  'team Excel export must use the same calendar month validator');
let dbCalls=0;
const context=vm.createContext({Date,Number,String,Math,Array,Error,
  DB:{timeZone:'Asia/Tokyo'},Utilities:{formatDate:()=> '2026-10'},
  requireSession_:()=>({employee:{employeeId:'EMP-1'}}),
  requireAdminSession_:()=>({employee:{employeeId:'EMP-1'}}),
  getEmployee_:()=>{dbCalls++;return {};},
  getPayrollEmployees_:()=>{throw Error('Closed month export must not use live payroll roster');},
  getMonthlyCloseStatusInternal_:()=>{dbCalls++;return {closed:false,snapshotId:''};}
});
vm.runInContext(code,context);
for(const invalid of ['2026-00','2026-13','2026-99','2026-1','2026/01','X']){
  assert.throws(()=>context.getMonthlySummary('SESSION',invalid),/対象月/);
  assert.throws(()=>context.createTeamMonthlyExport('SESSION',invalid),/対象月/);
}
assert.equal(dbCalls,0,'impossible months must not access business data');
for(const valid of ['2026-01','2024-02','2026-12'])assert.equal(context.normalizeYearMonth_(valid),valid);
assert.throws(()=>context.createTeamMonthlyExport('SESSION','2026-10'),/月次締め後/);
assert.equal(dbCalls,1,'a valid month proceeds to authorized close-status lookup without using current employee master');
console.log('PASS monthly input guard: invalid months rejected before DB reads; valid months preserved');

