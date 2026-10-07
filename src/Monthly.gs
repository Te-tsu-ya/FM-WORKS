function getLegacyDailySnapshots_(employeeId, start, end) {
  const sheet = getDb_().getSheetByName('日次勤怠');
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;

  sheet.getRange(2,1,lastRow-1,16).getDisplayValues().forEach(r=>{
    if (!r[0] || r[1] !== employeeId || r[0] < start || r[0] > end || !['移行済','確定'].includes(r[14])) return;
    map[r[0]] = {
      date:r[0],
      clockIn:r[3]||'',
      clockOut:r[4]||'',
      breakMinutes:Number(r[5]||0),
      workMinutes:Number(r[6]||0),
      overtimeMinutes:Number(r[7]||0),
      holidayMinutes:Number(r[8]||0),
      workLocation:r[9]||'',
      absence:['TRUE','1'].includes(String(r[10]).toUpperCase()),
      lateEarlyMinutes:Number(r[11]||0),
      remote:['TRUE','1'].includes(String(r[12]).toUpperCase()),
      paidLeave:Number(r[13]||0),
      status:r[14]||'',
      note:r[15]||''
    };
  });
  return map;
}

function getMonthlySummary(sessionToken, yearMonth, employeeId) {
  const session = requireSession_(sessionToken);
  const ym = String(yearMonth || Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM'));
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('対象月を確認してください。');

  const targetId = session.employee.role === 'ADMIN' && employeeId ? String(employeeId) : session.employee.employeeId;
  const employee = getEmployee_(targetId);
  const parts = ym.split('-').map(Number);
  const start = ym + '-01';
  const lastDay = new Date(parts[0], parts[1], 0).getDate();
  const end = ym + '-' + String(lastDay).padStart(2,'0');
  const systemToday = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');

  const punchRows = getActivePunchRows_(targetId, start, end);
  const byDate = {};
  punchRows.forEach(r=>{
    (byDate[r[3]]||(byDate[r[3]]=[])).push({id:r[0],action:r[4],timestamp:r[5],workLocation:r[6]});
  });
  Object.values(byDate).forEach(rows=>rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)));

  const legacyMap = getLegacyDailySnapshots_(targetId,start,end);
  const calendar = getCompanyCalendarRange_(start,end);
  const calendarMap = Object.fromEntries(calendar.map(d=>[d.date,d]));
  const requests = getApprovedRequestsForMonth_(targetId,start,end);

  const fullLeaveDates = new Set();
  const absenceDates = new Set();
  const partialLeaveByDate = {};
  requests.forEach(r=>{
    const rangeStart = r.startDate < start ? start : r.startDate;
    const rangeEnd = r.endDate > end ? end : r.endDate;
    if (rangeStart > rangeEnd) return;
    for(let d=rangeStart;;d=addDateString_(d,1)){
      const company = calendarMap[d];
      if (company && company.working) {
        if (r.type === '有給') fullLeaveDates.add(d);
        if (r.type === '欠勤') absenceDates.add(d);
        if (r.type === '午前半休' || r.type === '午後半休' || r.type === '1/4日有給') {
          const set=partialLeaveByDate[d]||(partialLeaveByDate[d]=new Set());
          set.add(r.type);
        }
      }
      if(d===rangeEnd)break;
    }
  });

  const daily = [];
  let totalMinutes=0,overtimeMinutes=0,holidayMinutes=0,lateEarlyMinutes=0;
  let workDays=0,missingPunchDays=0,remoteDays=0,paidLeaveDays=0,absenceDays=0;

  for(let day=1;day<=lastDay;day++){
    const date=ym+'-'+String(day).padStart(2,'0');
    const rows=byDate[date]||[];
    const snapshot=rows.length?null:(legacyMap[date]||null);
    const registeredCompany=calendarMap[date]||null;
    const company=registeredCompany||{date:date,type:'未登録',working:false,start:'',end:'',breakMinutes:0,name:''};
    const past=date<systemToday;

    let clockIn='',clockOut='',minutes=0,overtime=0,holiday=0,lateEarly=0,workLocation='',remote=false;
    let absence=false,leaveStatus='',issueType='';

    if(snapshot){
      clockIn=snapshot.clockIn;
      clockOut=snapshot.clockOut;
      minutes=snapshot.workMinutes;
      overtime=snapshot.overtimeMinutes;
      holiday=snapshot.holidayMinutes;
      lateEarly=snapshot.lateEarlyMinutes;
      workLocation=snapshot.workLocation;
      remote=snapshot.remote&&minutes>0;
      const legacyPaid=Math.max(0,Number(snapshot.paidLeave||0));
      const legacyAbsence=!!snapshot.absence&&legacyPaid===0;
      if(legacyPaid>0){
        paidLeaveDays+=legacyPaid;
        leaveStatus=inferLegacyLeaveLabel_(snapshot,company);
      }
      if(legacyAbsence){
        absence=true;
        absenceDays++;
        leaveStatus=leaveStatus?leaveStatus+' / 欠勤':'欠勤';
      }
      const hasAnyPunch=!!clockIn||!!clockOut;
      const fullDayOff=legacyPaid>=1||legacyAbsence;
      if(!registeredCompany&&date<=systemToday)issueType='会社カレンダー未登録';
      else if(hasAnyPunch&&(!clockIn||!clockOut)&&past)issueType='旧データ打刻不足';
      else if(company.working&&past&&!hasAnyPunch&&minutes===0&&!fullDayOff)issueType='旧データ未打刻';
    }else{
      const clockInRow=rows.find(x=>x.action===PUNCH.CLOCK_IN);
      const clockOutRow=[...rows].reverse().find(x=>x.action===PUNCH.CLOCK_OUT);
      clockIn=clockInRow?clockInRow.timestamp.slice(11,16):'';
      clockOut=clockOutRow?clockOutRow.timestamp.slice(11,16):'';
      minutes=rows.length?calculateMonthlyDayMinutes_(rows,date===systemToday):0;
      const standard=company.working&&company.start&&company.end
        ? Math.max(0,timeRangeMinutes_(company.start,company.end)-Number(company.breakMinutes||0))
        : 0;
      overtime=company.working?Math.max(0,minutes-standard):0;
      holiday=company.working?0:minutes;

      const fullPaidLeave=fullLeaveDates.has(date);
      absence=absenceDates.has(date);
      const partialSet=partialLeaveByDate[date]||new Set();
      const partialDays=[...partialSet].reduce((sum,type)=>sum+(type==='1/4日有給'?0.25:0.5),0);
      const fullDayOff=fullPaidLeave||absence;
      if(fullPaidLeave){paidLeaveDays+=1;leaveStatus='有給'}
      if(partialSet.size){paidLeaveDays+=partialDays;leaveStatus=[...partialSet].join(' / ')}
      if(absence){absenceDays++;leaveStatus=leaveStatus?leaveStatus+' / 欠勤':'欠勤'}

      const incompletePunch=rows.length>0&&(!clockIn||(!clockOut&&past));
      const missingAllPunches=company.working&&past&&rows.length===0&&!fullDayOff;
      const offDayWithPunch=fullDayOff&&rows.length>0;
      if(!registeredCompany&&date<=systemToday)issueType='会社カレンダー未登録';
      else if(offDayWithPunch)issueType='休暇・欠勤日に打刻あり';
      else if(incompletePunch)issueType='打刻不足';
      else if(missingAllPunches)issueType='未打刻';

      if(company.working&&clockIn&&clockOut&&partialSet.size===0&&!fullDayOff&&company.start&&company.end){
        const inMin=timeToMinutes_(clockIn);
        const outMin=timeToMinutes_(clockOut);
        const startMin=timeToMinutes_(company.start);
        const endMin=timeToMinutes_(company.end);
        lateEarly=Math.max(0,inMin-startMin)+Math.max(0,endMin-outMin);
      }
      workLocation=rows.length?rows[rows.length-1].workLocation:'';
      remote=minutes>0&&rows.some(x=>x.workLocation==='在宅');
    }

    const issue=!!issueType;
    if(minutes>0)workDays++;
    if(issue)missingPunchDays++;
    if(remote)remoteDays++;
    totalMinutes+=minutes;
    overtimeMinutes+=overtime;
    holidayMinutes+=holiday;
    lateEarlyMinutes+=lateEarly;

    daily.push({
      date:date,
      companyType:company.type,
      companyName:company.name||'',
      workingDay:!!company.working,
      clockIn:clockIn,
      clockOut:clockOut,
      workMinutes:minutes,
      overtimeMinutes:overtime,
      holidayMinutes:holiday,
      lateEarlyMinutes:lateEarly,
      workLocation:workLocation,
      remote:remote,
      leaveStatus:leaveStatus,
      absence:absence,
      source:snapshot?'LEGACY':'LIVE',
      issue:issue,
      issueType:issueType
    });
  }

  const worklogSheet=getDb_().getSheetByName('工数');
  const worklogRows=worklogSheet.getLastRow()<2?[]:worklogSheet.getRange(2,1,worklogSheet.getLastRow()-1,15).getDisplayValues()
    .filter(r=>r[2]===targetId&&r[1]>=start&&r[1]<=end&&r[12]!=='削除');
  const worklogMinutes=worklogRows.reduce((sum,r)=>sum+Number(r[9]||0),0);

  return {
    yearMonth:ym,
    employee:{employeeId:employee.employeeId,name:employee.name,displayName:employee.displayName},
    totals:{
      workDays:workDays,
      absenceDays:absenceDays,
      totalMinutes:totalMinutes,
      overtimeMinutes:overtimeMinutes,
      holidayMinutes:holidayMinutes,
      lateEarlyMinutes:lateEarlyMinutes,
      paidLeaveDays:paidLeaveDays,
      remoteDays:remoteDays,
      missingPunchDays:missingPunchDays,
      worklogMinutes:worklogMinutes
    },
    daily:daily,
    requests:requests
  };
}
function inferLegacyLeaveLabel_(snapshot, company) {
  const paid = Math.max(0, Number(snapshot && snapshot.paidLeave || 0));
  if (paid >= 1) return '有給';
  if (paid === 0.25) return '1/4日有給';
  if (paid === 0.5) {
    const clockIn = String(snapshot && snapshot.clockIn || '');
    const clockOut = String(snapshot && snapshot.clockOut || '');
    if (clockIn && clockOut) {
      const inMin = timeToMinutes_(clockIn);
      const outMin = timeToMinutes_(clockOut);
      const companyStart = company && company.start ? timeToMinutes_(company.start) : null;
      const companyEnd = company && company.end ? timeToMinutes_(company.end) : null;
      if (companyStart !== null && companyEnd !== null) {
        if (inMin <= companyStart + 60 && outMin < companyEnd) return '午後半休';
        if (inMin > companyStart && outMin >= companyEnd - 60) return '午前半休';
      }
      if (outMin <= 15 * 60) return '午後半休';
    }
    return '半休';
  }
  return '有給 ' + paid + '日';
}

