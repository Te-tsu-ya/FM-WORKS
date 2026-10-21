const APP = Object.freeze({
  name: 'FM WORKS',
  version: '0.0.3',
  locale: 'ja-JP'
});

const DB = Object.freeze({
  spreadsheetId: 'SITES_SQL_ONLY',
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

function getInitialData(sessionToken) {
  const session = requireSession_(sessionToken);
  return buildInitialDataForEmployee_(session.employee);
}

function buildInitialDataForEmployee_(employee) {
  const perfStarted=Date.now();
  const today = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  const attendance = getAttendanceState_(employee.employeeId);
  const employees = employeeDirectoryForViewer_(getEmployees_(),employee);
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

// Limit employee-directory fields crossing the authenticated browser API boundary.
// The full source directory is retained on the server for permission checks.
// Managers need a managerId only for their own direct-report monthly selector.
function employeeDirectoryForViewer_(employees,viewer) {
  if(String(viewer&&viewer.role||'').toUpperCase()==='ADMIN')return employees;
  const managerId=String(viewer&&viewer.role||'').toUpperCase()==='MANAGER'
    ?String(viewer.employeeId||''):'';
  return (employees||[]).map(person=>({
    employeeId:person.employeeId,
    name:person.name,
    displayName:person.displayName,
    shortName:person.shortName,
    department:person.department,
    title:person.title,
    role:person.role,
    managerId:managerId&&String(person.managerId||'')===managerId?managerId:''
  }));
}

function getHomeMonthStats_(employee,today,approvedRequests) {
  const ym=today.slice(0,7),start=ym+'-01',end=today,targetId=employee.employeeId;
  const punches=getActivePunchRows_(targetId,start,end),byDate={};
  punches.forEach(r=>(byDate[r[3]]||(byDate[r[3]]=[])).push({id:r[0],action:r[4],timestamp:r[5],workLocation:r[6]}));
  Object.values(byDate).forEach(rows=>rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)));
  const legacy=getLegacyDailySnapshots_(targetId,start,end);
  const calendar=getCompanyCalendarRange_(start,end),calendarMap=Object.fromEntries(calendar.map(d=>[d.date,d]));
  const requests=Array.isArray(approvedRequests)?approvedRequests:getApprovedRequestsForMonth_(targetId,start,end);
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
    ? readRowsByDateRange_(worklogSheet,2,15,start,end,3,[targetId]).filter(r=>r[2]===targetId&&r[12]!=='削除')
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
  const reconciled=maybeReconcileLeave_(employee.employeeId,today,employee);
  const leaveEmployee=reconciled&&(reconciled.granted||reconciled.repaired)
    ?getEmployee_(employee.employeeId):employee;
  const currentLeave=getLeaveLedgerState_(leaveEmployee);
  const requestSnapshot=getHomeRequestSnapshot_(employee,today.slice(0,7)+'-01',today);
  const monthStats=getHomeMonthStats_(employee,today,requestSnapshot.approved);
  const pendingRequests=requestSnapshot.pendingCount;
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
    ? readRowsByDateRange_(sheet,4,12,startDate,endDate,2,[employeeId])
    // History needs all dates for correct superseded-punch handling, but not
    // other employees' 12-column rows. Keep cheap one-shot reads on small sheets.
    : lastRow>250&&String(employeeId||'').trim()
      ? readRowsByColumnValues_(sheet,2,12,[employeeId])
      : sheet.getRange(2,1,lastRow-1,12).getDisplayValues();
  const all=source.filter(r=>r[1]===employeeId&&(!startDate||r[3]>=startDate)&&(!endDate||r[3]<=endDate));
  const superseded=new Set(all.map(r=>String(r[9]||'').trim()).filter(Boolean));
  return all.filter(r=>String(r[8]).toUpperCase()!=='TRUE'&&!superseded.has(String(r[0]||'').trim()));
}

function getPunchHistory(sessionToken, limit) {
  const employee = requireSession_(sessionToken).employee;
  const rows = getActivePunchRows_(employee.employeeId)
    .sort((a,b) => String(b[5]).localeCompare(String(a[5])))
    // Clamp malformed or excessively large API requests before creating the RPC response.
    .slice(0, Number.isFinite(Number(limit)) ? Math.min(100, Math.max(1, Math.floor(Number(limit)))) : 20);

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
  // The cached employee directory is for display, never a MANAGER's ACL.
  const role=String(viewer&&viewer.role||'USER').toUpperCase();
  if(role==='MANAGER')return new Set(getActiveDirectReports_(viewer.employeeId).filter(e=>e.employeeId!==viewer.employeeId).map(e=>e.employeeId));
  if(role!=='ADMIN')return new Set();
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

function withScriptLock_() {} // Supplied by the Sites runtime.

function normalizeRuntimeEnvironment_(value) {
  const raw=String(value||'STAGING').trim().toUpperCase();
  return ['DEVELOPMENT','STAGING','PRODUCTION'].includes(raw)?raw:'STAGING';
}

function getRuntimeEnvironment_() {} // Supplied by the Sites runtime.

function getDatabaseSpreadsheetId_() {} // Supplied by the Sites runtime.

function getRuntimeInfo_() {} // Supplied by the Sites runtime.

// Reuse a Spreadsheet handle within an Apps Script execution. The environment
// guard runs before every reuse; switching the configured DB opens a new handle.
let fmWorksOpenDb_={id:'',handle:null};
function getDb_() {} // Supplied by the Sites runtime.

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
  const viewerId=String(viewer.employeeId||'');
  // Legacy creator names are not unique. A name can identify ownership only
  // when the event contains exactly this employee as its sole participant.
  if(viewerId&&(owner===viewerId||
    owner===String(viewer.name||'')&&ids.length===1&&ids[0]===viewerId))return true;
  if(visibility==='管理者のみ')return false;
  if(visibility==='参加者のみ')return ids.includes(viewer.employeeId);
  return true;
}

function getScheduleBundle(sessionToken, params) {
  const session = requireSession_(sessionToken);
  return getScheduleBundleForViewer_(session.employee,params);
}


// A display name is not a unique ownership identity. Only a verified employee
// ID grants normal edit rights. Preserve narrowly scoped legacy records.
function canEditScheduleRow_(viewer,row) {
  if(!viewer||!row)return false;
  if(String(viewer.role||'').toUpperCase()==='ADMIN')return true;
  const viewerId=String(viewer.employeeId||'');
  if(!viewerId)return false;
  const owner=String(row[13]||'');
  if(owner===viewerId)return true;
  const participants=String(row[5]||'').split(',').map(id=>id.trim()).filter(Boolean);
  const source=String(row[16]||'');
  if(source==='予定表(仮)'&&participants.includes(viewerId))return true;
  // Old imported data sometimes recorded only a creator name. Never grant
  // a same-name coworker write access to a multi-employee event.
  return owner===String(viewer.name||'')&&participants.length===1&&participants[0]===viewerId;
}

function getScheduleBundleForViewer_(viewer, params) {
  const perfStarted=Date.now();
  params = params || {};
  const today = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  const start = normalizeDate_(params.start || today);
  const end = normalizeDate_(params.end || start);
  if (start > end) throw new Error('期間指定が不正です。');
  assertReadWindow_(start,end,400);
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
        canEdit: canEditScheduleRow_(viewer,r)
      });
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.start || '99:99').localeCompare(b.start || '99:99') || a.title.localeCompare(b.title));
  const result={
    start, end, events,
    companyDays: getCompanyCalendarRange_(start, end),
    employees: params.includeEmployees === false ? [] : employeeDirectoryForViewer_(getEmployees_(),viewer)
  };
  logPerformance_('getScheduleBundle',perfStarted,PERFORMANCE_BUDGETS.scheduleBundle,{events:events.length,start:start,end:end});
  return result;
}
function saveSchedule(sessionToken, payload) {
  payload = payload || {};
  const employee = requireSession_(sessionToken).employee;
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
      if (!canEditScheduleRow_(employee,old)) {
        throw new Error('この予定を編集する権限がありません。');
      }
      if (old[12] === '削除') {
        throw new Error('削除済みの予定は編集できません。新しい予定として登録してください。');
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
    // Even an already deleted event is private to its owner/editors.
    if (!canEditScheduleRow_(employee,values)) {
      throw new Error('この予定を削除する権限がありません。');
    }
    if (values[12] === '削除') return { ok: true };

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

// Guard expensive range-based RPCs before reading the workbook/calendar.
// 400 dates permit full-year views without allowing multi-year accidental scans.
function assertReadWindow_(start,end,maxDays){
  const limit=Number(maxDays)||400;
  const span=Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z');
  if(!Number.isFinite(span)||span<0||span>(limit-1)*86400000){
    throw new Error('表示期間は最大'+limit+'日以内にしてください。');
  }
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



const AUTH = Object.freeze({
  sessionSheet: 'セッション',
  resetSheet: 'PIN再発行',
  settingsSheet: '設定',
  pepperKey: 'FM_WORKS_AUTH_PEPPER',
  defaultSessionHours: 12,
  defaultIdleMinutes: 120,
  defaultRememberSessionDays: 30,
  defaultRememberIdleDays: 30,
  defaultMaxFailures: 5,
  defaultLockMinutes: 15,
  defaultPinLength: 6,
  sessionTouchMinutes: 5,
  prototypeMode: false,
  prototypePin: '000000',
  prototypeEmployeeIds: ['FM0001','FM0002','FM0003','FM0004','FM0005']
});

function prototypeSettingEnabled_(value) {
  const raw=String(value==null?'':value).trim().toUpperCase();
  if(['FALSE','0','OFF'].includes(raw))return false;
  if(['TRUE','1','ON'].includes(raw))return true;
  return !!AUTH.prototypeMode;
}

function prototypeModeEnabledForEnvironment_(value, environment) {
  return prototypeSettingEnabled_(value) && normalizeRuntimeEnvironment_(environment)!=='PRODUCTION';
}

function isPrototypeConfigured_() {
  if(typeof SpreadsheetApp==='undefined')return !!AUTH.prototypeMode;
  return prototypeSettingEnabled_(getSettingsMap_().PROTOTYPE_MODE);
}

function isPrototypeMode_() {
  if(!isPrototypeConfigured_())return false;
  if(typeof PropertiesService==='undefined')return false;
  return prototypeModeEnabledForEnvironment_('TRUE',getRuntimeEnvironment_());
}
function getAuthAdminData(sessionToken, scope) {
  const session = requireAdminSession_(sessionToken);
  const mode=['people','auth','projects'].includes(String(scope||''))?String(scope):'auth';
  const result={scope:mode};

  if(mode==='people'||mode==='auth'){
    const sheet = getDb_().getSheetByName(DB.sheets.employees);
    const lastRow = sheet.getLastRow();
    const employees = [];
    if (lastRow >= 2) {
      const rows = sheet.getRange(2, 1, lastRow - 1, 26).getDisplayValues();
      rows.forEach(r => {
        if (!r[0]) return;
        employees.push({
          employeeId:r[0], name:r[1], displayName:r[2]||r[1], department:r[3]||'', title:r[4]||'',
          role:r[5]||'USER', active:r[6]==='在籍', workStart:r[7]||'09:00', workEnd:r[8]||'18:00',
          breakMinutes:Number(r[9]||60), leaveBalance:Number(r[10]||0), leaveBalanceConfigured:String(r[10]||'').trim()!=='',
          email:r[11]||'', note:r[12]||'', pinConfigured:!!r[14], mustChangePin:String(r[15]).toUpperCase()==='TRUE',
          failures:Number(r[16]||0), lockedUntil:r[17]||'', lastLogin:r[18]||'', authState:r[20]||'',
          payrollIncluded:String(r[22]).toUpperCase()==='TRUE', managerId:r[23]||'', leaveBasisDate:r[24]||'', hireDate:r[25]||'',
          autoLeaveEnabled:leaveAutoPolicy_(r[0]).enabled,
          autoLeaveForecast:mode==='people'?leaveAutoForecast_({
            employeeId:r[0],hireDate:r[25]||'',leaveBasisDate:r[24]||'',active:r[6]==='在籍'
          },Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd')):null
        });
      });
    }
    result.employees=employees;
  }

  if(mode==='projects'){
    result.projects=getProjectsInternal_(true);
  }

  if(mode==='auth'){
    const resetSheet = getDb_().getSheetByName(AUTH.resetSheet);
    const resetLastRow = resetSheet.getLastRow();
    result.resetRequests = resetLastRow < 2 ? [] : resetSheet.getRange(Math.max(2,resetLastRow-49),1,Math.min(50,resetLastRow-1),9).getDisplayValues()
      .filter(r => r[0])
      .reverse()
      .map(r => ({
        requestId:r[0], requestedAt:r[1], employeeId:r[2], name:r[3], status:r[4], note:r[5], handledBy:r[6], handledAt:r[7]
      }));
    result.support=getSupportConfig_();
    result.prototypeMode=isPrototypeConfigured_();
    result.prototypeAccessEffective=isPrototypeMode_();
    result.currentUser=publicEmployee_(session.employee);
  }
  return result;
}

function adminUnlockAccount(sessionToken, targetEmployeeId) {
  const admin = requireAdminSession_(sessionToken).employee;
  return withScriptLock_(function() {
    const target = getEmployeeAuthRecord_(targetEmployeeId);
    if (!target) throw new Error('対象社員が見つかりません。');
    updateEmployeeAuthCells_(target.rowNumber, { failures: 0, lockUntil: '' });
    appendAudit_({
      employeeId: admin.employeeId,
      employeeName: admin.name,
      operation: 'アカウントロック解除',
      target: '社員マスタ',
      targetId: target.employeeId,
      before: target.lockUntil || '',
      after: '',
      source: 'WEB',
      result: 'SUCCESS',
      note: target.name
    });
    SpreadsheetApp.flush();
    return { ok: true };
  });
}

function saveAuthSupportSettings(sessionToken, payload) {
  const admin = requireAdminSession_(sessionToken).employee;
  payload = payload || {};
  return withScriptLock_(function() {
    const values = {
      SUPPORT_CONTACT_NAME: safeSheetText_(payload.name, 80) || 'FM WORKS管理者',
      SUPPORT_EMAIL: String(payload.email || '').trim().slice(0, 200),
      SUPPORT_PHONE: String(payload.phone || '').trim().slice(0, 80),
      SUPPORT_NOTE: safeSheetText_(payload.note, 300) || 'PINを忘れた場合は、社内のFM WORKS管理者へご連絡ください。'
    };
    if (!values.SUPPORT_EMAIL && !values.SUPPORT_PHONE) {
      throw new Error('PINを忘れた場合の連絡先として、メールまたは電話番号を1つ以上登録してください。');
    }
    if (values.SUPPORT_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.SUPPORT_EMAIL)) {
      throw new Error('メールアドレスの形式を確認してください。');
    }
    saveSettings_(values);
    appendAudit_({
      employeeId: admin.employeeId,
      employeeName: admin.name,
      operation: 'サポート連絡先更新',
      target: '設定',
      targetId: 'SUPPORT',
      before: '',
      after: values.SUPPORT_CONTACT_NAME,
      source: 'WEB',
      result: 'SUCCESS',
      note: ''
    });
    SpreadsheetApp.flush();
    return getSupportConfig_();
  });
}
function requireSession_() {} // Supplied by the Sites runtime.

function requireAdminSession_() {} // Supplied by the Sites runtime.

function invalidateEmployeeSessions_(employeeId, exceptRowNumber) {
  const sheet = getDb_().getSheetByName(AUTH.sessionSheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const rows = sheet.getRange(2, 1, lastRow - 1, 11).getDisplayValues();
  const targets=[];
  rows.forEach((r,idx)=>{
    const rowNumber=idx+2;
    if(rowNumber===exceptRowNumber)return;
    if(r[2]===employeeId&&r[7]==='ACTIVE')targets.push('H'+rowNumber);
  });
  if(targets.length)sheet.getRangeList(targets).setValue('REVOKED');
}

function getEmployeeAuthRecord_(employeeId) {
  const id = normalizeEmployeeId_(employeeId);
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const verified=findVerifiedSheetRow_(sheet,1,26,id,'employee',true);
  if(!verified)return null;
  const rowNumber=verified.rowNumber,r=verified.row;
  return {
    rowNumber: rowNumber,
    employeeId: r[0],
    name: r[1],
    displayName: r[2] || r[1],
    department: r[3] || '',
    title: r[4] || '',
    role: r[5] || 'USER',
    active: r[6] === '在籍',
    leaveBalance: Number(r[10] || 0),
    leaveBalanceConfigured: String(r[10] || '').trim() !== '',
    email: r[11] || '',
    pinSalt: r[13] || '',
    pinHash: r[14] || '',
    mustChangePin: String(r[15]).toUpperCase() === 'TRUE',
    failures: Number(r[16] || 0),
    lockUntil: r[17] || '',
    lastLogin: r[18] || '',
    pinUpdatedAt: r[19] || '',
    authState: r[20] || '',
    payrollIncluded: String(r[22]).toUpperCase() === 'TRUE',
    managerId: r[23] || '',
    leaveBasisDate: r[24] || '',
    hireDate: r[25] || ''
  };
}

function updateEmployeeAuthCells_(rowNumber, values) {
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const mapping = {
    pinSalt: 14,
    pinHash: 15,
    mustChangePin: 16,
    failures: 17,
    lockUntil: 18,
    lastLogin: 19,
    pinUpdatedAt: 20,
    authState: 21,
    permissionDetail: 22
  };
  const range=sheet.getRange(rowNumber,14,1,9);
  const row=range.getValues()[0];
  let changed=false;
  Object.keys(values).forEach(key=>{
    const column=mapping[key];
    if(!column)return;
    row[column-14]=values[key];
    changed=true;
  });
  if(changed)range.setValues([row]);
}

function getSupportConfig_(settings) {
  const map = settings || getSettingsMap_();
  return {
    name: map.SUPPORT_CONTACT_NAME || 'FM WORKS管理者',
    email: map.SUPPORT_EMAIL || '',
    phone: map.SUPPORT_PHONE || '',
    note: map.SUPPORT_NOTE || 'PINを忘れた場合は、社内のFM WORKS管理者へご連絡ください。'
  };
}

function getSettingsMap_() {
  const cacheKey='fm:settings:v2';
  const cached=cacheJsonGet_(cacheKey);
  if(cached)return cached;
  const sheet = getDb_().getSheetByName(AUTH.settingsSheet);
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues().forEach(r => {
      if (r[0]) map[r[0]] = r[1];
    });
  }
  cacheJsonPut_(cacheKey,map,90);
  return map;
}

function saveSettings_(values) {
  cacheRemove_('fm:settings:v2');
  const sheet = getDb_().getSheetByName(AUTH.settingsSheet);
  const lastRow = sheet.getLastRow();
  const rows = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 4).getDisplayValues() : [];
  const rowByKey = {};
  rows.forEach((r, i) => { if (r[0]) rowByKey[r[0]] = i + 2; });
  const nowText = toTimestamp_(new Date());
  Object.keys(values).forEach(key => {
    const rowNumber = rowByKey[key];
    if (rowNumber) {
      sheet.getRange(rowNumber, 2).setValue(values[key]);
      sheet.getRange(rowNumber, 4).setValue(nowText);
    } else {
      sheet.appendRow([key, values[key], '', nowText]);
    }
  });
}

function normalizeEmployeeId_(value) {
  const id = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,24}$/.test(id)) throw loginError_();
  return id;
}

