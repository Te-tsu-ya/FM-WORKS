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
  prototypeMode: true,
  prototypePin: '000000',
  prototypeEmployeeIds: ['FM0001','FM0002','FM0003','FM0004','FM0005']
});

function getPublicAuthConfig() {
  const config = getAuthConfig_();
  return {
    appName: APP.name,
    needsSetup: isPrototypeMode_() ? false : !hasAnyPinConfigured_(),
    pinLength: config.pinLength,
    prototypeMode: isPrototypeMode_(),
    prototypePin: isPrototypeMode_() ? AUTH.prototypePin : '',
    support: getSupportConfig_()
  };
}

function initializeFirstAdmin(employeeId, pin, clientInfo, support, rememberSession) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (hasAnyPinConfigured_()) {
      throw new Error('初期設定はすでに完了しています。');
    }
    const record = getEmployeeAuthRecord_(employeeId);
    if (!record || !record.active || record.role !== 'ADMIN') {
      throw new Error('初期管理者として設定できません。');
    }
    validatePin_(pin, record.employeeId);
    support = support || {};
    const supportEmail = String(support.email || '').trim().slice(0, 200);
    const supportPhone = String(support.phone || '').trim().slice(0, 80);
    const supportName = safeSheetText_(support.name || record.displayName || record.name, 80);
    if (!supportEmail && !supportPhone) {
      throw new Error('PINを忘れた場合の連絡先として、メールまたは電話番号を入力してください。');
    }
    if (supportEmail && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(supportEmail)) {
      throw new Error('連絡先メールアドレスの形式を確認してください。');
    }
    saveSettings_({
      SUPPORT_CONTACT_NAME: supportName || 'FM WORKS管理者',
      SUPPORT_EMAIL: supportEmail,
      SUPPORT_PHONE: supportPhone,
      SUPPORT_NOTE: 'PINを忘れた場合は、下記のFM WORKS管理者へご連絡いただくか、再発行依頼を送信してください。'
    });
    setEmployeePin_(record, pin, false);
    appendAudit_({
      employeeId: record.employeeId,
      employeeName: record.name,
      operation: '認証初期設定',
      target: '社員マスタ',
      targetId: record.employeeId,
      before: '',
      after: 'PIN設定済み',
      source: 'WEB',
      result: 'SUCCESS',
      note: '初期管理者'
    });
  } finally {
    lock.releaseLock();
  }
  return login(employeeId, pin, clientInfo, rememberSession);
}

function login(employeeId, pin, clientInfo, rememberSession) {
  const id = normalizeEmployeeId_(employeeId);
  const value = String(pin || '');
  const config = getAuthConfig_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  let record;
  try {
    record = getEmployeeAuthRecord_(id);
    if (!record || !record.active) {
      hashPin_('DUMMY', Utilities.getUuid(), value);
      throw loginError_();
    }
    if (record.authState === 'DISABLED') throw loginError_();

    const prototypeAccess = isPrototypeLogin_(record, value);
    const now = new Date();
    if (!prototypeAccess && record.lockUntil && parseTimestamp_(record.lockUntil) > now) {
      throw new Error('ログインできません。しばらく待ってから再度お試しください。');
    }
    if ((!record.pinHash || !record.pinSalt) && !prototypeAccess) {
      throw loginError_();
    }

    if (!prototypeAccess) {
      const computed = hashPin_(record.employeeId, record.pinSalt, value);
      if (!safeEqual_(computed, record.pinHash)) {
        const failures = record.failures + 1;
        let lockUntil = '';
        if (failures >= config.maxFailures) {
          lockUntil = toTimestamp_(new Date(now.getTime() + config.lockMinutes * 60000));
        }
        updateEmployeeAuthCells_(record.rowNumber, {
          failures: failures,
          lockUntil: lockUntil
        });
        appendAudit_({
          employeeId: record.employeeId,
          employeeName: record.name,
          operation: 'ログイン失敗',
          target: '認証',
          targetId: record.employeeId,
          before: '',
          after: '',
          source: 'WEB',
          result: 'ERROR',
          note: lockUntil ? 'アカウント一時ロック' : 'PIN不一致'
        });
        throw loginError_();
      }
    }

    const nowText = toTimestamp_(now);
    updateEmployeeAuthCells_(record.rowNumber, {
      failures: 0,
      lockUntil: '',
      lastLogin: nowText,
      authState: 'ACTIVE'
    });
    record.failures = 0;
    record.lockUntil = '';
    record.lastLogin = nowText;
    const keepSignedIn = !!rememberSession;
    const sessionToken = createSession_(record, clientInfo, keepSignedIn);
    appendAudit_({
      employeeId: record.employeeId,
      employeeName: record.name,
      operation: 'ログイン',
      target: '認証',
      targetId: record.employeeId,
      before: '',
      after: '成功',
      source: 'WEB',
      result: 'SUCCESS',
      note: prototypeAccess ? '試作版共通PIN / ' + sanitizeClientInfo_(clientInfo) : sanitizeClientInfo_(clientInfo)
    });
    return {
      ok: true,
      sessionToken: sessionToken,
      remembered: keepSignedIn,
      mustChangePin: prototypeAccess ? false : record.mustChangePin,
      user: publicEmployee_(record)
    };
  } finally {
    lock.releaseLock();
  }
}

