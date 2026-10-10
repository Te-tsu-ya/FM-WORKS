import './test_worklog_integrity.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const files = [
  'src/Code.gs',
  'src/Finance.gs',
  'src/Auth.gs',
  'src/Worklog.gs',
  'src/Requests.gs',
  'src/Monthly.gs',
  'src/MonthlySnapshot.gs',
  'src/LeaveLedger.gs',
  'src/AnnualLeaveAutomation.gs',
  'src/Maintenance.gs',
  'src/Labor.gs',
  'src/Schema.gs',
  'src/DataAccess.gs',
  'src/Employees.gs'
];

const context = vm.createContext({
  console,
  Object,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Set,
  Map,
  JSON,
  RegExp,
  Error
});

for (const file of files) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

vm.runInContext(`
globalThis.__fmTest = {
  PUNCH,
  REQUEST_TYPES,
  timeRangeMinutes_,
  timeToMinutes_,
  validatePunchSequence_,
  buildAttendanceStateFromRows_,
  summarizeWorkLocations_,
  isTimePunchAction_,
  inferLegacyLeaveLabel_,
  addDateString_,
  dateSpanDays_,
  safeSheetText_,
  safeSheetName_,
  parseTimestamp_,
  sessionRowsToDelete_,
  prototypeSettingEnabled_,
  prototypeModeEnabledForEnvironment_,
  isPrototypeLogin_,
  shortEmployeeName_,
  requiredBreakMinutes_,
  calculateBreakMinutesForRows_,
  normalizeYearMonth_,
  previousYearMonth_,
  monthlyReviewUrgency_,
  yearMonthsBetween_,
  canManageEmployeeRecord_,
  getPermissions_,
  financeOperatorAllowed_,
  financeAmount_,
  financeExpensePayload_,
  financeTravelPayload_,
  monthlySnapshotPayload_,
  normalizeLeaveDays_,
  leaveBalanceAfterDelta_,
  leaveDueAtIndex_,
  leaveEntitlement_,
  leaveAutoAlreadyGranted_,
  leaveAutoEarlierMissing_,
  leaveAttendanceEvidence_,
  annualLeavePeriodEnd_,
  annualLeaveQualifyingUsage_,
  normalizeScheduleVisibility_,
  canViewScheduleRow_,
  normalizeRuntimeEnvironment_,
  isBackupDue_,
  normalizeLaborWeekStartDay_,
  normalizeLaborAgreementStartMonth_,
  normalizeLaborSpecialClause_,
  laborAgreementPeriodStart_,
  evaluateGeneralLaborHistory_,
  dailyStatutoryOvertimeMinutes_,
  lateNightOverlapMinutes_,
  applyWeeklyStatutoryOvertimeToFacts_,
  schemaHeaderIssues_,
  requestSheetHeaders:DB_SCHEMA_SPECS['申請'],
  dateRangeStrings_,
  dateRangeRegex_,
  readRowsByDateRange_,
  contiguousRowBlocks_,
  columnLetter_,
  managerAssignmentCreatesCycle_,
  compareBackupShape_
};
`, context);

const api = context.__fmTest;
let failures = 0;

function expect(name, condition, detail = '') {
  if (!condition) {
    failures++;
    console.error('FAIL:', name, detail);
  } else {
    console.log('PASS:', name);
  }
}

function expectThrows(name, fn) {
  let threw = false;
  try { fn(); } catch (_) { threw = true; }
  expect(name, threw, 'expected an exception');
}


expect('office access is offered to ADMIN but not implicitly to personnel editing',
  api.getPermissions_({role:'ADMIN',department:'開発'}).officeWorkspace===true);
expect('MANAGER without accounting or general affairs duties does not gain office access',
  api.getPermissions_({role:'MANAGER',department:'開発'}).officeWorkspace===false&&
  api.getPermissions_({role:'MANAGER',department:'開発'}).financeWorkspace===false&&
  api.getPermissions_({role:'MANAGER',department:'開発'}).employeeAdmin===false);
expect('office access includes general affairs department without granting admin console',
  api.getPermissions_({role:'USER',department:'総務部'}).officeWorkspace===true&&
  api.getPermissions_({role:'USER',department:'総務部'}).adminConsole===false);
