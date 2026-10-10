function requestRowToObject_(r) {
  return {
    id:r[0], requestDate:r[1], employeeId:r[2], name:r[3], type:r[4],
    startDate:r[5], endDate:r[6], content:r[7], reason:r[8], status:r[9],
    approver:r[10], approvedAt:r[11], rejectReason:r[12], createdAt:r[13],
    cancelReason:r[14]||'', cancelRequestedAt:r[15]||'', cancelDecisionReason:r[16]||'',
    cancelDecidedBy:r[17]||'', cancelDecidedAt:r[18]||''
  };
}

const REQUEST_TYPES = Object.freeze(['有給','午前半休','午後半休','1/4日有給','欠勤','打刻修正','在宅勤務','残業','休日出勤']);

function getRequests(sessionToken, params) {
  const session = requireSession_(sessionToken);
  params = params || {};
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const permissions = getPermissions_(session.employee);
  const managedIds = permissions.requestApprove ? getManagedEmployeeIds_(session.employee) : new Set();
  const teamScope = permissions.requestApprove && params.scope === 'ALL';
  const status = String(params.status || 'ALL');
  const ids=teamScope?[...managedIds]:[session.employee.employeeId];
  return readRowsByColumnValues_(sheet,3,19,ids)
    .filter(r => r[0] && (status === 'ALL' || r[9] === status))
    .map(requestRowToObject_)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
function getPendingRequestCount_(employee) {
  if (!employee || !employee.employeeId) return 0;
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const permissions = getPermissions_(employee);
  const managedIds = permissions.requestApprove ? getManagedEmployeeIds_(employee) : new Set();
  const ids=permissions.requestApprove?[...managedIds]:[employee.employeeId];
  return readRowsByColumnValues_(sheet,3,10,ids).reduce((count,r)=>count+(r[9]==='承認待ち'?1:0),0);
}
function assertCanApproveRequest_(approver, requesterEmployeeId) {
  const requesterId = String(requesterEmployeeId || '').trim().toUpperCase();
  if (!requesterId) throw new Error('申請者を確認できません。');
  if (requesterId === approver.employeeId) throw new Error('申請者本人は承認できません。別の承認者へ依頼してください。');
  const requester = getEmployee_(requesterId);
  if (!canManageEmployeeRecord_(approver, requester)) throw new Error('この申請を承認する権限がありません。');
  return requester;
}
function getRequestsBundle(sessionToken) {
  const perfStarted=Date.now();
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  maybeReconcileLeave_(employee.employeeId);
  const permissions = getPermissions_(employee);
  const managedIds = permissions.requestApprove ? getManagedEmployeeIds_(employee) : new Set();
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  const ids=[employee.employeeId,...managedIds];
  const items = lastRow < 2 ? [] : readRowsByColumnValues_(sheet,3,19,ids)
    .filter(r=>r[0])
    .map(requestRowToObject_)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const own = items.filter(r => r.employeeId === employee.employeeId);
  const team = items.filter(r => managedIds.has(r.employeeId));
  const context=getLeaveRequestContext_(employee.employeeId,own);
  const fresh=getEmployee_(employee.employeeId),today=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');
  context.fiveDay=getAnnualLeaveFiveDayStatus_(fresh,today);
  context.autoLeave=leaveAutoForecast_(fresh,today);
  const result={ own: own, team: team, context };
  logPerformance_('getRequestsBundle',perfStarted,PERFORMANCE_BUDGETS.requestsBundle,{own:own.length,team:team.length});
  return result;
}
function getLeaveRequestContext_(employeeId, ownRequests) {
  const employee = getEmployee_(employeeId);
  if (!employee) throw new Error('社員情報が見つかりません。');

  const paidTypes = new Set(['有給','午前半休','午後半休','1/4日有給']);
  let pendingDays = 0;
  let pendingUnknown = 0;
  const items = Array.isArray(ownRequests) ? ownRequests : getRequestsForEmployee_(employeeId);

  items.filter(r => r.status === '承認待ち' && paidTypes.has(r.type)).forEach(r => {
    try {
      pendingDays += calculateLeaveDaysForRequest_(r.type, r.startDate, r.endDate);
    } catch (e) {
      pendingUnknown++;
    }
  });

  pendingDays = Math.round(pendingDays * 4) / 4;
  const leaveState = getLeaveLedgerState_(employee);
  const balance = leaveState.configured ? Number(leaveState.balance || 0) : null;
  const available = balance == null ? null : Math.max(0, Math.round((balance - pendingDays) * 4) / 4);

  return {
    leaveBalanceConfigured: !!leaveState.configured,
    leaveBalance: balance,
    pendingLeaveDays: pendingDays,
    availableLeaveDays: available,
    pendingUnknownCount: pendingUnknown
  };
}

function getRequestsForEmployee_(employeeId) {
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return readRowsByColumnValues_(sheet,3,19,[employeeId])
    .filter(r => r[0])
    .map(requestRowToObject_);
}
function previewRequest(sessionToken, payload) {
  const employee = requireSession_(sessionToken).employee;
  maybeReconcileLeave_(employee.employeeId);
  payload = payload || {};
  const type = String(payload.type || '');
  if (!REQUEST_TYPES.includes(type)) throw new Error('申請種別を確認してください。');

  const startDate = normalizeDate_(payload.startDate);
  const endDate = normalizeDate_(payload.endDate || startDate);
  if (startDate > endDate) throw new Error('終了日は開始日以降にしてください。');

  const paidTypes = ['有給','午前半休','午後半休','1/4日有給'];
  const context = getLeaveRequestContext_(employee.employeeId);
  let requestedDays = null;
  let projectedBalance = context.availableLeaveDays;

  if (paidTypes.includes(type)) {
    requestedDays = calculateLeaveDaysForRequest_(type, startDate, endDate);
    projectedBalance = context.availableLeaveDays == null
      ? null
      : Math.round((context.availableLeaveDays - requestedDays) * 4) / 4;
  }

  return {
    type:type,
    requestedDays:requestedDays,
    leaveBalanceConfigured:context.leaveBalanceConfigured,
    leaveBalance:context.leaveBalance,
    pendingLeaveDays:context.pendingLeaveDays,
    availableLeaveDays:context.availableLeaveDays,
    projectedBalance:projectedBalance,
    sufficient:projectedBalance == null ? false : projectedBalance >= 0
  };
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
    assertMonthRangeOpen_(startDate,endDate,'申請を登録');
    if (['午前半休','午後半休','1/4日有給','打刻修正'].includes(type) && startDate !== endDate) {
      throw new Error(type + 'は1日単位で申請してください。');
    }
    if (['有給','午前半休','午後半休','1/4日有給','欠勤'].includes(type)) {
      assertNoLeaveConflict_(employee.employeeId, type, startDate, endDate, '', false);
    }
    if (['有給','午前半休','午後半休','1/4日有給'].includes(type)) {
      reconcileLeaveUnlocked_(getEmployee_(employee.employeeId),Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'));
      const leaveContext = getLeaveRequestContext_(employee.employeeId);
      if (!leaveContext.leaveBalanceConfigured) {
        throw new Error('有給残日数が未設定です。管理者に社員情報の有給残日数を設定してもらってください。');
      }
      const requestedDays = calculateLeaveDaysForRequest_(type, startDate, endDate);
      if (requestedDays <= 0) {
        throw new Error('この日付では有給を消化しません。会社カレンダーの勤務日を確認してください。');
      }
      if (leaveContext.availableLeaveDays < requestedDays) {
        throw new Error(
          '有給残日数が不足しています。承認待ちを含む申請可能残数は ' +
          leaveContext.availableLeaveDays + '日、今回の申請は ' + requestedDays + '日です。'
        );
      }
    }
    const reason = safeSheetText_(payload.reason, 600);
    if (!reason) throw new Error('申請理由を入力してください。');

    let content = safeSheetText_(payload.content, 1500);
    if (type === '打刻修正') {
      const correction = payload.correction || {};
      const action = String(correction.action || '');
      if (!isTimePunchAction_(action)) throw new Error('修正する打刻種別を選択してください。');
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
      nowText,
      '', '', '', '', ''
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
  const approver = requireSession_(sessionToken).employee;
  const normalizedDecision = String(decision || '').toUpperCase();
  if (!['APPROVE','REJECT'].includes(normalizedDecision)) throw new Error('承認操作を確認してください。');

  return withScriptLock_(function() {
    const rowInfo = findRequestRow_(requestId);
    if (!rowInfo) throw new Error('申請が見つかりません。');
    const r = rowInfo.values;
    if (r[9] !== '承認待ち') throw new Error('この申請はすでに処理されています。');
    assertCanApproveRequest_(approver, r[2]);
    const approve = normalizedDecision === 'APPROVE';
    const rejectReason = safeSheetText_(comment, 500);
    if (approve) assertMonthRangeOpen_(r[5],r[6],'申請を承認');
    if (!approve && !rejectReason) throw new Error('差戻し理由を入力してください。');

    const nowText = toTimestamp_(new Date());
    let leaveDaysToConsume = 0;
    let leaveEmployee = null;
    if (approve && ['有給','午前半休','午後半休','1/4日有給','欠勤'].includes(r[4])) {
      assertNoLeaveConflict_(r[2], r[4], r[5], r[6], r[0], true);
      if (r[4] !== '欠勤') {
        leaveEmployee = getEmployee_(r[2]);
        reconcileLeaveUnlocked_(leaveEmployee,Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'));
        leaveEmployee = getEmployee_(r[2]);
        const leaveState = getLeaveLedgerState_(leaveEmployee);
        if (!leaveState.configured) throw new Error('有給残日数が未設定です。社員設定で残日数と年休基準日を設定してください。');
        if (!leaveEmployee.leaveBasisDate) throw new Error('年休基準日が未設定です。社員設定で登録してください。');
        leaveDaysToConsume = calculateLeaveDaysForRequest_(r[4], r[5], r[6]);
        if (leaveDaysToConsume <= 0) throw new Error('対象日に消化する有給日数がありません。会社カレンダーを確認してください。');
        if (leaveState.balance < leaveDaysToConsume) throw new Error('有給残日数が不足しています。現在の残日数: ' + leaveState.balance + '日');
      }
    }

    if (approve && r[4] === '打刻修正') {
      preparePunchCorrection_(r);
    }

    rowInfo.sheet.getRange(rowInfo.row,10,1,4).setValues([[
      approve ? '承認済' : '差戻し',
      approver.name,
      nowText,
      approve ? '' : rejectReason
    ]]);

    if (approve && r[4] === '打刻修正') {
      applyApprovedPunchCorrection_(r);
    }
    if (approve && leaveEmployee && leaveDaysToConsume > 0) consumeLeaveBalance_(leaveEmployee,leaveDaysToConsume,r[0],approver);

    appendAudit_({
      employeeId:approver.employeeId,employeeName:approver.name,
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

  // Fetch only this employee's rows; ignore unrelated application history.
  const rows = readRowsByColumnValues_(sheet,3,19,[employeeId]);
  for (const r of rows) {
    if (!r[0] || r[0] === excludeRequestId || r[2] !== employeeId || !dayOffTypes.includes(r[4])) continue;
    if (approvedOnly ? !['承認済','取消申請中'].includes(r[9]) : !['承認待ち','承認済','取消申請中'].includes(r[9])) continue;
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

function requestApprovedCancellation(sessionToken, requestId, reason) {
  const employee=requireSession_(sessionToken).employee;
  const note=safeSheetText_(reason,500);
  if(!note)throw new Error('取消理由を入力してください。');
  return withScriptLock_(function(){
    const rowInfo=findRequestRow_(requestId);
    if(!rowInfo)throw new Error('申請が見つかりません。');
    const r=rowInfo.values;
    if(r[2]!==employee.employeeId)throw new Error('自分の申請だけ取消依頼できます。');
    if(r[9]!=='承認済')throw new Error('承認済みの申請だけ取消依頼できます。');
    if(r[4]==='打刻修正')throw new Error('承認済みの打刻修正は直接取り消せません。新しい打刻修正申請で訂正してください。');
    assertMonthRangeOpen_(r[5],r[6],'承認済み申請の取消を依頼');
    const nowText=toTimestamp_(new Date());
    rowInfo.sheet.getRange(rowInfo.row,10).setValue('取消申請中');
    rowInfo.sheet.getRange(rowInfo.row,15,1,5).setValues([[note,nowText,'','','']]);
    appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'承認済申請の取消依頼',target:'申請',targetId:r[0],before:'承認済',after:'取消申請中',source:'WEB',result:'SUCCESS',note:note});
    SpreadsheetApp.flush();
    return {ok:true};
  });
}

function decideApprovedCancellation(sessionToken, requestId, decision, comment) {
  const approver=requireSession_(sessionToken).employee;
  const normalized=String(decision||'').toUpperCase();
  if(!['APPROVE','REJECT'].includes(normalized))throw new Error('取消判断を確認してください。');
  return withScriptLock_(function(){
    const rowInfo=findRequestRow_(requestId);
    if(!rowInfo)throw new Error('申請が見つかりません。');
    const r=rowInfo.values;
    if(r[9]!=='取消申請中')throw new Error('取消依頼中の申請ではありません。');
    assertCanApproveRequest_(approver,r[2]);
    const note=safeSheetText_(comment,500);
    if(normalized==='REJECT'&&!note)throw new Error('取消却下理由を入力してください。');
    assertMonthRangeOpen_(r[5],r[6],'承認済み申請の取消を処理');

    if(normalized==='APPROVE'&&['有給','午前半休','午後半休','1/4日有給'].includes(r[4])){
      const employee=getEmployee_(r[2]);
      const days=calculateLeaveDaysForRequest_(r[4],r[5],r[6]);
      restoreLeaveBalance_(employee,days,r[0],approver,'承認済み休暇申請の取消');
    }

    const nowText=toTimestamp_(new Date());
    const next=normalized==='APPROVE'?'取消済':'承認済';
    rowInfo.sheet.getRange(rowInfo.row,10).setValue(next);
    rowInfo.sheet.getRange(rowInfo.row,17,1,3).setValues([[note,approver.name,nowText]]);
    appendAudit_({employeeId:approver.employeeId,employeeName:approver.name,operation:normalized==='APPROVE'?'承認済申請の取消承認':'承認済申請の取消却下',target:'申請',targetId:r[0],before:'取消申請中',after:next,source:'WEB',result:'SUCCESS',note:note});
    SpreadsheetApp.flush();
    return {ok:true,status:next};
  });
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
  return {sheet:sheet,row:row,values:sheet.getRange(row,1,1,19).getDisplayValues()[0]};
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
  if (!isTimePunchAction_(action) || !time) throw new Error('打刻修正内容が不正です。');

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