function publicEmployee_(employee) {
  return {
    employeeId: employee.employeeId,
    name: employee.name,
    displayName: employee.displayName,
    department: employee.department,
    title: employee.title,
    role: employee.role
  };
}

function loginError_() {
  return new Error('社員番号またはPINを確認してください。');
}

function toTimestamp_(date) {
  return Utilities.formatDate(date, DB.timeZone, 'yyyy-MM-dd HH:mm:ss');
}

function parseTimestamp_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getTime());
  }
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const date = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] || 0)
  );
  return isNaN(date.getTime()) ? null : date;
}


const PERFORMANCE_BUDGETS = Object.freeze({
  initialData:900,
  homeOverview:1000,
  scheduleBundle:1200,
  requestsBundle:1200,
  monthlySummary:2500,
  worklogs:900,
  dateRangeRead:800,
  indexedRead:800
});

function dateRangeStrings_(start,end,maxDays){
  const from=String(start||''),to=String(end||from),limit=Math.max(1,Number(maxDays||370));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return [];
  const out=[];
  for(let d=from;out.length<limit;d=addDateString_(d,1)){
    out.push(d);
    if(d===to)return out;
  }
  return [];
}

function dateRangeRegex_(start,end,maxDays){
  const days=dateRangeStrings_(start,end,maxDays);
  // A partial range index silently drops later records. If the requested
  // end day was not reached, let readRowsByDateRange_ use its full fallback.
  if(!days.length||days[days.length-1]!==String(end||start))return '';
  return '^(?:'+days.join('|')+')$';
}

