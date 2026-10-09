
const AUTO_LEAVE_DAYS=Object.freeze([10,11,12,14,16,18,20]);
const AUTO_LEAVE_PREFIX='FM_AUTO_LEAVE_V1_';
function leaveDueAtIndex_(hire,index){
  const [y,m,d]=String(hire||'').split('-').map(Number),i=Number(index);
  if(!y||!m||!d||m>12||d>31||!Number.isInteger(i)||i<0||i>80)return '';
  const mon=(m-1)+6+12*i,Y=y+Math.floor(mon/12),M=((mon%12)+12)%12;
  const D=Math.min(d,new Date(Date.UTC(Y,M+1,0)).getUTCDate());
  return [Y,String(M+1).padStart(2,'0'),String(D).padStart(2,'0')].join('-');
}
function leaveEntitlement_(hire,asOf){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(asOf||''))||!leaveDueAtIndex_(hire,0))return null;
  let due=null,next=null;
  for(let i=0;i<=80;i++){
    const date=leaveDueAtIndex_(hire,i);
    const part={index:i,date,days:AUTO_LEAVE_DAYS[Math.min(i,6)],
      from:i===0?hire:leaveDueAtIndex_(hire,i-1),through:addDateString_(date,-1)};
    if(date<=asOf)due=part;else{next=part;break;}
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
function maybeReconcileLeave_(employeeId,asOf){
  const employee=getEmployee_(employeeId),today=asOf||Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'),
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
function annualLeaveDailyJob_(){
  const today=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');
  getEmployees_().forEach(e=>{
    try{maybeReconcileLeave_(e.employeeId,today);}
    catch(err){console.error('年休付与チェック失敗 '+e.employeeId+': '+String(err));}
  });
}
function installAnnualLeaveDailyJob(sessionToken){
  const admin=requireAdminSession_(sessionToken).employee;
  const exists=ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='annualLeaveDailyJob_');
  if(!exists)ScriptApp.newTrigger('annualLeaveDailyJob_').timeBased().everyDays(1).atHour(5).create();
  appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,
    operation:'年休自動処理を設定',target:'設定',targetId:'annualLeaveDailyJob_',
    before:exists?'有効':'未設定',after:'有効',source:'WEB',result:'SUCCESS',note:'毎日午前5時頃'});
  return {ok:true,enabled:true};
}
