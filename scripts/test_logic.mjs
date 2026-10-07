import fs from 'node:fs';
import vm from 'node:vm';

const files = [
  'src/Code.gs',
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
  safeSheetName_
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

if (failures) {
  console.error(`Logic test failures: ${failures}`);
  process.exit(1);
}
console.log('All FM WORKS logic tests passed.');
