const APP = Object.freeze({
  name: 'FM WORKS',
  version: '0.4.0',
  locale: 'ja-JP'
});

const DB = Object.freeze({
  spreadsheetId: '1vCGsU43ZvfLfMUN9uA-LwxaIHY97Ssu73YvMERxPG-I',
  timeZone: 'Asia/Tokyo',
  defaultEmployeeId: 'FM0001',
  sheets: {
    employees: '社員マスタ',
    punches: '打刻ログ',
    schedule: '予定',
    companyCalendar: '会社カレンダー',
    audit: '監査ログ'
  }
});

const PERMISSIONS = Object.freeze({
  COMPANY_CALENDAR_EDIT_ROLES: ['ADMIN', 'CALENDAR_EDITOR']
});

const PUNCH = Object.freeze({
  CLOCK_IN: '出勤',
  BREAK_START: '休憩開始',
  BREAK_END: '休憩終了',
  CLOCK_OUT: '退勤'
});

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.appName = APP.name;
  template.appVersion = APP.version;

  return template
    .evaluate()
    .setTitle(APP.name)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getInitialData(sessionToken) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  const attendance = getAttendanceState_(employee.employeeId);
  const today = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  const scheduleBundle = getScheduleBundle(sessionToken, { start: today, end: today, employeeId: employee.employeeId });
  const companyToday = scheduleBundle.companyDays.find(d => d.date === today) || null;

  return {
    app: APP,
    demo: false,
    serverTime: new Date().toISOString(),
    today: today,
    user: {
      employeeId: employee.employeeId,
      displayName: employee.displayName,
      fullName: employee.name,
      role: employee.role,
      department: employee.department,
      title: employee.title || ''
    },
    permissions: getPermissions_(employee),
    employees: getEmployees_(),
    attendance: attendance,
    todaySchedule: scheduleBundle.events.slice(0, 8),
    companyToday: companyToday,
    month: {
      workHours: '72時間36分',
      overtime: '8時間12分',
      leaveBalance: employee.leaveBalance + '日'
    },
    tasks: [
      { label: '工数入力', status: '未完了', tone: 'danger' },
      { label: '勤怠の確認', status: '0件', tone: 'info' },
      { label: '申請の確認', status: '0件', tone: 'info' }
    ]
  };
}

function recordPunch(sessionToken, action, workLocation) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  const allowedActions = Object.values(PUNCH);
  if (!allowedActions.includes(action)) {
    throw new Error('不正な打刻種別です。');
  }

  const location = ['出社', '在宅', '外出'].includes(workLocation) ? workLocation : '出社';
  const lock = LockService.getScriptLock();

  lock.waitLock(10000);
  try {
    const before = getAttendanceState_(employee.employeeId);
    validatePunchTransition_(before, action);

    const now = new Date();
    const dateText = Utilities.formatDate(now, DB.timeZone, 'yyyy-MM-dd');
    const timestampText = Utilities.formatDate(now, DB.timeZone, 'yyyy-MM-dd HH:mm:ss');
    const punchId = createId_('P');

    const sheet = getDb_().getSheetByName(DB.sheets.punches);
    sheet.appendRow([
      punchId,
      employee.employeeId,
      employee.name,
      dateText,
      action,
      timestampText,
      location,
      'WEB',
      false,
      '',
      '',
      timestampText
    ]);

    appendAudit_({
      employeeId: employee.employeeId,
      employeeName: employee.name,
      operation: '打刻',
      target: '打刻ログ',
      targetId: punchId,
      before: before.state,
      after: action,
      source: 'WEB',
      result: 'SUCCESS',
      note: location
    });

    SpreadsheetApp.flush();
    return getInitialData(sessionToken);
  } catch (err) {
    appendAudit_({
      employeeId: employee.employeeId,
      employeeName: employee.name,
      operation: '打刻',
      target: '打刻ログ',
      targetId: '',
      before: '',
      after: action,
      source: 'WEB',
      result: 'ERROR',
      note: String(err && err.message ? err.message : err)
    });
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function getPunchHistory(sessionToken, limit) {
  const employee = requireSession_(sessionToken).employee;
  const sheet = getDb_().getSheetByName(DB.sheets.punches);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, 12).getDisplayValues()
    .filter(r => r[1] === employee.employeeId)
    .slice(-Math.max(1, Number(limit) || 20))
    .reverse();

  return rows.map(r => ({
    punchId: r[0],
    employeeId: r[1],
    name: r[2],
    date: r[3],
    action: r[4],
    timestamp: r[5],
    workLocation: r[6],
    source: r[7]
  }));
}