function regexEscape_(value){
  return String(value==null?'':value).replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');
}

// Cache entries must never follow a switch between staging and production DBs.
function databaseCacheKey_(key){return 'fm:db:'+getDatabaseSpreadsheetId_()+':'+String(key||'');}
function utf8Bytes_(text){
  let bytes=0;
  for(const ch of String(text)){const cp=ch.codePointAt(0);bytes+=cp<128?1:cp<2048?2:cp<65536?3:4;}
  return bytes;
}
function cacheJsonGet_(key){
  try{
    const raw=CacheService.getScriptCache().get(databaseCacheKey_(key));
    return raw?JSON.parse(raw):null;
  }catch(e){
    console.warn('cache get failed',key,e);
    return null;
  }
}

function cacheJsonPut_(key,value,ttlSeconds){
  try{
    const raw=JSON.stringify(value);
    if(utf8Bytes_(raw)>90000)return false;
    CacheService.getScriptCache().put(databaseCacheKey_(key),raw,Math.max(1,Number(ttlSeconds||60)));
    return true;
  }catch(e){
    console.warn('cache put failed',key,e);
    return false;
  }
}

function cacheRemove_(key){
  try{CacheService.getScriptCache().remove(databaseCacheKey_(key));}catch(e){console.warn('cache remove failed',key,e);}
}

