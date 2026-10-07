const REQUEST_TYPES = Object.freeze(['有給','午前半休','午後半休','1/4日有給','欠勤','打刻修正','在宅勤務','残業','休日出勤']);

function getRequests(sessionToken, params) {
  const session = requireSession_(sessionToken);
  params = params || {};
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const all = session.employee.role === 'ADMIN' && params.scope === 'ALL';
  const status = String(params.status || 'ALL');
  return sheet.getRange(2, 1, lastRow - 1, 14).getDisplayValues()
    .filter(r => r[0] && (all || r[2] === session.employee.employeeId) && (status === 'ALL' || r[9] === status))
    .map(r => ({
      id:r[0], requestDate:r[1], employeeId:r[2], name:r[3], type:r[4],
      startDate:r[5], endDate:r[6], content:r[7], reason:r[8], status:r[9],
      approver:r[10], approvedAt:r[11], rejectReason:r[12], createdAt:r[13]
    }))
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

function submitRequest(sessionToken, payload) {
  const employee = requireSession_(sessionToken).employee;
  payload = payload || {};
  return withScriptLock_(function() {
    const type = String(payload.type || '');
    if (!REQUEST_TYPES.includes(type)) throw new Error('申請種別を確認してください。');
    const startDate = normalizeDate_(payload.startDate);
    const endDate = normalizeDate_(payload.endDate || startDate);
    if (startDate > endDate) throw new Error('対象期間を確認してください。');
    if (['午前半休','午後半休','1/4日有給','打刻修正'].includes(type) && startDate !== endDate) {
      throw new Error(type + 'は1日単位で申請してください。');
    }
    if (['有給','午前半休','午後半休','1/4日有給','欠勤'].includes(type)) {
      assertNoLeaveConflict_(employee.employeeId, type, startDate, endDate, '', false);
    }
    const reason = safeSheetText_(payload.reason, 600);
    if (!reason) throw new Error('申請理由を入力してください。');

    let content = safeSheetText_(payload.content, 1500);
    if (type === '打刻修正') {
      const correction = payload.correction || {};
      const action = String(correction.action || '');
      if (!Object.values(PUNCH).includes(action)) throw new Error('修正する打刻種別を選択してください。');
      const time = normalizeTime_(correction.time || '');
      if (!time) throw new Error('修正後の時刻を入力してください。');
      content = JSON.stringify({
        originalPunchId: String(correction.originalPunchId || ''),
        action: action,
        time: time,
        workLocation: ['出社','在宅','外出'].includes(correction.workLocation) ? correction.workLocation : '出社'
      });
    }

    const now = new Date();
    const nowText = toTimestamp_(now);
    const requestId = createId_('R');
    getDb_().getSheetByName('申請').appendRow([
      requestId,
      Utilities.formatDate(now, DB.timeZone, 'yyyy-MM-dd'),
      employee.employeeId,
      employee.name,
      type,
      startDate,
      endDate,
      content,
      reason,
      '承認待ち',
      '',
      '',
      '',
      nowText
    ]);
    appendAudit_({
      employeeId:employee.employeeId,employeeName:employee.name,operation:'申請登録',
      target:'申請',targetId:requestId,before:'',after:type+' '+startDate,
      source:'WEB',result:'SUCCESS',note:''
    });
    SpreadsheetApp.flush();
    return {ok:true,id:requestId};
  });
}
function cancelRequest(sessionToken, requestId) {
  const employee = requireSession_(sessionToken).employee;
  return withScriptLock_(function() {
    const rowInfo = findRequestRow_(requestId);
    if (!rowInfo) throw new Error('申請が見つかりません。');
    const r = rowInfo.values;
    if (r[2] !== employee.employeeId && employee.role !== 'ADMIN') throw new Error('この申請を取り消す権限がありません。');
    if (r[9] !== '承認待ち') throw new Error('承認待ちの申請だけ取り消せます。');
    rowInfo.sheet.getRange(rowInfo.row,10).setValue('取消');
    appendAudit_({
      employeeId:employee.employeeId,employeeName:employee.name,operation:'申請取消',
      target:'申請',targetId:r[0],before:'承認待ち',after:'取消',source:'WEB',result:'SUCCESS',note:''
    });
    SpreadsheetApp.flush();
    return {ok:true};
  });
}
function approveRequest(sessionToken, requestId, decision, comment) {
  const admin = requireAdminSession_(sessionToken).employee;
  const normalizedDecision = String(decision || '').toUpperCase();
  if (!['APPROVE','REJECT'].includes(normalizedDecision)) throw new Error('承認操作を確認してください。');

  return withScriptLock_(function() {
    const rowInfo = findRequestRow_(requestId);
    if (!rowInfo) throw new Error('申請が見つかりません。');
    const r = rowInfo.values;
    if (r[9] !== '承認待ち') throw new Error('この申請はすでに処理されています。');
    const approve = normalizedDecision === 'APPROVE';
    const rejectReason = safeSheetText_(comment, 500);
    if (!approve && !rejectReason) throw new Error('差戻し理由を入力してください。');

    const nowText = toTimestamp_(new Date());
    let leaveDaysToConsume = 0;
    let leaveEmployee = null;
    if (approve && ['有給','午前半休','午後半休','1/4日有給','欠勤'].includes(r[4])) {
      assertNoLeaveConflict_(r[2], r[4], r[5], r[6], r[0], true);
      if (r[4] !== '欠勤') {
        leaveEmployee = getEmployee_(r[2]);
        if (!leaveEmployee.leaveBalanceConfigured) {
          throw new Error('有給残日数が未設定です。社員マスタで残日数を設定してから承認してください。');
        }
        leaveDaysToConsume = calculateLeaveDaysForRequest_(r[4], r[5], r[6]);
        if (leaveDaysToConsume <= 0) throw new Error('対象日に消化する有給日数がありません。会社カレンダーを確認してください。');
        if (leaveEmployee.leaveBalance < leaveDaysToConsume) {
          throw new Error('有給残日数が不足しています。現在の残日数: ' + leaveEmployee.leaveBalance + '日');
        }
      }
    }

    if (approve && r[4] === '打刻修正') {
      preparePunchCorrection_(r);
    }

    rowInfo.sheet.getRange(rowInfo.row,10,1,4).setValues([[
      approve ? '承認済' : '差戻し',
      admin.name,
      nowText,
      approve ? '' : rejectReason
    ]]);

    if (approve && r[4] === '打刻修正') {
      applyApprovedPunchCorrection_(r);
    }
    if (approve && leaveEmployee && leaveDaysToConsume > 0) {
      const employeeSheet = getDb_().getSheetByName(DB.sheets.employees);
      employeeSheet.getRange(leaveEmployee.rowNumber,11).setValue(leaveEmployee.leaveBalance - leaveDaysToConsume);
    }

    appendAudit_({
      employeeId:admin.employeeId,employeeName:admin.name,
      operation:approve?'申請承認':'申請差戻し',target:'申請',targetId:r[0],
      before:'承認待ち',after:approve?'承認済':'差戻し',source:'WEB',result:'SUCCESS',
      note:approve?'':rejectReason.slice(0,200)
    });
    SpreadsheetApp.flush();
    return {ok:true};
  });
}
function getPunchesForDate(sessionToken, date) {
  const employee = requireSession_(sessionToken).employee;
  const targetDate = normalizeDate_(date);
  return getActivePunchRows_(employee.employeeId, targetDate, targetDate)
    .sort((a,b)=>String(a[5]).localeCompare(String(b[5])))
    .map(r=>({
      id:r[0], action:r[4], timestamp:r[5], time:String(r[5]).slice(11,16),
      workLocation:r[6]||'出社', source:r[7]||''
    }));
}
function assertNoLeaveConflict_(employeeId, type, startDate, endDate, excludeRequestId, approvedOnly) {
  const dayOffTypes = ['有給','午前半休','午後半休','1/4日有給','欠勤'];
  if (!dayOffTypes.includes(type)) return;

  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const rows = sheet.getRange(2, 1, lastRow - 1, 14).getDisplayValues();
  for (const r of rows) {
    if (!r[0] || r[0] === excludeRequestId || r[2] !== employeeId || !dayOffTypes.includes(r[4])) continue;
    if (approvedOnly ? r[9] !== '承認済' : !['承認待ち','承認済'].includes(r[9])) continue;
    if (r[6] < startDate || r[5] > endDate) continue;

    const newFullDay = type === '有給' || type === '欠勤';
    const existingFullDay = r[4] === '有給' || r[4] === '欠勤';
    if (newFullDay || existingFullDay) {
      throw new Error('同じ期間に有給・半休・欠勤の申請がすでに存在します。');
    }
    if (type === r[4] && startDate === r[5]) {
      throw new Error('同じ日の' + type + '申請がすでに存在します。');
    }
  }
}

function calculateLeaveDaysForRequest_(type, startDate, endDate) {
  if (type === '午前半休' || type === '午後半休' || type === '1/4日有給') {
    const days = getCompanyCalendarRange_(startDate, startDate);
    if (days.length !== 1) throw new Error('対象日の会社カレンダーが未登録です。');
    if (!days[0].working) return 0;
    return type === '1/4日有給' ? 0.25 : 0.5;
  }
  const expected = inclusiveDateCount_(startDate, endDate);
  const days = getCompanyCalendarRange_(startDate, endDate);
  if (days.length !== expected) {
    throw new Error('申請期間の会社カレンダーが未登録です。');
  }
  return days.filter(d => d.working).length;
}
function inclusiveDateCount_(startDate, endDate) {
  const a = startDate.split('-').map(Number);
  const b = endDate.split('-').map(Number);
  const start = Date.UTC(a[0],a[1]-1,a[2]);
  const end = Date.UTC(b[0],b[1]-1,b[2]);
  return Math.floor((end-start)/86400000)+1;
}

function findRequestRow_(requestId) {
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const found = sheet.getRange(2,1,lastRow-1,1).createTextFinder(String(requestId||'')).matchEntireCell(true).findNext();
  if (!found) return null;
  const row = found.getRow();
  return {sheet:sheet,row:row,values:sheet.getRange(row,1,1,14).getDisplayValues()[0]};
}

function preparePunchCorrection_(requestRow) {
  let correction;
  try { correction = JSON.parse(requestRow[7] || '{}'); }
  catch(e) { throw new Error('打刻修正申請の内容が読み取れません。'); }

  const employeeId = requestRow[2];
  const employeeName = requestRow[3];
  const date = requestRow[5];
  const action = correction.action;
  const time = normalizeTime_(correction.time || '');
  if (!Object.values(PUNCH).includes(action) || !time) throw new Error('打刻修正内容が不正です。');

  const activeRows = getActivePunchRows_(employeeId, date, date);
  const originalId = String(correction.originalPunchId || '').trim();
  let originalLocation = ['出社','在宅','外出'].includes(correction.workLocation) ? correction.workLocation : '出社';

  if (originalId) {
    const original = activeRows.find(r => r[0] === originalId);
    if (!original) throw new Error('修正対象の打刻が見つからないか、すでに別の修正で置き換えられています。');
    originalLocation = original[6] || originalLocation;
  }

  const timestamp = date + ' ' + time + ':00';
  const candidate = activeRows
    .filter(r => r[0] !== originalId)
    .map(r => ({ id:r[0], action:r[4], timestamp:r[5], workLocation:r[6] }));
  candidate.push({ id:'PROPOSED', action:action, timestamp:timestamp, workLocation:originalLocation });
  validatePunchSequence_(candidate);

  return {
    employeeId: employeeId,
    employeeName: employeeName,
    date: date,
    action: action,
    timestamp: timestamp,
    workLocation: originalLocation,
    originalId: originalId
  };
}

function applyApprovedPunchCorrection_(requestRow) {
  const plan = preparePunchCorrection_(requestRow);
  const nowText = toTimestamp_(new Date());
  getDb_().getSheetByName(DB.sheets.punches).appendRow([
    createId_('P'), plan.employeeId, plan.employeeName, plan.date, plan.action,
    plan.timestamp, plan.workLocation, 'CORRECTION',
    false, plan.originalId, '申請承認による修正 ' + requestRow[0], nowText
  ]);
}