expect('standard employees outside general affairs do not gain office access',
  api.getPermissions_({role:'USER',department:'開発'}).officeWorkspace===false);


expect('finance privilege only for admin and accounting/general affairs departments',
 api.financeOperatorAllowed_({role:'ADMIN',department:'開発'}) &&
 api.financeOperatorAllowed_({role:'USER',department:'経理担当'}) &&
 api.financeOperatorAllowed_({role:'USER',department:'総務部'}) &&
 !api.financeOperatorAllowed_({role:'MANAGER',department:'開発'}) &&
 !api.financeOperatorAllowed_({role:'USER',department:'開発'}));
expect('finance department checking rejects misleading names',
 !api.financeOperatorAllowed_({role:'USER',department:'非経理'})&&
 !api.financeOperatorAllowed_({role:'USER',department:'旧総務'})&&
 api.financeOperatorAllowed_({role:'USER',department:'総務・経理'}));
expect('finance access does not imply admin privilege',
 api.getPermissions_({role:'USER',department:'経理'}).financeWorkspace===true &&
 api.getPermissions_({role:'USER',department:'経理'}).adminConsole===false &&
 api.getPermissions_({role:'USER',department:'経理'}).employeeAdmin===false);
expect('integer Yen accepted',api.financeAmount_('1200','申請額',true)===1200);
expectThrows('negative yen is rejected',()=>api.financeAmount_('-1','金額',true));
expectThrows('decimal yen is rejected',()=>api.financeAmount_('1.5','金額',true));
expectThrows('zero required yen is rejected',()=>api.financeAmount_('0','金額',true));
expect('expense payload retains receipt metadata',(()=>{
 const p=api.financeExpensePayload_({usedOn:'2026-10-08',vendor:'架空の取引先',item:'備品',category:'消耗品費',
  amount:'2500',purpose:'試験用',requestKey:'FMSAMPLE123456'});
 return p.amount===2500&&p.vendor==='架空の取引先'&&p.purpose==='試験用';
})());
expect('travel payload includes destination and actual costs',(()=>{
 const p=api.financeTravelPayload_({startsOn:'2026-10-08',endsOn:'2026-10-09',destination:'架空の出張先',
  purpose:'会議',outcome:'会議の結果',nights:'1',distanceCategory:'30km以上',spentAmount:'2400',
  requestedAllowance:'5000',requestKey:'FMSAMPLE123457'},{title:'営業'});
 return p.nights===1&&p.distanceCategory==='30km以上'&&p.spentAmount===2400&&p.requestedAllowance===5000;
})());
expectThrows('travel return date before departure rejected',()=>api.financeTravelPayload_({
 startsOn:'2026-10-09',endsOn:'2026-10-08',destination:'架空',purpose:'会議',outcome:'成果'},{}));


expect('schema declaration matches real request-sheet column positions',
  api.schemaHeaderIssues_(
   ['申請ID','申請日','社員ID','氏名','申請種別','対象日開始','対象日終了','申請内容',
    '理由','ステータス','承認者','承認日時','差戻し理由','登録日時',
    '取消理由','取消申請日時','取消判断理由','取消判断者','取消判断日時'],
   api.requestSheetHeaders
  ).length===0);
const mockDateSheet={
 getLastRow:()=>3,
 getRange:()=>({getDisplayValues:()=>[['E-1','2026-01-01'],['E-2','2028-01-01']]})
};
const longRange=api.readRowsByDateRange_(mockDateSheet,2,2,'2026-01-01','2027-12-31');
expect('date-index fallback never leaks rows outside a long requested interval',
 longRange.length===1&&longRange[0][0]==='E-1');
expect('inverted date interval never returns all rows',
 api.readRowsByDateRange_(mockDateSheet,2,2,'2028-01-01','2026-01-01').length===0);

expect('09:00-18:00 is 540 minutes', api.timeRangeMinutes_('09:00','18:00') === 540);
expect('08:30 is 510 minutes', api.timeToMinutes_('08:30') === 510);
expect('date increment across month boundary', api.addDateString_('2026-02-28',1) === '2026-03-01');
expect('date span is inclusive', api.dateSpanDays_('2026-09-29','2026-09-30') === 2);
expect('quarter-day leave type exists', api.REQUEST_TYPES.includes('1/4日有給'));