function getAttendanceState_(employeeId) {
  const sheet = getDb_().getSheetByName(DB.sheets.punches);
  const today = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return emptyAttendance_(today);
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 12).getDisplayValues()
    .filter(r => r[1] === employeeId && r[3] === today && String(r[8]).toUpperCase() !== 'TRUE')
    .map(r => ({
      id: r[0],
      action: r[4],
      timestamp: r[5],
      workLocation: r[6]
    }));

  if (!rows.length) return emptyAttendance_(today);

  const last = rows[rows.length - 1];
  const clockIn = rows.find(r => r.action === PUNCH.CLOCK_IN);
  const clockOut = [...rows].reverse().find(r => r.action === PUNCH.CLOCK_OUT);

  let state = 'off';
  if (last.action === PUNCH.CLOCK_IN || last.action === PUNCH.BREAK_END) state = 'working';
  if (last.action === PUNCH.BREAK_START) state = 'break';
  if (last.action === PUNCH.CLOCK_OUT) state = 'finished';

  const workedMinutes = calculateWorkedMinutes_(rows);

  return {
    state,
    stateLabel: state === 'working' ? '勤務中' : state === 'break' ? '休憩中' : state === 'finished' ? '退勤済み' : '勤務外',
    clockIn: clockIn ? clockIn.timestamp.slice(11, 16) : '',
    clockOut: clockOut ? clockOut.timestamp.slice(11, 16) : '',
    workLocation: last.workLocation || '出社',
    workedMinutes,
    worked: formatMinutes_(workedMinutes),
    today,
    history: rows.slice().reverse().map(r => ({
      action: r.action,
      time: r.timestamp.slice(11, 16),
      workLocation: r.workLocation
    }))
  };
}

function emptyAttendance_(today) {
  return {
    state: 'off',
    stateLabel: '勤務外',
    clockIn: '',
    clockOut: '',
    workLocation: '出社',
    workedMinutes: 0,
    worked: '0時間00分',
    today,
    history: []
  };
}

function calculateWorkedMinutes_(rows) {
  const parse = value => {
    const m = String(value).match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  };

  const clockIn = rows.find(r => r.action === PUNCH.CLOCK_IN);
  if (!clockIn) return 0;

  const clockOut = [...rows].reverse().find(r => r.action === PUNCH.CLOCK_OUT);
  const start = parse(clockIn.timestamp);
  const end = clockOut ? parse(clockOut.timestamp) : new Date();
  if (!start || !end || end < start) return 0;

  let breakMs = 0;
  let breakStart = null;
  rows.forEach(r => {
    if (r.action === PUNCH.BREAK_START) breakStart = parse(r.timestamp);
    if (r.action === PUNCH.BREAK_END && breakStart) {
      const breakEnd = parse(r.timestamp);
      if (breakEnd && breakEnd >= breakStart) breakMs += breakEnd - breakStart;
      breakStart = null;
    }
  });
  if (breakStart && !clockOut) breakMs += Math.max(0, new Date() - breakStart);

  return Math.max(0, Math.floor(((end - start) - breakMs) / 60000));
}

function validatePunchTransition_(attendance, action) {
  const state = attendance.state;
  const allowed = {
    off: [PUNCH.CLOCK_IN],
    working: [PUNCH.BREAK_START, PUNCH.CLOCK_OUT],
    break: [PUNCH.BREAK_END],
    finished: []
  };

  if (!allowed[state] || !allowed[state].includes(action)) {
    const labels = {
      off: '勤務外',
      working: '勤務中',
      break: '休憩中',
      finished: '退勤済み'
    };
    throw new Error('現在の状態「' + (labels[state] || state) + '」では「' + action + '」を登録できません。');
  }
}