function isPrototypeMode_() {
  if(typeof SpreadsheetApp==='undefined')return !!AUTH.prototypeMode;
  const raw=String(getSettingsMap_().PROTOTYPE_MODE||'').trim().toUpperCase();
  if(['FALSE','0','OFF'].includes(raw))return false;
  if(['TRUE','1','ON'].includes(raw))return true;
  return !!AUTH.prototypeMode;
}

function isPrototypeLogin_(record, pin) {
  return !!(isPrototypeMode_() &&
    record &&
    AUTH.prototypeEmployeeIds.includes(record.employeeId) &&
    String(pin || '') === AUTH.prototypePin);
}

function resumeSession(sessionToken) {
  const session = requireSession_(sessionToken);
  return {
    ok: true,
    mustChangePin: session.employee.mustChangePin,
    user: publicEmployee_(session.employee)
  };
}

function logout(sessionToken) {
  if (!sessionToken) return { ok: true };
  const hash = hashToken_(sessionToken);
  const sheet = getDb_().getSheetByName(AUTH.sessionSheet);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const found = sheet.getRange(2, 2, lastRow - 1, 1).createTextFinder(hash).matchEntireCell(true).findNext();
    if (found) {
      const row = found.getRow();
      const values = sheet.getRange(row, 1, 1, 10).getDisplayValues()[0];
      sheet.getRange(row, 8).setValue('LOGGED_OUT');
      sheet.getRange(row, 10).setValue(toTimestamp_(new Date()));
      const employee = getEmployeeAuthRecord_(values[2]);
      if (employee) {
        appendAudit_({
          employeeId: employee.employeeId,
          employeeName: employee.name,
          operation: 'ログアウト',
          target: '認証',
          targetId: values[0],
          before: 'ACTIVE',
          after: 'LOGGED_OUT',
          source: 'WEB',
          result: 'SUCCESS',
          note: ''
        });
      }
    }
  }
  return { ok: true };
}

