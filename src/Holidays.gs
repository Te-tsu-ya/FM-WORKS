const JAPAN_HOLIDAY_SOURCE = 'https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html';

const JAPAN_HOLIDAYS = Object.freeze({
  2026: Object.freeze({
    '2026-01-01':'元日',
    '2026-01-12':'成人の日',
    '2026-02-11':'建国記念の日',
    '2026-02-23':'天皇誕生日',
    '2026-03-20':'春分の日',
    '2026-04-29':'昭和の日',
    '2026-05-03':'憲法記念日',
    '2026-05-04':'みどりの日',
    '2026-05-05':'こどもの日',
    '2026-05-06':'振替休日',
    '2026-07-20':'海の日',
    '2026-08-11':'山の日',
    '2026-09-21':'敬老の日',
    '2026-09-22':'休日',
    '2026-09-23':'秋分の日',
    '2026-10-12':'スポーツの日',
    '2026-11-03':'文化の日',
    '2026-11-23':'勤労感謝の日'
  }),
  2027: Object.freeze({
    '2027-01-01':'元日',
    '2027-01-11':'成人の日',
    '2027-02-11':'建国記念の日',
    '2027-02-23':'天皇誕生日',
    '2027-03-21':'春分の日',
    '2027-03-22':'振替休日',
    '2027-04-29':'昭和の日',
    '2027-05-03':'憲法記念日',
    '2027-05-04':'みどりの日',
    '2027-05-05':'こどもの日',
    '2027-07-19':'海の日',
    '2027-08-11':'山の日',
    '2027-09-20':'敬老の日',
    '2027-09-23':'秋分の日',
    '2027-10-11':'スポーツの日',
    '2027-11-03':'文化の日',
    '2027-11-23':'勤労感謝の日'
  })
});

function hasOfficialHolidayData_(year) {
  return !!JAPAN_HOLIDAYS[Number(year)];
}

function generateStandardCompanyCalendarYear(sessionToken, year) {
  const employee = requireSession_(sessionToken).employee;
  assertPermission_(employee, 'companyCalendarEdit');
  const y = Number(year);
  if (!Number.isInteger(y) || !hasOfficialHolidayData_(y)) {
    throw new Error('この年の公的な祝日データはまだ登録されていません。');
  }

  return withScriptLock_(function() {
    const start = y + '-01-01';
    const end = y + '-12-31';
    const existing = getCompanyCalendarRange_(start, end);
    if (existing.length) {
      throw new Error(y + '年の会社カレンダーはすでに登録されています。既存データは自動上書きしません。');
    }

    const pattern = getDefaultCompanyWorkPattern_();
    const holidays = JAPAN_HOLIDAYS[y];
    const rows = [];
    const daysInYear = Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000);

    for (let offset = 0; offset < daysInYear; offset++) {
      const d = new Date(Date.UTC(y, 0, 1 + offset));
      const date = Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
      const dow = d.getUTCDay();
      const holidayName = holidays[date] || '';
      let type = '通常勤務';
      let name = '';
      let working = true;

      if (holidayName) {
        type = '法定祝日';
        name = holidayName;
        working = false;
      } else if (dow === 0 || dow === 6) {
        type = '週末';
        name = dow === 0 ? '日曜日' : '土曜日';
        working = false;
      }

      rows.push([
        date,
        type,
        name,
        working ? pattern.start : '',
        working ? pattern.end : '',
        working ? pattern.breakMinutes : '',
        working,
        '標準カレンダー自動生成 / 会社独自休日・調整出勤日は要確認',
        employee.name,
        toTimestamp_(new Date())
      ]);
    }

    const sheet = getDb_().getSheetByName(DB.sheets.companyCalendar);
    const rowStart = Math.max(2, sheet.getLastRow() + 1);
    sheet.getRange(rowStart, 1, rows.length, 10).setValues(rows);
    invalidateCompanyCalendarCache_(y);

    appendAudit_({
      employeeId: employee.employeeId,
      employeeName: employee.name,
      operation: '会社カレンダー標準生成',
      target: '会社カレンダー',
      targetId: String(y),
      before: '',
      after: rows.length + '日',
      source: 'WEB',
      result: 'SUCCESS',
      note: '国民の祝日: 内閣府 / 会社独自休日・調整出勤日は未設定'
    });
    SpreadsheetApp.flush();

    return {
      ok: true,
      year: y,
      generatedDays: rows.length,
      source: JAPAN_HOLIDAY_SOURCE,
      requiresCompanyReview: true
    };
  }, 30000);
}

function getDefaultCompanyWorkPattern_() {
  const sheet = getDb_().getSheetByName(DB.sheets.companyCalendar);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { start:'09:00', end:'18:00', breakMinutes:60 };

  const counts = {};
  sheet.getRange(2, 1, lastRow - 1, 10).getDisplayValues().forEach(r => {
    if (String(r[6]).toUpperCase() !== 'TRUE' || !r[3] || !r[4]) return;
    const key = [r[3], r[4], Number(r[5] || 60)].join('|');
    counts[key] = (counts[key] || 0) + 1;
  });

  const keys = Object.keys(counts);
  if (!keys.length) return { start:'09:00', end:'18:00', breakMinutes:60 };
  keys.sort((a,b) => counts[b] - counts[a]);
  const parts = keys[0].split('|');
  return { start:parts[0], end:parts[1], breakMinutes:Number(parts[2] || 60) };
}
