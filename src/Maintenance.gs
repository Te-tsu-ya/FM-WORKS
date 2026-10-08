const MAINTENANCE = Object.freeze({
  backupFolderProperty: 'FM_WORKS_BACKUP_FOLDER_ID',
  databaseIdProperty: 'FM_WORKS_DB_ID',
  lastBackupProperty: 'FM_WORKS_LAST_BACKUP_AT',
  lastBackupVerifiedProperty: 'FM_WORKS_LAST_BACKUP_VERIFIED',
  autoBackupProperty: 'FM_WORKS_AUTO_BACKUP',
  backupTriggerHandler: 'scheduledDailyMaintenance_',
  backupRetentionDays: 90
});

function getSystemStatus(sessionToken) {
  const admin = requireAdminSession_(sessionToken).employee;
  const db = getDb_();
  const sheets = {};
  db.getSheets().forEach(sheet => {
    sheets[sheet.getName()] = Math.max(0, sheet.getLastRow() - 1);
  });

  const sessionSheet = db.getSheetByName(AUTH.sessionSheet);
  let activeSessions = 0;
  if (sessionSheet && sessionSheet.getLastRow() >= 2) {
    activeSessions = sessionSheet.getRange(2, 8, sessionSheet.getLastRow() - 1, 1)
      .getDisplayValues().filter(r => r[0] === 'ACTIVE').length;
  }

  const employeeSheet = db.getSheetByName(DB.sheets.employees);
  let pinPending = 0;
  if (employeeSheet && employeeSheet.getLastRow() >= 2) {
    pinPending = employeeSheet.getRange(2, 1, employeeSheet.getLastRow() - 1, 21)
      .getDisplayValues()
      .filter(r => r[0] && r[6] === '在籍' && !r[14]).length;
  }

  const props = PropertiesService.getScriptProperties();
  const backupSetting = props.getProperty(MAINTENANCE.autoBackupProperty);
  const backupEnabled = backupSetting === null ? true : backupSetting === 'true';
  const runtime = getRuntimeInfo_();
  const triggerState = getDailyBackupTriggerState_();

  return {
    dbName: db.getName(),
    dbId: db.getId(),
    sheets: sheets,
    activeSessions: activeSessions,
    pinPending: pinPending,
    backupEnabled: backupEnabled,
    backupTriggerInstalled: triggerState.installed,
    backupTriggerCount: triggerState.count,
    backupMode: triggerState.installed ? '毎日03時台 / 時間トリガー' : '未設定（管理者利用時の補助のみ）',
    lastBackupAt: props.getProperty(MAINTENANCE.lastBackupProperty) || '',
    backupVerified: props.getProperty(MAINTENANCE.lastBackupVerifiedProperty) === 'true',
    backupRetentionDays: MAINTENANCE.backupRetentionDays,
    environment: runtime.environment,
    laborConfig: getLaborRuleConfig_(),
    schemaStatus: getDatabaseSchemaStatus_(),
    explicitDb: runtime.explicitDb,
    usingDefaultStagingDb: runtime.usingDefaultStagingDb,
    readiness: getProductionReadiness_(),
    checkedAt: toTimestamp_(new Date()),
    checkedBy: admin.name
  };
}

