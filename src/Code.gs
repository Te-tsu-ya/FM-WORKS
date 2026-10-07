const APP = Object.freeze({
  name: 'FM WORKS',
  version: '0.2.0',
  locale: 'ja-JP'
});

const DB = Object.freeze({
  spreadsheetId: '1vCGsU43ZvfLfMUN9uA-LwxaIHY97Ssu73YvMERxPG-I',
  timeZone: 'Asia/Tokyo',
  defaultEmployeeId: 'FM0001',
  sheets: {
    employees: '社員マスタ',
    punches: '打刻ログ',
    audit: '監査ログ'
  }
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

function getInitialData() {
  const employee = getEmployee_(DB.defaultEmployeeId);
  const attendance = getAttendanceState_(employee.employeeId);

  return {
    app: APP,
    demo: false,
    serverTime: new Date().toISOString(),
    user: {
      employeeId: employee.employeeId,
      displayName: employee.displayName,
      fullName: employee.name,
      role: employee.role,
      department: employee.department
    },
    attendance: attendance,
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

function recordPunch(action, workLocation) {
  const allowedActions = Object.values(PUNCH);
  if (!allowedActions.includes(action)) {
    throw new Error('不正な打刻種別です。');
  }

  const location = ['出社', '在宅', '外出'].includes(workLocation) ? workLocation : '出社';
  const employee = getEmployee_(DB.defaultEmployeeId);
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
    return getInitialData();
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

function getPunchHistory(limit) {
  const employee = getEmployee_(DB.defaultEmployeeId);
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
    .filter(r => r[1] === employeeId && r[3] === today)
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

function getEmployee_(employeeId) {
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('社員マスタが登録されていません。');

  const rows = sheet.getRange(2, 1, lastRow - 1, 13).getDisplayValues();
  const row = rows.find(r => r[0] === employeeId);
  if (!row) throw new Error('社員情報が見つかりません: ' + employeeId);

  return {
    employeeId: row[0],
    name: row[1],
    displayName: row[2] || row[1],
    department: row[3],
    title: row[4],
    role: row[5],
    active: row[6] === '在籍',
    leaveBalance: Number(row[10] || 0)
  };
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