function getPermissions_(employee) {
  const role = String(employee && employee.role || 'USER').toUpperCase();
  return {
    companyCalendarView: true,
    companyCalendarEdit: PERMISSIONS.COMPANY_CALENDAR_EDIT_ROLES.includes(role),
    adminConsole: role === 'ADMIN',
    employeeAdmin: role === 'ADMIN',
    monthlyTeamView: role === 'ADMIN',
    scheduleEdit: true
  };
}

function assertPermission_(employee, permission) {
  const permissions = getPermissions_(employee);
  if (!permissions[permission]) {
    throw new Error('この操作を行う権限がありません。');
  }
}

function getEmployee_(employeeId) {
  const employee = getEmployeeAuthRecord_(employeeId);
  if (!employee) throw new Error('社員情報が見つかりません。');
  return employee;
}

function appendAudit_(item) {
  try {
    const now = new Date();
    const timestampText = Utilities.formatDate(now, DB.timeZone, 'yyyy-MM-dd HH:mm:ss');
    const sheet = getDb_().getSheetByName(DB.sheets.audit);
    sheet.appendRow([
      createId_('A'),
      timestampText,
      item.employeeId || '',
      item.employeeName || '',
      item.operation || '',
      item.target || '',
      item.targetId || '',
      item.before || '',
      item.after || '',
      item.source || '',
      item.result || '',
      item.note || ''
    ]);
  } catch (e) {
    console.error('audit log failed', e);
  }
}

function getDb_() {
  return SpreadsheetApp.openById(DB.spreadsheetId);
}

function createId_(prefix) {
  return prefix + '-' + Utilities.getUuid();
}

function formatMinutes_(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + '時間' + String(m).padStart(2, '0') + '分';
}


function getScheduleBundle(sessionToken, params) {
  requireSession_(sessionToken);
  params = params || {};
  const today = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  const start = normalizeDate_(params.start || today);
  const end = normalizeDate_(params.end || start);
  if (start > end) throw new Error('期間指定が不正です。');

  const employeeId = String(params.employeeId || 'ALL');
  const category = String(params.category || 'ALL');
  const sheet = getDb_().getSheetByName(DB.sheets.schedule);
  const lastRow = sheet.getLastRow();
  const events = [];

  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 18).getDisplayValues();
    rows.forEach(r => {
      if (!r[0] || !r[1] || r[12] === '削除') return;
      if (r[1] < start || r[1] > end) return;
      const ids = String(r[5] || '').split(',').map(x => x.trim()).filter(Boolean);
      if (employeeId !== 'ALL' && !ids.includes(employeeId)) return;
      if (category !== 'ALL' && r[8] !== category) return;
      events.push({
        id: r[0],
        date: r[1],
        start: r[2] || '',
        end: r[3] || '',
        allDay: String(r[4]).toUpperCase() === 'TRUE',
        employeeIds: ids,
        employeeNames: r[6] ? String(r[6]).split('、').filter(Boolean) : [],
        title: r[7] || '',
        category: r[8] || '予定',
        location: r[9] || '',
        detail: r[10] || '',
        visibility: r[11] || '社内',
        status: r[12] || '有効',
        createdBy: r[13] || '',
        createdAt: r[14] || '',
        updatedAt: r[15] || '',
        source: r[16] || '',
        colorKey: r[17] || r[8] || '予定'
      });
    });
  }

  events.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    (a.start || '99:99').localeCompare(b.start || '99:99') ||
    a.title.localeCompare(b.title)
  );

  return {
    start,
    end,
    events,
    companyDays: getCompanyCalendarRange_(start, end),
    employees: getEmployees_()
  };
}

