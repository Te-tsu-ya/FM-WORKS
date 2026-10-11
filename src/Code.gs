const APP = Object.freeze({
  name: 'FM WORKS',
  version: '0.24.1',
  locale: 'ja-JP'
});

const DB = Object.freeze({
  spreadsheetId: '1vCGsU43ZvfLfMUN9uA-LwxaIHY97Ssu73YvMERxPG-I',
  timeZone: 'Asia/Tokyo',
  sheets: {
    employees: '社員マスタ',
    punches: '打刻ログ',
    schedule: '予定',
    companyCalendar: '会社カレンダー',
    audit: '監査ログ',
    projects: 'プロジェクト',
    monthlyClose: '月次締め',
    monthlyReview: '月次確認',
    monthlySnapshot: '月次確定',
    monthlySnapshotDaily: '月次確定日次',
    leaveLedger: '有給台帳'
  }
});

const PERMISSIONS = Object.freeze({
  COMPANY_CALENDAR_EDIT_ROLES: ['ADMIN', 'CALENDAR_EDITOR']
});

const WORK_LOCATIONS = Object.freeze(['出社','在宅','外出']);
const PUNCH = Object.freeze({
  CLOCK_IN: '出勤',
  BREAK_START: '休憩開始',
  BREAK_END: '休憩終了',
  CLOCK_OUT: '退勤',
  LOCATION_CHANGE: '勤務場所変更'
});
const TIME_PUNCH_ACTIONS = Object.freeze([
  PUNCH.CLOCK_IN,
  PUNCH.BREAK_START,
  PUNCH.BREAK_END,
  PUNCH.CLOCK_OUT
]);
function isWorkLocation_(value) {
  return WORK_LOCATIONS.includes(String(value || ''));
}
function isTimePunchAction_(action) {
  return TIME_PUNCH_ACTIONS.includes(String(action || ''));
}

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.appName = APP.name;
  template.appVersion = APP.version;

  return template
    .evaluate()
    .setTitle(APP.name)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getInitialData(sessionToken) {
  const session = requireSession_(sessionToken);
  return buildInitialDataForEmployee_(session.employee);
}