const validPunches = [
  { action: api.PUNCH.CLOCK_IN, timestamp: '2026-10-07 09:00:00' },
  { action: api.PUNCH.BREAK_START, timestamp: '2026-10-07 12:00:00' },
  { action: api.PUNCH.BREAK_END, timestamp: '2026-10-07 13:00:00' },
  { action: api.PUNCH.CLOCK_OUT, timestamp: '2026-10-07 18:00:00' }
];
expect('valid punch sequence accepted', api.validatePunchSequence_(validPunches) === true);
const switchedLocationPunches = [
  { action: api.PUNCH.CLOCK_IN, timestamp: '2026-10-07 09:00:00', workLocation: '出社' },
  { action: api.PUNCH.LOCATION_CHANGE, timestamp: '2026-10-07 13:30:00', workLocation: '在宅' },
  { action: api.PUNCH.CLOCK_OUT, timestamp: '2026-10-07 18:00:00', workLocation: '在宅' }
];
expect('location change inside a work session is sequence-safe', api.validatePunchSequence_(switchedLocationPunches) === true);
expect('location change is not treated as a time-punch correction action', api.isTimePunchAction_(api.PUNCH.LOCATION_CHANGE) === false);
const switchedAttendance = api.buildAttendanceStateFromRows_('2026-10-07', switchedLocationPunches);
expect('location change preserves finished attendance state', switchedAttendance.state === 'finished');
expect('location change updates current work location', switchedAttendance.workLocation === '在宅');
expect('location change summary preserves the day transition', switchedAttendance.workLocationSummary === '出社→在宅' && api.summarizeWorkLocations_(switchedLocationPunches) === '出社→在宅');
const locationHistory = switchedAttendance.history.find(x=>x.action===api.PUNCH.LOCATION_CHANGE);
expect('location change history preserves from/to locations', locationHistory&&locationHistory.fromWorkLocation==='出社'&&locationHistory.workLocation==='在宅');
expectThrows('location change before clock-in is rejected', () => api.validatePunchSequence_([
  { action: api.PUNCH.LOCATION_CHANGE, timestamp: '2026-10-07 08:30:00', workLocation: '在宅' }
]));
expectThrows('break before clock-in rejected', () => api.validatePunchSequence_([
  { action: api.PUNCH.BREAK_START, timestamp: '2026-10-07 12:00:00' }
]));
expectThrows('duplicate clock-in rejected', () => api.validatePunchSequence_([
  { action: api.PUNCH.CLOCK_IN, timestamp: '2026-10-07 09:00:00' },
  { action: api.PUNCH.CLOCK_IN, timestamp: '2026-10-07 10:00:00' }
]));

expect(
  'legacy quarter-day label preserved',
  api.inferLegacyLeaveLabel_({paidLeave:0.25,clockIn:'09:00',clockOut:'15:00'}, {start:'09:00',end:'18:00'}) === '1/4日有給'
);
expect(
  'legacy morning-work half-day inferred as afternoon leave',
  api.inferLegacyLeaveLabel_({paidLeave:0.5,clockIn:'09:00',clockOut:'13:00'}, {start:'09:00',end:'18:00'}) === '午後半休'
);