function saveSchedule(sessionToken, payload) {
  payload = payload || {};
  const employee = requireSession_(sessionToken).employee;
  const isAdmin = employee.role === 'ADMIN';
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const date = normalizeDate_(payload.date);
    const title = String(payload.title || '').trim();
    if (!title) throw new Error('予定名を入力してください。');

    const allDay = payload.allDay === true || String(payload.allDay).toUpperCase() === 'TRUE';
    const start = allDay ? '' : normalizeTime_(payload.start || '');
    const end = allDay ? '' : normalizeTime_(payload.end || '');
    if (!allDay && !start) throw new Error('開始時刻を入力してください。');
    if (start && end && start > end) throw new Error('終了時刻は開始時刻以降にしてください。');

    let employeeIds = payload.employeeIds;
    if (!Array.isArray(employeeIds)) {
      employeeIds = String(employeeIds || employee.employeeId).split(',').map(x => x.trim()).filter(Boolean);
    }
    if (!employeeIds.length) employeeIds = [employee.employeeId];

    const activeEmployees = getEmployees_();
    const validIds = new Set(activeEmployees.map(e => e.employeeId));
    employeeIds = [...new Set(employeeIds.filter(id => validIds.has(id)))];
    if (!employeeIds.length) employeeIds = [employee.employeeId];

    const names = employeeIds.map(id => {
      const hit = activeEmployees.find(e => e.employeeId === id);
      return hit ? hit.shortName : id;
    });

    const allowedCategories = ['予定', '仮予定', '業務', '出張', '休暇', '社内'];
    const category = allowedCategories.includes(payload.category) ? payload.category : '予定';
    const nowText = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd HH:mm:ss');
    const sheet = getDb_().getSheetByName(DB.sheets.schedule);

    let id = String(payload.id || '').trim();
    let rowNumber = 0;
    let createdBy = employee.employeeId;
    let createdAt = nowText;
    let source = 'FM WORKS';

    if (id) {
      const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1)
        .createTextFinder(id).matchEntireCell(true).findNext();
      if (!found) throw new Error('編集対象の予定が見つかりません。');
      rowNumber = found.getRow();
      const old = sheet.getRange(rowNumber, 1, 1, 18).getDisplayValues()[0];
      const owner = old[13] || '';
      if (!isAdmin && owner !== employee.employeeId && owner !== employee.name) {
        throw new Error('この予定を編集する権限がありません。');
      }
      createdBy = owner || employee.employeeId;
      createdAt = old[14] || nowText;
      source = old[16] || 'FM WORKS';
    } else {
      id = createId_('S');
      rowNumber = Math.max(2, sheet.getLastRow() + 1);
    }

    const row = [
      id,
      date,
      start,
      end,
      allDay,
      employeeIds.join(','),
      names.join('、'),
      title,
      category,
      String(payload.location || '').trim().slice(0, 150),
      String(payload.detail || '').trim().slice(0, 1000),
      '社内',
      '有効',
      createdBy,
      createdAt,
      nowText,
      source,
      category
    ];

    sheet.getRange(rowNumber, 1, 1, 18).setValues([row]);
    appendAudit_({
      employeeId: employee.employeeId,
      employeeName: employee.name,
      operation: payload.id ? '予定更新' : '予定登録',
      target: '予定',
      targetId: id,
      before: '',
      after: date + ' ' + title,
      source: 'WEB',
      result: 'SUCCESS',
      note: names.join('、')
    });
    SpreadsheetApp.flush();
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function deleteSchedule(sessionToken, scheduleId) {
  const id = String(scheduleId || '').trim();
  if (!id) throw new Error('予定IDがありません。');
  const employee = requireSession_(sessionToken).employee;
  const sheet = getDb_().getSheetByName(DB.sheets.schedule);
  const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1)
    .createTextFinder(id).matchEntireCell(true).findNext();
  if (!found) throw new Error('削除対象の予定が見つかりません。');

  const row = found.getRow();
  const values = sheet.getRange(row, 1, 1, 18).getDisplayValues()[0];
  const owner = values[13] || '';
  if (employee.role !== 'ADMIN' && owner !== employee.employeeId && owner !== employee.name) {
    throw new Error('この予定を削除する権限がありません。');
  }
  const title = values[7] || '';
  sheet.getRange(row, 13).setValue('削除');
  sheet.getRange(row, 16).setValue(Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd HH:mm:ss'));

  appendAudit_({
    employeeId: employee.employeeId,
    employeeName: employee.name,
    operation: '予定削除',
    target: '予定',
    targetId: id,
    before: title,
    after: '削除',
    source: 'WEB',
    result: 'SUCCESS',
    note: ''
  });
  return { ok: true };
}