function changeOwnPin(sessionToken, currentPin, newPin) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  return withScriptLock_(function() {
    const fresh = getEmployeeAuthRecord_(employee.employeeId);
    if (!fresh || !fresh.active) throw new Error('AUTH_REQUIRED');
    const currentHash = hashPin_(fresh.employeeId, fresh.pinSalt, String(currentPin || ''));
    if (!fresh.pinHash || !safeEqual_(currentHash, fresh.pinHash)) {
      throw new Error('現在のPINが正しくありません。');
    }
    validatePin_(newPin, fresh.employeeId);
    if (String(currentPin) === String(newPin)) {
      throw new Error('現在と異なるPINを設定してください。');
    }
    setEmployeePin_(fresh, newPin, false);
    invalidateEmployeeSessions_(fresh.employeeId, session.rowNumber);
    appendAudit_({
      employeeId: fresh.employeeId,
      employeeName: fresh.name,
      operation: 'PIN変更',
      target: '認証',
      targetId: fresh.employeeId,
      before: '',
      after: '変更済み',
      source: 'WEB',
      result: 'SUCCESS',
      note: ''
    });
    SpreadsheetApp.flush();
    return { ok: true };
  });
}
function requestPinHelp(employeeId, note, clientInfo) {
  const id = normalizeEmployeeId_(employeeId);
  const support = getSupportConfig_();

  return withScriptLock_(function() {
    const employee = getEmployeeAuthRecord_(id);
    if (employee && employee.active) {
      const now = new Date();
      const nowText = toTimestamp_(now);
      const requestId = 'R-' + Utilities.getUuid();
      const sheet = getDb_().getSheetByName(AUTH.resetSheet);
      const lastRow = sheet.getLastRow();
      let recentRequest = false;
      let requestsToday = 0;

      if (lastRow >= 2) {
        const rows = sheet.getRange(2,1,lastRow-1,9).getDisplayValues();
        const today = Utilities.formatDate(now, DB.timeZone, 'yyyy-MM-dd');
        rows.forEach(r => {
          if (r[2] !== employee.employeeId) return;
          if (String(r[1] || '').slice(0,10) === today) requestsToday++;
          if (r[4] !== '未対応') return;
          const at = parseTimestamp_(r[1]);
          if (at && (now.getTime() - at.getTime()) < 15 * 60 * 1000) recentRequest = true;
        });
      }

      if (!recentRequest && requestsToday < 5) {
        sheet.appendRow([
          requestId,
          nowText,
          employee.employeeId,
          employee.name,
          '未対応',
          safeSheetText_(note, 300),
          '',
          '',
          'WEB'
        ]);
        appendAudit_({
          employeeId: employee.employeeId,
          employeeName: employee.name,
          operation: 'PIN再発行依頼',
          target: 'PIN再発行',
          targetId: requestId,
          before: '',
          after: '未対応',
          source: 'WEB',
          result: 'SUCCESS',
          note: sanitizeClientInfo_(clientInfo)
        });

        if (support.email) {
          try {
            MailApp.sendEmail({
              to: support.email,
              subject: '[FM WORKS] PIN再発行依頼 ' + employee.employeeId,
              body: 'FM WORKSでPIN再発行依頼が登録されました。\n\n社員ID: ' + employee.employeeId + '\n氏名: ' + employee.name + '\n日時: ' + nowText + '\n\n管理画面から仮PINを再発行してください。'
            });
          } catch (e) {
            console.warn('PIN help email failed', e);
          }
        }
      }
    }

    SpreadsheetApp.flush();
    return {
      ok: true,
      message: 'PIN再発行の案内を確認してください。',
      support: support
    };
  });
}
function getAuthAdminData(sessionToken) {
  const session = requireAdminSession_(sessionToken);
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const lastRow = sheet.getLastRow();
  const employees = [];
  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, 24).getDisplayValues();
    rows.forEach((r, i) => {
      if (!r[0]) return;
      employees.push({
        employeeId: r[0],
        name: r[1],
        displayName: r[2] || r[1],
        department: r[3] || '',
        title: r[4] || '',
        role: r[5] || 'USER',
        active: r[6] === '在籍',
        workStart: r[7] || '09:00',
        workEnd: r[8] || '18:00',
        breakMinutes: Number(r[9] || 60),
        leaveBalance: Number(r[10] || 0),
        leaveBalanceConfigured: String(r[10] || '').trim() !== '',
        email: r[11] || '',
        note: r[12] || '',
        pinConfigured: !!r[14],
        mustChangePin: String(r[15]).toUpperCase() === 'TRUE',
        failures: Number(r[16] || 0),
        lockedUntil: r[17] || '',
        lastLogin: r[18] || '',
        authState: r[20] || '',
        payrollIncluded: String(r[22]).toUpperCase() === 'TRUE',
        managerId: r[23] || ''
      });
    });
  }
  const resetSheet = getDb_().getSheetByName(AUTH.resetSheet);
  const resetLastRow = resetSheet.getLastRow();
  const resetRequests = resetLastRow < 2 ? [] : resetSheet.getRange(2, 1, resetLastRow - 1, 9).getDisplayValues()
    .filter(r => r[0])
    .slice(-50)
    .reverse()
    .map(r => ({
      requestId: r[0],
      requestedAt: r[1],
      employeeId: r[2],
      name: r[3],
      status: r[4],
      note: r[5],
      handledBy: r[6],
      handledAt: r[7]
    }));
  return {
    employees: employees,
    projects: getProjectsInternal_(true),
    resetRequests: resetRequests,
    support: getSupportConfig_(),
    prototypeMode: isPrototypeMode_(),
    currentUser: publicEmployee_(session.employee)
  };
}