// Immutable generations keep a concurrent reader from mixing old/new chunks.
// Any missing part is a cache miss; partial business records are never returned.
function cacheJsonGetLarge_(key){
  const value=cacheJsonGet_(key);
  if(!value||value._fmChunks!==1)return value;
  try{
    if(!/^[A-Za-z0-9-]+$/.test(value.generation)||!Number.isInteger(value.count)||value.count<1||value.count>80)return null;
    const prefix=databaseCacheKey_(key)+':'+value.generation+':';
    const keys=Array.from({length:value.count},(_,i)=>prefix+i);
    const parts=CacheService.getScriptCache().getAll(keys);
    if(keys.some(k=>typeof parts[k]!=='string'))return null;
    return JSON.parse(keys.map(k=>parts[k]).join(''));
  }catch(e){console.warn('large cache get failed',key,e);return null;}
}
function cacheJsonPutLarge_(key,value,ttlSeconds){
  try{
    const raw=JSON.stringify(value),bytes=utf8Bytes_(raw);
    if(bytes<=90000)return cacheJsonPut_(key,value,ttlSeconds);
    if(bytes>4800000){cacheRemove_(key);return false;}
    const generation=Utilities.getUuid(),prefix=databaseCacheKey_(key)+':'+generation+':',parts={};let part='',size=0,count=0;
    for(const ch of raw){const n=utf8Bytes_(ch);if(size+n>60000){parts[prefix+count++]=part;part='';size=0;}part+=ch;size+=n;}
    parts[prefix+count++]=part;
    CacheService.getScriptCache().putAll(parts,Math.max(1,Number(ttlSeconds||60)));
    return cacheJsonPut_(key,{_fmChunks:1,generation,count},ttlSeconds);
  }catch(e){cacheRemove_(key);console.warn('large cache put failed',key,e);return false;}
}