function buildInitialDataForEmployee_(employee) {
  const perfStarted=Date.now();
  const today = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  const attendance = getAttendanceState_(employee.employeeId);
  const employees = getEmployees_();
  const scheduleBundle = getScheduleBundleForViewer_(employee, {
    start: today,
    end: today,
    employeeId: employee.employeeId,
    includeEmployees: false
  });
  const companyToday = scheduleBundle.companyDays.find(d => d.date === today) || null;
  const data={
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
    employees: employees,
    projects: [],
    attendance: attendance,
    todaySchedule: scheduleBundle.events.slice(0, 8),
    companyToday: companyToday,
    monthlyReview: null,
    month: null,
    tasks: null,
    overviewReady: false
  };
  logPerformance_('getInitialData',perfStarted,PERFORMANCE_BUDGETS.initialData,{employees:employees.length,todayEvents:scheduleBundle.events.length});
  return data;
}
function getHomeMonthStats_(employee,today) {
  const ym=today.slice(0,7),start=ym+'-01',end=today,targetId=employee.employeeId;
  const punches=getActivePunchRows_(targetId,start,end),byDate={};
  punches.forEach(r=>(byDate[r[3]]||(byDate[r[3]]=[])).push({id:r[0],action:r[4],timestamp:r[5],workLocation:r[6]}));
  Object.values(byDate).forEach(rows=>rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)));
  const legacy=getLegacyDailySnapshots_(targetId,start,end);
  const calendar=getCompanyCalendarRange_(start,end),calendarMap=Object.fromEntries(calendar.map(d=>[d.date,d]));
  const requests=getApprovedRequestsForMonth_(targetId,start,end);
  const fullDayOff=new Set();
  requests.forEach(req=>{
    if(!['有給','欠勤'].includes(req.type))return;
    const from=req.startDate<start?start:req.startDate,to=req.endDate>end?end:req.endDate;
    if(from>to)return;
    for(let d=from;;d=addDateString_(d,1)){
      if(calendarMap[d]&&calendarMap[d].working)fullDayOff.add(d);
      if(d===to)break;
    }
  });

  const worklogSheet=getDb_().getSheetByName('工数');
  const worklogRows=worklogSheet&&worklogSheet.getLastRow()>=2
    ? readRowsByDateRange_(worklogSheet,2,15,start,end).filter(r=>r[2]===targetId&&r[12]!=='削除')
    : [];
  const worklogMinutes=worklogRows.reduce((sum,r)=>sum+Number(r[9]||0),0);

  let totalMinutes=0,overtimeMinutes=0,missingPunchDays=0;
  for(let date=start;;date=addDateString_(date,1)){
    const rows=byDate[date]||[],snapshot=rows.length?null:(legacy[date]||null),company=calendarMap[date]||null,past=date<today;
    let minutes=0,overtime=0,clockIn='',clockOut='',breakMinutes=0,issue=false;
    if(snapshot){
      minutes=Number(snapshot.workMinutes||0);
      overtime=Number(snapshot.overtimeMinutes||0);
      clockIn=snapshot.clockIn||'';
      clockOut=snapshot.clockOut||'';
      breakMinutes=Number(snapshot.breakMinutes||0);
      const hasAnyPunch=!!clockIn||!!clockOut;
      if(!company)issue=true;
      else if(hasAnyPunch&&(!clockIn||!clockOut)&&past)issue=true;
      else if(company.working&&past&&!hasAnyPunch&&minutes===0&&!fullDayOff.has(date))issue=true;
    }else{
      const clockInRow=rows.find(x=>x.action===PUNCH.CLOCK_IN);
      const clockOutRow=[...rows].reverse().find(x=>x.action===PUNCH.CLOCK_OUT);
      clockIn=clockInRow?clockInRow.timestamp.slice(11,16):'';
      clockOut=clockOutRow?clockOutRow.timestamp.slice(11,16):'';
      minutes=rows.length?calculateMonthlyDayMinutes_(rows,date===today):0;
      breakMinutes=rows.length?calculateBreakMinutesForRows_(rows,date===today):0;
      if(company&&company.working){
        const standard=company.start&&company.end?Math.max(0,timeRangeMinutes_(company.start,company.end)-Number(company.breakMinutes||0)):0;
        overtime=Math.max(0,minutes-standard);
      }
      if(!company)issue=true;
      else if(fullDayOff.has(date)&&rows.length>0)issue=true;
      else if(rows.length>0&&(!clockIn||(!clockOut&&past)))issue=true;
      else if(company.working&&past&&rows.length===0&&!fullDayOff.has(date))issue=true;
    }
    const requiredBreak=requiredBreakMinutes_(minutes);
    const dayFinished=!!clockOut||!!snapshot||past;
    if(dayFinished&&minutes>0&&requiredBreak>0&&breakMinutes<requiredBreak)issue=true;
    if(issue)missingPunchDays++;
    totalMinutes+=minutes;
    overtimeMinutes+=overtime;
    if(date===end)break;
  }
  return {totalMinutes,overtimeMinutes,missingPunchDays,worklogMinutes};
}

