function managerAssignmentCreatesCycle_(employeeId, managerId, managerByEmployee) {
  const employee=String(employeeId||'').trim().toUpperCase();
  let current=String(managerId||'').trim().toUpperCase();
  if(!employee||!current)return false;
  const seen=new Set();
  while(current){
    if(current===employee)return true;
    if(seen.has(current))return true;
    seen.add(current);
    current=String((managerByEmployee&&managerByEmployee[current])||'').trim().toUpperCase();
  }
  return false;
}

function getEmployeeManagerMap_() {
  const sheet=getDb_().getSheetByName(DB.sheets.employees);
  const lastRow=sheet.getLastRow();
  if(lastRow<2)return {};
  const map={};
  sheet.getRange(2,1,lastRow-1,24).getDisplayValues().forEach(r=>{if(r[0])map[r[0]]=r[23]||'';});
  return map;
}

function assertManagerAssignmentAcyclic_(employeeId, managerId) {
  if(!managerId)return;
  const map=getEmployeeManagerMap_();
  map[String(employeeId||'').trim().toUpperCase()]=String(managerId||'').trim().toUpperCase();
  if(managerAssignmentCreatesCycle_(employeeId,managerId,map)){
    throw new Error('直属承認者の設定が循環しています。承認経路を確認してください。');
  }
}

function getActiveDirectReports_(managerId) {
  const id=String(managerId||'').trim().toUpperCase();
  if(!id)return [];
  const sheet=getDb_().getSheetByName(DB.sheets.employees);
  return readRowsByColumnValues_(sheet,24,24,[id],true)
    .filter(r=>r[0]&&r[6]==='在籍'&&String(r[23]||'').toUpperCase()===id)
    .map(r=>({employeeId:r[0],name:r[1]||r[0]}));
}

function assertManagerRoleChangeSafe_(employeeId, nextRole, nextActive) {
  if(nextActive&&['MANAGER','ADMIN'].includes(String(nextRole||'').toUpperCase()))return;
  const reports=getActiveDirectReports_(employeeId);
  if(reports.length){
    throw new Error('この社員には直属部下がいます。先に直属承認者を変更してください: '+reports.slice(0,8).map(r=>r.name).join('、')+(reports.length>8?' ほか'+(reports.length-8)+'名':''));
  }
}