// Cache only a row-number hint. Authentication, permissions, PIN fields,
// status and expiry are ALWAYS read fresh from the actual sheet row.
function findVerifiedSheetRow_(sheet,column,width,value,scope,display){
  const key=String(value==null?'':value);
  if(!key)return null;
  const lastRow=sheet.getLastRow();
  if(lastRow<2)return null;
  const started=Date.now();
  const cacheKey='fm:rowhint:v1:'+getDatabaseSpreadsheetId_()+':'+scope+':'+key;
  const hint=cacheJsonGet_(cacheKey);
  const rowHint=Number(hint&&hint.row);
  const readRow=rowNumber=>{
    const range=sheet.getRange(rowNumber,1,1,width);
    return (display?range.getDisplayValues():range.getValues())[0];
  };
  if(Number.isInteger(rowHint)&&rowHint>=2&&rowHint<=lastRow){
    try{
      const row=readRow(rowHint);
      if(String(row&&row[column-1])===key){
        if(Date.now()-started>400)logPerformance_('verifiedRowLookup',started,400,{scope,source:'ROW_HINT'});
        return {rowNumber:rowHint,row};
      }
    }catch(_){/* A moved or deleted row invalidates the hint. */}
  }
  const finder=sheet.getRange(2,column,lastRow-1,1).createTextFinder(key).matchEntireCell(true);
  // IDs and submission keys are exact values. The default case-insensitive
  // finder could stop on a different key before the real matching row.
  if(typeof finder.matchCase==='function')finder.matchCase(true);
  const found=finder.findNext();
  if(!found)return null;
  const rowNumber=found.getRow();
  const row=readRow(rowNumber);
  if(String(row&&row[column-1])!==key)return null;
  cacheJsonPut_(cacheKey,{row:rowNumber},300);
  if(Date.now()-started>400)logPerformance_('verifiedRowLookup',started,400,{scope,source:'TEXT_FINDER'});
  return {rowNumber,row};
}

function readRowsByColumnValues_(sheet,column,width,values,caseInsensitive,withRowNumbers){
  const lastRow=sheet.getLastRow();
  if(lastRow<2)return [];
  const normalize=value=>caseInsensitive?String(value||'').toUpperCase():String(value||'');
  const wanted=[...new Set((values||[]).map(v=>normalize(String(v||'').trim())).filter(Boolean))];
  if(!wanted.length)return [];
  const wantedSet=new Set(wanted);
  const select=(rows,start)=>rows.map((r,i)=>withRowNumbers?{rowNumber:start+i,values:r}:r)
    .filter(r=>wantedSet.has(normalize((withRowNumbers?r.values:r)[column-1])));
  const pattern='^(?:'+wanted.map(regexEscape_).join('|')+')$';
  const started=Date.now();
  if(lastRow-1<=250&&(lastRow-1)*width<=10000){
    const rows=select(sheet.getRange(2,1,lastRow-1,width).getDisplayValues(),2);
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'SMALL_BATCH'});return rows;
  }
  if(pattern.length>5000||wanted.length>80){
    const rows=select(sheet.getRange(2,1,lastRow-1,width).getDisplayValues(),2);
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'FULL_FALLBACK',values:wanted.length});
    return rows;
  }
  let cells;
  try{cells=sheet.getRange(2,column,lastRow-1,1).createTextFinder(pattern).useRegularExpression(true).matchEntireCell(true).findAll();}
  catch(_){
    const rows=select(sheet.getRange(2,1,lastRow-1,width).getDisplayValues(),2);
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'INDEX_UNAVAILABLE',values:wanted.length});
    return rows;
  }
  if(!cells.length){
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:0,source:'TEXT_FINDER',values:wanted.length});
    return [];
  }
  const blocks=indexedRowWindows_(cells.map(c=>c.getRow()));
  const endCol=columnLetter_(width);
  const rows=sheet.getRangeList(blocks.map(b=>'A'+b.start+':'+endCol+b.end)).getRanges()
    .flatMap((range,i)=>select(range.getDisplayValues(),blocks[i].start));
  logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'VALUE_INDEX',blocks:blocks.length,values:wanted.length});
  return rows;
}
function contiguousRowBlocks_(rowNumbers){
  const rows=[...new Set((rowNumbers||[]).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b),blocks=[];
  rows.forEach(row=>{
    const last=blocks[blocks.length-1];
    if(last&&row===last.end+1)last.end=row;
    else blocks.push({start:row,end:row});
  });
  return blocks;
}

// At most eight Sheet value reads. Keep the seven largest gaps unread: among
// ordered row windows this minimizes extra cells for this service-call budget.
// Callers must filter live row values again because a window may include gaps.
function indexedRowWindows_(rowNumbers,minGapRows){
  const blocks=contiguousRowBlocks_(rowNumbers);
  if(blocks.length<=1)return blocks;
  // Default path preserves the existing smallest-cell, at-most-eight-window behavior.
  // Optional minimum gap avoids paying extra Sheets round trips for tiny holes.
  const minGap=Math.max(0,Math.floor(Number(minGapRows)||0));
  if(blocks.length<=8&&!minGap)return blocks;
  const gaps=blocks.slice(1).map((b,i)=>({after:i,size:b.start-blocks[i].end-1}))
    .filter(g=>g.size>=minGap);
  const cuts=new Set(gaps.sort((a,b)=>b.size-a.size||a.after-b.after).slice(0,7).map(g=>g.after));
  const windows=[];let start=blocks[0].start;
  blocks.forEach((b,i)=>{if(cuts.has(i)||i===blocks.length-1){windows.push({start,end:b.end});start=blocks[i+1]?.start;}});
  return windows;
}

function columnLetter_(column){
  let n=Math.max(1,Number(column||1)),out='';
  while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}
  return out;
}

