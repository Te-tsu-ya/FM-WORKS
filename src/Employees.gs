function saveEmployee(sessionToken, payload) {
  const admin = requireAdminSession_(sessionToken).employee;
  payload = payload || {};
  const employeeId = String(payload.employeeId || '').trim().toUpperCase();
  if (!/^FM\d{4,6}$/.test(employeeId)) throw new Error('社員IDは FM0001 のような形式で入力してください。');
  const name = String(payload.name || '').trim().slice(0,100);
  if (!name) throw new Error('氏名を入力してください。');
  const displayName = String(payload.displayName || name).trim().slice(0,80);
  const department = String(payload.department || '').trim().slice(0,80);
  const title = String(payload.title || '').trim().slice(0,80);
  const allowedRoles = ['USER','CALENDAR_EDITOR','ADMIN'];
  const role = allowedRoles.includes(payload.role) ? payload.role : 'USER';
  const status = payload.active === false ? '退職' : '在籍';
  const workStart = normalizeTime_(payload.workStart || '09:00');
  const workEnd = normalizeTime_(payload.workEnd || '18:00');
  const breakMinutes = Math.max(0,Math.min(480,Number(payload.breakMinutes||60)));
  const leaveBalance = Math.max(0,Number(payload.leaveBalance||0));
  const email = String(payload.email || '').trim().slice(0,200);
  if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) throw new Error('メールアドレスの形式を確認してください。');
  const note = String(payload.note || '').trim().slice(0,500);

  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const lastRow = sheet.getLastRow();
  let rowNumber = 0;
  if (lastRow >= 2) {
    const found = sheet.getRange(2,1,lastRow-1,1).createTextFinder(employeeId).matchEntireCell(true).findNext();
    if (found) rowNumber=found.getRow();
  }
  const isNew = !rowNumber;
  if (isNew) rowNumber=Math.max(2,lastRow+1);
  const existingAuth = isNew ? Array(9).fill('') : sheet.getRange(rowNumber,14,1,9).getValues()[0];
  if (isNew) existingAuth[7] = 'ACTIVE';

  sheet.getRange(rowNumber,1,1,22).setValues([[
    employeeId,name,displayName,department,title,role,status,workStart,workEnd,breakMinutes,leaveBalance,email,note,
    ...existingAuth
  ]]);

  appendAudit_({
    employeeId:admin.employeeId,employeeName:admin.name,operation:isNew?'社員追加':'社員更新',
    target:'社員マスタ',targetId:employeeId,before:'',after:name+' / '+role+' / '+status,
    source:'WEB',result:'SUCCESS',note:''
  });
  return {ok:true,employeeId:employeeId};
}

function setEmployeeActiveState(sessionToken, employeeId, active) {
  const admin = requireAdminSession_(sessionToken).employee;
  const target = getEmployeeAuthRecord_(employeeId);
  if (!target) throw new Error('社員が見つかりません。');
  if (target.employeeId === admin.employeeId && !active) throw new Error('自分自身を無効化することはできません。');
  const sheet=getDb_().getSheetByName(DB.sheets.employees);
  sheet.getRange(target.rowNumber,7).setValue(active?'在籍':'退職');
  sheet.getRange(target.rowNumber,21).setValue(active?'ACTIVE':'DISABLED');
  if(!active) invalidateEmployeeSessions_(target.employeeId,0);
  appendAudit_({
    employeeId:admin.employeeId,employeeName:admin.name,operation:active?'社員有効化':'社員無効化',
    target:'社員マスタ',targetId:target.employeeId,before:target.active?'在籍':'退職',after:active?'在籍':'退職',
    source:'WEB',result:'SUCCESS',note:target.name
  });
  return {ok:true};
}