function saveEmployee(sessionToken, payload) {
  const admin = requireAdminSession_(sessionToken).employee;
  payload = payload || {};

  return withScriptLock_(function() {
    const employeeId = String(payload.employeeId || '').trim().toUpperCase();
    if (!/^FM\d{4,6}$/.test(employeeId)) throw new Error('社員IDは FM0001 のような形式で入力してください。');

    const name = safeSheetText_(payload.name, 100);
    if (!name) throw new Error('氏名を入力してください。');
    const displayName = safeSheetText_(payload.displayName || name, 80);
    const department = safeSheetText_(payload.department, 80);
    const title = safeSheetText_(payload.title, 80);
    const allowedRoles = ['USER','CALENDAR_EDITOR','MANAGER','ADMIN'];
    const role = allowedRoles.includes(payload.role) ? payload.role : 'USER';
    const status = payload.active === false ? '退職' : '在籍';

    const workStart = normalizeTime_(payload.workStart || '09:00');
    const workEnd = normalizeTime_(payload.workEnd || '18:00');
    if (workStart >= workEnd) throw new Error('標準勤務終了時刻は開始時刻より後に設定してください。');

    const totalMinutes = timeRangeMinutes_(workStart, workEnd);
    const breakMinutes = Math.max(0,Math.min(480,Number(payload.breakMinutes||60)));
    if (breakMinutes >= totalMinutes) throw new Error('標準休憩時間は勤務時間より短く設定してください。');

    const leaveText = String(payload.leaveBalance == null ? '' : payload.leaveBalance).trim();
    let leaveBalance = '';
    if (leaveText !== '') {
      const parsedLeave = Number(leaveText);
      if (!Number.isFinite(parsedLeave) || parsedLeave < 0 || parsedLeave > 999) throw new Error('有給残日数を確認してください。');
      leaveBalance = Math.round(parsedLeave * 4) / 4;
    }
    const email = String(payload.email || '').trim().slice(0,200);
    if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      throw new Error('メールアドレスの形式を確認してください。');
    }
    const note = safeSheetText_(payload.note, 500);
    const payrollIncluded = !!payload.payrollIncluded;
    const managerId = String(payload.managerId || '').trim().toUpperCase();
    const leaveBasisDate = payload.leaveBasisDate ? normalizeDate_(payload.leaveBasisDate) : '';
    const hireDate = payload.hireDate ? normalizeDate_(payload.hireDate) : '';
    if (managerId === employeeId) throw new Error('自分自身を直属承認者には設定できません。');
    if (managerId) {
      const manager = getEmployeeAuthRecord_(managerId);
      if (!manager || !manager.active) throw new Error('直属承認者が在籍社員として見つかりません。');
      if (!['MANAGER','ADMIN'].includes(String(manager.role || '').toUpperCase())) throw new Error('直属承認者にはマネージャーまたは管理者を指定してください。');
      assertManagerAssignmentAcyclic_(employeeId,managerId);
    }

    const existingBefore = getEmployeeAuthRecord_(employeeId);
    const oldPolicy=leaveAutoPolicy_(employeeId);
    const autoEnabled=Object.prototype.hasOwnProperty.call(payload,'autoLeaveEnabled')?
      payload.autoLeaveEnabled===true:oldPolicy.enabled;
    if(autoEnabled&&!hireDate)throw new Error('年休自動付与には入社日を設定してください。');
    const currentState=existingBefore?getLeaveLedgerState_(existingBefore):null;
    if(existingBefore&&Object.prototype.hasOwnProperty.call(payload,'expectedLeaveBalance')){
      const wanted=String(payload.expectedLeaveBalance==null?'':payload.expectedLeaveBalance);
      const actual=currentState&&currentState.configured?String(currentState.balance):'';
      if(wanted!==actual)throw new Error('有給残日数が他の操作で更新されました。社員情報を再読込してください。');
    }
    if (leaveText !== '' && !leaveBasisDate) throw new Error('有給残日数を設定する場合は年休基準日も設定してください。');
    if (existingBefore && existingBefore.leaveBalanceConfigured && leaveText === '') {
      throw new Error('有給台帳運用開始後は残日数を未設定へ戻せません。調整値を入力してください。');
    }
    if (existingBefore) assertManagerRoleChangeSafe_(employeeId,role,status==='在籍');
    if (existingBefore && existingBefore.employeeId === admin.employeeId && (role !== 'ADMIN' || status !== '在籍')) {
      throw new Error('自分自身の管理者権限解除・無効化はできません。別の管理者から変更してください。');
    }
    if (existingBefore && existingBefore.role === 'ADMIN' && existingBefore.active && (role !== 'ADMIN' || status !== '在籍')) {
      assertAnotherActiveAdmin_(employeeId);
    }

    const sheet = getDb_().getSheetByName(DB.sheets.employees);
    const lastRow = sheet.getLastRow();
    let rowNumber = 0;
    if (lastRow >= 2) {
      const found = sheet.getRange(2,1,lastRow-1,1).createTextFinder(employeeId).matchEntireCell(true).findNext();
      if (found) rowNumber=found.getRow();
    }

    const isNew = !rowNumber;
    const existingEmployee = !isNew ? existingBefore : null;
    if (isNew) rowNumber=Math.max(2,lastRow+1);
    const existingAuth = isNew ? Array(9).fill('') : sheet.getRange(rowNumber,14,1,9).getValues()[0];
    existingAuth[7] = status === '在籍'
      ? (String(existingAuth[7] || '').toUpperCase() === 'DISABLED' ? 'ACTIVE' : (existingAuth[7] || 'ACTIVE'))
      : 'DISABLED';

    sheet.getRange(rowNumber,1,1,26).setValues([[
      employeeId,name,displayName,department,title,role,status,workStart,workEnd,
      breakMinutes,leaveBalance,email,note,...existingAuth,payrollIncluded,managerId,leaveBasisDate,hireDate
    ]]);
    invalidateEmployeeDirectoryCache_();

    recordLeaveBalanceAdminChange_(
      employeeId,name,leaveBasisDate,
      !!(existingBefore&&existingBefore.leaveBalanceConfigured),
      existingBefore?existingBefore.leaveBalance:0,
      leaveText!=='',leaveBalance,admin
    );
    if(autoEnabled!==oldPolicy.enabled)storeLeaveAutoPolicy_(employeeId,autoEnabled,hireDate,admin);
    if(autoEnabled)reconcileLeaveUnlocked_(getEmployee_(employeeId),Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'));

    if (existingEmployee && existingEmployee.active && status !== '在籍') {
      invalidateEmployeeSessions_(employeeId, 0);
    }

    appendAudit_({
      employeeId:admin.employeeId,employeeName:admin.name,operation:isNew?'社員追加':'社員更新',
      target:'社員マスタ',targetId:employeeId,
      before:existingEmployee ? auditJson_({
        name:existingEmployee.name,displayName:existingEmployee.displayName,department:existingEmployee.department,title:existingEmployee.title,
        role:existingEmployee.role,status:existingEmployee.active?'在籍':'退職',workStart:existingEmployee.workStart,workEnd:existingEmployee.workEnd,
        breakMinutes:existingEmployee.breakMinutes,leaveBalance:existingEmployee.leaveBalanceConfigured?existingEmployee.leaveBalance:null,
        email:existingEmployee.email,payrollIncluded:!!existingEmployee.payrollIncluded,managerId:existingEmployee.managerId||'',
        leaveBasisDate:existingEmployee.leaveBasisDate||'',hireDate:existingEmployee.hireDate||'',autoLeaveEnabled:oldPolicy.enabled
      }) : '',
      after:auditJson_({name:name,displayName:displayName,department:department,title:title,role:role,status:status,workStart:workStart,workEnd:workEnd,
        breakMinutes:breakMinutes,leaveBalance:leaveText!==''?leaveBalance:null,email:email,payrollIncluded:payrollIncluded,managerId:managerId,
        leaveBasisDate:leaveBasisDate,hireDate:hireDate,autoLeaveEnabled:autoEnabled}),
      source:'WEB',result:'SUCCESS',note:''
    });
    SpreadsheetApp.flush();
    return {ok:true,employeeId:employeeId};
  });
}