const protectedFormula = api.safeSheetText_('=IMPORTDATA("https://example.invalid")', 200);
expect('spreadsheet formula injection guarded', protectedFormula.startsWith("'="));
expect('normal sheet text unchanged', api.safeSheetText_('Project Atlas', 100) === 'Project Atlas');
expect('sheet name sanitizes forbidden characters', !/[\\\/\?\*\[\]\:]/.test(api.safeSheetName_('FM/WORKS:*?')));
const singleDigitHourTimestamp = api.parseTimestamp_('2026-10-08 3:19:57');
expect('session timestamp accepts single-digit Sheets hour', !!singleDigitHourTimestamp && !Number.isNaN(singleDigitHourTimestamp.getTime()));
const sessionRows=[
  ['S1','','FM0001','','2026-10-07 10:00:00','','','ACTIVE','','',''],
  ['S2','','FM0002','','2026-10-09 10:00:00','','','ACTIVE','','',''],
  ['S3','','FM0003','','2026-10-09 10:00:00','','','REVOKED','','','']
];
expect('session cleanup selects expired and inactive rows in sheet coordinates', JSON.stringify(Array.from(api.sessionRowsToDelete_(sessionRows,new Date('2026-10-08T00:00:00+09:00'))))===JSON.stringify([2,4]));
expect('prototype mode may be explicitly enabled in staging', api.prototypeModeEnabledForEnvironment_('TRUE','STAGING') === true);
expect('prototype mode is forcibly disabled in production', api.prototypeModeEnabledForEnvironment_('TRUE','PRODUCTION') === false);
expect('prototype mode honors an explicit OFF setting', api.prototypeModeEnabledForEnvironment_('FALSE','STAGING') === false);
expect('prototype login fails closed without Apps Script runtime settings', api.isPrototypeLogin_({employeeId:'FM0001'}, '000000') === false);
expect('employee short label uses surname only', api.shortEmployeeName_('青木 悠真','青木さん','FM0001') === '青木');
expect('display name fallback strips honorific', api.shortEmployeeName_('', '森川さん', 'FM0002') === '森川');
expect('6h requires no statutory break threshold', api.requiredBreakMinutes_(360) === 0);
expect('over 6h requires 45 minutes', api.requiredBreakMinutes_(361) === 45);
expect('over 8h requires 60 minutes', api.requiredBreakMinutes_(481) === 60);
expect('recorded lunch break totals 60 minutes', api.calculateBreakMinutesForRows_([
  { action: api.PUNCH.CLOCK_IN, timestamp: '2026-10-07 09:00:00' },
  { action: api.PUNCH.BREAK_START, timestamp: '2026-10-07 12:00:00' },
  { action: api.PUNCH.BREAK_END, timestamp: '2026-10-07 13:00:00' },
  { action: api.PUNCH.CLOCK_OUT, timestamp: '2026-10-07 18:00:00' }
], false) === 60);
expect('valid year-month accepted', api.normalizeYearMonth_('2026-09') === '2026-09');
expectThrows('invalid year-month rejected', () => api.normalizeYearMonth_('2026-13'));
expect('previous month crosses year boundary', api.previousYearMonth_('2026-01-10') === '2025-12');
expect('monthly review is warning before due day', api.monthlyReviewUrgency_(3,5) === 'warning');
expect('monthly review becomes danger after due day', api.monthlyReviewUrgency_(6,5) === 'danger');
expect(
  'month range crosses year boundary in order',
  JSON.stringify(Array.from(api.yearMonthsBetween_('2025-11','2026-02'))) === JSON.stringify(['2025-11','2025-12','2026-01','2026-02'])
);
expect('empty month range rejected as empty list', api.yearMonthsBetween_('2026-03','2026-02').length === 0);
expect('manager cycle detects direct self return', api.managerAssignmentCreatesCycle_('FM0001','FM0002',{FM0002:'FM0001'})===true);
expect('manager cycle detects longer loop', api.managerAssignmentCreatesCycle_('FM0001','FM0002',{FM0002:'FM0003',FM0003:'FM0001'})===true);
expect('manager hierarchy accepts acyclic chain', api.managerAssignmentCreatesCycle_('FM0001','FM0002',{FM0002:'FM0003',FM0003:''})===false);
expect('admin can manage another employee', api.canManageEmployeeRecord_({employeeId:'FM0001',role:'ADMIN'},{employeeId:'FM0003',role:'USER',managerId:'FM0001'}) === true);
expect('admin cannot approve self', api.canManageEmployeeRecord_({employeeId:'FM0001',role:'ADMIN'},{employeeId:'FM0001',role:'ADMIN',managerId:''}) === false);
expect('manager can manage direct report', api.canManageEmployeeRecord_({employeeId:'FM0002',role:'MANAGER'},{employeeId:'FM0003',role:'USER',managerId:'FM0002'}) === true);
expect('manager cannot manage unrelated employee', api.canManageEmployeeRecord_({employeeId:'FM0002',role:'MANAGER'},{employeeId:'FM0004',role:'USER',managerId:'FM0001'}) === false);
expect('user cannot manage another employee', api.canManageEmployeeRecord_({employeeId:'FM0003',role:'USER'},{employeeId:'FM0004',role:'USER',managerId:'FM0003'}) === false);
const snapshotPayload = api.monthlySnapshotPayload_({
  yearMonth:'2026-09',
  employee:{employeeId:'FM0003'},
  totals:{workDays:20,totalMinutes:9600,overtimeMinutes:120,worklogMinutes:9600},
  daily:[{date:'2026-09-01',workingDay:true,workMinutes:480,worklogMinutes:480,workLocation:'出社'}]
});
expect('monthly snapshot payload keeps employee and month', snapshotPayload.employeeId==='FM0003' && snapshotPayload.yearMonth==='2026-09');
expect('monthly snapshot payload contains normalized daily facts', snapshotPayload.daily.length===1 && snapshotPayload.daily[0].workMinutes===480);
expect('annual leave period ends one day before next anniversary', api.annualLeavePeriodEnd_('2026-04-01')==='2027-03-31');
const leaveCalendar=['2026-04-01','2026-04-02','2026-04-03','2026-04-04'].map(date=>({date,working:date!=='2026-04-04'}));
const leaveUsage=api.annualLeaveQualifyingUsage_([
  {type:'有給',startDate:'2026-04-01',endDate:'2026-04-02'},
  {type:'午前半休',startDate:'2026-04-03',endDate:'2026-04-03'},
  {type:'1/4日有給',startDate:'2026-04-03',endDate:'2026-04-03'}
],leaveCalendar,'2026-04-01','2026-04-04');
expect('five-day leave monitor counts full and half days', leaveUsage.qualifyingDays===2.5);
expect('quarter-day leave is excluded from statutory five-day tally', leaveUsage.excludedQuarterDays===0.25);
expect('leave days normalize to quarter day', api.normalizeLeaveDays_(1.24)===1.25);
expect('leave balance applies usage', api.leaveBalanceAfterDelta_(10,-1.5)===8.5);
expectThrows('leave balance rejects negative result', ()=>api.leaveBalanceAfterDelta_(1,-1.25));
expect('schedule visibility accepts participant scope', api.normalizeScheduleVisibility_('参加者のみ',{employeeId:'FM0003',role:'USER'})==='参加者のみ');
expectThrows('non-admin cannot create admin-only schedule', ()=>api.normalizeScheduleVisibility_('管理者のみ',{employeeId:'FM0003',role:'USER'}));
const participantRow=['S1','2026-10-07','09:00','10:00','FALSE','FM0003,FM0004','神谷、小林','面談','予定','','','参加者のみ','有効','FM0001','','','FM WORKS','予定'];
expect('participant-only visible to participant', api.canViewScheduleRow_({employeeId:'FM0003',name:'神谷 直人',role:'USER'},participantRow)===true);
expect('participant-only hidden from unrelated user', api.canViewScheduleRow_({employeeId:'FM0005',name:'中村 健太',role:'USER'},participantRow)===false);
const adminOnlyRow=[...participantRow]; adminOnlyRow[11]='管理者のみ';
expect('admin-only visible to admin', api.canViewScheduleRow_({employeeId:'FM0002',name:'森川 彩乃',role:'ADMIN'},adminOnlyRow)===true);
expect('admin-only hidden from participant', api.canViewScheduleRow_({employeeId:'FM0003',name:'神谷 直人',role:'USER'},adminOnlyRow)===false);
expect('runtime environment defaults to staging', api.normalizeRuntimeEnvironment_('')==='STAGING');
expect('runtime environment accepts production', api.normalizeRuntimeEnvironment_('production')==='PRODUCTION');
expect('unknown runtime environment falls back to staging', api.normalizeRuntimeEnvironment_('UNKNOWN')==='STAGING');
expect('backup shape accepts identical copy', api.compareBackupShape_([{name:'社員',rows:10,columns:26}],[{name:'社員',rows:10,columns:26}]).length===0);
expect('backup shape detects missing sheet', api.compareBackupShape_([{name:'社員',rows:10,columns:26},{name:'打刻',rows:20,columns:12}],[{name:'社員',rows:10,columns:26}]).includes('missing:打刻'));
expect('backup shape detects row mismatch', api.compareBackupShape_([{name:'社員',rows:10,columns:26}],[{name:'社員',rows:9,columns:26}]).includes('rows:社員'));
expect('backup due when last backup is prior day', api.isBackupDue_('2026-10-06 03:12:00','2026-10-07')===true);
expect('backup skipped when already backed up today', api.isBackupDue_('2026-10-07 03:12:00','2026-10-07')===false);
expect('labor agreement start month validates', api.normalizeLaborAgreementStartMonth_(4)===4 && api.normalizeLaborAgreementStartMonth_(13)===0);
expect('labor special clause validates', api.normalizeLaborSpecialClause_('enabled')==='ENABLED' && api.normalizeLaborSpecialClause_('x')==='UNCONFIGURED');
expect('labor agreement period crosses calendar year', api.laborAgreementPeriodStart_('2027-02',4)==='2026-04');
const annualLaborRecords=Array.from({length:12},(_,i)=>({yearMonth:(i<9?'2026-':'2027-')+String(i<9?i+4:i-8).padStart(2,'0'),statutoryOvertimeMinutes:1900,overtimeHolidayMinutes:1900}));
const annualLaborEval=api.evaluateGeneralLaborHistory_(annualLaborRecords,'2027-03',4,'ENABLED');
expect('annual labor history detects over 360h', annualLaborEval.periodComplete===true && annualLaborEval.annualStatutoryOvertimeMinutes===22800);
const specialMonths=['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10'].map(yearMonth=>({yearMonth,statutoryOvertimeMinutes:2800,overtimeHolidayMinutes:5000}));
const specialEval=api.evaluateGeneralLaborHistory_(specialMonths,'2026-10',4,'ENABLED');
expect('special clause history counts months over 45h', specialEval.monthsOver45===7);
expect('multi-month average includes overtime plus statutory holiday', specialEval.maxMultiMonthAverageMinutes===5000 && specialEval.maxMultiMonthWindow>=2);
expect('labor week start normalizes', api.normalizeLaborWeekStartDay_('monday')==='MONDAY');
expect('8h has no daily statutory overtime', api.dailyStatutoryOvertimeMinutes_(480,false)===0);
expect('9h has 60m daily statutory overtime', api.dailyStatutoryOvertimeMinutes_(540,false)===60);
expect('statutory holiday work is not daily overtime', api.dailyStatutoryOvertimeMinutes_(600,true)===0);
expect('22:00-23:30 has 90m late night', api.lateNightOverlapMinutes_(1320,1410)===90);
expect('23:00-06:00 has 360m late night', api.lateNightOverlapMinutes_(1380,1800)===360);
const weekFacts=['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10'].map((date,i)=>({date,workMinutes:i<5?480:120,statutoryHoliday:false}));
api.applyWeeklyStatutoryOvertimeToFacts_(weekFacts,'MONDAY');
expect('week over 40h allocates 120m weekly overtime', weekFacts[5].statutoryWeeklyOvertimeMinutes===120);
expect('schema header validation accepts exact header', api.schemaHeaderIssues_(['A','B'],['A','B']).length===0);
expect('schema header validation identifies wrong column', api.schemaHeaderIssues_(['A','X'],['A','B']).length===1);
expect('date range includes both endpoints', JSON.stringify(Array.from(api.dateRangeStrings_('2026-10-01','2026-10-03',10)))===JSON.stringify(['2026-10-01','2026-10-02','2026-10-03']));
expect('date range regex matches target date', new RegExp(api.dateRangeRegex_('2026-10-01','2026-10-03',10)).test('2026-10-02'));
expect('row blocks group contiguous rows', JSON.stringify(api.contiguousRowBlocks_([2,3,5,6,7]))===JSON.stringify([{start:2,end:3},{start:5,end:7}]));
expect('column letter handles AB', api.columnLetter_(28)==='AB');