function logPerformance_(label,startedAt,budgetMs,meta){
  const elapsed=Math.max(0,Date.now()-Number(startedAt||Date.now()));
  const payload={type:'FM_WORKS_PERF',label:String(label||''),elapsedMs:elapsed,budgetMs:Number(budgetMs||0),overBudget:!!budgetMs&&elapsed>budgetMs,meta:meta||{}};
  console.log(JSON.stringify(payload));
  return payload;
}

// Optional owner index intersects with the date index before any wide-row read.
// Every result is rechecked against live values; indexes never grant access.
function readRowsByDateRange_(sheet,dateColumn,width,start,end,scopeColumn,scopeValues){
  const lastRow=sheet.getLastRow();if(lastRow<2||String(start)>String(end))return [];
  const scoped=Number.isInteger(scopeColumn)&&scopeColumn>=1&&scopeColumn<=width;
  const wanted=scoped?[...new Set((scopeValues||[]).map(v=>String(v||'')).filter(Boolean))]:[];
  if(scoped&&!wanted.length)return [];
  const owners=new Set(wanted),started=Date.now();
  const select=rows=>rows.filter(r=>String(r[dateColumn-1]||'')>=String(start)&&
    String(r[dateColumn-1]||'')<=String(end)&&(!scoped||owners.has(String(r[scopeColumn-1]||''))));
  const fallback=source=>{
    const rows=select(sheet.getRange(2,1,lastRow-1,width).getDisplayValues());
    logPerformance_('dateRangeRead',started,PERFORMANCE_BUDGETS.dateRangeRead,{rows:rows.length,source,scoped});return rows;
  };
  if(lastRow-1<=250&&(lastRow-1)*width<=10000)return fallback('SMALL_BATCH');
  // Match the 400-day maximum of schedule/worklog APIs without truncation.
  const regex=dateRangeRegex_(start,end,400);
  if(!regex)return fallback('LONG_RANGE_FALLBACK');
  const ownerRegex='^(?:'+wanted.map(regexEscape_).join('|')+')$';
  let cells,preselectedBlocks=null,source=scoped?'DATE_OWNER_INDEX':'DATE_INDEX';
  try{
    cells=sheet.getRange(2,dateColumn,lastRow-1,1).createTextFinder(regex).useRegularExpression(true).matchEntireCell(true).findAll();
    if(scoped&&cells.length){
      // A second TextFinder scans the entire employee column. For a compact
      // date result it is cheaper to read those few rows and check the owner
      // in JavaScript. Index hints must never determine authorization.
      const dateBlocks=indexedRowWindows_(cells.map(c=>c.getRow()));
      const candidateRows=dateBlocks.reduce((total,b)=>total+b.end-b.start+1,0);
      const compact=cells.length<=180&&candidateRows*width<=3600;
      if(compact){
        preselectedBlocks=dateBlocks;
        source='DATE_INDEX_IN_MEMORY_SCOPE';
      }else{
        if(wanted.length>80||ownerRegex.length>5000)return fallback('SCOPE_LIMIT_FALLBACK');
        const matches=sheet.getRange(2,scopeColumn,lastRow-1,1).createTextFinder(ownerRegex).useRegularExpression(true).matchEntireCell(true).findAll();
        const positions=new Set(matches.map(c=>c.getRow()));cells=cells.filter(c=>positions.has(c.getRow()));
      }
    }
  }catch(_){return fallback('INDEX_UNAVAILABLE');}
  if(!cells.length){logPerformance_('dateRangeRead',started,PERFORMANCE_BUDGETS.dateRangeRead,{rows:0,source:'TEXT_FINDER',scoped});return [];}
  const blocks=preselectedBlocks||indexedRowWindows_(cells.map(c=>c.getRow()));
  const endCol=columnLetter_(width);
  const ranges=sheet.getRangeList(blocks.map(b=>'A'+b.start+':'+endCol+b.end)).getRanges();
  const rows=select(ranges.flatMap(range=>range.getDisplayValues()));
  logPerformance_('dateRangeRead',started,PERFORMANCE_BUDGETS.dateRangeRead,{rows:rows.length,source,blocks:blocks.length});return rows;
}


const DB_SCHEMA_VERSION = 20;