function getProductionReadiness_() {
  const db=getDb_();
  const now=new Date();
  const today=Utilities.formatDate(now,DB.timeZone,'yyyy-MM-dd');
  const horizon=Utilities.formatDate(new Date(now.getTime()+90*86400000),DB.timeZone,'yyyy-MM-dd');
  const requiredSheets=[
    DB.sheets.employees,DB.sheets.punches,'日次勤怠','工数','申請',DB.sheets.companyCalendar,
    DB.sheets.audit,AUTH.settingsSheet,DB.sheets.schedule,AUTH.sessionSheet,AUTH.resetSheet,DB.sheets.projects,DB.sheets.monthlyReview,DB.sheets.monthlySnapshot,DB.sheets.monthlySnapshotDaily,DB.sheets.leaveLedger
  ];
  const sheetNames=new Set(db.getSheets().map(s=>s.getName()));
  const blockers=[];
  const warnings=[];

  const schemaStatus=getDatabaseSchemaStatus_();
  if(!schemaStatus.ready)blockers.push('DBスキーマ不整合: '+schemaStatus.issues.slice(0,3).join(' / '));

  const missingSheets=requiredSheets.filter(name=>!sheetNames.has(name));
  if(missingSheets.length)blockers.push('必須シート不足: '+missingSheets.join('、'));

  const employeeSheet=db.getSheetByName(DB.sheets.employees);
  const employeeRows=employeeSheet&&employeeSheet.getLastRow()>=2
    ? employeeSheet.getRange(2,1,employeeSheet.getLastRow()-1,23).getDisplayValues().filter(r=>r[0]&&r[6]==='在籍')
    : [];
  const activeAdmins=employeeRows.filter(r=>r[5]==='ADMIN');
  if(!activeAdmins.length)blockers.push('有効な管理者がいません');

  const missingPins=employeeRows.filter(r=>!r[14]);
  if(missingPins.length)blockers.push('PIN未設定 '+missingPins.length+'名');

  const support=getSupportConfig_();
  if(!support.email&&!support.phone)blockers.push('PIN再発行の連絡先が未設定です');

  const payrollCount=employeeRows.filter(r=>String(r[22]).toUpperCase()==='TRUE').length;
  if(!payrollCount)warnings.push('給与集計対象者が0名です');

  const calendar=getCompanyCalendarRange_(today,horizon);
  const expectedDays=Math.round((parseYmd_(horizon)-parseYmd_(today))/86400000)+1;
  if(calendar.length!==expectedDays){
    blockers.push('会社カレンダーが今後90日分そろっていません');
  }
  if(calendar.length&& !calendar.some(d=>d.type==='法定休日')){
    blockers.push('会社カレンダーに法定休日の明示指定がありません。就業規則に合わせて法定休日を設定してください');
  }

  const settingsSheet=db.getSheetByName(AUTH.settingsSheet);
  if(settingsSheet&&settingsSheet.getLastRow()>=2){
    const keys=settingsSheet.getRange(2,1,settingsSheet.getLastRow()-1,1).getDisplayValues().map(r=>r[0]).filter(Boolean);
    const seen=new Set(),duplicates=new Set();
    keys.forEach(k=>{if(seen.has(k))duplicates.add(k);else seen.add(k);});
    if(duplicates.size)warnings.push('設定キー重複: '+[...duplicates].join('、'));
  }

  const props=PropertiesService.getScriptProperties();
  const runtime=getRuntimeInfo_();
  if(runtime.environment!=='PRODUCTION')blockers.push('実行環境が'+runtime.environment+'です');
  if(runtime.environment==='PRODUCTION'&&runtime.usingDefaultStagingDb)blockers.push('PRODUCTION用DBが分離されていません');
  const triggerState=getDailyBackupTriggerState_();
  if(!triggerState.installed)blockers.push('日次バックアップの時間トリガーが未設定です');
  if(triggerState.count>1)warnings.push('日次バックアップの時間トリガーが重複しています');
  const lastBackup=String(props.getProperty(MAINTENANCE.lastBackupProperty)||'');
  const backupAt=parseTimestamp_(lastBackup);
  const backupAgeHours=backupAt?Math.floor((now-backupAt)/3600000):null;
  const backupVerified=props.getProperty(MAINTENANCE.lastBackupVerifiedProperty)==='true';
  if(!backupAt)warnings.push('バックアップがまだありません');
  else if(!backupVerified)blockers.push('最新バックアップの整合性確認が完了していません');
  else if(backupAgeHours>36)warnings.push('最終バックアップから36時間以上経過しています');

  const laborConfig=getLaborRuleConfig_();
  if(!laborConfig.configured)blockers.push('労務ルールが未確定です（就業規則・36協定の確認が必要）');

  const prototypeMode=isPrototypeConfigured_();
  const prototypeAccessEffective=isPrototypeMode_();
  if(prototypeMode)blockers.push('試作版共通PINモードが有効です');

  return {
    ready:blockers.length===0,
    prototypeMode:prototypeMode,
    prototypeAccessEffective:prototypeAccessEffective,
    environment:runtime.environment,
    backupTriggerInstalled:triggerState.installed,
    laborConfig:laborConfig,
    schemaStatus:schemaStatus,
    blockers:blockers,
    warnings:warnings,
    activeEmployees:employeeRows.length,
    activeAdmins:activeAdmins.length,
    pinConfigured:employeeRows.length-missingPins.length,
    payrollEmployees:payrollCount,
    calendarThrough:horizon,
    backupAgeHours:backupAgeHours,
    backupVerified:backupVerified
  };
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

function createManualBackup(sessionToken) {
  const admin = requireAdminSession_(sessionToken).employee;
  return withScriptLock_(function() {
    const result = createDatabaseBackup_(admin.name);
    appendAudit_({
      employeeId: admin.employeeId,
      employeeName: admin.name,
      operation: '手動バックアップ',
      target: 'FM WORKS DB',
      targetId: result.fileId,
      before: '',
      after: result.fileName,
      source: 'WEB',
      result: 'SUCCESS',
      note: ''
    });
    SpreadsheetApp.flush();
    return result;
  }, 30000);
}

function setDailyBackupEnabled(sessionToken, enabled) {
  const admin = requireAdminSession_(sessionToken).employee;
  const value = !!enabled;
  const props=PropertiesService.getScriptProperties();
  const before=props.getProperty(MAINTENANCE.autoBackupProperty);
  props.setProperty(MAINTENANCE.autoBackupProperty, String(value));
  if(value) installDailyBackupTrigger_(true);
  else removeDailyBackupTriggers_();
  appendAudit_({
    employeeId: admin.employeeId,
    employeeName: admin.name,
    operation: '自動バックアップ設定',
    target: '設定',
    targetId: 'AUTO_BACKUP',
    before: before===null?'既定:有効':before,
    after: value ? '有効 / 時間トリガー' : '無効',
    source: 'WEB',
    result: 'SUCCESS',
    note: value ? '毎日03時台' : '時間トリガー削除'
  });
  return getSystemStatus(sessionToken);
}

function isBackupDue_(lastBackupAt, today) {
  const last=String(lastBackupAt||'');
  return last.slice(0,10)!==String(today||'');
}

function getDailyBackupTriggerState_() {
  const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()===MAINTENANCE.backupTriggerHandler);
  return {installed:triggers.length===1,count:triggers.length};
}

function removeDailyBackupTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t=>t.getHandlerFunction()===MAINTENANCE.backupTriggerHandler)
    .forEach(t=>ScriptApp.deleteTrigger(t));
}

function installDailyBackupTrigger_(replaceExisting) {
  const state=getDailyBackupTriggerState_();
  if(state.installed&&!replaceExisting)return state;
  if(replaceExisting||state.count>1)removeDailyBackupTriggers_();
  ScriptApp.newTrigger(MAINTENANCE.backupTriggerHandler)
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .inTimezone(DB.timeZone)
    .create();
  return getDailyBackupTriggerState_();
}

function installDailyBackupTrigger(sessionToken) {
  const admin=requireAdminSession_(sessionToken).employee;
  const before=getDailyBackupTriggerState_();
  const after=installDailyBackupTrigger_(true);
  PropertiesService.getScriptProperties().setProperty(MAINTENANCE.autoBackupProperty,'true');
  appendAudit_({
    employeeId:admin.employeeId,employeeName:admin.name,operation:'バックアップ時間トリガー設定',
    target:'Apps Script Trigger',targetId:MAINTENANCE.backupTriggerHandler,
    before:JSON.stringify(before),after:JSON.stringify(after),source:'WEB',result:'SUCCESS',note:'毎日03時台'
  });
  return getSystemStatus(sessionToken);
}

function scheduledDailyMaintenance_() {
  const cleanedSessions=cleanupExpiredSessions_();
  const props=PropertiesService.getScriptProperties();
  const setting=props.getProperty(MAINTENANCE.autoBackupProperty);
  const enabled=setting===null?true:setting==='true';
  if(!enabled)return {ok:true,skipped:true,reason:'disabled',cleanedSessions:cleanedSessions};
  const today=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');
  const last=String(props.getProperty(MAINTENANCE.lastBackupProperty)||'');
  if(!isBackupDue_(last,today))return {ok:true,skipped:true,reason:'already-backed-up',cleanedSessions:cleanedSessions};
  return withScriptLock_(function(){
    const recheck=String(props.getProperty(MAINTENANCE.lastBackupProperty)||'');
    if(!isBackupDue_(recheck,today))return {ok:true,skipped:true,reason:'already-backed-up'};
    try{
      const result=createDatabaseBackup_('SYSTEM');
      appendAudit_({
        employeeId:'SYSTEM',employeeName:'SYSTEM',operation:'日次バックアップ',target:'FM WORKS DB',
        targetId:result.fileId,before:'',after:result.fileName,source:'TRIGGER',result:'SUCCESS',note:'毎日03時台'
      });
      SpreadsheetApp.flush();
      result.cleanedSessions=cleanedSessions;
      return result;
    }catch(err){
      try{
        appendAudit_({
          employeeId:'SYSTEM',employeeName:'SYSTEM',operation:'日次バックアップ',target:'FM WORKS DB',
          targetId:'',before:'',after:'',source:'TRIGGER',result:'ERROR',note:String(err&&err.message?err.message:err)
        });
      }catch(_){}
      throw err;
    }
  },30000);
}

