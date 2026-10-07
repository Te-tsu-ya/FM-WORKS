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

  const punchSheet = getDb_().getSheetByName(DB.sheets.punches);
  const punchRows = punchSheet.getLastRow() < 2 ? [] : punchSheet.getRange(2,1,punchSheet.getLastRow()-1,12).getDisplayValues()
    .filter(r=>r[1]===targetId && r[3]>=start && r[3]<=end && String(r[8]).toUpperCase()!=='TRUE');

  const byDate = {};
  punchRows.forEach(r=>{
    (byDate[r[3]]||(byDate[r[3]]=[])).push({id:r[0],action:r[4],timestamp:r[5],workLocation:r[6]});
  });
  Object.values(byDate).forEach(rows=>rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)));

  const calendar = getCompanyCalendarRange_(start,end);
  const calendarMap = Object.fromEntries(calendar.map(d=>[d.date,d]));
  const daily = [];
  const systemToday = Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd');
  let totalMinutes=0,overtimeMinutes=0,holidayMinutes=0,workDays=0,missingPunchDays=0;

  for(let day=1;day<=lastDay;day++){
    const date=ym+'-'+String(day).padStart(2,'0');
    const rows=byDate[date]||[];
    const company=calendarMap[date]||{date:date,type:'未登録',working:false,start:'',end:'',breakMinutes:0,name:''};
    const clockIn=rows.find(x=>x.action===PUNCH.CLOCK_IN);
    const clockOut=[...rows].reverse().find(x=>x.action===PUNCH.CLOCK_OUT);
    const minutes=rows.length?calculateMonthlyDayMinutes_(rows,date===systemToday):0;
    const standard=company.working&&company.start&&company.end ? Math.max(0,timeRangeMinutes_(company.start,company.end)-Number(company.breakMinutes||0)) : 0;
    const overtime=company.working?Math.max(0,minutes-standard):0;
    const holiday=company.working?0:minutes;
    const issue=rows.length>0&&(!clockIn||!clockOut);
    if(minutes>0)workDays++;
    if(issue)missingPunchDays++;
    totalMinutes+=minutes;overtimeMinutes+=overtime;holidayMinutes+=holiday;
    daily.push({
      date:date, companyType:company.type, companyName:company.name||'', workingDay:!!company.working,
      clockIn:clockIn?clockIn.timestamp.slice(11,16):'', clockOut:clockOut?clockOut.timestamp.slice(11,16):'',
      workMinutes:minutes, overtimeMinutes:overtime, holidayMinutes:holiday, workLocation:rows.length?rows[rows.length-1].workLocation:'',
      issue:issue
    });
  }

  const requests = getApprovedRequestsForMonth_(targetId,start,end);
  let paidLeaveDays=0;
  requests.forEach(r=>{
    if(r.type==='有給') paidLeaveDays += dateSpanDays_(r.startDate,r.endDate);
    if(r.type==='午前半休'||r.type==='午後半休') paidLeaveDays += 0.5;
  });

  const worklogSheet=getDb_().getSheetByName('工数');
  const worklogRows=worklogSheet.getLastRow()<2?[]:worklogSheet.getRange(2,1,worklogSheet.getLastRow()-1,12).getDisplayValues()
    .filter(r=>r[2]===targetId&&r[1]>=start&&r[1]<=end);
  const worklogMinutes=worklogRows.reduce((sum,r)=>sum+Number(r[9]||0),0);

  return {
    yearMonth:ym,
    employee:{employeeId:employee.employeeId,name:employee.name,displayName:employee.displayName},
    totals:{
      workDays:workDays,totalMinutes:totalMinutes,overtimeMinutes:overtimeMinutes,holidayMinutes:holidayMinutes,
      paidLeaveDays:paidLeaveDays,missingPunchDays:missingPunchDays,worklogMinutes:worklogMinutes
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
  const header=['日付','会社区分','出勤','退勤','実働分','残業分','休日出勤分','勤務場所','要確認'];
  const rows=[header];
  summary.daily.forEach(d=>rows.push([
    d.date,d.companyName||d.companyType,d.clockIn,d.clockOut,d.workMinutes,d.overtimeMinutes,d.holidayMinutes,d.workLocation,d.issue?'要確認':''
  ]));
  rows.push([]);
  rows.push(['社員',summary.employee.name]);
  rows.push(['勤務日数',summary.totals.workDays]);
  rows.push(['実働分',summary.totals.totalMinutes]);
  rows.push(['残業分',summary.totals.overtimeMinutes]);
  rows.push(['休日出勤分',summary.totals.holidayMinutes]);
  rows.push(['有給取得日数',summary.totals.paidLeaveDays]);
  rows.push(['工数入力分',summary.totals.worklogMinutes]);

  const csv='\uFEFF'+rows.map(r=>r.map(csvEscape_).join(',')).join('\r\n');
  const emailLines=summary.requests.length?summary.requests.map(r=>'・'+r.startDate+(r.endDate!==r.startDate?'〜'+r.endDate:'')+' '+r.type):['・特になし'];
  return {
    filename:'FM_WORKS_'+summary.employee.employeeId+'_'+summary.yearMonth+'.csv',
    base64:Utilities.base64Encode(csv,Utilities.Charset.UTF_8),
    emailText:'■有給・残業・休日出勤等\n【'+summary.employee.name+'】\n'+emailLines.join('\n')+'\n・在宅勤務日数 '+summary.daily.filter(d=>d.workLocation==='在宅').length+'日'
  };
}

function getApprovedRequestsForMonth_(employeeId,start,end) {
  const sheet=getDb_().getSheetByName('申請');
  if(sheet.getLastRow()<2)return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,14).getDisplayValues()
    .filter(r=>r[2]===employeeId&&r[9]==='承認済'&&r[5]<=end&&r[6]>=start)
    .map(r=>({id:r[0],type:r[4],startDate:r[5],endDate:r[6],reason:r[8]}));
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