function calculateMonthlyDayMinutes_(rows, isToday) {
  if (!rows || !rows.length) return 0;
  const hasClockIn = rows.some(r => r.action === PUNCH.CLOCK_IN);
  const hasClockOut = rows.some(r => r.action === PUNCH.CLOCK_OUT);
  if (!hasClockIn) return 0;
  if (!hasClockOut && !isToday) return 0;
  return calculateWorkedMinutes_(rows);
}

function createMonthlyExport(sessionToken, yearMonth, employeeId) {
  requireSession_(sessionToken);
  const summary = getMonthlySummary(sessionToken, yearMonth, employeeId);
  assertMonthlyReadyForExport_(summary);

  let blob;
  let tempFileId = '';
  const fileName = 'FM_WORKS_' + summary.employee.employeeId + '_' + summary.yearMonth + '.xlsx';
  try {
    const temp = SpreadsheetApp.create('FM_WORKS_EXPORT_' + Utilities.getUuid());
    tempFileId = temp.getId();
    const sheet = temp.getSheets()[0];
    sheet.setName('勤怠集計');
    writeMonthlyDetailSheet_(sheet, summary);
    SpreadsheetApp.flush();
    blob = exportSpreadsheetXlsx_(tempFileId, fileName);
  } finally {
    if (tempFileId) {
      try { DriveApp.getFileById(tempFileId).setTrashed(true); }
      catch(e) { console.warn('temporary export cleanup failed', e); }
    }
  }

  if (!blob) throw new Error('Excelファイルを作成できませんでした。');
  return {
    filename: fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: Utilities.base64Encode(blob.getBytes()),
    emailText: buildTaxEmailText_([summary], summary.yearMonth)
  };
}

