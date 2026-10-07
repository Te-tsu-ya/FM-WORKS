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
  return sheet.getRange(2,1,sheet.getLastRow()-1,13).getDisplayValues()
    .filter(r => r[0] && r[1] === employeeId)
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

function consumeLeaveBalance_(employee, days, requestId, actor) {
  const state=ensureLeaveLedgerOpening_(employee,actor);
  const amount=normalizeLeaveDays_(days);
  const next=leaveBalanceAfterDelta_(state.balance,-amount);
  appendLeaveLedgerRow_(employee,employee.leaveBasisDate,Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'),'USE',-amount,next,requestId,actor,'承認済み休暇申請');
  getDb_().getSheetByName(DB.sheets.employees).getRange(employee.rowNumber,11).setValue(next);
  return next;
}

function restoreLeaveBalance_(employee, days, requestId, actor, note) {
  const state=ensureLeaveLedgerOpening_(employee,actor);
  const amount=normalizeLeaveDays_(days);
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
  const rows=sheet&&sheet.getLastRow()>=2?sheet.getRange(2,1,sheet.getLastRow()-1,19).getDisplayValues():[];
  const requests=rows
    .filter(r=>r[0]&&r[2]===employee.employeeId&&['承認済','取消申請中'].includes(r[9])&&r[5]<=through&&r[6]>=periodStart)
    .map(r=>({type:r[4],startDate:r[5],endDate:r[6]}));
  const usage=annualLeaveQualifyingUsage_(requests,calendar,periodStart,through);
  const takenDays=usage.qualifyingDays,remainingDays=Math.max(0,Math.round((5-takenDays)*2)/2);
  const daysRemaining=today>periodEnd?0:Math.max(0,Math.ceil((parseYmd_(periodEnd)-parseYmd_(today))/86400000));
  const status=takenDays>=5?'COMPLETED':today>periodEnd?'OVERDUE':'TRACKING';
  return {
    status,requiredDays:5,takenDays,remainingDays,periodStart,periodEnd,daysRemaining,
    grantDays:Number(grant.days||0),excludedQuarterDays:usage.excludedQuarterDays,
    reason:usage.excludedQuarterDays>0?'1/4日有給は法的区分未確定のため年5日取得実績へ算入していません。':''
  };
}

function getLeaveLedger(sessionToken, employeeId) {
  requireAdminSession_(sessionToken);
  const employee=getEmployee_(employeeId);
  return {
    employee:{employeeId:employee.employeeId,name:employee.name},
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