function getCompanyCalendar(sessionToken, year) {
  requireSession_(sessionToken);
  const y = Number(year || Utilities.formatDate(new Date(), DB.timeZone, 'yyyy'));
  if (!Number.isInteger(y) || y < 2024 || y > 2100) throw new Error('年の指定が不正です。');
  const start = y + '-01-01';
  const end = y + '-12-31';
  const days = getCompanyCalendarRange_(start, end);
  return {
    year: y,
    days: days,
    workdays: days.filter(d => d.working).length,
    daysOff: days.filter(d => !d.working).length,
    adjustedWorkdays: days.filter(d => d.type === '調整出勤日').length,
    companyHolidays: days.filter(d => d.type === '会社休日').length
  };
}

function saveCompanyCalendarDay(sessionToken, payload) {
  payload = payload || {};
  const employee = requireSession_(sessionToken).employee;
  assertPermission_(employee, 'companyCalendarEdit');

  const date = normalizeDate_(payload.date);
  const allowedTypes = ['通常勤務', '法定祝日', '会社休日', '調整出勤日', '週末'];
  const type = allowedTypes.includes(payload.type) ? payload.type : '通常勤務';
  const working = type === '通常勤務' || type === '調整出勤日';
  const name = String(payload.name || '').trim().slice(0, 100);
  const start = working ? normalizeTime_(payload.start || '09:00') : '';
  const end = working ? normalizeTime_(payload.end || '18:00') : '';
  const breakMinutes = working ? Math.max(0, Math.min(480, Number(payload.breakMinutes || 60))) : '';
  const nowText = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd HH:mm:ss');

  const sheet = getDb_().getSheetByName(DB.sheets.companyCalendar);
  const lastRow = sheet.getLastRow();
  let rowNumber = 0;
  if (lastRow >= 2) {
    const found = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(date).matchEntireCell(true).findNext();
    if (found) rowNumber = found.getRow();
  }
  if (!rowNumber) rowNumber = Math.max(2, lastRow + 1);

  sheet.getRange(rowNumber, 1, 1, 10).setValues([[
    date, type, name, start, end, breakMinutes, working,
    'FM WORKS編集', employee.name, nowText
  ]]);

  appendAudit_({
    employeeId: employee.employeeId,
    employeeName: employee.name,
    operation: '会社カレンダー更新',
    target: '会社カレンダー',
    targetId: date,
    before: '',
    after: type + (name ? ' / ' + name : ''),
    source: 'WEB',
    result: 'SUCCESS',
    note: ''
  });
  SpreadsheetApp.flush();
  return { ok: true };
}

function getCompanyCalendarRange_(start, end) {
  const sheet = getDb_().getSheetByName(DB.sheets.companyCalendar);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 10).getDisplayValues()
    .filter(r => r[0] && r[0] >= start && r[0] <= end)
    .map(r => ({
      date: r[0],
      type: r[1] || '',
      name: r[2] || '',
      start: r[3] || '',
      end: r[4] || '',
      breakMinutes: Number(r[5] || 0),
      working: String(r[6]).toUpperCase() === 'TRUE',
      note: r[7] || ''
    }))
    .sort((a,b) => a.date.localeCompare(b.date));
}

function getEmployees_() {
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2, 1, lastRow - 1, 13).getDisplayValues()
    .filter(r => r[0] && r[6] === '在籍')
    .map(r => ({
      employeeId: r[0],
      name: r[1],
      displayName: r[2] || r[1],
      shortName: String(r[1] || '').replace(/\s+/g, '').replace('達哉','').replace('弘典','') || r[2] || r[0],
      department: r[3] || '',
      title: r[4] || '',
      role: r[5] || 'USER'
    }));
}

function normalizeDate_(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日付は YYYY-MM-DD 形式で指定してください。');
  const parts = s.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
  if (d.getUTCFullYear() !== parts[0] || d.getUTCMonth() !== parts[1]-1 || d.getUTCDate() !== parts[2]) {
    throw new Error('存在しない日付です。');
  }
  return s;
}

function normalizeTime_(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('時刻は HH:MM 形式で指定してください。');
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error('時刻が不正です。');
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function healthCheck() {
  const db = getDb_();
  return {
    ok: true,
    app: APP.name,
    version: APP.version,
    dbTitle: db.getName(),
    timestamp: new Date().toISOString()
  };
}