function createTeamMonthlyExport(sessionToken, yearMonth) {
  requireAdminSession_(sessionToken);
  const ym = String(yearMonth || Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM'));
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('対象月を確認してください。');

  const employees = getPayrollEmployees_();
  if (!employees.length) throw new Error('給与集計対象の社員が設定されていません。社員マスタを確認してください。');

  const summaries = employees.map(e => getMonthlySummary(sessionToken, ym, e.employeeId));
  const blocked = summaries.filter(s => s.totals.missingPunchDays > 0);
  if (blocked.length) {
    throw new Error('要確認の勤怠が残っています: ' + blocked.map(s => s.employee.name + ' ' + s.totals.missingPunchDays + '日').join(' / '));
  }

  let blob;
  let tempFileId = '';
  const fileName = 'FM_WORKS_給与提出_' + ym + '.xlsx';
  try {
    const temp = SpreadsheetApp.create('FM_WORKS_TEAM_EXPORT_' + Utilities.getUuid());
    tempFileId = temp.getId();
    const summarySheet = temp.getSheets()[0];
    summarySheet.setName('集計一覧');
    writeTeamSummarySheet_(summarySheet, summaries);

    summaries.forEach(summary => {
      const sheetName = safeSheetName_(summary.employee.employeeId + ' ' + summary.employee.name);
      const sheet = temp.insertSheet(sheetName);
      writeMonthlyDetailSheet_(sheet, summary);
    });

    SpreadsheetApp.flush();
    blob = exportSpreadsheetXlsx_(tempFileId, fileName);
  } finally {
    if (tempFileId) {
      try { DriveApp.getFileById(tempFileId).setTrashed(true); }
      catch(e) { console.warn('temporary team export cleanup failed', e); }
    }
  }

  if (!blob) throw new Error('一括Excelファイルを作成できませんでした。');
  return {
    filename: fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: Utilities.base64Encode(blob.getBytes()),
    emailText: buildTaxEmailText_(summaries, ym)
  };
}

function getPayrollEmployees_() {
  const sheet = getDb_().getSheetByName(DB.sheets.employees);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2,1,lastRow-1,23).getDisplayValues()
    .filter(r => r[0] && r[6] === '在籍' && String(r[22]).toUpperCase() === 'TRUE')
    .map(r => ({ employeeId:r[0], name:r[1] }));
}

