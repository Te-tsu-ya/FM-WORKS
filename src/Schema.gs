const DB_SCHEMA_VERSION = 11;

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
  '見積採番': ['ベンダーコード','最終発行末尾番号','既存番号確認','更新日時','更新者ID']
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

function assertDatabaseMigrationSafe_(db){
  // Prevent partial creation/extension when any existing nonempty header disagrees.
  const issues=[];
  Object.keys(DB_SCHEMA_SPECS).forEach(name=>{
    const sheet=db.getSheetByName(name);
    if(!sheet)return;
    const expected=DB_SCHEMA_SPECS[name];
    const actual=sheet.getRange(1,1,1,expected.length).getDisplayValues()[0];
    schemaHeaderIssues_(actual,expected).forEach(issue=>{
      if(String(issue.actual||'').trim())
        issues.push(name+' '+issue.column+'列 ('+issue.actual+' / '+issue.expected+')');
    });
  });
  if(issues.length)throw new Error('既存シートの列名が一致しないためDB更新を中止しました。変更せず管理者へ確認してください: '+issues.slice(0,8).join('; '));
}
function migrateDatabaseToCurrent(sessionToken){
  const admin=requireAdminSession_(sessionToken).employee;
  return withScriptLock_(function(){
    const before=getDatabaseSchemaStatus_();
    if(before.ready)return {ok:true,changed:false,before,after:before,backup:null};
    assertDatabaseMigrationSafe_(getDb_());
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
