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

  const calendar = getCompanyCalendarRange_(start,end);
  const calendarMap = Object.fromEntries(calendar.map(d=>[d.date,d]));
  const requests = getApprovedRequestsForMonth_(targetId,start,end);

  const fullLeaveDates = new Set();
  const absenceDates = new Set();
  const halfLeaveDates = new Set();
  const halfLeaveKeys = new Set();

  requests.forEach(r=>{
    const rangeStart = r.startDate < start ? start : r.startDate;
    const rangeEnd = r.endDate > end ? end : r.endDate;
    if (rangeStart > rangeEnd) return;
    for(let d=rangeStart;;d=addDateString_(d,1)){
      const company = calendarMap[d];
      if (company && company.working) {
        if (r.type === '有給') fullLeaveDates.add(d);
        if (r.type === '欠勤') absenceDates.add(d);
        if (r.type === '午前半休' || r.type === '午後半休') {
          halfLeaveDates.add(d);
          halfLeaveKeys.add(d + '|' + r.type);
        }
      }
      if(d===rangeEnd)break;
    }
  });

  const daily = [];
  let totalMinutes=0,overtimeMinutes=0,holidayMinutes=0,lateEarlyMinutes=0;
  let workDays=0,missingPunchDays=0,remoteDays=0;

  for(let day=1;day<=lastDay;day++){
    const date=ym+'-'+String(day).padStart(2,'0');
    const rows=byDate[date]||[];
    const registeredCompany=calendarMap[date]||null;
    const company=registeredCompany||{date:date,type:'未登録',working:false,start:'',end:'',breakMinutes:0,name:''};
    const clockIn=rows.find(x=>x.action===PUNCH.CLOCK_IN);
    const clockOut=[...rows].reverse().find(x=>x.action===PUNCH.CLOCK_OUT);
    const minutes=rows.length?calculateMonthlyDayMinutes_(rows,date===systemToday):0;
    const standard=company.working&&company.start&&company.end
      ? Math.max(0,timeRangeMinutes_(company.start,company.end)-Number(company.breakMinutes||0))
      : 0;
    const overtime=company.working?Math.max(0,minutes-standard):0;
    const holiday=company.working?0:minutes;

    const fullPaidLeave=fullLeaveDates.has(date);
    const absence=absenceDates.has(date);
    const halfLeave=halfLeaveDates.has(date);
    const fullDayOff=fullPaidLeave||absence;
    const past=date<systemToday;
    const incompletePunch=rows.length>0&&(!clockIn||(!clockOut&&past));
    const missingAllPunches=company.working&&past&&rows.length===0&&!fullDayOff;
    const offDayWithPunch=fullDayOff&&rows.length>0;
    const missingCalendar=!registeredCompany&&date<=systemToday;

    let issueType='';
    if(missingCalendar) issueType='会社カレンダー未登録';
    else if(offDayWithPunch) issueType='休暇・欠勤日に打刻あり';
    else if(incompletePunch) issueType='打刻不足';
    else if(missingAllPunches) issueType='未打刻';
    const issue=!!issueType;

    let lateEarly=0;
    if(company.working&&clockIn&&clockOut&&!halfLeave&&!fullDayOff&&company.start&&company.end){
      const inMin=timeToMinutes_(clockIn.timestamp.slice(11,16));
      const outMin=timeToMinutes_(clockOut.timestamp.slice(11,16));
      const startMin=timeToMinutes_(company.start);
      const endMin=timeToMinutes_(company.end);
      lateEarly=Math.max(0,inMin-startMin)+Math.max(0,endMin-outMin);
    }

    const remote=minutes>0&&rows.some(x=>x.workLocation==='在宅');
    if(minutes>0)workDays++;
    if(issue)missingPunchDays++;
    if(remote)remoteDays++;
    totalMinutes+=minutes;
    overtimeMinutes+=overtime;
    holidayMinutes+=holiday;
    lateEarlyMinutes+=lateEarly;

    const leaveLabels=[];
    if(fullPaidLeave)leaveLabels.push('有給');
    if(absence)leaveLabels.push('欠勤');
    if(halfLeave){
      requests.filter(r=>(r.type==='午前半休'||r.type==='午後半休')&&r.startDate<=date&&r.endDate>=date)
        .forEach(r=>{if(!leaveLabels.includes(r.type))leaveLabels.push(r.type)});
    }

    daily.push({
      date:date,
      companyType:company.type,
      companyName:company.name||'',
      workingDay:!!company.working,
      clockIn:clockIn?clockIn.timestamp.slice(11,16):'',
      clockOut:clockOut?clockOut.timestamp.slice(11,16):'',
      workMinutes:minutes,
      overtimeMinutes:overtime,
      holidayMinutes:holiday,
      lateEarlyMinutes:lateEarly,
      workLocation:rows.length?rows[rows.length-1].workLocation:'',
      remote:remote,
      leaveStatus:leaveLabels.join(' / '),
      absence:absence,
      issue:issue,
      issueType:issueType
    });
  }

  const paidLeaveDays=fullLeaveDates.size + halfLeaveKeys.size*0.5;
  const absenceDays=absenceDates.size;

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
function calculateMonthlyDayMinutes_(rows, isToday) {
  if (!rows || !rows.length) return 0;
  const hasClockIn = rows.some(r => r.action === PUNCH.CLOCK_IN);
  const hasClockOut = rows.some(r => r.action === PUNCH.CLOCK_OUT);
  if (!hasClockIn) return 0;
  if (!hasClockOut && !isToday) return 0;
  return calculateWorkedMinutes_(rows);
}