function setEmployeeActiveState(sessionToken, employeeId, active) {
  const admin = requireAdminSession_(sessionToken).employee;
  return withScriptLock_(function() {
    const target = getEmployeeAuthRecord_(employeeId);
    if (!target) throw new Error('社員が見つかりません。');
    if (target.employeeId === admin.employeeId && !active) throw new Error('自分自身を無効化することはできません。');
    if(!active)assertManagerRoleChangeSafe_(target.employeeId,target.role,false);
    if (target.role === 'ADMIN' && target.active && !active) assertAnotherActiveAdmin_(target.employeeId);

    const sheet=getDb_().getSheetByName(DB.sheets.employees);
    sheet.getRange(target.rowNumber,7).setValue(active?'在籍':'退職');
    sheet.getRange(target.rowNumber,21).setValue(active?'ACTIVE':'DISABLED');
    invalidateEmployeeDirectoryCache_();
    if(!active) invalidateEmployeeSessions_(target.employeeId,0);

    appendAudit_({
      employeeId:admin.employeeId,employeeName:admin.name,operation:active?'社員有効化':'社員無効化',
      target:'社員マスタ',targetId:target.employeeId,before:target.active?'在籍':'退職',after:active?'在籍':'退職',
      source:'WEB',result:'SUCCESS',note:target.name
    });
    SpreadsheetApp.flush();
    return {ok:true};
  });
}

function assertAnotherActiveAdmin_(excludeEmployeeId) {
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('管理者を最低1名残す必要があります。');
  const admins = sheet.getRange(2,1,lastRow-1,7).getDisplayValues()
    .filter(r => r[0] !== excludeEmployeeId && r[5] === 'ADMIN' && r[6] === '在籍');
  if (!admins.length) throw new Error('管理者を最低1名残す必要があります。');
}