function ensureDailyBackup(sessionToken) {
  const admin = requireAdminSession_(sessionToken).employee;
  const props = PropertiesService.getScriptProperties();
  const setting = props.getProperty(MAINTENANCE.autoBackupProperty);
  const enabled = setting === null ? true : setting === 'true';
  if (!enabled) return { ok:true, skipped:true, reason:'disabled' };

  const today = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  const last = String(props.getProperty(MAINTENANCE.lastBackupProperty) || '');
  if (last.slice(0,10) === today) return { ok:true, skipped:true, reason:'already-backed-up' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok:true, skipped:true, reason:'busy' };
  try {
    const recheck = String(props.getProperty(MAINTENANCE.lastBackupProperty) || '');
    if (recheck.slice(0,10) === today) return { ok:true, skipped:true, reason:'already-backed-up' };
    const result = createDatabaseBackup_(admin.name);
    appendAudit_({
      employeeId: admin.employeeId,
      employeeName: admin.name,
      operation: '日次バックアップ',
      target: 'FM WORKS DB',
      targetId: result.fileId,
      before: '',
      after: result.fileName,
      source: 'WEB',
      result: 'SUCCESS',
      note: '管理者利用時の自動バックアップ'
    });
    return result;
  } finally {
    lock.releaseLock();
  }
}

function spreadsheetShape_(spreadsheet) {
  return spreadsheet.getSheets().map(sheet=>({
    name:sheet.getName(),
    rows:sheet.getLastRow(),
    columns:sheet.getLastColumn()
  })).sort((a,b)=>a.name.localeCompare(b.name));
}

function compareBackupShape_(sourceShape, backupShape) {
  const expected=Object.fromEntries((sourceShape||[]).map(x=>[x.name,x]));
  const actual=Object.fromEntries((backupShape||[]).map(x=>[x.name,x]));
  const issues=[];
  Object.keys(expected).sort().forEach(name=>{
    if(!actual[name]){issues.push('missing:'+name);return;}
    if(Number(actual[name].rows)!==Number(expected[name].rows))issues.push('rows:'+name);
    if(Number(actual[name].columns)!==Number(expected[name].columns))issues.push('columns:'+name);
  });
  Object.keys(actual).sort().forEach(name=>{if(!expected[name])issues.push('unexpected:'+name);});
  return issues;
}

function verifyDatabaseBackupCopy_(copyId, sourceShape) {
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const backup=SpreadsheetApp.openById(copyId);
      const backupShape=spreadsheetShape_(backup);
      const issues=compareBackupShape_(sourceShape,backupShape);
      if(!issues.length)return {ok:true,sheetCount:backupShape.length};
      lastError=new Error('バックアップ形状不一致: '+issues.slice(0,8).join(' / '));
    }catch(err){lastError=err;}
    Utilities.sleep(300*(attempt+1));
  }
  throw lastError||new Error('バックアップの整合性を確認できませんでした。');
}

function createDatabaseBackup_(actor) {
  const db = getDb_();
  const now = new Date();
  const stamp = Utilities.formatDate(now, DB.timeZone, 'yyyyMMdd_HHmmss');
  const name = 'FM_WORKS_DB_BACKUP_' + stamp;
  const folder = getOrCreateBackupFolder_();
  const sourceShape=spreadsheetShape_(db);
  const props=PropertiesService.getScriptProperties();
  props.setProperty(MAINTENANCE.lastBackupVerifiedProperty,'false');
  const copy = DriveApp.getFileById(db.getId()).makeCopy(name, folder);
  let verification;
  try{
    verification=verifyDatabaseBackupCopy_(copy.getId(),sourceShape);
  }catch(err){
    try{copy.setTrashed(true);}catch(_){}
    throw err;
  }

  props.setProperty(MAINTENANCE.lastBackupProperty,toTimestamp_(now));
  props.setProperty(MAINTENANCE.lastBackupVerifiedProperty,'true');

  cleanupOldBackups_(folder, now);
  return {
    ok: true,
    verified: true,
    sheetCount: verification.sheetCount,
    fileId: copy.getId(),
    fileName: copy.getName(),
    createdAt: toTimestamp_(now),
    actor: actor || 'SYSTEM'
  };
}

function getOrCreateBackupFolder_() {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty(MAINTENANCE.backupFolderProperty);
  if (stored) {
    try { return DriveApp.getFolderById(stored); }
    catch (e) { console.warn('Stored backup folder unavailable', e); }
  }

  const existing = DriveApp.getFoldersByName('FM WORKS Backups');
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder('FM WORKS Backups');
  props.setProperty(MAINTENANCE.backupFolderProperty, folder.getId());
  return folder;
}

function cleanupOldBackups_(folder, now) {
  const cutoff = new Date(now.getTime() - MAINTENANCE.backupRetentionDays * 86400000);
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (!/^FM_WORKS_DB_BACKUP_/.test(file.getName())) continue;
    if (file.getDateCreated() < cutoff) {
      try { file.setTrashed(true); }
      catch (e) { console.warn('Old backup cleanup failed', e); }
    }
  }
}