expect('yearly annual leave starts with ten after first six months',
  api.leaveDueAtIndex_('2026-04-01',0)==='2026-10-01' &&
  api.leaveEntitlement_('2026-04-01','2026-10-01').due.days===10);
expect('second grant happens after another year with eleven days',
  api.leaveDueAtIndex_('2026-04-01',1)==='2027-10-01' &&
  api.leaveEntitlement_('2026-04-01','2027-10-01').due.days===11);
expect('six years six months reaches twenty days',
  api.leaveDueAtIndex_('2020-04-01',6)==='2026-10-01' &&
  api.leaveEntitlement_('2020-04-01','2026-10-01').due.days===20);
expect('first leave is not granted before six months',
  api.leaveEntitlement_('2026-04-01','2026-09-30').due===null);
expect('short February is handled for month-end hire',
  api.leaveDueAtIndex_('2026-08-31',0)==='2027-02-28');
expect('invalid employee hire dates cannot produce statutory leave grants',
  api.leaveDueAtIndex_('2026-02-31',0)==='' &&
  api.leaveDueAtIndex_('2026-13-01',0)==='' &&
  api.leaveDueAtIndex_('2026-00-01',0)==='' &&
  api.leaveDueAtIndex_('not-a-date',0)==='' &&
  api.leaveEntitlement_('2026-02-31','2026-10-01')===null);