function assertMonthlyReadyForExport_(summary) {
  if (summary.totals.missingPunchDays > 0) {
    throw new Error(summary.employee.name + 'の勤怠に要確認日が' + summary.totals.missingPunchDays + '日あります。修正後に提出データを作成してください。');
  }
}

function writeMonthlyDetailSheet_(sheet, summary) {
  const header = ['日付','会社区分','出勤','退勤','実働時間','残業時間','休日出勤時間','遅刻・早退時間','勤務場所','在宅','休暇・欠勤','要確認'];
  const detail = [header].concat(summary.daily.map(d => [
    d.date,
    d.companyName || d.companyType,
    d.clockIn,
    d.clockOut,
    minutesToExcelTime_(d.workMinutes),
    minutesToExcelTime_(d.overtimeMinutes),
    minutesToExcelTime_(d.holidayMinutes),
    minutesToExcelTime_(d.lateEarlyMinutes),
    d.workLocation,
    d.remote ? '在宅' : '',
    d.leaveStatus || '',
    d.issue ? d.issueType : ''
  ]));
  sheet.getRange(1,1,detail.length,header.length).setValues(detail);

  const summaryRows = [
    ['社員', summary.employee.name],
    ['出勤日数', summary.totals.workDays],
    ['欠勤日数', summary.totals.absenceDays],
    ['実働時間', minutesToExcelTime_(summary.totals.totalMinutes)],
    ['残業時間', minutesToExcelTime_(summary.totals.overtimeMinutes)],
    ['休日出勤時間', minutesToExcelTime_(summary.totals.holidayMinutes)],
    ['遅刻・早退時間', minutesToExcelTime_(summary.totals.lateEarlyMinutes)],
    ['有給取得日数', summary.totals.paidLeaveDays],
    ['在宅勤務日数', summary.totals.remoteDays],
    ['工数入力時間', minutesToExcelTime_(summary.totals.worklogMinutes)],
    ['要確認日数', summary.totals.missingPunchDays]
  ];
  const summaryStart = detail.length + 2;
  sheet.getRange(summaryStart,1,summaryRows.length,2).setValues(summaryRows);

  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,header.length).setFontWeight('bold').setBackground('#10294f').setFontColor('#ffffff');
  sheet.autoResizeColumns(1,header.length);
  if (summary.daily.length) sheet.getRange(2,5,summary.daily.length,4).setNumberFormat('[h]:mm');
  sheet.getRange(summaryStart + 3,2,4,1).setNumberFormat('[h]:mm');
  sheet.getRange(summaryStart + 7,2).setNumberFormat('0.00');
  sheet.getRange(summaryStart + 9,2).setNumberFormat('[h]:mm');
}