function createMonthlyExport(sessionToken, yearMonth, employeeId) {
  const summary=getMonthlySummary(sessionToken,yearMonth,employeeId);
  const header=['日付','会社区分','出勤','退勤','実働時間','残業時間','休日出勤時間','遅刻・早退時間','勤務場所','在宅','休暇・欠勤','要確認'];
  const rows=[header];

  summary.daily.forEach(d=>rows.push([
    d.date,
    d.companyName||d.companyType,
    d.clockIn,
    d.clockOut,
    minutesToExcelTime_(d.workMinutes),
    minutesToExcelTime_(d.overtimeMinutes),
    minutesToExcelTime_(d.holidayMinutes),
    minutesToExcelTime_(d.lateEarlyMinutes),
    d.workLocation,
    d.remote?'在宅':'',
    d.leaveStatus||'',
    d.issue?d.issueType:''
  ]));

  rows.push([]);
  rows.push(['社員',summary.employee.name]);
  rows.push(['出勤日数',summary.totals.workDays]);
  rows.push(['欠勤日数',summary.totals.absenceDays]);
  rows.push(['実働時間',minutesToExcelTime_(summary.totals.totalMinutes)]);
  rows.push(['残業時間',minutesToExcelTime_(summary.totals.overtimeMinutes)]);
  rows.push(['休日出勤時間',minutesToExcelTime_(summary.totals.holidayMinutes)]);
  rows.push(['遅刻・早退時間',minutesToExcelTime_(summary.totals.lateEarlyMinutes)]);
  rows.push(['有給取得日数',summary.totals.paidLeaveDays]);
  rows.push(['在宅勤務日数',summary.totals.remoteDays]);
  rows.push(['工数入力時間',minutesToExcelTime_(summary.totals.worklogMinutes)]);
  rows.push(['要確認日数',summary.totals.missingPunchDays]);

  const fileName='FM_WORKS_'+summary.employee.employeeId+'_'+summary.yearMonth+'.xlsx';
  let blob;
  let tempFileId='';
  try {
    const temp=SpreadsheetApp.create('FM_WORKS_EXPORT_'+Utilities.getUuid());
    tempFileId=temp.getId();
    const sheet=temp.getSheets()[0];
    sheet.setName('勤怠集計');
    sheet.getRange(1,1,rows.length,header.length).clear();
    rows.forEach((row,index)=>{
      if(!row.length)return;
      sheet.getRange(index+1,1,1,row.length).setValues([row]);
    });
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,header.length).setFontWeight('bold').setBackground('#10294f').setFontColor('#ffffff');
    sheet.autoResizeColumns(1,header.length);
    if(summary.daily.length){
      sheet.getRange(2,5,summary.daily.length,4).setNumberFormat('[h]:mm');
    }
    const summaryStart=summary.daily.length+3;
    sheet.getRange(summaryStart+2,2,1,1).setNumberFormat('0.0');
    sheet.getRange(summaryStart+3,2,4,1).setNumberFormat('[h]:mm');
    SpreadsheetApp.flush();

    const exportUrl='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(tempFileId)+'/export?mimeType='+encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const response=UrlFetchApp.fetch(exportUrl,{
      headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},
      muteHttpExceptions:false
    });
    blob=response.getBlob().setName(fileName);
  } finally {
    if(tempFileId){
      try{DriveApp.getFileById(tempFileId).setTrashed(true);}catch(e){console.warn('temporary export cleanup failed',e);}
    }
  }

  if(!blob) throw new Error('Excelファイルを作成できませんでした。');

  const emailLines=summary.requests.length
    ? summary.requests.map(r=>'・'+r.startDate+(r.endDate!==r.startDate?'〜'+r.endDate:'')+' '+r.type)
    : ['・特になし'];

  return {
    filename:fileName,
    mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64:Utilities.base64Encode(blob.getBytes()),
    emailText:'■有給・残業・休日出勤等\n【'+summary.employee.name+'】\n'+emailLines.join('\n')+
      '\n・欠勤 '+summary.totals.absenceDays+'日'+
      '\n・遅刻・早退 '+formatMinutes_(summary.totals.lateEarlyMinutes)+
      '\n・在宅勤務日数 '+summary.totals.remoteDays+'日'
  };
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