expect('invalid as-of dates are rejected before leave balance calculation',
  api.leaveEntitlement_('2026-04-01','2026-13-01')===null &&
  api.leaveEntitlement_('2026-04-01','2026-02-30')===null &&
  api.leaveEntitlement_('2026-04-01','2026-00-10')===null);
expect('valid leap-year and trimmed hire dates preserve six-month entitlement',
  api.leaveDueAtIndex_('2024-02-29',0)==='2024-08-29' &&
  api.leaveEntitlement_(' 2026-04-01 ','2026-10-01').due.days===10 &&
  api.leaveEntitlement_(' 2026-04-01 ','2026-10-01').due.from==='2026-04-01');
expect('manual grant on the same entitlement date blocks automation',
  api.leaveAutoAlreadyGranted_({employeeId:'FM0001',leaveBasisDate:''},{date:'2026-10-01'},
  [{transactionDate:'2026-10-01',type:'GRANT'}])===true);
expect('manual opening basis on the same date blocks automation',
  api.leaveAutoAlreadyGranted_({employeeId:'FM0001',leaveBasisDate:'2026-10-01'},
  {date:'2026-10-01'},[])===true);
const leaveMockResult=vm.runInContext(`(()=>{
  const originalCalendar=getCompanyCalendarRange_, originalPunches=getActivePunchRows_,
    originalRequests=getRequestsForEmployee_;
  const dates=['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'];
  getCompanyCalendarRange_=()=>dates.map(date=>({date,working:true}));
  getActivePunchRows_=()=>dates.slice(0,4).map(date=>['P1','FM0001','社員',date,'出勤']);
  getRequestsForEmployee_=()=>[];
  const eighty=leaveAttendanceEvidence_({employeeId:'FM0001'},{from:dates[0],through:dates[4]});
  getActivePunchRows_=()=>dates.slice(0,3).map(date=>['P1','FM0001','社員',date,'出勤']);
  const sixty=leaveAttendanceEvidence_({employeeId:'FM0001'},{from:dates[0],through:dates[4]});
  getCompanyCalendarRange_=()=>[];
  const absent=leaveAttendanceEvidence_({employeeId:'FM0001'},{from:dates[0],through:dates[4]});
  getCompanyCalendarRange_=originalCalendar;
  getActivePunchRows_=originalPunches;
  getRequestsForEmployee_=originalRequests;
  return {eighty,sixty,absent};
})()`,context);
expect('attendance evidence grants at exactly 80 percent',leaveMockResult.eighty.verified&&leaveMockResult.eighty.rate===80);
expect('attendance evidence blocks a 60 percent record',!leaveMockResult.sixty.verified);
expect('missing company calendar cannot be treated as qualifying',!leaveMockResult.absent.verified);