function writeTeamSummarySheet_(sheet, summaries) {
  const header = ['社員ID','氏名','出勤日数','欠勤日数','実働時間','残業時間','休日出勤時間','遅刻・早退時間','有給取得日数','在宅勤務日数','工数入力時間','要確認日数'];
  const rows = [header].concat(summaries.map(s => [
    s.employee.employeeId,
    s.employee.name,
    s.totals.workDays,
    s.totals.absenceDays,
    minutesToExcelTime_(s.totals.totalMinutes),
    minutesToExcelTime_(s.totals.overtimeMinutes),
    minutesToExcelTime_(s.totals.holidayMinutes),
    minutesToExcelTime_(s.totals.lateEarlyMinutes),
    s.totals.paidLeaveDays,
    s.totals.remoteDays,
    minutesToExcelTime_(s.totals.worklogMinutes),
    s.totals.missingPunchDays
  ]));
  sheet.getRange(1,1,rows.length,header.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,header.length).setFontWeight('bold').setBackground('#10294f').setFontColor('#ffffff');
  if (summaries.length) {
    sheet.getRange(2,5,summaries.length,4).setNumberFormat('[h]:mm');
    sheet.getRange(2,9,summaries.length,1).setNumberFormat('0.00');
    sheet.getRange(2,11,summaries.length,1).setNumberFormat('[h]:mm');
  }
  sheet.autoResizeColumns(1,header.length);
}