function getHomeOverview(sessionToken) {
  const perfStarted=Date.now();
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  const today = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  maybeReconcileLeave_(employee.employeeId,today);
  const currentLeave=getLeaveLedgerState_(getEmployee_(employee.employeeId));
  const monthStats = getHomeMonthStats_(employee,today);
  const pendingRequests = getPendingRequestCount_(employee);
  const worklogGap = Math.max(0, monthStats.totalMinutes - monthStats.worklogMinutes);
  const result={
    generatedAt: new Date().toISOString(),
    month: {
      workHours: formatMinutes_(monthStats.totalMinutes),
      overtime: formatMinutes_(monthStats.overtimeMinutes),
      leaveBalance: currentLeave.configured ? currentLeave.balance + '日' : '未設定',
      pendingRequests: pendingRequests,
      worklogMinutes: monthStats.worklogMinutes,
      worklogGapMinutes: worklogGap,
      missingPunchDays: monthStats.missingPunchDays
    },
    tasks: [
      { label: '工数入力', status: worklogGap > 0 ? formatMinutes_(worklogGap) + '不足' : '完了', tone: worklogGap > 0 ? 'danger' : 'info' },
      { label: '勤怠の確認', status: monthStats.missingPunchDays + '件', tone: monthStats.missingPunchDays > 0 ? 'warning' : 'info' },
      { label: getPermissions_(employee).requestApprove ? '申請の承認' : '申請の確認', status: pendingRequests + '件', tone: pendingRequests > 0 ? 'warning' : 'info' }
    ]
  };
  logPerformance_('getHomeOverview',perfStarted,PERFORMANCE_BUDGETS.homeOverview,{punchIssues:monthStats.missingPunchDays});
  return result;
}
function recordPunch(sessionToken, action, workLocation) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  if (!isTimePunchAction_(action)) {
    throw new Error('不正な打刻種別です。');
  }

  const location = isWorkLocation_(workLocation) ? workLocation : '出社';
  const lock = LockService.getScriptLock();

  lock.waitLock(10000);
  try {
    const context = getAttendanceContext_(employee.employeeId);
    const before = context.attendance;
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

    const nextRows=context.rows.concat([{id:punchId,action:action,timestamp:timestampText,workLocation:location}]);
    return {
      ok: true,
      today: dateText,
      serverTime: new Date().toISOString(),
      attendance: buildAttendanceStateFromRows_(dateText,nextRows)
    };
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

function recordWorkLocationChange(sessionToken, workLocation) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  const location = String(workLocation || '');
  if (!isWorkLocation_(location)) throw new Error('勤務場所を確認してください。');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const context = getAttendanceContext_(employee.employeeId);
    const before = context.attendance;
    if (!['working','break'].includes(before.state)) {
      throw new Error('勤務場所は勤務中または休憩中に変更できます。');
    }

    const previous = isWorkLocation_(before.workLocation) ? before.workLocation : '出社';
    if (previous === location) {
      return {
        ok:true,
        changed:false,
        today:context.today,
        serverTime:new Date().toISOString(),
        attendance:before
      };
    }

    const now = new Date();
    const dateText = Utilities.formatDate(now, DB.timeZone, 'yyyy-MM-dd');
    const timestampText = Utilities.formatDate(now, DB.timeZone, 'yyyy-MM-dd HH:mm:ss');
    const punchId = createId_('P');
    getDb_().getSheetByName(DB.sheets.punches).appendRow([
      punchId,
      employee.employeeId,
      employee.name,
      dateText,
      PUNCH.LOCATION_CHANGE,
      timestampText,
      location,
      'WEB',
      false,
      '',
      previous + ' → ' + location,
      timestampText
    ]);

    appendAudit_({
      employeeId:employee.employeeId,
      employeeName:employee.name,
      operation:'勤務場所変更',
      target:'打刻ログ',
      targetId:punchId,
      before:previous,
      after:location,
      source:'WEB',
      result:'SUCCESS',
      note:previous + ' → ' + location
    });

    const nextRows=context.rows.concat([{id:punchId,action:PUNCH.LOCATION_CHANGE,timestamp:timestampText,workLocation:location}]);
    return {
      ok:true,
      changed:true,
      today:dateText,
      serverTime:new Date().toISOString(),
      attendance:buildAttendanceStateFromRows_(dateText,nextRows)
    };
  } catch (err) {
    appendAudit_({
      employeeId:employee.employeeId,
      employeeName:employee.name,
      operation:'勤務場所変更',
      target:'打刻ログ',
      targetId:'',
      before:'',
      after:location,
      source:'WEB',
      result:'ERROR',
      note:String(err && err.message ? err.message : err)
    });
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function getActivePunchRows_(employeeId, startDate, endDate) {
  const sheet = getDb_().getSheetByName(DB.sheets.punches);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const source=startDate&&endDate
    ? readRowsByDateRange_(sheet,4,12,startDate,endDate)
    : sheet.getRange(2,1,lastRow-1,12).getDisplayValues();
  const all=source.filter(r=>r[1]===employeeId&&(!startDate||r[3]>=startDate)&&(!endDate||r[3]<=endDate));
  const superseded=new Set(all.map(r=>String(r[9]||'').trim()).filter(Boolean));
  return all.filter(r=>String(r[8]).toUpperCase()!=='TRUE'&&!superseded.has(String(r[0]||'').trim()));
}

function getPunchHistory(sessionToken, limit) {
  const employee = requireSession_(sessionToken).employee;
  const rows = getActivePunchRows_(employee.employeeId)
    .sort((a,b) => String(b[5]).localeCompare(String(a[5])))
    .slice(0, Math.max(1, Number(limit) || 20));

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

function summarizeWorkLocations_(rows) {
  const ordered=(rows||[]).slice().sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp)));
  const locations=[];
  ordered.forEach(row=>{
    const location=String(row&&row.workLocation||'');
    if(!isWorkLocation_(location))return;
    if(locations[locations.length-1]!==location)locations.push(location);
  });
  return locations.join('→');
}