const DB_SCHEMA_SPECS = Object.freeze({
  '社員マスタ': [
    '社員ID','氏名','表示名','部署','役職','権限','在籍状況','標準勤務開始','標準勤務終了','標準休憩分',
    '有給残日数','メール','備考','PINソルト','PINハッシュ','PIN変更必須','ログイン失敗回数','ロック期限',
    '最終ログイン日時','PIN更新日時','認証状態','権限詳細','給与集計対象','直属承認者ID','年休基準日','雇入日'
  ],
  '申請': [
    '申請ID','申請日','社員ID','氏名','申請種別','対象日開始','対象日終了','申請内容','理由','ステータス','承認者','承認日時','差戻し理由','登録日時',
    '取消理由','取消申請日時','取消判断理由','取消判断者','取消判断日時'
  ],
  '月次締め': ['年月','状態','締め日時','締め者','再開日時','再開者','備考','更新日時','スナップショットID'],
  '月次確定': [
    'スナップショットID','年月','社員ID','氏名','締め日時','締め者','勤務日数','欠勤日数','実働分','残業分','休日勤務分',
    '遅刻早退分','有給日数','在宅日数','要確認日数','工数分','工数差異日数','データハッシュ','作成日時',
    '法定時間外分','深夜労働分','法定休日労働分','時間外休日合計分','労務ルール状態'
  ],
  '月次確定日次': [
    'スナップショットID','年月','社員ID','日付','会社区分','勤務日','出勤','退勤','実働分','残業分','休日勤務分','遅刻早退分',
    '休憩分','工数分','勤務場所','休暇','要確認','ソース','工数差分','法定日次時間外分','法定週次時間外分','深夜労働分',
    '法定休日労働分','労務注意'
  ],
  '有給台帳': ['台帳ID','社員ID','氏名','基準日','取引日','種別','日数','残日数','関連申請ID','処理者ID','処理者名','処理日時','備考'],
  '経費記録': ['記録ID','登録日時','登録者ID','登録者名','利用日','経費種別','取引先','適格請求書番号','商品名','利用金額','備考','支払者','支払方法','支払有無','証憑整理番号','更新日時','送信識別子'],
  '経費精算申請': ['申請ID','申請日時','申請者ID','申請者名','使用日','取引先','品目','経費種別','申請額','申請理由','支払方法','証憑整理番号','状態','承認者ID','承認日時','差戻し理由','出金日','立替者受取日','更新日時','送信識別子'],
  '出張報告': ['報告ID','申請日時','出張者ID','出張者名','役職','出発日','出発時刻','帰着日','帰着時刻','出張先','出張内容','報告・成果','30km区分','使用金額','宿泊地域','宿泊日数','時間帯手当','日当区分','支給希望額','備考','状態','承認者ID','承認日時','差戻し理由','更新日時','精算日','送信識別子'],
  '見積取引先': ['ベンダーコード','取引先名','インボイス番号','所在地','業種','状態','更新日時'],
  '見積ヘッダー': ['見積ID','作成日時','更新日時','作成者ID','作成者名','ベンダーコード','取引先名','所在地','インボイス番号','見積日','件名','納期','支払条件','有効期限','担当者','備考','振込先','状態','見積番号','発行日時','税率','小計','税額','合計','改訂番号','送信識別子','PDFファイルID','ExcelファイルID'],
  '見積明細': ['見積ID','行番号','品名・内容','数量','単位','単価','金額'],
  '見積採番': ['ベンダーコード','最終発行末尾番号','既存番号確認','更新日時','更新者ID'],
  '関連書類': ['書類ID','種別','元見積ID','送信識別子','所有者ID','所有者名','ベンダーコード','取引先名',
    '所在地','インボイス番号','件名','元見積日','発行日','期限・納品日','入金日',
    '納期','支払条件','有効期限','担当者','備考','振込先','小計','税額','合計',
    '明細スナップショットJSON','状態','書類番号','正式発行日時','PDFファイルID','ExcelファイルID','更新日時','入金確認者ID'],
  '関連書類採番': ['種別','年','最終採番','更新日時','更新者ID'],
  'プロジェクト計画': ['プロジェクトID','予定工数分','責任者ID','見積ID','受注番号','受注日','受注金額','受注状態','概要','旧案件名JSON','改訂番号','作成日時','更新日時','登録者ID','更新者ID','送信識別子'],
  'プロジェクト作業': ['作業ID','プロジェクトID','作業名','担当者ID','開始日','期限','予定工数分','進捗率','状態','メモ','改訂番号','作成日時','更新日時','登録者ID','更新者ID','送信識別子'],
  'プロジェクト資料': ['資料ID','プロジェクトID','資料名','種別','HTTPSリンク','本文','状態','改訂番号','作成日時','更新日時','登録者ID','更新者ID','送信識別子'],
  'プロジェクト共有': ['共有ID','プロジェクトID','種別','本文','作成日時','登録者ID','投稿者名','送信識別子'],
  '総務備品': ['備品ID','管理番号','品名','分類','メーカー','型番','保管場所','保有数','在庫下限','状態','備考','登録日時','更新日時','更新者ID','改訂番号'],
  '総務貸出': ['貸出ID','備品ID','管理番号','貸出先','貸出数','貸出日','返却予定日','返却日','状態','使用目的','登録者ID','登録日時','更新日時','送信識別子'],
  '総務購買': ['購買ID','品名','数量','概算単価','希望日','申請理由','申請者ID','申請者名','状態','関連備品ID','発注日','入荷日','備考','登録日時','更新日時','送信識別子','承認者ID','承認日時'],
  '総務書類': ['書類ID','書類名','分類','保管場所','HTTPSリンク','期限','備考','状態','登録者ID','登録日時','更新日時','送信識別子'],
  '総務契約': ['契約ID','契約名','分類','契約先','契約番号','開始日','満了日','通知期限','自動更新','年額円','担当者','原本リンク','状態','備考','作成日時','更新日時','登録者ID','更新者ID','改訂番号','送信識別子'],
  '総務施設設備': ['設備ID','管理番号','名称','種別','所在地','管理担当','保守業者','最終点検日','次回点検日','状態','備考','作成日時','更新日時','登録者ID','更新者ID','改訂番号','送信識別子'],
  'プロジェクト工数対応': ['工数ID','プロジェクトID','作業ID','更新日時','更新者ID','送信識別子'],
  'プロジェクト依存': ['作業ID','プロジェクトID','先行作業JSON','改訂番号','更新日時','更新者ID'],
  'プロジェクト添付': ['添付ID','プロジェクトID','資料ID','ファイル名','MIME','バイト数','DriveファイルID','版数','状態','登録日時','登録者ID','送信識別子'],
  'プロジェクト既読': ['社員ID','通知ID','既読日時'],
  'プロジェクト原価': ['原価ID','プロジェクトID','日付','分類','説明','金額','改訂番号','状態','更新日時','更新者ID','送信識別子'],
  'プロジェクト予算': ['プロジェクトID','予算円','備考','改訂番号','更新日時','更新者ID'],
  '総務依頼': ['依頼ID','件名','種別','優先度','依頼者','担当者','対応期限','内容','状態','完了日','対応メモ','作成日時','更新日時','登録者ID','更新者ID','改訂番号','送信識別子'],
  '資金繰り年間': ['決算年度','期首現預金残高','月別入力JSON','改訂番号','更新日時','更新者ID','送信識別子'],
  '資金口座': ['口座ID','金融機関名','支店','表示名','口座末尾4桁','有効','改訂番号','更新日時','更新者ID','送信識別子'],
  '資金予定': ['予定ID','名称','入出区分','金額円','口座ID','分類','繰り返し','開始月','終了月','予定日','有効','備考','改訂番号','更新日時','更新者ID','送信識別子'],
  '資金取引': ['明細ID','口座ID','日付','入金円','出金円','摘要','残高円','銀行取引番号','重複内連番','取引指紋','内部振替','元ファイル名','取込日時','取込者ID','改訂番号'],
  '資金月次確定': ['決算年度','実績確定月','改訂番号','更新日時','更新者ID','送信識別子'],
  '資金明細注記': ['明細ID','計上区分','タグ','個別メモ','改訂番号','更新日時','更新者ID','送信識別子'],
  '資金分類ルール': ['ルールID','摘要キーワード','入出金区分','口座ID','計上区分','タグ','優先度','有効','改訂番号','更新日時','更新者ID','送信識別子'],
  '資金シナリオ': ['シナリオID','決算年度','シナリオ名','条件JSON','改訂番号','更新日時','更新者ID','送信識別子'],
  '資金月次照合': ['照合ID','決算年度','対象月','口座ID','明細件数','入金合計','出金合計','取引指紋','月末残高','照合メモ','改訂番号','更新日時','更新者ID','送信識別子'],
  '資金予定照合': ['明細ID','予定ID','予定日','状態','銀行指紋','予定指紋','確認理由','改訂番号','確認日時','確認者ID','送信識別子']
});