function exportSpreadsheetXlsx_(spreadsheetId, fileName) {
  const exportUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(spreadsheetId) +
    '/export?mimeType=' + encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const response = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: false
  });
  return response.getBlob().setName(fileName);
}

function safeSheetName_(value) {
  return String(value || '勤怠').replace(/[\\\/\?\*\[\]\:]/g, '_').slice(0, 31) || '勤怠';
}

function buildTaxEmailText_(summaries, yearMonth) {
  const p = String(yearMonth).split('-');
  const heading = Number(p[0]) + '年' + Number(p[1]) + '月分の出勤簿をお送りいたします。';
  return heading + '\n\n■有給・残業・休日出勤等\n' +
    summaries.map(buildTaxEmailEmployeeBlock_).join('\n\n');
}

function buildTaxEmailEmployeeBlock_(summary) {
  const lines = [];
  summary.daily.forEach(d => {
    if (d.leaveStatus) lines.push('・' + formatMonthDay_(d.date) + ' ' + d.leaveStatus);
  });

  summary.requests.forEach(r => {
    if (['有給','午前半休','午後半休','1/4日有給','欠勤'].includes(r.type)) return;
    lines.push('・' + formatRequestRange_(r.startDate, r.endDate) + ' ' + r.type);
  });

  if (summary.totals.overtimeMinutes > 0) lines.push('・残業時間 合計 ' + formatMinutes_(summary.totals.overtimeMinutes));
  if (summary.totals.holidayMinutes > 0) lines.push('・休日出勤時間 合計 ' + formatMinutes_(summary.totals.holidayMinutes));
  if (summary.totals.lateEarlyMinutes > 0) lines.push('・遅刻・早退時間 合計 ' + formatMinutes_(summary.totals.lateEarlyMinutes));
  if (!lines.length) lines.push('・特になし');
  lines.push('・在宅勤務日数 ' + summary.totals.remoteDays + '日');

  return '【' + summary.employee.name + '】\n' + lines.join('\n');
}

function formatRequestRange_(startDate, endDate) {
  if (!endDate || startDate === endDate) return formatMonthDay_(startDate);
  return formatMonthDay_(startDate) + '〜' + formatMonthDay_(endDate);
}

function formatMonthDay_(date) {
  const p = String(date || '').split('-');
  if (p.length !== 3) return String(date || '');
  return Number(p[1]) + '/' + Number(p[2]);
}

function minutesToExcelTime_(minutes){
  return Math.max(0,Number(minutes||0))/1440;
}

function getApprovedRequestsForMonth_(employeeId,start,end) {
  const sheet=getDb_().getSheetByName('申請');
  if(sheet.getLastRow()<2)return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,14).getDisplayValues()
    .filter(r=>r[2]===employeeId&&r[9]==='承認済'&&r[5]<=end&&r[6]>=start)
    .map(r=>({id:r[0],type:r[4],startDate:r[5],endDate:r[6],reason:r[8]}));
}

function countWorkingLeaveDays_(requestStart,requestEnd,calendarMap,monthStart,monthEnd){
  const start=requestStart<monthStart?monthStart:requestStart;
  const end=requestEnd>monthEnd?monthEnd:requestEnd;
  if(start>end)return 0;
  let count=0;
  for(let d=start;;d=addDateString_(d,1)){
    if(calendarMap[d]&&calendarMap[d].working)count++;
    if(d===end)break;
  }
  return count;
}

function addDateString_(dateString,days){
  const p=String(dateString).split('-').map(Number);
  const d=new Date(Date.UTC(p[0],p[1]-1,p[2]+days));
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
}

function dateSpanDays_(start,end){
  const a=parseYmd_(start),b=parseYmd_(end);
  return Math.max(1,Math.round((b-a)/86400000)+1);
}

function parseYmd_(s){
  const p=String(s).split('-').map(Number);
  return new Date(Date.UTC(p[0],p[1]-1,p[2]));
}

function csvEscape_(value){
  const s=String(value==null?'':value);
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