function buildAttendanceStateFromRows_(today,rows) {
  const ordered=(rows||[]).slice().sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp)));
  if (!ordered.length) return emptyAttendance_(today);

  const clockIn = ordered.find(r => r.action === PUNCH.CLOCK_IN);
  const clockOut = [...ordered].reverse().find(r => r.action === PUNCH.CLOCK_OUT);
  let state = 'off';
  let currentLocation = '出社';
  let previousLocation = '';
  const history=[];

  ordered.forEach(r=>{
    const action=r.action;
    const rowLocation=isWorkLocation_(r.workLocation)?r.workLocation:currentLocation;
    if(action===PUNCH.CLOCK_IN)state='working';
    else if(action===PUNCH.BREAK_START)state='break';
    else if(action===PUNCH.BREAK_END)state='working';
    else if(action===PUNCH.CLOCK_OUT)state='finished';

    if(action===PUNCH.LOCATION_CHANGE){
      const from=isWorkLocation_(previousLocation)?previousLocation:currentLocation;
      history.push({
        action:action,
        time:String(r.timestamp||'').slice(11,16),
        workLocation:rowLocation,
        fromWorkLocation:from
      });
    }else{
      history.push({
        action:action,
        time:String(r.timestamp||'').slice(11,16),
        workLocation:rowLocation
      });
    }

    if(isWorkLocation_(rowLocation)){
      currentLocation=rowLocation;
      previousLocation=rowLocation;
    }
  });

  const workedMinutes = calculateWorkedMinutes_(ordered);
  return {
    state,
    stateLabel: state === 'working' ? '勤務中' : state === 'break' ? '休憩中' : state === 'finished' ? '退勤済み' : '勤務外',
    clockIn: clockIn ? clockIn.timestamp.slice(11, 16) : '',
    clockOut: clockOut ? clockOut.timestamp.slice(11, 16) : '',
    workLocation: currentLocation,
    workLocationSummary: summarizeWorkLocations_(ordered),
    workedMinutes,
    worked: formatMinutes_(workedMinutes),
    today,
    history: history.reverse()
  };
}

function getAttendanceContext_(employeeId) {
  const today = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  const rows = getActivePunchRows_(employeeId, today, today)
    .map(r => ({id:r[0],action:r[4],timestamp:r[5],workLocation:r[6]}))
    .sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  return {today:today,rows:rows,attendance:buildAttendanceStateFromRows_(today,rows)};
}

