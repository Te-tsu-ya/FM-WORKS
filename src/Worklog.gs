function getWorklogs(sessionToken, params) {
  const session = requireSession_(sessionToken);
  params = params || {};
  const start = normalizeDate_(params.start || Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd'));
  const end = normalizeDate_(params.end || start);
  const requestedEmployeeId = String(params.employeeId || session.employee.employeeId);
  const employeeId = session.employee.role === 'ADMIN' ? requestedEmployeeId : session.employee.employeeId;
  const sheet = getDb_().getSheetByName('工数');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { items: [], totalMinutes: 0 };
  const items = sheet.getRange(2, 1, lastRow - 1, 12).getDisplayValues()
    .filter(r => r[0] && r[1] >= start && r[1] <= end && (employeeId === 'ALL' || r[2] === employeeId))
    .map(r => ({
      id: r[0], date: r[1], employeeId: r[2], name: r[3], project: r[4],
      category: r[5], description: r[6], start: r[7], end: r[8],
      minutes: Number(r[9] || 0), note: r[10] || '', createdAt: r[11] || ''
    }))
    .sort((a,b) => b.date.localeCompare(a.date) || (b.start||'').localeCompare(a.start||''));
  return { items: items, totalMinutes: items.reduce((sum,x)=>sum+x.minutes,0) };
}

function saveWorklog(sessionToken, payload) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  payload = payload || {};
  const date = normalizeDate_(payload.date);
  const project = String(payload.project || '').trim().slice(0, 120);
  const category = String(payload.category || '').trim().slice(0, 80);
  const description = String(payload.description || '').trim().slice(0, 500);
  const note = String(payload.note || '').trim().slice(0, 500);
  const start = normalizeTime_(payload.start || '');
  const end = normalizeTime_(payload.end || '');
  if (!project) throw new Error('プロジェクト名を入力してください。');
  if (!description) throw new Error('作業内容を入力してください。');
  if (!start || !end) throw new Error('開始時刻と終了時刻を入力してください。');
  const minutes = timeRangeMinutes_(start, end);
  if (minutes <= 0 || minutes > 1440) throw new Error('工数時間を確認してください。');

  const sheet = getDb_().getSheetByName('工数');
  const nowText = toTimestamp_(new Date());
  let id = String(payload.id || '').trim();
  let rowNumber = 0;

  if (id) {
    const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1).createTextFinder(id).matchEntireCell(true).findNext();
    if (!found) throw new Error('編集対象の工数が見つかりません。');
    rowNumber = found.getRow();
    const ownerId = sheet.getRange(rowNumber, 3).getDisplayValue();
    if (employee.role !== 'ADMIN' && ownerId !== employee.employeeId) throw new Error('この工数を編集する権限がありません。');
  } else {
    id = createId_('W');
    rowNumber = Math.max(2, sheet.getLastRow() + 1);
  }

  const targetEmployeeId = employee.role === 'ADMIN' && payload.employeeId ? String(payload.employeeId) : employee.employeeId;
  const target = getEmployee_(targetEmployeeId);
  sheet.getRange(rowNumber, 1, 1, 12).setValues([[
    id, date, target.employeeId, target.name, project, category, description, start, end, minutes, note, nowText
  ]]);
  appendAudit_({
    employeeId: employee.employeeId, employeeName: employee.name,
    operation: payload.id ? '工数更新' : '工数登録', target: '工数', targetId: id,
    before: '', after: date + ' ' + project + ' ' + minutes + '分',
    source: 'WEB', result: 'SUCCESS', note: target.name
  });
  return { ok: true, id: id };
}

function deleteWorklog(sessionToken, worklogId) {
  const employee = requireSession_(sessionToken).employee;
  const id = String(worklogId || '').trim();
  const sheet = getDb_().getSheetByName('工数');
  const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1).createTextFinder(id).matchEntireCell(true).findNext();
  if (!found) throw new Error('削除対象が見つかりません。');
  const row = found.getRow();
  const values = sheet.getRange(row, 1, 1, 12).getDisplayValues()[0];
  if (employee.role !== 'ADMIN' && values[2] !== employee.employeeId) throw new Error('この工数を削除する権限がありません。');
  sheet.deleteRow(row);
  appendAudit_({
    employeeId: employee.employeeId, employeeName: employee.name,
    operation: '工数削除', target: '工数', targetId: id,
    before: values[1] + ' ' + values[4], after: '削除',
    source: 'WEB', result: 'SUCCESS', note: ''
  });
  return { ok: true };
}

function timeRangeMinutes_(start, end) {
  const a = start.split(':').map(Number), b = end.split(':').map(Number);
  return (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
}
