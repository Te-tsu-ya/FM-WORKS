const REQUEST_TYPES = Object.freeze(['有給','午前半休','午後半休','打刻修正','在宅勤務','残業','休日出勤']);

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
  const type = String(payload.type || '');
  if (!REQUEST_TYPES.includes(type)) throw new Error('申請種別を確認してください。');
  const startDate = normalizeDate_(payload.startDate);
  const endDate = normalizeDate_(payload.endDate || startDate);
  if (startDate > endDate) throw new Error('対象期間を確認してください。');
  const reason = String(payload.reason || '').trim().slice(0, 600);
  if (!reason) throw new Error('申請理由を入力してください。');

  let content = String(payload.content || '').trim().slice(0, 1500);
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
  return {ok:true,id:requestId};
}

function cancelRequest(sessionToken, requestId) {
  const employee = requireSession_(sessionToken).employee;
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
  return {ok:true};
}

function approveRequest(sessionToken, requestId, decision, comment) {
  const admin = requireAdminSession_(sessionToken).employee;
  const rowInfo = findRequestRow_(requestId);
  if (!rowInfo) throw new Error('申請が見つかりません。');
  const r = rowInfo.values;
  if (r[9] !== '承認待ち') throw new Error('この申請はすでに処理されています。');
  const approve = decision === 'APPROVE';
  const nowText = toTimestamp_(new Date());
  rowInfo.sheet.getRange(rowInfo.row,10,1,4).setValues([[
    approve ? '承認済' : '差戻し',
    admin.name,
    nowText,
    approve ? '' : String(comment || '').trim().slice(0,500)
  ]]);

  if (approve && r[4] === '打刻修正') {
    applyApprovedPunchCorrection_(r);
  }

  appendAudit_({
    employeeId:admin.employeeId,employeeName:admin.name,
    operation:approve?'申請承認':'申請差戻し',target:'申請',targetId:r[0],
    before:'承認待ち',after:approve?'承認済':'差戻し',source:'WEB',result:'SUCCESS',
    note:String(comment||'').slice(0,200)
  });
  return {ok:true};
}

function getPunchesForDate(sessionToken, date) {
  const employee = requireSession_(sessionToken).employee;
  const targetDate = normalizeDate_(date);
  const sheet = getDb_().getSheetByName(DB.sheets.punches);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2,1,lastRow-1,12).getDisplayValues()
    .filter(r=>r[1]===employee.employeeId && r[3]===targetDate && String(r[8]).toUpperCase()!=='TRUE')
    .map(r=>({id:r[0],action:r[4],timestamp:r[5],workLocation:r[6]}));
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

function applyApprovedPunchCorrection_(requestRow) {
  let correction;
  try { correction = JSON.parse(requestRow[7] || '{}'); }
  catch(e) { throw new Error('打刻修正申請の内容が読み取れません。'); }
  const employeeId = requestRow[2];
  const employeeName = requestRow[3];
  const date = requestRow[5];
  const action = correction.action;
  const time = normalizeTime_(correction.time || '');
  if (!Object.values(PUNCH).includes(action) || !time) throw new Error('打刻修正内容が不正です。');

  const sheet = getDb_().getSheetByName(DB.sheets.punches);
  let originalLocation = correction.workLocation || '出社';
  const originalId = String(correction.originalPunchId || '');
  if (originalId && sheet.getLastRow() >= 2) {
    const found = sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(originalId).matchEntireCell(true).findNext();
    if (found) {
      const row = found.getRow();
      const original = sheet.getRange(row,1,1,12).getDisplayValues()[0];
      if (original[1] !== employeeId) throw new Error('修正対象の打刻が一致しません。');
      originalLocation = original[6] || originalLocation;
      sheet.getRange(row,9).setValue(true);
    }
  }

  const nowText = toTimestamp_(new Date());
  sheet.appendRow([
    createId_('P'), employeeId, employeeName, date, action,
    date + ' ' + time + ':00', originalLocation, 'CORRECTION',
    false, originalId, '申請承認による修正 ' + requestRow[0], nowText
  ]);
}
