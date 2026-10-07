import fs from 'node:fs';
import vm from 'node:vm';

const files = [
  'src/Code.gs',
  'src/Auth.gs',
  'src/Worklog.gs',
  'src/Requests.gs',
  'src/Monthly.gs',
  'src/MonthlySnapshot.gs',
  'src/LeaveLedger.gs',
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
  monthlySnapshotPayload_,
  normalizeLeaveDays_,
  leaveBalanceAfterDelta_,
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
  dateRangeStrings_,
  dateRangeRegex_,
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

if (failures) {
  console.error(`Logic test failures: ${failures}`);
  process.exit(1);
}
console.log('All FM WORKS logic tests passed.');
