import fs from 'node:fs';
import vm from 'node:vm';

const files = [
  'src/Code.gs',
  'src/Auth.gs',
  'src/Worklog.gs',
  'src/Requests.gs',
  'src/Monthly.gs'
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
  isPrototypeLogin_,
  shortEmployeeName_,
  requiredBreakMinutes_,
  calculateBreakMinutesForRows_,
  normalizeYearMonth_,
  previousYearMonth_,
  monthlyReviewUrgency_,
  yearMonthsBetween_,
  canManageEmployeeRecord_
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
expect('prototype PIN accepts fictional employee', api.isPrototypeLogin_({employeeId:'FM0001'}, '000000') === true);
expect('prototype PIN rejects unknown employee', api.isPrototypeLogin_({employeeId:'FM9999'}, '000000') === false);
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
expect('admin can manage another employee', api.canManageEmployeeRecord_({employeeId:'FM0001',role:'ADMIN'},{employeeId:'FM0003',role:'USER',managerId:'FM0001'}) === true);
expect('admin cannot approve self', api.canManageEmployeeRecord_({employeeId:'FM0001',role:'ADMIN'},{employeeId:'FM0001',role:'ADMIN',managerId:''}) === false);
expect('manager can manage direct report', api.canManageEmployeeRecord_({employeeId:'FM0002',role:'MANAGER'},{employeeId:'FM0003',role:'USER',managerId:'FM0002'}) === true);
expect('manager cannot manage unrelated employee', api.canManageEmployeeRecord_({employeeId:'FM0002',role:'MANAGER'},{employeeId:'FM0004',role:'USER',managerId:'FM0001'}) === false);
expect('user cannot manage another employee', api.canManageEmployeeRecord_({employeeId:'FM0003',role:'USER'},{employeeId:'FM0004',role:'USER',managerId:'FM0003'}) === false);

if (failures) {
  console.error(`Logic test failures: ${failures}`);
  process.exit(1);
}
console.log('All FM WORKS logic tests passed.');
