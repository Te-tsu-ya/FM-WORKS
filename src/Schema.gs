const DB_SCHEMA_VERSION = 9;

const DB_SCHEMA_SPECS = Object.freeze({
  '社員マスタ': [
    '社員ID','氏名','表示名','部署','役職','権限','在籍状況','標準勤務開始','標準勤務終了','標準休憩分',
    '有給残日数','メール','備考','PINソルト','PINハッシュ','PIN変更必須','ログイン失敗回数','ロック期限',
    '最終ログイン日時','PIN更新日時','認証状態','権限詳細','給与集計対象','直属承認者ID','年休基準日','雇入日'
  ],
  '申請': [
    '申請ID','申請日','社員ID','氏名','申請種別','開始日','終了日','内容','理由','状態','承認者','承認日時','差戻し理由','登録日時',
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
  '有給台帳': ['台帳ID','社員ID','氏名','基準日','取引日','種別','日数','残日数','関連申請ID','処理者ID','処理者名','処理日時','備考']
});

function schemaHeaderIssues_(actual,expected){
  const issues=[];
  (expected||[]).forEach((value,index)=>{
    const got=String((actual||[])[index]||'');
    if(got!==String(value))issues.push({column:index+1,expected:String(value),actual:got});
  });
  return issues;
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
    const actual=sheet.getRange(1,1,1,Math.max(expected.length,1)).getDisplayValues()[0];
    const headerIssues=schemaHeaderIssues_(actual,expected);
    sheets[name]={exists:true,ready:headerIssues.length===0,columns:sheet.getMaxColumns(),issues:headerIssues};
    headerIssues.forEach(i=>issues.push(name+' '+i.column+'列: '+(i.actual||'空欄')+' → '+i.expected));
  });
  if(version!==DB_SCHEMA_VERSION)issues.unshift('DB_VERSION '+version+' → '+DB_SCHEMA_VERSION);
  return {version,expectedVersion:DB_SCHEMA_VERSION,ready:issues.length===0,issues,sheets};
}

function ensureSchemaSheet_(db,name,headers){
  let sheet=db.getSheetByName(name);
  if(!sheet)sheet=db.insertSheet(name);
  const missingColumns=headers.length-sheet.getMaxColumns();
  if(missingColumns>0)sheet.insertColumnsAfter(sheet.getMaxColumns(),missingColumns);
  const actual=sheet.getRange(1,1,1,headers.length).getDisplayValues()[0];
  actual.forEach((value,index)=>{
    if(value&&value!==headers[index])throw new Error(name+' '+(index+1)+'列の見出しが想定外です: '+value+' / expected '+headers[index]);
  });
  const merged=headers.map((value,index)=>actual[index]||value);
  sheet.getRange(1,1,1,headers.length).setValues([merged]);
  sheet.setFrozenRows(1);
  return sheet;
}

function migrateDatabaseToCurrent(sessionToken){
  const admin=requireAdminSession_(sessionToken).employee;
  return withScriptLock_(function(){
    const before=getDatabaseSchemaStatus_();
    if(before.ready)return {ok:true,changed:false,before,after:before,backup:null};
    const backup=createDatabaseBackup_(admin);
    const db=getDb_();
    Object.keys(DB_SCHEMA_SPECS).forEach(name=>ensureSchemaSheet_(db,name,DB_SCHEMA_SPECS[name]));
    saveSettings_({DB_VERSION:String(DB_SCHEMA_VERSION)});
    SpreadsheetApp.flush();
    const after=getDatabaseSchemaStatus_();
    if(!after.ready)throw new Error('DB更新後もスキーマ不整合が残っています: '+after.issues.join(' / '));
    appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation:'DBスキーマ更新',target:'Database',targetId:String(DB_SCHEMA_VERSION),
      before:auditJson_({version:before.version,issues:before.issues}),after:auditJson_({version:after.version,issues:after.issues}),
      source:'WEB',result:'SUCCESS',note:backup&&backup.name||''});
    return {ok:true,changed:true,before,after,backup:backup||null};
  },30000);
}