const AUTO_LEAVE_DAYS=Object.freeze([10,11,12,14,16,18,20]);
const AUTO_LEAVE_PREFIX='FM_AUTO_LEAVE_V1_';
function leaveDueAtIndex_(hire,index){
  // Reject impossible hire dates instead of calculating an entitlement from corrupt data.
  let validHire;
  try{validHire=normalizeDate_(hire);}catch(_){return '';}
  const [y,m,d]=validHire.split('-').map(Number),i=Number(index);
  if(!Number.isInteger(i)||i<0||i>80)return '';
  const mon=m+5+12*i,Y=y+Math.floor(mon/12),M=((mon%12)+12)%12;
  const D=Math.min(d,new Date(Date.UTC(Y,M+1,0)).getUTCDate());
  return [Y,String(M+1).padStart(2,'0'),String(D).padStart(2,'0')].join('-');
}
function leaveEntitlement_(hire,asOf){
  let validHire,validAsOf;
  try{
    validHire=normalizeDate_(hire);
    validAsOf=normalizeDate_(asOf);
  }catch(_){return null;}
  if(!leaveDueAtIndex_(validHire,0))return null;
  let due=null,next=null;
  for(let i=0;i<=80;i++){
    const date=leaveDueAtIndex_(validHire,i);
    const part={index:i,date,days:AUTO_LEAVE_DAYS[Math.min(i,6)],
      from:i===0?validHire:leaveDueAtIndex_(validHire,i-1),through:addDateString_(date,-1)};
    if(date<=validAsOf)due=part;else{next=part;break;}
  }
  return {due,next};
}
function leaveAutoPolicy_(id){
  try{
    const p=JSON.parse(String(getSettingsMap_()[AUTO_LEAVE_PREFIX+String(id).toUpperCase()]||'{}'));
    return {enabled:p.enabled===true&&p.category==='STANDARD',from:String(p.from||''),confirmedBy:p.confirmedBy||''};
  }catch(_){return {enabled:false,from:'',confirmedBy:''};}
}
function storeLeaveAutoPolicy_(employeeId,enabled,hireDate,admin,today){
  const id=String(employeeId||'').toUpperCase(),prev=leaveAutoPolicy_(id);
  if(enabled&&!hireDate)throw new Error('入社日を設定してから年休自動付与を有効にしてください。');
  const now=today||Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');
  saveSettings_({[AUTO_LEAVE_PREFIX+id]:JSON.stringify({
    enabled:!!enabled,category:enabled?'STANDARD':'MANUAL',
    from:enabled&&prev.enabled&&prev.from?prev.from:now,confirmedBy:admin.employeeId
  })});
  appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,
    operation:enabled?'年休自動管理を有効化':'年休自動管理を停止',
    target:'社員マスタ',targetId:id,before:prev.enabled?'有効':'無効',
    after:enabled?'有効':'無効',source:'WEB',result:'SUCCESS',note:'履歴の遡及付与は行わない'});
}
function leaveAttendanceEvidence_(employee,part){
  const calendar=getCompanyCalendarRange_(part.from,part.through);
  if(calendar.length!==dateSpanDays_(part.from,part.through))
    return {verified:false,reason:'会社カレンダーが不足しています。'};
  const work=new Set(calendar.filter(x=>x.working===true).map(x=>x.date));
  if(!work.size)return {verified:false,reason:'勤務日が確認できません。'};
  const attended=new Set();
  getActivePunchRows_(employee.employeeId,part.from,part.through)
    .forEach(r=>{if(work.has(r[3])&&['出勤','退勤','直行','直帰'].includes(String(r[4]||'')))attended.add(r[3]);});
  getRequestsForEmployee_(employee.employeeId).forEach(r=>{
    if(!['承認済','取消申請中'].includes(r.status)||!['有給','午前半休','午後半休','1/4日有給'].includes(r.type))return;
    const first=r.startDate>part.from?r.startDate:part.from,end=r.endDate<part.through?r.endDate:part.through;
    for(let d=first;d<=end;d=addDateString_(d,1))if(work.has(d))attended.add(d);
  });
  const rate=attended.size/work.size;
  return {verified:rate>=.8,rate:Math.round(rate*1000)/10,
    expected:work.size,attended:attended.size,
    reason:rate>=.8?'':'出勤率80％を記録だけで確認できません。産休・育休・労災休業などは管理者が別途確認してください。'};
}
function leaveAutoAlreadyGranted_(employee,part,rows){
  return String(employee.leaveBasisDate||'')>=part.date||
    (rows||getLeaveLedgerRows_(employee.employeeId)).some(r=>r.transactionDate===part.date&&['GRANT','OPENING'].includes(r.type));
}
// Due dates preceding the current year remain reviewable, not silently forgotten.
// Years missed since activation cannot be blindly credited because rights may have expired.
function leaveAutoEarlierMissing_(employee,plan,policy,rows){
  if(!policy.enabled||!plan||!plan.due)return [];
  const entries=rows||getLeaveLedgerRows_(employee.employeeId),missing=[];
  for(let i=0;i<plan.due.index;i++){
    const date=leaveDueAtIndex_(employee.hireDate,i);
    if(!date||date<policy.from)continue;
    if(entries.some(r=>r.transactionDate===date&&['GRANT','OPENING'].includes(r.type)))continue;
    missing.push({date,days:AUTO_LEAVE_DAYS[Math.min(i,6)]});
  }
  return missing;
}
function leaveAutoForecast_(employee,today){
  const policy=leaveAutoPolicy_(employee.employeeId),plan=leaveEntitlement_(employee.hireDate,today);
  if(!plan)return {status:'NO_HIRE_DATE',enabled:policy.enabled,message:'入社日が未設定です。'};
  const next=plan.next,base={enabled:policy.enabled,nextDate:next&&next.date||'',nextDays:next&&next.days||null};
  if(!policy.enabled)return {...base,status:'DISABLED',message:'自動付与は無効です。'};
  if(!plan.due||plan.due.date<policy.from)return {...base,status:'SCHEDULED',message:'次回の付与を待っています。過去分は自動加算しません。'};
  const rows=getLeaveLedgerRows_(employee.employeeId),prior=leaveAutoEarlierMissing_(employee,plan,policy,rows);
  if(prior.length)return {...base,status:'REVIEW',dueDate:prior[0].date,dueDays:prior[0].days,
    overdueCount:prior.length,message:'過年度に付与記録のない期間があります。過去分は自動加算せず管理者が履歴を確認してください。'};
  const granted=leaveAutoAlreadyGranted_(employee,plan.due,rows);
  return {...base,dueDate:plan.due.date,dueDays:plan.due.days,
    status:granted?'GRANTED':'REVIEW',
    message:granted?'今回分の付与記録があります。':'出勤率や会社カレンダーの確認が必要です。'};
}
function repairAnnualLeaveMaster_(employee,part,rows){
  const ledgerRows=rows||getLeaveLedgerRows_(employee.employeeId);
  const autoGrant=ledgerRows.some(r=>r.type==='GRANT'&&r.transactionDate===part.date&&String(r.note||'').startsWith('AUTO_LEAVE_V1|'));
  if(!autoGrant)return false;
  const latest=ledgerRows[ledgerRows.length-1];
  if(!latest)return false;
  const needBalance=!employee.leaveBalanceConfigured||Number(employee.leaveBalance)!==Number(latest.balance);
  const needDate=String(employee.leaveBasisDate||'')<part.date;
  if(!needBalance&&!needDate)return false;
  const sheet=getDb_().getSheetByName(DB.sheets.employees);
  if(needBalance)sheet.getRange(employee.rowNumber,11).setValue(Number(latest.balance));
  if(needDate)sheet.getRange(employee.rowNumber,25).setValue(part.date);
  invalidateEmployeeDirectoryCache_();
  appendAudit_({employeeId:'SYSTEM',employeeName:'年休自動付与',
    operation:'年休台帳と社員残数の同期',target:'社員マスタ',targetId:employee.employeeId,
    before:String(employee.leaveBalance),after:String(latest.balance),source:'SYSTEM',result:'SUCCESS',note:part.date});
  SpreadsheetApp.flush();
  return true;
}
function reconcileLeaveUnlocked_(employee,today){
  const policy=leaveAutoPolicy_(employee.employeeId),plan=leaveEntitlement_(employee.hireDate,today),part=plan&&plan.due;
  if(!employee.active||!policy.enabled||!part||part.date<policy.from)return {granted:false,reason:'NOT_APPLICABLE'};
  const posted=getLeaveLedgerRows_(employee.employeeId);
  if(leaveAutoAlreadyGranted_(employee,part,posted)){
    const repaired=repairAnnualLeaveMaster_(employee,part,posted);
    return {granted:false,reason:'ALREADY_GRANTED',repaired};
  }
  const evidence=leaveAttendanceEvidence_(employee,part);
  if(!evidence.verified)return {granted:false,reason:'ATTENDANCE_REVIEW',evidence,part};
  const initial=getLeaveLedgerState_(employee),actor={employeeId:'SYSTEM',name:'年休自動付与'};
  if(initial.configured&&initial.source!=='LEDGER'){
    if(!employee.leaveBasisDate)return {granted:false,reason:'BASE_DATE_MISSING'};
    ensureLeaveLedgerOpening_(employee,actor);
  }
  const current=getLeaveLedgerState_(employee),before=current.configured?current.balance:0,
    next=leaveBalanceAfterDelta_(before,part.days);
  appendLeaveLedgerRow_(employee,part.date,part.date,'GRANT',part.days,next,'',actor,
    'AUTO_LEAVE_V1|'+part.date+'|出勤率 '+evidence.rate+'%');
  const master=getDb_().getSheetByName(DB.sheets.employees);
  master.getRange(employee.rowNumber,11).setValue(next);
  master.getRange(employee.rowNumber,25).setValue(part.date);
  invalidateEmployeeDirectoryCache_();
  appendAudit_({employeeId:'SYSTEM',employeeName:'年休自動付与',operation:'法定年休自動付与',
    target:'有給台帳',targetId:employee.employeeId,before:String(before),after:String(next),
    source:'SYSTEM',result:'SUCCESS',note:part.date+' '+part.days+'日'});
  SpreadsheetApp.flush();
  return {granted:true,date:part.date,days:part.days,balance:next};
}
function maybeReconcileLeave_(employeeId,asOf,verifiedEmployee){
  // Only reuse a fresh employee verified earlier by requireSession_.
  const employee=verifiedEmployee&&String(verifiedEmployee.employeeId)===String(employeeId)
    ?verifiedEmployee:getEmployee_(employeeId);
  const today=asOf||Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'),
    policy=leaveAutoPolicy_(employeeId),plan=leaveEntitlement_(employee.hireDate,today),part=plan&&plan.due;
  if(!employee.active||!policy.enabled||!part||part.date<policy.from)return {granted:false};
  const ledger=getLeaveLedgerRows_(employee.employeeId),recorded=leaveAutoAlreadyGranted_(employee,part,ledger);
  if(recorded){
    const auto=ledger.some(r=>r.type==='GRANT'&&r.transactionDate===part.date&&String(r.note||'').startsWith('AUTO_LEAVE_V1|'));
    if(!auto)return {granted:false};
    const latest=ledger[ledger.length-1];
    if(latest&&employee.leaveBalanceConfigured&&Number(employee.leaveBalance)===Number(latest.balance)&&
      String(employee.leaveBasisDate||'')>=part.date)return {granted:false};
  }
  return withScriptLock_(()=>reconcileLeaveUnlocked_(getEmployee_(employeeId),today));
}


