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