function getAttendanceState_(employeeId) {
  return getAttendanceContext_(employeeId).attendance;
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

function validatePunchSequence_(rows) {
  const ordered = (rows || []).slice().sort((a,b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  let state = 'off';
  let clockInCount = 0;
  let clockOutCount = 0;
  const allowed = {
    off: [PUNCH.CLOCK_IN],
    working: [PUNCH.BREAK_START, PUNCH.CLOCK_OUT],
    break: [PUNCH.BREAK_END],
    finished: []
  };

  for (const row of ordered) {
    const action = row.action;
    if (action === PUNCH.LOCATION_CHANGE) {
      if (!['working','break'].includes(state)) {
        throw new Error('勤務場所変更は勤務中または休憩中にのみ登録できます。');
      }
      if (!isWorkLocation_(row.workLocation)) throw new Error('勤務場所が不正です。');
      continue;
    }
    if (!isTimePunchAction_(action)) throw new Error('打刻種別が不正です。');
    if (!allowed[state].includes(action)) {
      throw new Error('打刻修正後の順序が成立しません。出勤・休憩・退勤の時刻を確認してください。');
    }
    if (action === PUNCH.CLOCK_IN) { clockInCount++; state = 'working'; }
    else if (action === PUNCH.BREAK_START) state = 'break';
    else if (action === PUNCH.BREAK_END) state = 'working';
    else if (action === PUNCH.CLOCK_OUT) { clockOutCount++; state = 'finished'; }
  }

  if (clockInCount > 1 || clockOutCount > 1) {
    throw new Error('1日に複数の出勤・退勤打刻は登録できません。');
  }
  return true;
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

function financeDepartmentAllowed_(department) {
  const name=String(department||'').replace(/\s+/g,'').replace(/[／/]/g,'・');
  if(/^(?:経理総務|総務経理)(?:部|課|担当)?$/.test(name))return true;
  const parts=name.split('・');
  return parts.length>=1&&parts.length<=2&&parts.every(part=>/^(?:経理|総務)(?:部|課|室|担当|チーム)?$/.test(part));
}
function getPermissions_(employee) {
  const role = String(employee && employee.role || 'USER').toUpperCase();
  return {
    companyCalendarView: true,
    companyCalendarEdit: PERMISSIONS.COMPANY_CALENDAR_EDIT_ROLES.includes(role),
    adminConsole: role === 'ADMIN',
    // The finance APIs independently enforce this permission on the server.
    quoteWorkspace: true, // Every authenticated employee may create, save, and issue own estimates.
    officeWorkspace: role === 'ADMIN' || financeDepartmentAllowed_(employee && employee.department),
    financeWorkspace: role === 'ADMIN' || financeDepartmentAllowed_(employee && employee.department),
    cashFlowWorkspace: role === 'ADMIN',
    employeeAdmin: role === 'ADMIN',
    requestApprove: role === 'ADMIN' || role === 'MANAGER',
    monthlyTeamView: role === 'ADMIN' || role === 'MANAGER',
    scheduleEdit: true
  };
}

function canManageEmployeeRecord_(viewer, target) {
  if (!viewer || !target || !viewer.employeeId || !target.employeeId) return false;
  if (viewer.employeeId === target.employeeId) return false;
  const role = String(viewer.role || 'USER').toUpperCase();
  if (role === 'ADMIN') return true;
  if (role === 'MANAGER') return String(target.managerId || '') === String(viewer.employeeId);
  return false;
}

function canManageEmployee_(viewer, targetEmployeeId) {
  return canManageEmployeeRecord_(viewer, getEmployee_(targetEmployeeId));
}

function getManagedEmployeeIds_(viewer) {
  return new Set(getEmployees_().filter(target => canManageEmployeeRecord_(viewer, target)).map(target => target.employeeId));
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

function auditJson_(value) {
  try { return safeSheetText_(JSON.stringify(value == null ? null : value), 4000); }
  catch (_) { return safeSheetText_(String(value == null ? '' : value), 4000); }
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
    return true;
  } catch (e) {
    console.error('audit log failed', e);
    // Financial operations can explicitly alert the operator that the record
    // was written but its audit entry was not confirmed. Existing callers
    // that ignore this return value retain their previous behavior.
    return false;
  }
}

function withScriptLock_(fn, timeoutMs) {
  const lock = LockService.getScriptLock();
  lock.waitLock(Number(timeoutMs || 15000));
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function normalizeRuntimeEnvironment_(value) {
  const raw=String(value||'STAGING').trim().toUpperCase();
  return ['DEVELOPMENT','STAGING','PRODUCTION'].includes(raw)?raw:'STAGING';
}

function getRuntimeEnvironment_() {
  return normalizeRuntimeEnvironment_(PropertiesService.getScriptProperties().getProperty('FM_WORKS_ENVIRONMENT'));
}

function getDatabaseSpreadsheetId_() {
  const props=PropertiesService.getScriptProperties();
  const environment=getRuntimeEnvironment_();
  const configured=String(props.getProperty('FM_WORKS_DB_ID')||'').trim();
  if(environment==='PRODUCTION'){
    if(!configured)throw new Error('PRODUCTION環境では FM_WORKS_DB_ID の明示設定が必要です。');
    if(configured===DB.spreadsheetId)throw new Error('PRODUCTION環境ではSTAGING既定DBを使用できません。');
  }
  return configured||DB.spreadsheetId;
}

function getRuntimeInfo_() {
  const props=PropertiesService.getScriptProperties();
  const environment=getRuntimeEnvironment_();
  const configured=String(props.getProperty('FM_WORKS_DB_ID')||'').trim();
  return {
    environment:environment,
    explicitDb:!!configured,
    databaseId:configured||DB.spreadsheetId,
    usingDefaultStagingDb:!configured||configured===DB.spreadsheetId
  };
}

// Reuse a Spreadsheet handle within an Apps Script execution. The environment
// guard runs before every reuse; switching the configured DB opens a new handle.
let fmWorksOpenDb_={id:'',handle:null};
function getDb_() {
  const id=getDatabaseSpreadsheetId_();
  if(fmWorksOpenDb_.handle&&fmWorksOpenDb_.id===id)return fmWorksOpenDb_.handle;
  const handle=SpreadsheetApp.openById(id);
  fmWorksOpenDb_={id,handle};
  return handle;
}

function createId_(prefix) {
  return prefix + '-' + Utilities.getUuid();
}

function safeSheetText_(value, maxLength) {
  let text = String(value == null ? '' : value).trim();
  if (maxLength) text = text.slice(0, Number(maxLength));
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return text;
}

function formatMinutes_(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + '時間' + String(m).padStart(2, '0') + '分';
}


function normalizeScheduleVisibility_(value, viewer) {
  const requested=String(value||'社内').trim();
  const allowed=['社内','参加者のみ','管理者のみ'];
  const normalized=allowed.includes(requested)?requested:'社内';
  if(normalized==='管理者のみ'&&String(viewer&&viewer.role||'USER').toUpperCase()!=='ADMIN') throw new Error('管理者のみの予定を作成できるのは管理者だけです。');
  return normalized;
}

function canViewScheduleRow_(viewer,row) {
  if(!viewer||!row)return false;
  if(String(viewer.role||'USER').toUpperCase()==='ADMIN')return true;
  const visibility=String(row[11]||'社内').trim()||'社内';
  const owner=String(row[13]||'');
  const ids=String(row[5]||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(owner===viewer.employeeId||owner===viewer.name)return true;
  if(visibility==='管理者のみ')return false;
  if(visibility==='参加者のみ')return ids.includes(viewer.employeeId);
  return true;
}

function getScheduleBundle(sessionToken, params) {
  const session = requireSession_(sessionToken);
  return getScheduleBundleForViewer_(session.employee,params);
}

function getScheduleBundleForViewer_(viewer, params) {
  const perfStarted=Date.now();
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
    const rows = readRowsByDateRange_(sheet,2,18,start,end);
    rows.forEach(r => {
      if (!r[0] || !r[1] || r[12] === '削除') return;
      if (!canViewScheduleRow_(viewer,r)) return;
      const ids = String(r[5] || '').split(',').map(x => x.trim()).filter(Boolean);
      if (employeeId !== 'ALL' && !ids.includes(employeeId)) return;
      if (category !== 'ALL' && r[8] !== category) return;
      events.push({
        id: r[0], date: r[1], start: r[2] || '', end: r[3] || '',
        allDay: String(r[4]).toUpperCase() === 'TRUE',
        employeeIds: ids,
        employeeNames: r[6] ? String(r[6]).split('、').filter(Boolean) : [],
        title: r[7] || '', category: r[8] || '予定', location: r[9] || '', detail: r[10] || '',
        visibility: r[11] || '社内', status: r[12] || '有効', createdBy: r[13] || '', createdAt: r[14] || '',
        updatedAt: r[15] || '', source: r[16] || '', colorKey: r[17] || r[8] || '予定',
        canEdit: viewer.role === 'ADMIN' ||
          (r[13] || '') === viewer.employeeId ||
          (r[13] || '') === viewer.name ||
          ((r[16] || '') === '予定表(仮)' && ids.includes(viewer.employeeId))
      });
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.start || '99:99').localeCompare(b.start || '99:99') || a.title.localeCompare(b.title));
  const result={
    start, end, events,
    companyDays: getCompanyCalendarRange_(start, end),
    employees: params.includeEmployees === false ? [] : getEmployees_()
  };
  logPerformance_('getScheduleBundle',perfStarted,PERFORMANCE_BUDGETS.scheduleBundle,{events:events.length,start:start,end:end});
  return result;
}
function saveSchedule(sessionToken, payload) {
  payload = payload || {};
  const employee = requireSession_(sessionToken).employee;
  const isAdmin = employee.role === 'ADMIN';
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const date = normalizeDate_(payload.date);
    const title = safeSheetText_(payload.title, 200);
    if (!title) throw new Error('予定名を入力してください。');

    const allDay = payload.allDay === true || String(payload.allDay).toUpperCase() === 'TRUE';
    const start = allDay ? '' : normalizeTime_(payload.start || '');
    const end = allDay ? '' : normalizeTime_(payload.end || '');
    if (!allDay && !start) throw new Error('開始時刻を入力してください。');
    if (start && end && start >= end) throw new Error('終了時刻は開始時刻より後にしてください。');

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
    const visibility = normalizeScheduleVisibility_(payload.visibility || '社内', employee);
    const nowText = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd HH:mm:ss');
    const sheet = getDb_().getSheetByName(DB.sheets.schedule);

    let id = String(payload.id || '').trim();
    let rowNumber = 0;
    let createdBy = employee.employeeId;
    let createdAt = nowText;
    let source = 'FM WORKS';
    let auditBefore = '';


    if (id) {
      const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1)
        .createTextFinder(id).matchEntireCell(true).findNext();
      if (!found) throw new Error('編集対象の予定が見つかりません。');
      rowNumber = found.getRow();
      const old = sheet.getRange(rowNumber, 1, 1, 18).getDisplayValues()[0];
      auditBefore = auditJson_({date:old[1],start:old[2],end:old[3],allDay:old[4],employeeIds:old[5],title:old[7],category:old[8],location:old[9],detail:old[10],visibility:old[11],status:old[12]});
      const owner = old[13] || '';
      const oldIds = String(old[5] || '').split(',').map(x => x.trim()).filter(Boolean);
      const oldSource = old[16] || '';
      const canEditLegacyOwn = oldSource === '予定表(仮)' && oldIds.includes(employee.employeeId);
      if (!isAdmin && owner !== employee.employeeId && owner !== employee.name && !canEditLegacyOwn) {
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
      safeSheetText_(payload.location, 150),
      safeSheetText_(payload.detail, 1000),
      visibility,
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
      before: auditBefore,
      after: auditJson_({date:date,start:start,end:end,allDay:allDay,employeeIds:employeeIds,title:title,category:category,location:row[9],detail:row[10],visibility:visibility,status:'有効'}),
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

  return withScriptLock_(function() {
    const sheet = getDb_().getSheetByName(DB.sheets.schedule);
    const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1)
      .createTextFinder(id).matchEntireCell(true).findNext();
    if (!found) throw new Error('削除対象の予定が見つかりません。');

    const row = found.getRow();
    const values = sheet.getRange(row, 1, 1, 18).getDisplayValues()[0];
    if (values[12] === '削除') return { ok: true };
    const owner = values[13] || '';
    const participantIds = String(values[5] || '').split(',').map(x => x.trim()).filter(Boolean);
    const source = values[16] || '';
    const canEditLegacyOwn = source === '予定表(仮)' && participantIds.includes(employee.employeeId);
    if (employee.role !== 'ADMIN' && owner !== employee.employeeId && owner !== employee.name && !canEditLegacyOwn) {
      throw new Error('この予定を削除する権限がありません。');
    }

    const title = values[7] || '';
    const nowText = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(row, 13).setValue('削除');
    sheet.getRange(row, 16).setValue(nowText);

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
    SpreadsheetApp.flush();
    return { ok: true };
  });
}
function getCompanyCalendar(sessionToken, year) {
  requireSession_(sessionToken);
  const requestedYear = Number(year || Utilities.formatDate(new Date(), DB.timeZone, 'yyyy'));
  if (!Number.isInteger(requestedYear) || requestedYear < 2024 || requestedYear > 2100) throw new Error('年の指定が不正です。');

  const availableYears = getCompanyCalendarYears_();
  const currentYear = Number(Utilities.formatDate(new Date(), DB.timeZone, 'yyyy'));
  let y = requestedYear;
  if (availableYears.length && !availableYears.includes(y)) {
    if (availableYears.includes(currentYear)) {
      y = currentYear;
    } else {
      y = availableYears.reduce((best, candidate) =>
        Math.abs(candidate - requestedYear) < Math.abs(best - requestedYear) ? candidate : best
      , availableYears[0]);
    }
  }

  const start = y + '-01-01';
  const end = y + '-12-31';
  const days = getCompanyCalendarRange_(start, end);
  const nextCreatableYear = availableYears.length ? Math.max.apply(null, availableYears) + 1 : currentYear;

  return {
    year: y,
    requestedYear: requestedYear,
    availableYears: availableYears,
    nextCreatableYear: nextCreatableYear,
    canGenerateNextStandard: hasOfficialHolidayData_(nextCreatableYear),
    days: days,
    workdays: days.filter(d => d.working).length,
    daysOff: days.filter(d => !d.working).length,
    adjustedWorkdays: days.filter(d => d.type === '調整出勤日').length,
    companyHolidays: days.filter(d => d.type === '会社休日').length,
    canGenerateStandard: days.length === 0 && hasOfficialHolidayData_(y),
    standardSource: hasOfficialHolidayData_(y) ? JAPAN_HOLIDAY_SOURCE : ''
  };
}

function getCompanyCalendarYears_() {
  const cacheKey='fm:calendar-years:v2';
  const cached=cacheJsonGet_(cacheKey);
  if(cached)return cached;
  const sheet = getDb_().getSheetByName(DB.sheets.companyCalendar);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const years = new Set();
  sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().forEach(r => {
    const match = String(r[0] || '').match(/^(\d{4})-/);
    if (match) years.add(Number(match[1]));
  });
  const result=Array.from(years).filter(y => Number.isInteger(y)).sort((a,b) => a-b);
  cacheJsonPut_(cacheKey,result,600);
  return result;
}
function saveCompanyCalendarDay(sessionToken, payload) {
  payload = payload || {};
  const employee = requireSession_(sessionToken).employee;
  assertPermission_(employee, 'companyCalendarEdit');

  return withScriptLock_(function() {
    const date = normalizeDate_(payload.date);
    const allowedTypes = ['通常勤務', '法定祝日', '法定休日', '会社休日', '調整出勤日', '週末'];
    const type = allowedTypes.includes(payload.type) ? payload.type : '通常勤務';
    const working = type === '通常勤務' || type === '調整出勤日';
    const name = safeSheetText_(payload.name, 100);
    const start = working ? normalizeTime_(payload.start || '09:00') : '';
    const end = working ? normalizeTime_(payload.end || '18:00') : '';
    if (working && start >= end) throw new Error('勤務終了時刻は開始時刻より後に設定してください。');
    const breakMinutes = working ? Math.max(0, Math.min(480, Number(payload.breakMinutes || 60))) : '';
    const totalMinutes = working ? timeRangeMinutes_(start, end) : 0;
    if (working && breakMinutes >= totalMinutes) throw new Error('休憩時間は勤務時間より短く設定してください。');
    const nowText = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd HH:mm:ss');

    const sheet = getDb_().getSheetByName(DB.sheets.companyCalendar);
    const lastRow = sheet.getLastRow();
    let rowNumber = 0;
    let before = '';
    if (lastRow >= 2) {
      const found = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(date).matchEntireCell(true).findNext();
      if (found) {
        rowNumber = found.getRow();
        const old = sheet.getRange(rowNumber, 1, 1, 10).getDisplayValues()[0];
        before = [old[1], old[2], old[3], old[4], old[5]].join(' / ');
      }
    }
    if (!rowNumber) rowNumber = Math.max(2, lastRow + 1);

    sheet.getRange(rowNumber, 1, 1, 10).setValues([[
      date, type, name, start, end, breakMinutes, working,
      'FM WORKS編集', employee.name, nowText
    ]]);
    invalidateCompanyCalendarCache_(date.slice(0,4));

    appendAudit_({
      employeeId: employee.employeeId,
      employeeName: employee.name,
      operation: '会社カレンダー更新',
      target: '会社カレンダー',
      targetId: date,
      before: before,
      after: type + (name ? ' / ' + name : '') + (working ? ' / ' + start + '-' + end : ''),
      source: 'WEB',
      result: 'SUCCESS',
      note: ''
    });
    SpreadsheetApp.flush();
    return { ok: true };
  });
}
function getCompanyCalendarRange_(start, end) {
  const from=normalizeDate_(start),to=normalizeDate_(end);
  if(from>to)return [];
  const startYear=Number(from.slice(0,4)),endYear=Number(to.slice(0,4)),rows=[];
  for(let year=startYear;year<=endYear;year++)rows.push(...getCompanyCalendarYearCached_(year));
  return rows.filter(d=>d.date>=from&&d.date<=to).sort((a,b)=>a.date.localeCompare(b.date));
}

function getCompanyCalendarYearCached_(year) {
  const y=Number(year);
  if(!Number.isInteger(y))return [];
  const key='fm:calendar:'+y+':v2';
  const cached=cacheJsonGet_(key);
  if(cached)return cached;
  const sheet = getDb_().getSheetByName(DB.sheets.companyCalendar);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const start=y+'-01-01',end=y+'-12-31';
  const rows=readRowsByDateRange_(sheet,1,10,start,end)
    .filter(r => r[0] && r[0] >= start && r[0] <= end)
    .map(r => ({
      date:r[0], type:r[1]||'', name:r[2]||'', start:r[3]||'', end:r[4]||'',
      breakMinutes:Number(r[5]||0), working:String(r[6]).toUpperCase()==='TRUE', note:r[7]||''
    })).sort((a,b)=>a.date.localeCompare(b.date));
  cacheJsonPut_(key,rows,600);
  return rows;
}

function invalidateCompanyCalendarCache_(year) {
  cacheRemove_('fm:calendar:'+Number(year)+':v2');
  cacheRemove_('fm:calendar-years:v2');
}
function getEmployees_() {
  const cacheKey='fm:employees:v2';
  const cached=cacheJsonGet_(cacheKey);
  if(cached)return cached;
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const employees=sheet.getRange(2, 1, lastRow - 1, 26).getDisplayValues()
    .filter(r => r[0] && r[6] === '在籍')
    .map(r => ({
      employeeId:r[0], name:r[1], displayName:r[2]||r[1], shortName:shortEmployeeName_(r[1],r[2],r[0]),
      department:r[3]||'', title:r[4]||'', role:r[5]||'USER', payrollIncluded:String(r[22]).toUpperCase()==='TRUE',
      managerId:r[23]||'', leaveBasisDate:r[24]||'', hireDate:r[25]||''
    }));
  cacheJsonPut_(cacheKey,employees,120);
  return employees;
}

function invalidateEmployeeDirectoryCache_() {
  cacheRemove_('fm:employees:v2');
}
function shortEmployeeName_(fullName, displayName, employeeId) {
  const full = String(fullName || '').trim();
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length) return parts[0];
  }
  const display = String(displayName || '').trim().replace(/さん$/, '');
  return display || String(employeeId || '');
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

function healthCheck(sessionToken) {
  requireSession_(sessionToken);
  return {
    ok: true,
    app: APP.name,
    version: APP.version,
    environment: getRuntimeEnvironment_(),
    timestamp: new Date().toISOString()
  };
}