function normalizeLeaveDays_(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('有給日数を確認してください。');
  return Math.round(n * 4) / 4;
}

function leaveBalanceAfterDelta_(currentBalance, delta) {
  const current = normalizeLeaveDays_(currentBalance || 0);
  const change = normalizeLeaveDays_(delta || 0);
  const next = normalizeLeaveDays_(current + change);
  if (next < 0) throw new Error('有給残日数が不足しています。');
  return next;
}

function getLeaveLedgerRows_(employeeId) {
  const sheet = getDb_().getSheetByName(DB.sheets.leaveLedger);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return readRowsByColumnValues_(sheet,2,13,[employeeId])
    .filter(r => r[0])
    .map(r => ({
      ledgerId:r[0], employeeId:r[1], name:r[2], basisDate:r[3], transactionDate:r[4],
      type:r[5], days:Number(r[6]||0), balance:Number(r[7]||0), requestId:r[8]||'',
      actorId:r[9]||'', actorName:r[10]||'', processedAt:r[11]||'', note:r[12]||''
    }));
}

function getLeaveLedgerState_(employee) {
  const rows = getLeaveLedgerRows_(employee.employeeId);
  if (rows.length) {
    const last = rows[rows.length-1];
    return {configured:true,balance:Number(last.balance||0),basisDate:last.basisDate||employee.leaveBasisDate||'',source:'LEDGER',entries:rows.length};
  }
  return {
    configured:!!employee.leaveBalanceConfigured,
    balance:employee.leaveBalanceConfigured?Number(employee.leaveBalance||0):null,
    basisDate:employee.leaveBasisDate||'',
    source:employee.leaveBalanceConfigured?'LEGACY':'NONE',
    entries:0
  };
}