function adminSetTemporaryPin(sessionToken, targetEmployeeId, temporaryPin) {
  const admin = requireAdminSession_(sessionToken).employee;
  return withScriptLock_(function() {
    const target = getEmployeeAuthRecord_(targetEmployeeId);
    if (!target || !target.active) throw new Error('対象社員が見つかりません。');
    validatePin_(temporaryPin, target.employeeId);
    setEmployeePin_(target, temporaryPin, true);
    invalidateEmployeeSessions_(target.employeeId, 0);
    markPinHelpRequestsHandled_(target.employeeId, admin);
    appendAudit_({
      employeeId: admin.employeeId,
      employeeName: admin.name,
      operation: '仮PIN発行',
      target: '社員マスタ',
      targetId: target.employeeId,
      before: '',
      after: 'PIN再発行・初回変更必須',
      source: 'WEB',
      result: 'SUCCESS',
      note: target.name
    });
    SpreadsheetApp.flush();
    return { ok: true };
  });
}
function markPinHelpRequestsHandled_(employeeId, admin) {
  const sheet = getDb_().getSheetByName(AUTH.resetSheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const rows = sheet.getRange(2, 1, lastRow - 1, 9).getDisplayValues();
  const nowText = toTimestamp_(new Date());
  rows.forEach((r, idx) => {
    if (r[2] === employeeId && r[4] === '未対応') {
      const rowNumber = idx + 2;
      sheet.getRange(rowNumber, 5, 1, 4).setValues([['対応済', r[5] || '', admin.name, nowText]]);
    }
  });
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
function setPrototypeMode(sessionToken, enabled) {
  const admin=requireAdminSession_(sessionToken).employee;
  const next=!!enabled;
  if(next)throw new Error('試作モードの再有効化はソース管理側で行ってください。');

  const sheet=getDb_().getSheetByName(DB.sheets.employees);
  const lastRow=sheet.getLastRow();
  const rows=lastRow<2?[]:sheet.getRange(2,1,lastRow-1,23).getDisplayValues().filter(r=>r[0]&&r[6]==='在籍');
  const missingPin=rows.filter(r=>!r[14]).map(r=>r[1]||r[0]);
  if(missingPin.length){
    throw new Error('本番モードへ切り替える前に、全社員へPINを設定してください: '+missingPin.join('、'));
  }
  const support=getSupportConfig_();
  if(!support.email&&!support.phone){
    throw new Error('本番モードへ切り替える前に、PIN再発行の連絡先を設定してください。');
  }

  saveSettings_({PROTOTYPE_MODE:'FALSE'});
  appendAudit_({
    employeeId:admin.employeeId,employeeName:admin.name,operation:'試作モード終了',
    target:'設定',targetId:'PROTOTYPE_MODE',before:'TRUE',after:'FALSE',
    source:'WEB',result:'SUCCESS',note:'本番認証へ切替'
  });
  rows.forEach(r=>invalidateEmployeeSessions_(r[0],0));
  return {ok:true,prototypeMode:false,requiresRelogin:true};
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
function requireSession_(sessionToken) {
  const raw = String(sessionToken || '');
  if (raw.length < 40) throw new Error('AUTH_REQUIRED');
  const hash = hashToken_(raw);
  const sheet = getDb_().getSheetByName(AUTH.sessionSheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('AUTH_REQUIRED');

  const found = sheet.getRange(2, 2, lastRow - 1, 1).createTextFinder(hash).matchEntireCell(true).findNext();
  if (!found) throw new Error('AUTH_REQUIRED');

  const rowNumber = found.getRow();
  const row = sheet.getRange(rowNumber, 1, 1, 11).getValues()[0];
  const now = new Date();
  const absoluteExpiry = parseTimestamp_(row[4]);
  const idleExpiry = parseTimestamp_(row[5]);
  if (row[7] !== 'ACTIVE' || !absoluteExpiry || !idleExpiry || absoluteExpiry <= now || idleExpiry <= now) {
    sheet.getRange(rowNumber, 8).setValue('EXPIRED');
    throw new Error('SESSION_EXPIRED');
  }

  const employee = getEmployeeAuthRecord_(row[2]);
  if (!employee || !employee.active || employee.authState === 'DISABLED') {
    sheet.getRange(rowNumber, 8).setValue('REVOKED');
    throw new Error('AUTH_REQUIRED');
  }

  const config = getAuthConfig_();
  const lastUsed = parseTimestamp_(row[6]);
  if (!lastUsed || (now.getTime() - lastUsed.getTime()) >= AUTH.sessionTouchMinutes * 60000) {
    const nowText = toTimestamp_(now);
    const remembered = String(row[10] || '').toUpperCase() === 'TRUE' || row[10] === true;
    const idleMinutes = remembered ? config.rememberIdleMinutes : config.idleMinutes;
    const nextIdle = toTimestamp_(new Date(now.getTime() + idleMinutes * 60000));
    sheet.getRange(rowNumber, 6, 1, 2).setValues([[nextIdle, nowText]]);
  }
  return { rowNumber: rowNumber, employee: employee, sessionId: row[0] };
}

function requireAdminSession_(sessionToken) {
  const session = requireSession_(sessionToken);
  if (session.employee.role !== 'ADMIN') throw new Error('この操作を行う権限がありません。');
  return session;
}

function createSession_(employee, clientInfo, rememberSession) {
  cleanupExpiredSessions_();
  const config = getAuthConfig_();
  const now = new Date();
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const sessionId = 'S-' + Utilities.getUuid();
  const remembered = !!rememberSession;
  const absoluteHours = remembered ? config.rememberSessionHours : config.sessionHours;
  const idleMinutes = remembered ? config.rememberIdleMinutes : config.idleMinutes;
  const absoluteExpiry = new Date(now.getTime() + absoluteHours * 3600000);
  const idleExpiry = new Date(now.getTime() + idleMinutes * 60000);
  getDb_().getSheetByName(AUTH.sessionSheet).appendRow([
    sessionId,
    hashToken_(token),
    employee.employeeId,
    toTimestamp_(now),
    toTimestamp_(absoluteExpiry),
    toTimestamp_(idleExpiry),
    toTimestamp_(now),
    'ACTIVE',
    sanitizeClientInfo_(clientInfo),
    '',
    remembered
  ]);
  return token;
}

function cleanupExpiredSessions_() {
  const sheet = getDb_().getSheetByName(AUTH.sessionSheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const rows = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
  const now = new Date();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const status = r[7] || '';
    const absoluteExpiry = parseTimestamp_(r[4]);
    const inactive = status !== 'ACTIVE' || (absoluteExpiry && absoluteExpiry <= now);
    if (inactive) sheet.deleteRow(i + 2);
  }
}

function invalidateEmployeeSessions_(employeeId, exceptRowNumber) {
  const sheet = getDb_().getSheetByName(AUTH.sessionSheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const rows = sheet.getRange(2, 1, lastRow - 1, 11).getDisplayValues();
  rows.forEach((r, idx) => {
    const rowNumber = idx + 2;
    if (rowNumber === exceptRowNumber) return;
    if (r[2] === employeeId && r[7] === 'ACTIVE') {
      sheet.getRange(rowNumber, 8).setValue('REVOKED');
    }
  });
}

function getEmployeeAuthRecord_(employeeId) {
  const id = normalizeEmployeeId_(employeeId);
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const rows = sheet.getRange(2, 1, lastRow - 1, 24).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] !== id) continue;
    return {
      rowNumber: i + 2,
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
      managerId: r[23] || ''
    };
  }
  return null;
}

function setEmployeePin_(record, pin, mustChange) {
  const salt = Utilities.getUuid().replace(/-/g, '');
  const nowText = toTimestamp_(new Date());
  updateEmployeeAuthCells_(record.rowNumber, {
    pinSalt: salt,
    pinHash: hashPin_(record.employeeId, salt, String(pin)),
    mustChangePin: !!mustChange,
    failures: 0,
    lockUntil: '',
    pinUpdatedAt: nowText,
    authState: 'ACTIVE'
  });
  record.pinSalt = salt;
  record.pinHash = hashPin_(record.employeeId, salt, String(pin));
  record.mustChangePin = !!mustChange;
  record.failures = 0;
  record.lockUntil = '';
  record.pinUpdatedAt = nowText;
  record.authState = 'ACTIVE';
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
  Object.keys(values).forEach(key => {
    if (!mapping[key]) return;
    sheet.getRange(rowNumber, mapping[key]).setValue(values[key]);
  });
}

function hasAnyPinConfigured_() {
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  return sheet.getRange(2, 15, lastRow - 1, 1).getDisplayValues().some(r => !!r[0]);
}

function getAuthConfig_() {
  const map = getSettingsMap_();
  return {
    sessionHours: Math.max(1, Number(map.SESSION_HOURS || AUTH.defaultSessionHours)),
    idleMinutes: Math.max(15, Number(map.SESSION_IDLE_MINUTES || AUTH.defaultIdleMinutes)),
    rememberSessionHours: Math.max(24, Number(map.REMEMBER_SESSION_DAYS || AUTH.defaultRememberSessionDays) * 24),
    rememberIdleMinutes: Math.max(1440, Number(map.REMEMBER_IDLE_DAYS || AUTH.defaultRememberIdleDays) * 1440),
    maxFailures: Math.max(3, Number(map.MAX_LOGIN_FAILURES || AUTH.defaultMaxFailures)),
    lockMinutes: Math.max(1, Number(map.LOCK_MINUTES || AUTH.defaultLockMinutes)),
    pinLength: Math.max(4, Number(map.PIN_LENGTH || AUTH.defaultPinLength))
  };
}

function getSupportConfig_() {
  const map = getSettingsMap_();
  return {
    name: map.SUPPORT_CONTACT_NAME || 'FM WORKS管理者',
    email: map.SUPPORT_EMAIL || '',
    phone: map.SUPPORT_PHONE || '',
    note: map.SUPPORT_NOTE || 'PINを忘れた場合は、社内のFM WORKS管理者へご連絡ください。'
  };
}

function getSettingsMap_() {
  const sheet = getDb_().getSheetByName(AUTH.settingsSheet);
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;
  sheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues().forEach(r => {
    if (r[0]) map[r[0]] = r[1];
  });
  return map;
}

function saveSettings_(values) {
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

function validatePin_(pin, employeeId) {
  const config = getAuthConfig_();
  const value = String(pin || '');
  const rule = new RegExp('^\\d{' + config.pinLength + '}$');
  if (!rule.test(value)) throw new Error(config.pinLength + '桁の数字でPINを設定してください。');
  if (/^(\d)\1+$/.test(value)) throw new Error('同じ数字だけのPINは使用できません。');
  const weak = ['012345', '123456', '234567', '345678', '456789', '987654', '876543', '765432', '654321'];
  if (weak.includes(value)) throw new Error('推測されやすいPINは使用できません。');
  const digits = String(employeeId || '').replace(/\D/g, '');
  if (digits && (digits.endsWith(value) || value.endsWith(digits))) {
    throw new Error('社員番号と同じ数字をPINに使用しないでください。');
  }
}

function hashPin_(employeeId, salt, pin) {
  const pepper = getOrCreatePepper_();
  const bytes = Utilities.computeHmacSha256Signature(
    String(employeeId) + ':' + String(salt) + ':' + String(pin),
    pepper
  );
  return bytesToHex_(bytes);
}

function hashToken_(token) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8));
}

function getOrCreatePepper_() {
  const props = PropertiesService.getScriptProperties();
  let pepper = props.getProperty(AUTH.pepperKey);
  if (!pepper) {
    pepper = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty(AUTH.pepperKey, pepper);
  }
  return pepper;
}

function bytesToHex_(bytes) {
  return bytes.map(b => ((b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))).join('');
}

function safeEqual_(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function normalizeEmployeeId_(value) {
  const id = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,24}$/.test(id)) throw loginError_();
  return id;
}

function sanitizeClientInfo_(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, 250);
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