const accrualRun=vm.runInContext(`(()=>{
  const originals={
    leaveAutoPolicy_,leaveAttendanceEvidence_,getLeaveLedgerRows_,getLeaveLedgerState_,
    appendLeaveLedgerRow_,getDb_,invalidateEmployeeDirectoryCache_,appendAudit_
  },oldSheet=globalThis.SpreadsheetApp;
  const staff={employeeId:'FM0006',name:'社員',rowNumber:2,active:true,
    hireDate:'2026-04-01',leaveBasisDate:''};
  let balance=0,grantCount=0,auditCount=0,from='2026-09-01';
  const rows=[];
  try{
    leaveAutoPolicy_=()=>({enabled:true,from});
    leaveAttendanceEvidence_=()=>({verified:true,rate:80});
    getLeaveLedgerRows_=()=>rows;
    getLeaveLedgerState_=()=>({configured:rows.length>0,balance,source:rows.length?'LEDGER':'NONE'});
    appendLeaveLedgerRow_=(e,basis,date,type,days,next)=>{
      rows.push({basisDate:basis,transactionDate:date,type,days,balance:next});
      if(type==='GRANT')grantCount++;
    };
    getDb_=()=>({getSheetByName:()=>({getRange:(row,col)=>({setValue:v=>{
      if(col===11)balance=v;
      if(col===25)staff.leaveBasisDate=v;
    }})})});
    invalidateEmployeeDirectoryCache_=()=>{};
    appendAudit_=()=>{auditCount++};
    globalThis.SpreadsheetApp={flush(){}};
    const first=reconcileLeaveUnlocked_(staff,'2026-10-01');
    const duplicate=reconcileLeaveUnlocked_(staff,'2026-10-01');
    const nextYear=reconcileLeaveUnlocked_(staff,'2027-10-01');
    const repeat=reconcileLeaveUnlocked_(staff,'2027-10-01');
    const prior={...staff,employeeId:'FM0099',hireDate:'2026-04-01',leaveBasisDate:''};
    from='2026-10-08';
    const retro=reconcileLeaveUnlocked_(prior,'2026-10-08');
    return {first,duplicate,nextYear,repeat,retro,grantCount,auditCount,balance};
  }finally{
    Object.assign(globalThis,originals);
    if(oldSheet===undefined)delete globalThis.SpreadsheetApp;
    else globalThis.SpreadsheetApp=oldSheet;
  }
})()`,context);
expect('auto grant writes ten days to ledger, master and audit on due date',
  accrualRun.first.granted&&accrualRun.first.balance===10);