function appendLeaveLedgerRow_(employee, basisDate, transactionDate, type, days, balance, requestId, actor, note) {
  const sheet=getDb_().getSheetByName(DB.sheets.leaveLedger);
  if(!sheet)throw new Error('有給台帳シートがありません。DB更新を実行してください。');
  const nowText=toTimestamp_(new Date());
  sheet.appendRow([
    createId_('L'), employee.employeeId, employee.name, basisDate||'', transactionDate||Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'),
    type, normalizeLeaveDays_(days), normalizeLeaveDays_(balance), requestId||'',
    actor&&actor.employeeId||'', actor&&actor.name||'', nowText, safeSheetText_(note,500)
  ]);
}

function ensureLeaveLedgerOpening_(employee, actor) {
  const state=getLeaveLedgerState_(employee);
  if(state.source==='LEDGER')return state;
  if(!state.configured)throw new Error('有給残日数が未設定です。');
  if(!employee.leaveBasisDate)throw new Error('年休基準日が未設定です。社員設定で基準日を登録してください。');
  appendLeaveLedgerRow_(employee,employee.leaveBasisDate,employee.leaveBasisDate,'OPENING',state.balance,state.balance,'',actor,'既存残数を有給台帳へ移行');
  return {configured:true,balance:state.balance,basisDate:employee.leaveBasisDate,source:'LEDGER',entries:1};
}


function findLeaveLedgerRequestPosting_(employeeId,requestId,type) {
  if(!requestId)return null;
  return getLeaveLedgerRows_(employeeId)
    .find(r=>r.requestId===requestId&&r.type===type)||null;
}
function syncLeaveMasterFromLedger_(employee) {
  const state=getLeaveLedgerState_(employee);
  if(!state.configured)throw new Error('有給台帳の残日数が確認できません。管理者へ連絡してください。');
  // If the posting succeeded but the employee-master write previously failed,
  // repair from the latest ledger balance, not a potentially outdated posting.
  getDb_().getSheetByName(DB.sheets.employees).getRange(employee.rowNumber,11).setValue(state.balance);
  return state.balance;
}