function schemaHeaderIssues_(actual,expected){
  const issues=[];
  (expected||[]).forEach((value,index)=>{
    const got=String((actual||[])[index]||'');
    if(got!==String(value))issues.push({column:index+1,expected:String(value),actual:got});
  });
  return issues;
}

function schemaReadHeader_(sheet,width){
  const count=Math.min(width,sheet.getMaxColumns());
  const actual=count>0?sheet.getRange(1,1,1,count).getDisplayValues()[0]:[];
  return Array.from({length:width},(_,index)=>actual[index]||'');
}
function getDatabaseSchemaStatus_(){
  const db=getDb_(),settings=getSettingsMap_();
  const version=Number(settings.DB_VERSION||0),sheets={},issues=[];
  Object.keys(DB_SCHEMA_SPECS).forEach(name=>{
    const expected=DB_SCHEMA_SPECS[name],sheet=db.getSheetByName(name);
    if(!sheet){
      sheets[name]={exists:false,ready:false,issues:[{type:'MISSING_SHEET'}]};
      issues.push(name+' がありません');
      return;
    }
    const actual=schemaReadHeader_(sheet,expected.length);
    const headerIssues=schemaHeaderIssues_(actual,expected);
    sheets[name]={exists:true,ready:headerIssues.length===0,columns:sheet.getMaxColumns(),issues:headerIssues};
    headerIssues.forEach(i=>issues.push(name+' '+i.column+'列: '+(i.actual||'空欄')+' → '+i.expected));
  });
  if(version!==DB_SCHEMA_VERSION)issues.unshift('DB_VERSION '+version+' → '+DB_SCHEMA_VERSION);
  return {version,expectedVersion:DB_SCHEMA_VERSION,ready:issues.length===0,issues,sheets};
}


// Site-side maintenance summary. Old Apps Script triggers and Drive backup jobs are not used.
function getSystemStatus(sessionToken) {
  const admin=requireAdminSession_(sessionToken).employee;
  const db=getDb_();
  const sheets=Object.fromEntries(db.getSheets().map(table=>[table.getName(),Math.max(0,table.getLastRow()-1)]));
  const runtime=getRuntimeInfo_();
  const schemaStatus=getDatabaseSchemaStatus_();
  const laborConfig=getLaborRuleConfig_();
  const employees=db.getSheetByName(DB.sheets.employees);
  const people=employees&&employees.getLastRow()>1
    ?employees.getRange(2,1,employees.getLastRow()-1,7).getDisplayValues().filter(row=>row[0]&&row[6]==='在籍')
    :[];
  const blockers=['Sites SQLのバックアップ・復元手順は未検証です。'];
  if(!schemaStatus.ready)blockers.push('SQLスキーマの状態を確認してください。');
  if(!laborConfig.configured)blockers.push('労務ルールが未確定です。');
  const readiness={ready:false,environment:runtime.environment,prototypeMode:true,
    prototypeAccessEffective:true,backupTriggerInstalled:false,backupVerified:false,
    laborConfig,schemaStatus,blockers,warnings:['架空データ専用。正式運用前に本人認証と復元を検証してください。'],
    activeEmployees:people.length,activeAdmins:people.filter(row=>row[5]==='ADMIN').length};
  return {dbName:'Sites SQL / D1',dbId:db.getId(),sheets,
    activeSessions:null,pinPending:0,backupEnabled:false,backupTriggerInstalled:false,
    backupTriggerCount:0,backupMode:'Sites側で別途管理',lastBackupAt:'',backupVerified:false,
    backupRetentionDays:null,environment:runtime.environment,laborConfig,schemaStatus,
    explicitDb:runtime.explicitDb,usingDefaultStagingDb:runtime.usingDefaultStagingDb,
    readiness,checkedAt:toTimestamp_(new Date()),checkedBy:admin.name};
}

function getAuditLogs(sessionToken, limit) {
  requireAdminSession_(sessionToken);
  const max = Math.max(10, Math.min(300, Number(limit || 100)));
  const sheet = getDb_().getSheetByName(DB.sheets.audit);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const count = Math.min(max, lastRow - 1);
  return sheet.getRange(lastRow - count + 1, 1, count, 12).getDisplayValues()
    .reverse()
    .map(r => ({
      id: r[0],
      at: r[1],
      employeeId: r[2],
      employeeName: r[3],
      operation: r[4],
      target: r[5],
      targetId: r[6],
      before: r[7],
      after: r[8],
      source: r[9],
      result: r[10],
      note: r[11]
    }));
}

function getSystemDocument(sessionToken, documentType) {
  requireAdminSession_(sessionToken);
  const key=String(documentType||'').toLowerCase();
  if(!['requirements','technical'].includes(key))throw new Error('文書種別を確認してください。');
  const doc=GENERATED_DOCS[key];
  if(!doc)throw new Error('設計文書が生成されていません。');
  return {
    type:key,
    title:doc.title,
    version:doc.version,
    updatedAt:doc.updatedAt,
    markdown:doc.markdown
  };
}


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