expect('auto grant is idempotent for first due date',
  !accrualRun.duplicate.granted&&accrualRun.grantCount===2);
expect('auto grant adds eleven days a year later only once',
  accrualRun.nextYear.granted&&accrualRun.nextYear.days===11&&accrualRun.balance===21&&
  !accrualRun.repeat.granted&&accrualRun.auditCount===2);
expect('auto leave never backfills an entitlement before activation',
  !accrualRun.retro.granted&&accrualRun.retro.reason==='NOT_APPLICABLE');


const sampleEmployee={employeeId:'FM0001',hireDate:'2026-04-01',leaveBasisDate:''};
const samplePeriod={due:{index:1,date:'2027-10-01'}};
const policyBefore={enabled:true,from:'2026-09-01'};
const missed=api.leaveAutoEarlierMissing_(sampleEmployee,samplePeriod,policyBefore,[]);
expect('missed older accrual remains visible after new annual due date',
  missed.length===1&&missed[0].date==='2026-10-01'&&missed[0].days===10);
expect('accrual older than automation activation is not flagged as past due',
  api.leaveAutoEarlierMissing_(sampleEmployee,samplePeriod,{enabled:true,from:'2026-10-08'},[]).length===0);
expect('recorded initial accrual is not falsely marked missing',
  api.leaveAutoEarlierMissing_(sampleEmployee,samplePeriod,policyBefore,
    [{transactionDate:'2026-10-01',type:'GRANT'}]).length===0);

if (failures) {
  console.error(`Logic test failures: ${failures}`);
  process.exit(1);
}
console.log('All FM WORKS logic tests passed.');