function consumeLeaveBalance_(employee, days, requestId, actor) {
  const amount=normalizeLeaveDays_(days);
  const previous=findLeaveLedgerRequestPosting_(employee.employeeId,requestId,'USE');
  if(previous){
    if(Math.abs(Number(previous.days)+amount)>0.00001)
      throw new Error('過去の有給消化記録と日数が一致しません。管理者へ連絡してください。');
    return syncLeaveMasterFromLedger_(employee);
  }
  const state=ensureLeaveLedgerOpening_(employee,actor);
  const next=leaveBalanceAfterDelta_(state.balance,-amount);
  appendLeaveLedgerRow_(employee,employee.leaveBasisDate,Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'),'USE',-amount,next,requestId,actor,'承認済み休暇申請');
  getDb_().getSheetByName(DB.sheets.employees).getRange(employee.rowNumber,11).setValue(next);
  return next;
}

function restoreLeaveBalance_(employee, days, requestId, actor, note) {
  const amount=normalizeLeaveDays_(days);
  const previous=findLeaveLedgerRequestPosting_(employee.employeeId,requestId,'RESTORE');
  if(previous){
    if(Math.abs(Number(previous.days)-amount)>0.00001)
      throw new Error('過去の有給返却記録と日数が一致しません。管理者へ連絡してください。');
    return syncLeaveMasterFromLedger_(employee);
  }
  const state=ensureLeaveLedgerOpening_(employee,actor);
  const next=leaveBalanceAfterDelta_(state.balance,amount);
  appendLeaveLedgerRow_(employee,employee.leaveBasisDate,Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'),'RESTORE',amount,next,requestId,actor,note||'承認済み休暇申請の取消');
  getDb_().getSheetByName(DB.sheets.employees).getRange(employee.rowNumber,11).setValue(next);
  return next;
}
function recordLeaveBalanceAdminChange_(employeeId, name, basisDate, oldConfigured, oldBalance, newConfigured, newBalance, actor) {
  if(!newConfigured)return;
  const employee={employeeId:employeeId,name:name,leaveBasisDate:basisDate,leaveBalanceConfigured:!!oldConfigured,leaveBalance:Number(oldBalance||0)};
  let state=getLeaveLedgerState_(employee);
  if(state.source!=='LEDGER'){
    if(oldConfigured){
      if(!basisDate)throw new Error('年休基準日を登録してください。');
      appendLeaveLedgerRow_(employee,basisDate,basisDate,'OPENING',Number(oldBalance||0),Number(oldBalance||0),'',actor,'既存残数を有給台帳へ移行');
      state={configured:true,balance:Number(oldBalance||0),basisDate:basisDate,source:'LEDGER'};
    }else{
      if(!basisDate)throw new Error('年休基準日を登録してください。');
      appendLeaveLedgerRow_(employee,basisDate,basisDate,'OPENING',Number(newBalance||0),Number(newBalance||0),'',actor,'有給残数の初期登録');
      return;
    }
  }
  const target=normalizeLeaveDays_(newBalance);
  const delta=normalizeLeaveDays_(target-Number(state.balance||0));
  if(delta===0)return;
  appendLeaveLedgerRow_(employee,basisDate,Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'),'ADJUST',delta,target,'',actor,'管理者による残数調整');
}

function annualLeavePeriodEnd_(startDate) {
  const p=String(startDate||'').split('-').map(Number);
  if(p.length!==3||!p[0]||!p[1]||!p[2])return '';
  const end=new Date(Date.UTC(p[0]+1,p[1]-1,p[2]));
  end.setUTCDate(end.getUTCDate()-1);
  return end.getUTCFullYear()+'-'+String(end.getUTCMonth()+1).padStart(2,'0')+'-'+String(end.getUTCDate()).padStart(2,'0');
}

function annualLeaveQualifyingUsage_(requests, calendarDays, startDate, endDate) {
  const working=new Set((calendarDays||[]).filter(d=>d.working).map(d=>d.date));
  let qualifyingDays=0,excludedQuarterDays=0;
  (requests||[]).forEach(r=>{
    const type=String(r.type||'');
    const start=String(r.startDate||''),end=String(r.endDate||start);
    if(end<startDate||start>endDate)return;
    if(type==='1/4日有給'){
      const d=start<startDate?startDate:start;
      if(d<=endDate&&working.has(d))excludedQuarterDays+=0.25;
      return;
    }
    if(type==='午前半休'||type==='午後半休'){
      if(start>=startDate&&start<=endDate&&working.has(start))qualifyingDays+=0.5;
      return;
    }
    if(type!=='有給')return;
    const from=start<startDate?startDate:start,to=end>endDate?endDate:end;
    for(let d=from;;d=addDateString_(d,1)){
      if(working.has(d))qualifyingDays+=1;
      if(d===to)break;
    }
  });
  return {
    qualifyingDays:Math.round(qualifyingDays*2)/2,
    excludedQuarterDays:Math.round(excludedQuarterDays*4)/4
  };
}

function getAnnualLeaveFiveDayStatus_(employee, asOfDate) {
  const today=normalizeDate_(asOfDate||Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'));
  const grants=getLeaveLedgerRows_(employee.employeeId)
    .filter(r=>r.type==='GRANT'&&Number(r.days||0)>=10&&r.transactionDate&&r.transactionDate<=today)
    .sort((a,b)=>a.transactionDate.localeCompare(b.transactionDate));
  if(!grants.length){
    return {status:'UNKNOWN',requiredDays:5,takenDays:0,remainingDays:5,periodStart:'',periodEnd:'',daysRemaining:null,reason:'10日以上の年休付与記録がありません。'};
  }
  const grant=grants[grants.length-1];
  const periodStart=grant.transactionDate,periodEnd=annualLeavePeriodEnd_(periodStart);
  const through=today<periodEnd?today:periodEnd;
  if(through<periodStart){
    return {status:'UNKNOWN',requiredDays:5,takenDays:0,remainingDays:5,periodStart,periodEnd,daysRemaining:null,reason:'年休付与期間を確認できません。'};
  }
  const calendar=getCompanyCalendarRange_(periodStart,through);
  const expected=dateSpanDays_(periodStart,through);
  if(calendar.length!==expected){
    return {status:'DATA_INCOMPLETE',requiredDays:5,takenDays:0,remainingDays:5,periodStart,periodEnd,daysRemaining:null,reason:'年5日判定に必要な会社カレンダーが不足しています。'};
  }
  const sheet=getDb_().getSheetByName('申請');
  const rows=sheet&&sheet.getLastRow()>=2?readRowsByColumnValues_(sheet,3,19,[employee.employeeId]):[];
  const requests=rows
    .filter(r=>r[0]&&['承認済','取消申請中'].includes(r[9])&&r[5]<=through&&r[6]>=periodStart)
    .map(r=>({type:r[4],startDate:r[5],endDate:r[6]}));
  const usage=annualLeaveQualifyingUsage_(requests,calendar,periodStart,through);
  const prior=grants.length>1?grants[grants.length-2]:null;
  let previousOverdue=null;
  if(prior&&annualLeavePeriodEnd_(prior.transactionDate)<today){
    const priorEnd=annualLeavePeriodEnd_(prior.transactionDate);
    const oldDays=getCompanyCalendarRange_(prior.transactionDate,priorEnd);
    if(oldDays.length===dateSpanDays_(prior.transactionDate,priorEnd)){
      const oldRequests=rows.filter(r=>r[0]&&['承認済','取消申請中'].includes(r[9])&&
        r[5]<=priorEnd&&r[6]>=prior.transactionDate)
        .map(r=>({type:r[4],startDate:r[5],endDate:r[6]}));
      const oldUsage=annualLeaveQualifyingUsage_(oldRequests,oldDays,prior.transactionDate,priorEnd);
      if(oldUsage.qualifyingDays<5)previousOverdue={
        periodStart:prior.transactionDate,periodEnd:priorEnd,
        takenDays:oldUsage.qualifyingDays,remainingDays:Math.round((5-oldUsage.qualifyingDays)*2)/2
      };
    }
  }
  const takenDays=usage.qualifyingDays,remainingDays=Math.max(0,Math.round((5-takenDays)*2)/2);
  const daysRemaining=today>periodEnd?0:Math.max(0,Math.ceil((parseYmd_(periodEnd)-parseYmd_(today))/86400000));
  const status=takenDays>=5?'COMPLETED':today>periodEnd?'OVERDUE':'TRACKING';
  return {
    status,requiredDays:5,takenDays,remainingDays,periodStart,periodEnd,daysRemaining,previousOverdue,
    grantDays:Number(grant.days||0),excludedQuarterDays:usage.excludedQuarterDays,
    reason:usage.excludedQuarterDays>0?'1/4日有給は法的区分未確定のため年5日取得実績へ算入していません。':''
  };
}

function getLeaveLedger(sessionToken, employeeId) {
  requireAdminSession_(sessionToken);
  maybeReconcileLeave_(employeeId);
  const employee=getEmployee_(employeeId);
  return {
    employee:{employeeId:employee.employeeId,name:employee.name},
    automation:leaveAutoForecast_(employee,Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd')),
    state:getLeaveLedgerState_(employee),
    rows:getLeaveLedgerRows_(employee.employeeId).slice().reverse().slice(0,100),
    fiveDay:getAnnualLeaveFiveDayStatus_(employee,Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'))
  };
}

function postLeaveLedgerEntry(sessionToken, employeeId, type, days, transactionDate, note) {
  const admin=requireAdminSession_(sessionToken).employee;
  const allowed=['GRANT','EXPIRE','ADJUST'];
  const normalized=String(type||'').toUpperCase();
  if(!allowed.includes(normalized))throw new Error('有給台帳の処理種別を確認してください。');
  return withScriptLock_(function(){
    const employee=getEmployee_(employeeId);
    if(!employee.leaveBasisDate)throw new Error('年休基準日が未設定です。');
    const state=ensureLeaveLedgerOpening_(employee,admin);
    let delta=normalizeLeaveDays_(days);
    if(normalized==='EXPIRE')delta=-Math.abs(delta);
    if(normalized==='GRANT')delta=Math.abs(delta);
    const next=leaveBalanceAfterDelta_(state.balance,delta);
    appendLeaveLedgerRow_(employee,employee.leaveBasisDate,normalizeDate_(transactionDate),normalized,delta,next,'',admin,note||'');
    getDb_().getSheetByName(DB.sheets.employees).getRange(employee.rowNumber,11).setValue(next);
    appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation:'有給台帳更新',target:'有給台帳',targetId:employee.employeeId,before:String(state.balance),after:String(next),source:'WEB',result:'SUCCESS',note:normalized+' '+delta});
    SpreadsheetApp.flush();
    return {ok:true,balance:next};
  });
}
