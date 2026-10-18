const LABOR_GENERAL_JP = Object.freeze({
  dailyStatutoryMinutes:480,
  weeklyStatutoryMinutes:2400,
  monthlyOvertimePrincipleMinutes:2700,
  monthlyOvertimePremium50Minutes:3600,
  annualOvertimePrincipleMinutes:21600,
  specialAnnualOvertimeLimitMinutes:43200,
  specialSingleMonthOvertimeHolidayLimitMinutes:6000,
  specialMultiMonthAverageLimitMinutes:4800,
  specialExcessMonthLimit:6,
  nightStartMinutes:1320,
  nightEndMinutes:300
});
const LABOR_WEEKDAY_INDEX=Object.freeze({SUNDAY:0,MONDAY:1,TUESDAY:2,WEDNESDAY:3,THURSDAY:4,FRIDAY:5,SATURDAY:6});

function normalizeLaborWeekStartDay_(value){
  const v=String(value||'').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(LABOR_WEEKDAY_INDEX,v)?v:'';
}

function normalizeLaborAgreementStartMonth_(value){
  const n=Number(value);
  return Number.isInteger(n)&&n>=1&&n<=12?n:0;
}

function normalizeLaborSpecialClause_(value){
  const v=String(value||'UNCONFIGURED').trim().toUpperCase();
  return ['NONE','ENABLED'].includes(v)?v:'UNCONFIGURED';
}

function getLaborRuleConfig_(){
  const s=getSettingsMap_();
  const profile=String(s.LABOR_RULE_PROFILE||'UNCONFIGURED').trim().toUpperCase()==='GENERAL_JP'?'GENERAL_JP':'UNCONFIGURED';
  const weekStartDay=normalizeLaborWeekStartDay_(s.LABOR_WEEK_START_DAY);
  const agreementStartMonth=normalizeLaborAgreementStartMonth_(s.LABOR_36_PERIOD_START_MONTH);
  const specialClause=normalizeLaborSpecialClause_(s.LABOR_SPECIAL_CLAUSE);
  return {
    profile,weekStartDay,agreementStartMonth,specialClause,
    configured:profile==='GENERAL_JP'&&!!weekStartDay&&!!agreementStartMonth&&specialClause!=='UNCONFIGURED',
    statutoryHolidaySource:String(s.LABOR_STATUTORY_HOLIDAY_SOURCE||'CALENDAR_TAG'),
    confirmedBy:String(s.LABOR_RULE_CONFIRMED_BY||''),
    confirmedAt:String(s.LABOR_RULE_CONFIRMED_AT||''),
    note:String(s.LABOR_RULE_NOTE||'')
  };
}

function getLaborAdminConfig(sessionToken){requireAdminSession_(sessionToken);return getLaborRuleConfig_();}

function saveLaborRuleConfig(sessionToken,payload){
  const admin=requireAdminSession_(sessionToken).employee;
  payload=payload||{};
  const profile=String(payload.profile||'UNCONFIGURED').toUpperCase()==='GENERAL_JP'?'GENERAL_JP':'UNCONFIGURED';
  const weekStartDay=normalizeLaborWeekStartDay_(payload.weekStartDay);
  const agreementStartMonth=normalizeLaborAgreementStartMonth_(payload.agreementStartMonth);
  const specialClause=normalizeLaborSpecialClause_(payload.specialClause);
  if(profile==='GENERAL_JP'&&!weekStartDay)throw new Error('一般則プロファイルを有効にする場合は、就業規則上の週開始曜日を設定してください。');
  if(profile==='GENERAL_JP'&&!agreementStartMonth)throw new Error('一般則プロファイルを有効にする場合は、36協定の対象期間の起算月を設定してください。');
  if(profile==='GENERAL_JP'&&specialClause==='UNCONFIGURED')throw new Error('36協定の特別条項の有無を確認してください。');
  const before=getLaborRuleConfig_();
  const now=toTimestamp_(new Date());
  saveSettings_({
    LABOR_RULE_PROFILE:profile,
    LABOR_WEEK_START_DAY:weekStartDay,
    LABOR_36_PERIOD_START_MONTH:agreementStartMonth||'',
    LABOR_SPECIAL_CLAUSE:specialClause,
    LABOR_STATUTORY_HOLIDAY_SOURCE:'CALENDAR_TAG',
    LABOR_RULE_CONFIRMED_BY:profile==='GENERAL_JP'?admin.name:'',
    LABOR_RULE_CONFIRMED_AT:profile==='GENERAL_JP'?now:'',
    LABOR_RULE_NOTE:safeSheetText_(payload.note,500)
  });
  const after=getLaborRuleConfig_();
  appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation:'労務ルール設定',target:'設定',targetId:'LABOR_RULE_PROFILE',
    before:JSON.stringify(before),after:JSON.stringify(after),source:'WEB',result:'SUCCESS',note:''});
  return after;
}

function dailyStatutoryOvertimeMinutes_(workMinutes,statutoryHoliday){
  return statutoryHoliday?0:Math.max(0,Number(workMinutes||0)-LABOR_GENERAL_JP.dailyStatutoryMinutes);
}

function lateNightOverlapMinutes_(startMinute,endMinute){
  const start=Number(startMinute),end=Number(endMinute);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 0;
  let total=0;
  const from=Math.floor(start/1440)-1,to=Math.floor(end/1440)+1;
  for(let d=from;d<=to;d++){
    [[d*1440,d*1440+300],[d*1440+1320,d*1440+1440]].forEach(w=>{
      total+=Math.max(0,Math.min(end,w[1])-Math.max(start,w[0]));
    });
  }
  return Math.round(total);
}

function punchMinute_(timestamp){
  const m=String(timestamp||'').match(/(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return m?Number(m[1])*60+Number(m[2]):null;
}

function calculateLateNightMinutesForRows_(rows,isToday){
  const ordered=(rows||[]).slice().sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp)));
  let active=null,total=0;
  const close=value=>{
    if(active===null)return;
    let end=punchMinute_(value);
    if(end===null){active=null;return;}
    if(end<active)end+=1440;
    total+=lateNightOverlapMinutes_(active,end);
    active=null;
  };
  ordered.forEach(r=>{
    const m=punchMinute_(r.timestamp);
    if(m===null)return;
    if(r.action===PUNCH.CLOCK_IN)active=m;
    else if(r.action===PUNCH.BREAK_START)close(r.timestamp);
    else if(r.action===PUNCH.BREAK_END)active=m;
    else if(r.action===PUNCH.CLOCK_OUT)close(r.timestamp);
  });
  if(active!==null&&isToday){
    const now=Number(Utilities.formatDate(new Date(),DB.timeZone,'H'))*60+Number(Utilities.formatDate(new Date(),DB.timeZone,'m'));
    let end=now;if(end<active)end+=1440;
    total+=lateNightOverlapMinutes_(active,end);
  }
  return Math.max(0,Math.round(total));
}

function estimateLateNightMinutesFromClockTimes_(clockIn,clockOut){
  if(!clockIn||!clockOut)return 0;
  let start=timeToMinutes_(clockIn),end=timeToMinutes_(clockOut);
  if(end<start)end+=1440;
  return lateNightOverlapMinutes_(start,end);
}

function laborWeekKey_(dateText,weekStartDay){
  const idx=LABOR_WEEKDAY_INDEX[normalizeLaborWeekStartDay_(weekStartDay)];
  if(idx===undefined)return '';
  const p=String(dateText).split('-').map(Number);
  const d=new Date(Date.UTC(p[0],p[1]-1,p[2]));
  const diff=(d.getUTCDay()-idx+7)%7;
  d.setUTCDate(d.getUTCDate()-diff);
  return d.toISOString().slice(0,10);
}

function applyWeeklyStatutoryOvertimeToFacts_(facts,weekStartDay){
  const start=normalizeLaborWeekStartDay_(weekStartDay),state={};
  const ordered=(facts||[]).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  ordered.forEach(f=>{
    f.statutoryDailyOvertimeMinutes=dailyStatutoryOvertimeMinutes_(f.workMinutes,!!f.statutoryHoliday);
    f.statutoryWeeklyOvertimeMinutes=0;
    if(!start||f.statutoryHoliday)return;
    const key=laborWeekKey_(f.date,start);
    const s=state[key]||(state[key]={regular:0});
    const before=Math.max(0,s.regular-2400);
    s.regular+=Math.min(480,Math.max(0,Number(f.workMinutes||0)));
    const after=Math.max(0,s.regular-2400);
    f.statutoryWeeklyOvertimeMinutes=Math.max(0,after-before);
  });
  return ordered;
}

function laborBoundaryFacts_(employeeId,start,end,systemToday){
  if(start>end)return [];
  const punches=getActivePunchRows_(employeeId,start,end),byDate={};
  punches.forEach(r=>(byDate[r[3]]||(byDate[r[3]]=[])).push({id:r[0],action:r[4],timestamp:r[5],workLocation:r[6]}));
  Object.values(byDate).forEach(rows=>rows.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)));
  const legacy=getLegacyDailySnapshots_(employeeId,start,end);
  const calendar=Object.fromEntries(getCompanyCalendarRange_(start,end).map(d=>[d.date,d]));
  const out=[];
  for(let date=start;;date=addDateString_(date,1)){
    const rows=byDate[date]||[],snap=rows.length?null:(legacy[date]||null),company=calendar[date]||{type:'未登録'};
    const workMinutes=snap?Number(snap.workMinutes||0):(rows.length?calculateMonthlyDayMinutes_(rows,date===systemToday):0);
    out.push({date,workMinutes,statutoryHoliday:company.type==='法定休日'});
    if(date===end)break;
  }
  return out;
}

function laborShiftYearMonth_(yearMonth,delta){
  const ym=String(yearMonth||'');
  if(!/^\d{4}-\d{2}$/.test(ym))return '';
  const p=ym.split('-').map(Number),d=new Date(Date.UTC(p[0],p[1]-1+Number(delta||0),1));
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
}

function laborAgreementPeriodStart_(targetYearMonth,startMonth){
  const ym=String(targetYearMonth||'');
  const m=normalizeLaborAgreementStartMonth_(startMonth);
  if(!/^\d{4}-\d{2}$/.test(ym)||!m)return '';
  const year=Number(ym.slice(0,4)),month=Number(ym.slice(5,7));
  const startYear=month>=m?year:year-1;
  return startYear+'-'+String(m).padStart(2,'0');
}

function getClosedLaborHistory_(employeeId,targetYearMonth,monthsBack){
  const start=laborShiftYearMonth_(targetYearMonth,-Math.max(0,Number(monthsBack||11)));
  const sheet=getDb_().getSheetByName(DB.sheets.monthlySnapshot);
  if(!sheet||sheet.getLastRow()<2)return [];
  const rows=readRowsByColumnValues_(sheet,3,24,[employeeId]);
  const latest={};
  rows.forEach(r=>{
    const ym=r[1],id=r[2];
    if(id!==employeeId||ym<start||ym>targetYearMonth)return;
    const stamp=r[18]||r[4]||'';
    if(!latest[ym]||stamp>latest[ym].stamp){
      latest[ym]={
        yearMonth:ym,
        statutoryOvertimeMinutes:Number(r[19]||0),
        statutoryHolidayMinutes:Number(r[21]||0),
        overtimeHolidayMinutes:Number(r[22]||0),
        ruleStatus:r[23]||'',
        stamp:stamp
      };
    }
  });
  return Object.values(latest).sort((a,b)=>a.yearMonth.localeCompare(b.yearMonth));
}

function evaluateGeneralLaborHistory_(records,targetYearMonth,startMonth,specialClause){
  const target=String(targetYearMonth||''),periodStart=laborAgreementPeriodStart_(target,startMonth);
  const byMonth={};
  (records||[]).forEach(r=>{if(r&&r.yearMonth)byMonth[r.yearMonth]=r;});
  const periodMonths=periodStart?yearMonthsBetween_(periodStart,target):[];
  const periodComplete=periodMonths.length>0&&periodMonths.every(ym=>!!byMonth[ym]);
  const periodRecords=periodMonths.map(ym=>byMonth[ym]).filter(Boolean);
  const annualStatutoryOvertimeMinutes=periodRecords.reduce((a,r)=>a+Number(r.statutoryOvertimeMinutes||0),0);
  const monthsOver45=periodRecords.filter(r=>Number(r.statutoryOvertimeMinutes||0)>LABOR_GENERAL_JP.monthlyOvertimePrincipleMinutes).length;
  let maxMultiMonthAverageMinutes=0,maxMultiMonthWindow=0,multiMonthComplete=false;
  for(let size=2;size<=6;size++){
    const months=[];
    for(let i=size-1;i>=0;i--)months.push(laborShiftYearMonth_(target,-i));
    if(months.every(ym=>!!byMonth[ym])){
      multiMonthComplete=true;
      const avg=Math.round(months.reduce((a,ym)=>a+Number(byMonth[ym].overtimeHolidayMinutes||0),0)/size);
      if(avg>maxMultiMonthAverageMinutes){maxMultiMonthAverageMinutes=avg;maxMultiMonthWindow=size;}
    }
  }
  return {
    agreementPeriodStart:periodStart,
    annualStatutoryOvertimeMinutes,
    monthsOver45,
    periodComplete,
    maxMultiMonthAverageMinutes,
    maxMultiMonthWindow,
    multiMonthComplete,
    specialClause:normalizeLaborSpecialClause_(specialClause)
  };
}

function applyLaborModelToMonthlyDaily_(daily,employeeId,start,end,systemToday){
  const config=getLaborRuleConfig_(),byDate=Object.fromEntries((daily||[]).map(d=>[d.date,d]));
  daily.forEach(d=>{
    d.statutoryHoliday=d.companyType==='法定休日';
    d.statutoryDailyOvertimeMinutes=dailyStatutoryOvertimeMinutes_(d.workMinutes,d.statutoryHoliday);
    d.statutoryWeeklyOvertimeMinutes=0;
    d.statutoryHolidayMinutes=d.statutoryHoliday?Number(d.workMinutes||0):0;
    d.laborIssue='';
  });
  if(config.weekStartDay){
    const weekStart=laborWeekKey_(start,config.weekStartDay),lastWeekStart=laborWeekKey_(end,config.weekStartDay);
    const p=lastWeekStart.split('-').map(Number),last=new Date(Date.UTC(p[0],p[1]-1,p[2]+6)),weekEnd=last.toISOString().slice(0,10);
    const facts=(weekStart<start?laborBoundaryFacts_(employeeId,weekStart,addDateString_(start,-1),systemToday):[])
      .concat(daily.map(d=>({date:d.date,workMinutes:d.workMinutes,statutoryHoliday:d.statutoryHoliday})))
      .concat(end<weekEnd?laborBoundaryFacts_(employeeId,addDateString_(end,1),weekEnd,systemToday):[]);
    applyWeeklyStatutoryOvertimeToFacts_(facts,config.weekStartDay).forEach(f=>{
      if(byDate[f.date])byDate[f.date].statutoryWeeklyOvertimeMinutes=Number(f.statutoryWeeklyOvertimeMinutes||0);
    });
  }
  let statutoryOvertimeMinutes=0,lateNightMinutes=0,statutoryHolidayMinutes=0;
  daily.forEach(d=>{
    statutoryOvertimeMinutes+=Number(d.statutoryDailyOvertimeMinutes||0)+Number(d.statutoryWeeklyOvertimeMinutes||0);
    lateNightMinutes+=Number(d.lateNightMinutes||0);
    statutoryHolidayMinutes+=Number(d.statutoryHolidayMinutes||0);
  });
  const overtimeHolidayMinutes=statutoryOvertimeMinutes+statutoryHolidayMinutes,warnings=[];
  const targetYearMonth=String(start||'').slice(0,7);
  const history=getClosedLaborHistory_(employeeId,targetYearMonth,11).filter(r=>r.yearMonth!==targetYearMonth);
  history.push({yearMonth:targetYearMonth,statutoryOvertimeMinutes,statutoryHolidayMinutes,overtimeHolidayMinutes,ruleStatus:config.configured?'CONFIGURED':'UNCONFIGURED'});
  const period=evaluateGeneralLaborHistory_(history,targetYearMonth,config.agreementStartMonth,config.specialClause);
  if(!config.configured)warnings.push('就業規則・36協定の確認が未完了です。表示値は一般則を基礎にした参考値です。');
  if(!config.weekStartDay)warnings.push('週40時間判定の週開始曜日が未設定です。');
  if(statutoryOvertimeMinutes>2700)warnings.push('法定時間外が月45時間を超えています。');
  if(statutoryOvertimeMinutes>3600)warnings.push('法定時間外が月60時間を超えています。');
  if(overtimeHolidayMinutes>=LABOR_GENERAL_JP.specialSingleMonthOvertimeHolidayLimitMinutes)warnings.push('法定時間外＋法定休日労働が単月100時間以上です。');
  if(config.agreementStartMonth){
    if(period.periodComplete){
      if(period.annualStatutoryOvertimeMinutes>LABOR_GENERAL_JP.annualOvertimePrincipleMinutes)warnings.push('36協定の対象期間で法定時間外が年360時間を超えています。');
      if(config.specialClause==='ENABLED'&&period.annualStatutoryOvertimeMinutes>LABOR_GENERAL_JP.specialAnnualOvertimeLimitMinutes)warnings.push('特別条項ありでも法定時間外が年720時間を超えています。');
      if(config.specialClause==='ENABLED'&&period.monthsOver45>LABOR_GENERAL_JP.specialExcessMonthLimit)warnings.push('月45時間を超えた月が年6か月を超えています。');
    }else if(period.agreementPeriodStart){
      warnings.push('36協定の年次判定に必要な過去月の確定データが不足しています。');
    }
    if(period.multiMonthComplete&&period.maxMultiMonthAverageMinutes>LABOR_GENERAL_JP.specialMultiMonthAverageLimitMinutes){
      warnings.push('法定時間外＋法定休日労働の'+period.maxMultiMonthWindow+'か月平均が80時間を超えています。');
    }
  }
  if(config.specialClause==='NONE'&&statutoryOvertimeMinutes>LABOR_GENERAL_JP.monthlyOvertimePrincipleMinutes)warnings.push('特別条項なし設定で月45時間を超えています。36協定を確認してください。');
  return {ruleStatus:config.configured?'CONFIGURED':'UNCONFIGURED',profile:config.profile,weekStartDay:config.weekStartDay,
    agreementStartMonth:config.agreementStartMonth,specialClause:config.specialClause,
    statutoryOvertimeMinutes,lateNightMinutes,statutoryHolidayMinutes,overtimeHolidayMinutes,
    annualStatutoryOvertimeMinutes:period.annualStatutoryOvertimeMinutes,monthsOver45:period.monthsOver45,
    multiMonthAverageMinutes:period.maxMultiMonthAverageMinutes,multiMonthWindow:period.maxMultiMonthWindow,
    historyComplete:period.periodComplete,warnings};
}


function previousYearMonth_(dateText) {
  const s=String(dateText||'');
  const m=s.match(/^(\d{4})-(\d{2})/);
  if(!m)throw new Error('日付を確認してください。');
  let year=Number(m[1]),month=Number(m[2])-1;
  if(month<1){year--;month=12;}
  return year+'-'+String(month).padStart(2,'0');
}

function yearMonthsBetween_(startMonth, endMonth) {
  const start=normalizeYearMonth_(startMonth);
  const end=normalizeYearMonth_(endMonth);
  if(start>end)return [];
  let year=Number(start.slice(0,4)),month=Number(start.slice(5,7));
  const out=[];
  for(let guard=0;guard<240;guard++){
    const ym=year+'-'+String(month).padStart(2,'0');
    if(ym>end)break;
    out.push(ym);
    month++;
    if(month>12){month=1;year++;}
  }
  return out;
}

function monthEndString_(yearMonth) {
  const ym=normalizeYearMonth_(yearMonth);
  const p=ym.split('-').map(Number);
  return ym+'-'+String(new Date(p[0],p[1],0).getDate()).padStart(2,'0');
}

function monthlyReviewUrgency_(day, dueDay) {
  const d=Math.max(1,Number(day||1));
  const due=Math.max(1,Math.min(31,Number(dueDay||5)));
  return d<=due?'warning':'danger';
}

function getMonthlyReviewStartMonth_(latestRequiredMonth) {
  const latest=normalizeYearMonth_(latestRequiredMonth);
  const settings=getSettingsMap_();
  let start=String(settings.MONTHLY_REVIEW_START_MONTH||'').trim();
  if(!/^\d{4}-\d{2}$/.test(start)||start>latest){
    start=latest;
    try{saveSettings_({MONTHLY_REVIEW_START_MONTH:start});}catch(e){console.warn('Monthly review start month persistence failed',e);}
  }
  return normalizeYearMonth_(start);
}

function getMonthlyReviewSheet_(createIfMissing) {
  const db=getDb_();
  let sheet=db.getSheetByName(DB.sheets.monthlyReview);
  if(sheet||!createIfMissing)return sheet;
  sheet=db.insertSheet(DB.sheets.monthlyReview);
  sheet.getRange(1,1,1,10).setValues([[
    '年月','社員ID','氏名','状態','確認日時','確認者','確認時最終更新','メモ','登録日時','更新日時'
  ]]);
  sheet.setFrozenRows(1);
  return sheet;
}

function getLatestMonthlyDataUpdateMap_(employeeId, startMonth, endMonth) {
  const months=yearMonthsBetween_(startMonth,endMonth);
  const allowed=new Set(months);
  const latestByMonth={};
  months.forEach(ym=>latestByMonth[ym]='');

  function consider(ym,value){
    if(!allowed.has(ym)||!value)return;
    const candidate=parseTimestamp_(value);
    const current=parseTimestamp_(latestByMonth[ym]);
    if(candidate&&(!current||candidate>current))latestByMonth[ym]=toTimestamp_(candidate);
  }

  const rangeStart=months.length?months[0]+'-01':'';
  const rangeEnd=months.length?monthEndString_(months[months.length-1]):'';
  if(!months.length)return latestByMonth;

  const db=getDb_();

  const punchSheet=db.getSheetByName(DB.sheets.punches);
  if(punchSheet&&punchSheet.getLastRow()>=2){
    readRowsByDateRange_(punchSheet,4,12,rangeStart,rangeEnd,2,[employeeId]).forEach(r=>{
      if(r[1]!==employeeId||r[3]<rangeStart||r[3]>rangeEnd)return;
      consider(String(r[3]).slice(0,7),r[11]||r[5]);
    });
  }

  const worklogSheet=db.getSheetByName('工数');
  if(worklogSheet&&worklogSheet.getLastRow()>=2){
    readRowsByDateRange_(worklogSheet,2,15,rangeStart,rangeEnd,3,[employeeId]).forEach(r=>{
      if(r[2]!==employeeId||r[1]<rangeStart||r[1]>rangeEnd)return;
      consider(String(r[1]).slice(0,7),r[14]||r[11]);
    });
  }

  const requestSheet=db.getSheetByName('申請');
  if(requestSheet&&requestSheet.getLastRow()>=2){
    readRowsByColumnValues_(requestSheet,3,14,[employeeId]).forEach(r=>{
      if(!r[5]||!r[6]||r[5]>rangeEnd||r[6]<rangeStart)return;
      months.forEach(ym=>{
        if(r[5]<=monthEndString_(ym)&&r[6]>=ym+'-01'){
          consider(ym,r[13]);
          consider(ym,r[11]);
        }
      });
    });
  }

  const calendarSheet=db.getSheetByName(DB.sheets.companyCalendar);
  if(calendarSheet&&calendarSheet.getLastRow()>=2){
    readRowsByDateRange_(calendarSheet,1,10,rangeStart,rangeEnd).forEach(r=>{
      if(!r[0]||r[0]<rangeStart||r[0]>rangeEnd)return;
      consider(String(r[0]).slice(0,7),r[9]);
    });
  }

  return latestByMonth;
}

function getMonthlyReviewHistoryInternal_(employeeId, startMonth, endMonth) {
  const months=yearMonthsBetween_(startMonth,endMonth);
  if(!months.length)return [];

  const sheet=getMonthlyReviewSheet_(false);
  const rows=sheet&&sheet.getLastRow()>=2
    ? readRowsByColumnValues_(sheet,2,10,[employeeId]).filter(r=>months.includes(r[0]))
    : [];
  const rowByMonth=Object.fromEntries(rows.map(r=>[r[0],r]));
  const latestByMonth=getLatestMonthlyDataUpdateMap_(employeeId,months[0],months[months.length-1]);

  return months.map(ym=>{
    const row=rowByMonth[ym]||null;
    const confirmedAt=row&&row[3]==='CONFIRMED'?row[4]||'':'';
    const lastUpdatedAt=latestByMonth[ym]||'';
    const confirmedDate=parseTimestamp_(confirmedAt);
    const lastDate=parseTimestamp_(lastUpdatedAt);
    const stale=!!(confirmedDate&&lastDate&&lastDate>confirmedDate);
    return {
      yearMonth:ym,
      employeeId:employeeId,
      recorded:!!row,
      status:row?row[3]||'PENDING':'PENDING',
      confirmed:!!confirmedAt&&!stale,
      stale:stale,
      confirmedAt:confirmedAt,
      confirmedBy:row?row[5]||'':'',
      lastUpdatedAt:lastUpdatedAt,
      note:row?row[7]||'':''
    };
  });
}

function getMonthlyReviewPrompt_(employeeId) {
  const today=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');
  const day=Number(today.slice(8,10));
  const latestRequiredMonth=previousYearMonth_(today);
  const startMonth=getMonthlyReviewStartMonth_(latestRequiredMonth);
  const dueDay=Math.max(1,Math.min(31,Number(getSettingsMap_().MONTHLY_REVIEW_DUE_DAY||5)));
  const history=getMonthlyReviewHistoryInternal_(employeeId,startMonth,latestRequiredMonth);
  const outstanding=history.filter(x=>!x.confirmed||x.stale);
  const target=outstanding[0]||history[history.length-1]||{
    yearMonth:latestRequiredMonth,confirmed:false,stale:false,confirmedAt:'',lastUpdatedAt:''
  };
  const isBacklog=target.yearMonth<latestRequiredMonth;
  const needsAttention=outstanding.length>0;

  return {
    targetMonth:target.yearMonth,
    latestRequiredMonth:latestRequiredMonth,
    reviewStartMonth:startMonth,
    pendingCount:outstanding.length,
    isBacklog:isBacklog,
    dueDay:dueDay,
    urgency:needsAttention&&(isBacklog||monthlyReviewUrgency_(day,dueDay)==='danger')?'danger':'warning',
    needsAttention:needsAttention,
    confirmed:target.confirmed,
    stale:target.stale,
    confirmedAt:target.confirmedAt,
    lastUpdatedAt:target.lastUpdatedAt,
    message:!needsAttention
      ? latestRequiredMonth+'までの勤怠確認は完了しています。'
      : target.stale
        ? target.yearMonth+'の勤怠は確認後に変更があります。もう一度確認してください。'
        : isBacklog
          ? target.yearMonth+'の勤怠確認が未完了です。古い未確認月から順に確認してください。'
          : target.yearMonth+'の勤怠内容に誤りがないか確認してください。'
  };
}

function getMonthlyReviewStatus(sessionToken, yearMonth, employeeId) {
  const session=requireSession_(sessionToken);
  const ym=normalizeYearMonth_(yearMonth);
  const requested=employeeId?String(employeeId).trim().toUpperCase():session.employee.employeeId;
  if(requested!==session.employee.employeeId&&!canManageEmployee_(session.employee,requested)) throw new Error('この社員の月次確認状態を表示する権限がありません。');
  return getMonthlyReviewStatusInternal_(ym,requested);
}

function getMonthlyReviewStatusInternal_(yearMonth, employeeId) {
  const ym=normalizeYearMonth_(yearMonth);
  const history=getMonthlyReviewHistoryInternal_(employeeId,ym,ym);
  return history[0]||{
    yearMonth:ym,employeeId:employeeId,recorded:false,status:'PENDING',confirmed:false,stale:false,
    confirmedAt:'',confirmedBy:'',lastUpdatedAt:'',note:''
  };
}

function confirmMonthlyReview(sessionToken, yearMonth, note) {
  const session=requireSession_(sessionToken);
  const employee=session.employee;
  const ym=normalizeYearMonth_(yearMonth);
  const current=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM');
  if(ym>=current)throw new Error('当月または未来の勤怠は月次確認できません。');

  return withScriptLock_(function(){
    const summary=getMonthlySummary(sessionToken,ym,employee.employeeId);
    const blockers=[];
    if(summary.totals.missingPunchDays>0)blockers.push('要確認日 '+summary.totals.missingPunchDays+'日');
    if(summary.totals.worklogMismatchDays>0)blockers.push('工数差異 '+summary.totals.worklogMismatchDays+'日');
    if(blockers.length){
      throw new Error('確認未完了の項目があります（'+blockers.join(' / ')+'）。赤・黄の付いた日を確認してください。');
    }

    const sheet=getMonthlyReviewSheet_(true);
    const lastRow=sheet.getLastRow();
    // Search the employee ID column, then read only the matching month's row.
    // The previous implementation downloaded all 10 columns for every employee.
    let existingRow=0;
    if(lastRow>=2){
      const matches=sheet.getRange(2,2,lastRow-1,1)
        .createTextFinder(employee.employeeId).matchEntireCell(true).findAll();
      for(const candidate of matches){
        const row=candidate.getRow();
        if(sheet.getRange(row,1).getDisplayValue()===ym){
          existingRow=row;
          break;
        }
      }
    }
    const before=existingRow?sheet.getRange(existingRow,1,1,10).getDisplayValues()[0]:null;
    const rowNumber=existingRow||Math.max(2,lastRow+1);
    const nowText=toTimestamp_(new Date());
    const latest=getLatestMonthlyDataUpdate_(employee.employeeId,ym);
    const createdAt=before?(before[8]||nowText):nowText;
    const memo=safeSheetText_(note,500);
    sheet.getRange(rowNumber,1,1,10).setValues([[
      ym,employee.employeeId,employee.name,'CONFIRMED',nowText,employee.name,latest,memo,createdAt,nowText
    ]]);
    appendAudit_({
      employeeId:employee.employeeId,employeeName:employee.name,operation:'月次勤怠確認',
      target:'月次確認',targetId:ym,before:before?(before[3]||'PENDING'):'PENDING',
      after:'CONFIRMED',source:'WEB',result:'SUCCESS',note:memo
    });
    SpreadsheetApp.flush();
    return getMonthlyReviewStatusInternal_(ym,employee.employeeId);
  });
}

function getLatestMonthlyDataUpdate_(employeeId, yearMonth) {
  const ym=normalizeYearMonth_(yearMonth);
  const map=getLatestMonthlyDataUpdateMap_(employeeId,ym,ym);
  return map[ym]||'';
}

function getMonthlyCloseStatus(sessionToken, yearMonth) {
  requireSession_(sessionToken);
  const ym=normalizeYearMonth_(yearMonth);
  return getMonthlyCloseStatusInternal_(ym);
}

function getMonthlyCloseStatusInternal_(yearMonth) {
  const ym=normalizeYearMonth_(yearMonth);
  const sheet=getDb_().getSheetByName(DB.sheets.monthlyClose);
  if(!sheet||sheet.getLastRow()<2)return {yearMonth:ym,closed:false,status:'OPEN',closedAt:'',closedBy:'',reopenedAt:'',reopenedBy:'',note:'',snapshotId:''};
  const found=sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(ym).matchEntireCell(true).findNext();
  if(!found)return {yearMonth:ym,closed:false,status:'OPEN',closedAt:'',closedBy:'',reopenedAt:'',reopenedBy:'',note:'',snapshotId:''};
  const r=sheet.getRange(found.getRow(),1,1,9).getDisplayValues()[0];
  return {yearMonth:ym,closed:r[1]==='CLOSED',status:r[1]||'OPEN',closedAt:r[2]||'',closedBy:r[3]||'',reopenedAt:r[4]||'',reopenedBy:r[5]||'',note:r[6]||'',snapshotId:r[8]||''};
}
function closeMonthlyPeriod(sessionToken, yearMonth) {
  const admin=requireAdminSession_(sessionToken).employee;
  const ym=normalizeYearMonth_(yearMonth);
  const current=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM');
  if(ym>=current)throw new Error('当月または未来の月は締め処理できません。月末後に実行してください。');

  return withScriptLock_(function(){
    const currentStatus=getMonthlyCloseStatusInternal_(ym);
    if(currentStatus.closed)return currentStatus;

    const employees=getPayrollEmployees_();
    if(!employees.length)throw new Error('給与集計対象の社員が設定されていません。');
    const summaries=employees.map(e=>getMonthlySummary(sessionToken,ym,e.employeeId));
    const laborBlocked=summaries.filter(s=>!s.labor||s.labor.ruleStatus!=='CONFIGURED');
    if(laborBlocked.length)throw new Error('労務ルールが未確定です。設定 → 運用設定で就業規則・36協定を確認してから月次締めしてください。');
    const attendanceBlockers=summaries.filter(s=>s.totals.missingPunchDays>0);
    if(attendanceBlockers.length){
      throw new Error('要確認の勤怠が残っています: '+attendanceBlockers.map(s=>s.employee.name+' '+s.totals.missingPunchDays+'日').join(' / '));
    }
    const worklogBlockers=summaries.filter(s=>s.totals.worklogMismatchDays>0);
    if(worklogBlockers.length){
      throw new Error('実働と工数の差異が残っています: '+worklogBlockers.map(s=>s.employee.name+' '+s.totals.worklogMismatchDays+'日').join(' / '));
    }

    const start=ym+'-01';
    const p=ym.split('-').map(Number);
    const end=ym+'-'+String(new Date(p[0],p[1],0).getDate()).padStart(2,'0');
    const requestSheet=getDb_().getSheetByName('申請');
    if(requestSheet&&requestSheet.getLastRow()>=2){
      const payrollIds=new Set(employees.map(e=>e.employeeId));
      const pending=readRowsByColumnValues_(requestSheet,3,14,[...payrollIds])
        .filter(r=>r[0]&&payrollIds.has(r[2])&&r[9]==='承認待ち'&&r[5]<=end&&r[6]>=start);
      if(pending.length)throw new Error('対象月に承認待ち申請が'+pending.length+'件あります。すべて処理してから締めてください。');
    }

    const snapshotId=persistMonthlyCloseSnapshots_(ym,summaries,admin);

    const sheet=getDb_().getSheetByName(DB.sheets.monthlyClose);
    const lastRow=sheet.getLastRow();
    const found=lastRow>=2?sheet.getRange(2,1,lastRow-1,1).createTextFinder(ym).matchEntireCell(true).findNext():null;
    const row=found?found.getRow():Math.max(2,lastRow+1);
    const nowText=toTimestamp_(new Date());
    const before=found?sheet.getRange(row,1,1,9).getDisplayValues()[0]:['','','','','','','','',''];
    sheet.getRange(row,1,1,9).setValues([[ym,'CLOSED',nowText,admin.name,before[4]||'',before[5]||'',before[6]||'',nowText,snapshotId]]);
    appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation:'月次締め',target:'月次締め',targetId:ym,before:before[1]||'OPEN',after:'CLOSED',source:'WEB',result:'SUCCESS',note:'給与対象 '+employees.length+'名 / snapshot '+snapshotId});
    SpreadsheetApp.flush();
    return getMonthlyCloseStatusInternal_(ym);
  },30000);
}

function reopenMonthlyPeriod(sessionToken, yearMonth, reason) {
  const admin=requireAdminSession_(sessionToken).employee;
  const ym=normalizeYearMonth_(yearMonth);
  const note=safeSheetText_(reason,500);
  if(!note)throw new Error('再開理由を入力してください。');
  return withScriptLock_(function(){
    const sheet=getDb_().getSheetByName(DB.sheets.monthlyClose);
    const lastRow=sheet.getLastRow();
    const found=lastRow>=2?sheet.getRange(2,1,lastRow-1,1).createTextFinder(ym).matchEntireCell(true).findNext():null;
    if(!found)throw new Error('締め済みの月が見つかりません。');
    const row=found.getRow();
    const before=sheet.getRange(row,1,1,9).getDisplayValues()[0];
    if(before[1]!=='CLOSED')return getMonthlyCloseStatusInternal_(ym);
    const nowText=toTimestamp_(new Date());
    sheet.getRange(row,2,1,8).setValues([['OPEN',before[2]||'',before[3]||'',nowText,admin.name,note,nowText,before[8]||'']]);
    appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation:'月次締め解除',target:'月次締め',targetId:ym,before:'CLOSED',after:'OPEN',source:'WEB',result:'SUCCESS',note:note});
    SpreadsheetApp.flush();
    return getMonthlyCloseStatusInternal_(ym);
  });
}

function assertMonthOpenForDate_(date, operationLabel) {
  const normalized=normalizeDate_(date);
  const ym=normalized.slice(0,7);
  if(getMonthlyCloseStatusInternal_(ym).closed){
    throw new Error(ym+'は月次締め済みのため'+(operationLabel||'変更')+'できません。管理者が月次締めを解除してください。');
  }
  return true;
}

function assertMonthRangeOpen_(startDate,endDate,operationLabel){
  const firstDate=normalizeDate_(startDate),lastDate=normalizeDate_(endDate||startDate);
  if(firstDate>lastDate)throw new Error('対象期間の開始日と終了日を確認してください。');
  let ym=firstDate.slice(0,7);
  const endYm=lastDate.slice(0,7);
  while(true){
    if(getMonthlyCloseStatusInternal_(ym).closed){
      throw new Error(ym+'は月次締め済みのため'+(operationLabel||'変更')+'できません。');
    }
    if(ym===endYm)break;
    const p=ym.split('-').map(Number);
    const d=new Date(p[0],p[1],1);
    ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  }
}

function normalizeYearMonth_(value){
  const ym=String(value||Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM'));
  if(!/^\d{4}-\d{2}$/.test(ym))throw new Error('対象月を確認してください。');
  const p=ym.split('-').map(Number);
  if(p[1]<1||p[1]>12)throw new Error('対象月を確認してください。');
  return ym;
}

function getLegacyDailySnapshots_(employeeId, start, end) {
  const sheet = getDb_().getSheetByName('日次勤怠');
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;

  readRowsByDateRange_(sheet,1,16,start,end,2,[employeeId]).forEach(r=>{
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
  const perfStarted=Date.now();
  const session = requireSession_(sessionToken);
  const ym = normalizeYearMonth_(yearMonth);

  const requestedId = employeeId ? String(employeeId).trim().toUpperCase() : session.employee.employeeId;
  if (requestedId !== session.employee.employeeId && !canManageEmployee_(session.employee, requestedId)) throw new Error('この社員の月次勤怠を表示する権限がありません。');
  const targetId = requestedId;
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

  const worklogSheet=getDb_().getSheetByName('工数');
  const worklogRows=worklogSheet.getLastRow()<2?[]:readRowsByDateRange_(worklogSheet,2,15,start,end,3,[targetId])
    .filter(r=>r[2]===targetId&&r[1]>=start&&r[1]<=end&&r[12]!=='削除');
  const worklogByDate={};
  worklogRows.forEach(r=>{ worklogByDate[r[1]]=(worklogByDate[r[1]]||0)+Number(r[9]||0); });
  const worklogMinutes=worklogRows.reduce((sum,r)=>sum+Number(r[9]||0),0);

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
  let workDays=0,missingPunchDays=0,remoteDays=0,paidLeaveDays=0,absenceDays=0,worklogMismatchDays=0;

  for(let day=1;day<=lastDay;day++){
    const date=ym+'-'+String(day).padStart(2,'0');
    const rows=byDate[date]||[];
    const snapshot=rows.length?null:(legacyMap[date]||null);
    const registeredCompany=calendarMap[date]||null;
    const company=registeredCompany||{date:date,type:'未登録',working:false,start:'',end:'',breakMinutes:0,name:''};
    const past=date<systemToday;

    let clockIn='',clockOut='',minutes=0,overtime=0,holiday=0,lateEarly=0,breakMinutes=0,lateNight=0,workLocation='',remote=false;
    let absence=false,leaveStatus='',issueType='';
    const worklogDayMinutes=Number(worklogByDate[date]||0);

    if(snapshot){
      clockIn=snapshot.clockIn;
      clockOut=snapshot.clockOut;
      minutes=snapshot.workMinutes;
      overtime=snapshot.overtimeMinutes;
      holiday=snapshot.holidayMinutes;
      lateEarly=snapshot.lateEarlyMinutes;
      breakMinutes=Number(snapshot.breakMinutes||0);
      lateNight=estimateLateNightMinutesFromClockTimes_(clockIn,clockOut);
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
      breakMinutes=rows.length?calculateBreakMinutesForRows_(rows,date===systemToday):0;
      lateNight=rows.length?calculateLateNightMinutesForRows_(rows,date===systemToday):0;
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
      workLocation=summarizeWorkLocations_(rows);
      remote=minutes>0&&rows.some(x=>x.workLocation==='在宅');
    }

    const requiredBreak=requiredBreakMinutes_(minutes);
    const dayFinished=!!clockOut||!!snapshot||past;
    if(dayFinished&&minutes>0&&requiredBreak>0&&breakMinutes<requiredBreak){
      issueType=appendMonthlyIssue_(issueType,'休憩不足 '+breakMinutes+'分 / 必要'+requiredBreak+'分');
    }
    const worklogDifference=worklogDayMinutes-minutes;
    const worklogIssue=Math.abs(worklogDifference)>5;
    if(worklogIssue)worklogMismatchDays++;

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
      breakMinutes:breakMinutes,
      lateNightMinutes:lateNight,
      requiredBreakMinutes:requiredBreak,
      worklogMinutes:worklogDayMinutes,
      worklogDifferenceMinutes:worklogDifference,
      worklogIssue:worklogIssue,
      workLocation:workLocation,
      remote:remote,
      leaveStatus:leaveStatus,
      absence:absence,
      source:snapshot?'LEGACY':'LIVE',
      issue:issue,
      issueType:issueType
    });
  }

  const labor=applyLaborModelToMonthlyDaily_(daily,targetId,start,end,systemToday);
  logPerformance_('getMonthlySummary',perfStarted,PERFORMANCE_BUDGETS.monthlySummary,{days:lastDay,punchRows:punchRows.length,worklogs:worklogRows.length});

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
      worklogMinutes:worklogMinutes,
      worklogMismatchDays:worklogMismatchDays,
      statutoryOvertimeMinutes:labor.statutoryOvertimeMinutes,
      lateNightMinutes:labor.lateNightMinutes,
      statutoryHolidayMinutes:labor.statutoryHolidayMinutes,
      overtimeHolidayMinutes:labor.overtimeHolidayMinutes
    },
    labor:labor,
    daily:daily,
    requests:requests,
    closeStatus:getMonthlyCloseStatusInternal_(ym),
    reviewStatus:ym<systemToday.slice(0,7)?getMonthlyReviewStatusInternal_(ym,targetId):null
  };
}
function appendMonthlyIssue_(current, next) {
  const items=String(current||'').split(' / ').filter(Boolean);
  if(next&&!items.includes(next))items.push(next);
  return items.join(' / ');
}

function requiredBreakMinutes_(workMinutes) {
  const minutes=Math.max(0,Number(workMinutes||0));
  if(minutes>480)return 60;
  if(minutes>360)return 45;
  return 0;
}

function calculateBreakMinutesForRows_(rows, isToday) {
  const ordered=(rows||[]).slice().sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp)));
  let start=null,totalMs=0;
  ordered.forEach(r=>{
    if(r.action===PUNCH.BREAK_START){
      start=parseTimestamp_(r.timestamp);
    }else if(r.action===PUNCH.BREAK_END&&start){
      const end=parseTimestamp_(r.timestamp);
      if(end&&end>=start)totalMs+=end-start;
      start=null;
    }
  });
  if(start&&isToday){
    const now=new Date();
    if(now>=start)totalMs+=now-start;
  }
  return Math.max(0,Math.floor(totalMs/60000));
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

function getPayrollEmployees_() {
  return getEmployees_().filter(e=>e.payrollIncluded).map(e=>({employeeId:e.employeeId,name:e.name}));
}

function getApprovedRequestsForMonth_(employeeId,start,end) {
  const sheet=getDb_().getSheetByName('申請');
  if(sheet.getLastRow()<2)return [];
  return readRowsByColumnValues_(sheet,3,19,[employeeId])
    .filter(r=>['承認済','取消申請中'].includes(r[9])&&r[5]<=end&&r[6]>=start)
    .map(r=>({id:r[0],type:r[4],startDate:r[5],endDate:r[6],reason:r[8]}));
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


function monthlySnapshotPayload_(summary) {
  return {
    yearMonth: String(summary && summary.yearMonth || ''),
    employeeId: String(summary && summary.employee && summary.employee.employeeId || ''),
    totals: {
      workDays: Number(summary && summary.totals && summary.totals.workDays || 0),
      absenceDays: Number(summary && summary.totals && summary.totals.absenceDays || 0),
      totalMinutes: Number(summary && summary.totals && summary.totals.totalMinutes || 0),
      overtimeMinutes: Number(summary && summary.totals && summary.totals.overtimeMinutes || 0),
      holidayMinutes: Number(summary && summary.totals && summary.totals.holidayMinutes || 0),
      lateEarlyMinutes: Number(summary && summary.totals && summary.totals.lateEarlyMinutes || 0),
      paidLeaveDays: Number(summary && summary.totals && summary.totals.paidLeaveDays || 0),
      remoteDays: Number(summary && summary.totals && summary.totals.remoteDays || 0),
      missingPunchDays: Number(summary && summary.totals && summary.totals.missingPunchDays || 0),
      worklogMinutes: Number(summary && summary.totals && summary.totals.worklogMinutes || 0),
      worklogMismatchDays: Number(summary && summary.totals && summary.totals.worklogMismatchDays || 0),
      statutoryOvertimeMinutes: Number(summary && summary.totals && summary.totals.statutoryOvertimeMinutes || 0),
      lateNightMinutes: Number(summary && summary.totals && summary.totals.lateNightMinutes || 0),
      statutoryHolidayMinutes: Number(summary && summary.totals && summary.totals.statutoryHolidayMinutes || 0),
      overtimeHolidayMinutes: Number(summary && summary.totals && summary.totals.overtimeHolidayMinutes || 0)
    },
    daily: (summary && summary.daily || []).map(d => ({
      date: String(d.date || ''),
      company: String(d.companyName || d.companyType || ''),
      workingDay: !!d.workingDay,
      clockIn: String(d.clockIn || ''),
      clockOut: String(d.clockOut || ''),
      workMinutes: Number(d.workMinutes || 0),
      overtimeMinutes: Number(d.overtimeMinutes || 0),
      holidayMinutes: Number(d.holidayMinutes || 0),
      lateEarlyMinutes: Number(d.lateEarlyMinutes || 0),
      breakMinutes: Number(d.breakMinutes || 0),
      worklogMinutes: Number(d.worklogMinutes || 0),
      worklogDifferenceMinutes: Number(d.worklogDifferenceMinutes || 0),
      workLocation: String(d.workLocation || ''),
      leaveStatus: String(d.leaveStatus || ''),
      issueType: String(d.issueType || ''),
      source: String(d.source || ''),
      statutoryDailyOvertimeMinutes: Number(d.statutoryDailyOvertimeMinutes || 0),
      statutoryWeeklyOvertimeMinutes: Number(d.statutoryWeeklyOvertimeMinutes || 0),
      lateNightMinutes: Number(d.lateNightMinutes || 0),
      statutoryHolidayMinutes: Number(d.statutoryHolidayMinutes || 0),
      laborIssue: String(d.laborIssue || '')
    }))
  };
}

function monthlySnapshotHash_(summary) {
  const json = JSON.stringify(monthlySnapshotPayload_(summary));
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function persistMonthlyCloseSnapshots_(yearMonth, summaries, admin) {
  const ym = normalizeYearMonth_(yearMonth);
  const snapshotId = 'MC-' + ym.replace('-','') + '-' + Utilities.getUuid();
  const nowText = toTimestamp_(new Date());
  const summarySheet = getDb_().getSheetByName(DB.sheets.monthlySnapshot);
  const dailySheet = getDb_().getSheetByName(DB.sheets.monthlySnapshotDaily);
  if (!summarySheet || !dailySheet) throw new Error('月次確定スナップショット用シートがありません。DB更新を実行してください。');

  const summaryRows = [];
  const dailyRows = [];
  summaries.forEach(summary => {
    const t = summary.totals;
    summaryRows.push([
      snapshotId, ym, summary.employee.employeeId, summary.employee.name, nowText, admin.name,
      t.workDays, t.absenceDays, t.totalMinutes, t.overtimeMinutes, t.holidayMinutes, t.lateEarlyMinutes,
      t.paidLeaveDays, t.remoteDays, t.missingPunchDays, t.worklogMinutes, t.worklogMismatchDays,
      monthlySnapshotHash_(summary), nowText,
      Number(t.statutoryOvertimeMinutes||0),Number(t.lateNightMinutes||0),Number(t.statutoryHolidayMinutes||0),
      Number(t.overtimeHolidayMinutes||0),summary.labor&&summary.labor.ruleStatus||'UNCONFIGURED'
    ]);
    summary.daily.forEach(d => dailyRows.push([
      snapshotId, ym, summary.employee.employeeId, d.date, d.companyName || d.companyType || '',
      !!d.workingDay, d.clockIn || '', d.clockOut || '', Number(d.workMinutes || 0), Number(d.overtimeMinutes || 0),
      Number(d.holidayMinutes || 0), Number(d.lateEarlyMinutes || 0), Number(d.breakMinutes || 0),
      Number(d.worklogMinutes || 0), d.workLocation || '', d.leaveStatus || '', d.issueType || '',
      d.source || '', Number(d.worklogDifferenceMinutes || 0),
      Number(d.statutoryDailyOvertimeMinutes||0),Number(d.statutoryWeeklyOvertimeMinutes||0),Number(d.lateNightMinutes||0),
      Number(d.statutoryHolidayMinutes||0),d.laborIssue||''
    ]));
  });

  if (summaryRows.length) {
    const start = Math.max(2, summarySheet.getLastRow() + 1);
    summarySheet.getRange(start,1,summaryRows.length,24).setValues(summaryRows);
  }
  if (dailyRows.length) {
    const start = Math.max(2, dailySheet.getLastRow() + 1);
    dailySheet.getRange(start,1,dailyRows.length,24).setValues(dailyRows);
  }
  SpreadsheetApp.flush();
  return snapshotId;
}


function getWorklogs(sessionToken, params) {
  const perfStarted=Date.now();
  const session = requireSession_(sessionToken);
  params = params || {};
  const start = normalizeDate_(params.start || Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd'));
  const end = normalizeDate_(params.end || start);
  if (start > end) throw new Error('期間指定を確認してください。');
  assertReadWindow_(start,end,400);
  const requestedEmployeeId = String(params.employeeId || session.employee.employeeId);
  const employeeId = session.employee.role === 'ADMIN' ? requestedEmployeeId : session.employee.employeeId;
  const includeProjects=params.includeProjects!==false;
  const sheet = getDb_().getSheetByName('工数');
  const lastRow = sheet.getLastRow();
  // The task-option builder used to re-read the same project catalog
  // immediately after getProjectsInternal_ in every included response.
  const projects=includeProjects?getProjectsInternal_(false):[];
  const taskOptions=includeProjects&&typeof projectAdvancedTaskOptions_==='function'
    ?projectAdvancedTaskOptions_(session.employee,projects):[];
  if (lastRow < 2) return { items: [], totalMinutes: 0, projects,taskOptions };

  const items = (typeof projectAdvancedWorklogIds_==='function'?projectAdvancedWorklogIds_:items=>items)(readRowsByDateRange_(sheet,2,15,start,end,employeeId==='ALL'?undefined:3,[employeeId])
    .filter(r => r[0] && r[12] !== '削除' && r[1] >= start && r[1] <= end && (employeeId === 'ALL' || r[2] === employeeId))
    .map(r => ({
      id: r[0], date: r[1], employeeId: r[2], name: r[3], project: r[4],
      category: r[5], description: r[6], start: r[7], end: r[8],
      minutes: Number(r[9] || 0), note: r[10] || '', createdAt: r[11] || '',
      status: r[12] || '有効', updatedAt: r[14] || r[11] || ''
    }))
    .sort((a,b) => b.date.localeCompare(a.date) || (b.start||'').localeCompare(a.start||'')));

  logPerformance_('getWorklogs',perfStarted,PERFORMANCE_BUDGETS.worklogs,{items:items.length});
  return { items: items, totalMinutes: items.reduce((sum,x)=>sum+x.minutes,0), projects,taskOptions };
}

function saveWorklog(sessionToken, payload) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  payload = payload || {};

  return withScriptLock_(function() {
    const date = normalizeDate_(payload.date);
    assertMonthOpenForDate_(date,'工数を登録・編集');
    const project = String(payload.project || '').trim().slice(0, 120);
    const category = safeSheetText_(payload.category, 80);
    const description = safeSheetText_(payload.description, 500);
    const note = safeSheetText_(payload.note, 500);
    const start = normalizeTime_(payload.start || '');
    const end = normalizeTime_(payload.end || '');

    if (!project) throw new Error('プロジェクトを選択してください。');
    const projectRecord = getProjectByName_(project);
    if (!projectRecord) throw new Error('プロジェクトマスタに存在しないプロジェクトです。');
    if (!description) throw new Error('作業内容を入力してください。');
    if (!start || !end) throw new Error('開始時刻と終了時刻を入力してください。');

    const minutes = timeRangeMinutes_(start, end);
    if (minutes <= 0 || minutes > 1440) throw new Error('工数時間を確認してください。');

    const sheet = getDb_().getSheetByName('工数');
    const nowText = toTimestamp_(new Date());
    let id = String(payload.id || '').trim();
    let rowNumber = 0;
    let createdAt = nowText;
    let existingProject = '';
    let existingEmployeeId = '';
    let auditBefore = '';
    let previousRow = null;


    if (id) {
      const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1)
        .createTextFinder(id).matchEntireCell(true).findNext();
      if (!found) throw new Error('編集対象の工数が見つかりません。');
      rowNumber = found.getRow();
      const existing = sheet.getRange(rowNumber, 1, 1, 15).getDisplayValues()[0];
      previousRow=existing.slice();
      auditBefore = auditJson_({date:existing[1],employeeId:existing[2],project:existing[4],category:existing[5],description:existing[6],start:existing[7],end:existing[8],minutes:Number(existing[9]||0),note:existing[10],status:existing[12]});
      assertMonthOpenForDate_(existing[1],'工数を編集');
      if (existing[12] === '削除') throw new Error('削除済みの工数は編集できません。');
      if (employee.role !== 'ADMIN' && existing[2] !== employee.employeeId) {
        throw new Error('この工数を編集する権限がありません。');
      }
      existingProject = existing[4] || '';
      existingEmployeeId = String(existing[2] || '');
      createdAt = existing[11] || nowText;
    } else {
      id = createId_('W');
      rowNumber = Math.max(2, sheet.getLastRow() + 1);
    }

    if (projectRecord.status !== '進行中' && (!id || existingProject !== project)) {
      throw new Error('停止・完了したプロジェクトには新しい工数を登録できません。');
    }

    // Editing another employee's record must never silently transfer ownership to the admin.
    const targetEmployeeId = employee.role === 'ADMIN'
      ? (payload.employeeId ? String(payload.employeeId).trim().toUpperCase()
        : (existingEmployeeId || employee.employeeId))
      : employee.employeeId;
    const target = getEmployee_(targetEmployeeId);
    if (!target.active) throw new Error('在籍していない社員には工数を登録できません。');
    const linkage=typeof projectAdvancedWorklogPrepare_==='function'?projectAdvancedWorklogPrepare_(payload,projectRecord,employee,id):{sheet:null,taskId:'',requestKey:''};
    if(linkage.duplicateId){
      const foundDuplicate=sheet.getRange(2,1,Math.max(1,sheet.getLastRow()-1),1).createTextFinder(linkage.duplicateId).matchEntireCell(true).findNext();
      if(!foundDuplicate)throw new Error('重複送信の既存工数が見つかりません。管理者へ確認してください。');
      const prior=sheet.getRange(foundDuplicate.getRow(),1,1,15).getDisplayValues()[0];
      if(prior[12]==='削除'||prior[1]!==date||prior[2]!==target.employeeId||prior[4]!==project||
          prior[5]!==category||prior[6]!==description||prior[7]!==start||prior[8]!==end||Number(prior[9])!==minutes||prior[10]!==note)
        throw new Error('同じ送信識別子で異なる工数内容は登録できません。');
      return {ok:true,id:linkage.duplicateId,duplicate:true};
    }
    assertNoWorklogOverlap_(sheet, target.employeeId, date, start, end, id);

    const nextRow=[
      id, date, target.employeeId, target.name, project, category, description,
      start, end, minutes, note, createdAt, '有効', '', nowText
    ];
    sheet.getRange(rowNumber,1,1,15).setValues([nextRow]);
    if(linkage.sheet){
      try{projectAdvancedWorklogCommit_(linkage,id,projectRecord,employee);}
      catch(error){
        // Sheets and the separate mapping sheet are not transactional.
        // Restore edited rows; tombstone a new row so it cannot be counted twice.
        try{
          if(previousRow)sheet.getRange(rowNumber,1,1,15).setValues([previousRow]);
          else sheet.getRange(rowNumber,13,1,3).setValues([['削除',nowText,nowText]]);
          SpreadsheetApp.flush();
        }catch(rollbackError){
          throw new Error('工数関連付けと復旧の双方に失敗しました。再登録せず管理者に連絡してください: '+String(rollbackError.message||rollbackError));
        }
        throw new Error('作業への工数ひも付けに失敗し、工数変更を取り消しました。再試行してください: '+String(error.message||error));
      }
    }

    appendAudit_({
      employeeId: employee.employeeId, employeeName: employee.name,
      operation: payload.id ? '工数更新' : '工数登録', target: '工数', targetId: id,
      before: auditBefore, after: auditJson_({date:date,employeeId:target.employeeId,project:project,category:category,description:description,start:start,end:end,minutes:minutes,note:note,status:'有効'}),
      source: 'WEB', result: 'SUCCESS', note: target.name
    });
    if(typeof projectHubInvalidateWorklogs_==='function')projectHubInvalidateWorklogs_();
    SpreadsheetApp.flush();
    return { ok: true, id: id };
  });
}

function deleteWorklog(sessionToken, worklogId) {
  const employee = requireSession_(sessionToken).employee;
  const id = String(worklogId || '').trim();
  if (!id) throw new Error('工数IDを確認してください。');

  return withScriptLock_(function() {
    const sheet = getDb_().getSheetByName('工数');
    const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1)
      .createTextFinder(id).matchEntireCell(true).findNext();
    if (!found) throw new Error('削除対象が見つかりません。');

    const row = found.getRow();
    const values = sheet.getRange(row, 1, 1, 15).getDisplayValues()[0];
    // An already-deleted row still belongs to its owner. Check authorization
    // before revealing its existence/state through an idempotent success.
    if (employee.role !== 'ADMIN' && values[2] !== employee.employeeId) {
      throw new Error('この工数を削除する権限がありません。');
    }
    assertMonthOpenForDate_(values[1],'工数を削除');
    if (values[12] === '削除') return { ok: true };

    const nowText = toTimestamp_(new Date());
    sheet.getRange(row, 13, 1, 3).setValues([['削除', nowText, nowText]]);
    appendAudit_({
      employeeId: employee.employeeId, employeeName: employee.name,
      operation: '工数削除', target: '工数', targetId: id,
      before: values[1] + ' ' + values[4] + ' ' + values[9] + '分', after: '削除',
      source: 'WEB', result: 'SUCCESS', note: ''
    });
    if(typeof projectHubInvalidateWorklogs_==='function')projectHubInvalidateWorklogs_();
    SpreadsheetApp.flush();
    return { ok: true };
  });
}

function assertNoWorklogOverlap_(sheet, employeeId, date, start, end, excludeId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  // Use the already-tested date index, instead of downloading all months of worklogs.
  const rows = readRowsByDateRange_(sheet,2,15,date,date,3,[employeeId]);
  const startMin = timeToMinutes_(start);
  const endMin = timeToMinutes_(end);

  for (const r of rows) {
    if (!r[0] || r[0] === excludeId || r[12] === '削除' || r[2] !== employeeId || r[1] !== date) continue;
    const existingStart = timeToMinutes_(r[7]);
    const existingEnd = timeToMinutes_(r[8]);
    if (startMin < existingEnd && existingStart < endMin) {
      throw new Error('同じ時間帯に別の工数が登録されています（' + r[7] + '–' + r[8] + ' / ' + r[4] + '）。');
    }
  }
}

function timeToMinutes_(value) {
  const parts = String(value || '').split(':').map(Number);
  if (parts.length !== 2 || parts.some(Number.isNaN)) return 0;
  return parts[0] * 60 + parts[1];
}

function timeRangeMinutes_(start, end) {
  const a = start.split(':').map(Number);
  const b = end.split(':').map(Number);
  return (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
}



function requestRowToObject_(r) {
  return {
    id:r[0], requestDate:r[1], employeeId:r[2], name:r[3], type:r[4],
    startDate:r[5], endDate:r[6], content:r[7], reason:r[8], status:r[9],
    approver:r[10], approvedAt:r[11], rejectReason:r[12], createdAt:r[13],
    cancelReason:r[14]||'', cancelRequestedAt:r[15]||'', cancelDecisionReason:r[16]||'',
    cancelDecidedBy:r[17]||'', cancelDecidedAt:r[18]||''
  };
}

const REQUEST_TYPES = Object.freeze(['有給','午前半休','午後半休','1/4日有給','欠勤','打刻修正','在宅勤務','残業','休日出勤']);

function getRequests(sessionToken, params) {
  const session = requireSession_(sessionToken);
  params = params || {};
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const permissions = getPermissions_(session.employee);
  const managedIds = permissions.requestApprove ? getManagedEmployeeIds_(session.employee) : new Set();
  const teamScope = permissions.requestApprove && params.scope === 'ALL';
  const status = String(params.status || 'ALL');
  const ids=teamScope?[...managedIds]:[session.employee.employeeId];
  return readRowsByColumnValues_(sheet,3,19,ids)
    .filter(r => r[0] && (status === 'ALL' || r[9] === status))
    .map(requestRowToObject_)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

/* One home request read covers approved leave and pending approvals. */
function getHomeRequestSnapshot_(employee,start,end){
  if(!employee||!employee.employeeId)return {approved:[],pendingCount:0};
  const sheet=getDb_().getSheetByName('申請');
  if(!sheet||sheet.getLastRow()<2)return {approved:[],pendingCount:0};
  const employeeId=String(employee.employeeId);
  const permissions=getPermissions_(employee);
  const managed=permissions.requestApprove?getManagedEmployeeIds_(employee):new Set();
  const pendingIds=permissions.requestApprove?managed:new Set([employeeId]);
  const permittedIds=new Set([employeeId,...managed]);
  // Large approval teams are better served with a narrow ten-column count
  // and one indexed full-width read for this employee's leave only.
  // Small teams keep the single round-trip shared read.
  const separate=permissions.requestApprove&&managed.size>80&&sheet.getLastRow()>250;
  const rows=readRowsByColumnValues_(sheet,3,19,separate?[employeeId]:[...permittedIds]);
  const pendingRows=separate?readRowsByColumnValues_(sheet,3,10,[...managed]):rows;
  const approved=[];
  let pendingCount=0;
  rows.forEach(r=>{
    if(!r||!r[0])return;
    const owner=String(r[2]||'');
    if(!permittedIds.has(owner))return;
    if(owner!==employeeId||!['承認済','取消申請中'].includes(r[9]))return;
    if(!r[5]||!r[6]||r[5]>end||r[6]<start)return;
    approved.push({id:r[0],type:r[4],startDate:r[5],endDate:r[6],reason:r[8]});
  });
  pendingRows.forEach(r=>{
    if(r&&r[0]&&pendingIds.has(String(r[2]||''))&&r[9]==='承認待ち')pendingCount++;
  });
  return {approved,pendingCount};
}

function assertCanApproveRequest_(approver, requesterEmployeeId) {
  const requesterId = String(requesterEmployeeId || '').trim().toUpperCase();
  if (!requesterId) throw new Error('申請者を確認できません。');
  if (requesterId === approver.employeeId) throw new Error('申請者本人は承認できません。別の承認者へ依頼してください。');
  const requester = getEmployee_(requesterId);
  if (!canManageEmployeeRecord_(approver, requester)) throw new Error('この申請を承認する権限がありません。');
  return requester;
}
function getRequestsBundle(sessionToken) {
  const perfStarted=Date.now();
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  const reconcile=maybeReconcileLeave_(employee.employeeId,null,employee);
  const permissions = getPermissions_(employee);
  const managedIds = permissions.requestApprove ? getManagedEmployeeIds_(employee) : new Set();
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  const ids=[employee.employeeId,...managedIds];
  const items = lastRow < 2 ? [] : readRowsByColumnValues_(sheet,3,19,ids)
    .filter(r=>r[0])
    .map(requestRowToObject_)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const own = items.filter(r => r.employeeId === employee.employeeId);
  const team = items.filter(r => managedIds.has(r.employeeId));
  const context=getLeaveRequestContext_(employee.employeeId,own);
  const fresh=reconcile&&(reconcile.granted||reconcile.repaired)?getEmployee_(employee.employeeId):employee;
  const today=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');
  context.fiveDay=getAnnualLeaveFiveDayStatus_(fresh,today);
  context.autoLeave=leaveAutoForecast_(fresh,today);
  const result={ own: own, team: team, context };
  logPerformance_('getRequestsBundle',perfStarted,PERFORMANCE_BUDGETS.requestsBundle,{own:own.length,team:team.length});
  return result;
}
function getLeaveRequestContext_(employeeId, ownRequests) {
  const employee = getEmployee_(employeeId);
  if (!employee) throw new Error('社員情報が見つかりません。');

  const paidTypes = new Set(['有給','午前半休','午後半休','1/4日有給']);
  let pendingDays = 0;
  let pendingUnknown = 0;
  const items = Array.isArray(ownRequests) ? ownRequests : getRequestsForEmployee_(employeeId);

  items.filter(r => r.status === '承認待ち' && paidTypes.has(r.type)).forEach(r => {
    try {
      pendingDays += calculateLeaveDaysForRequest_(r.type, r.startDate, r.endDate);
    } catch (e) {
      pendingUnknown++;
    }
  });

  pendingDays = Math.round(pendingDays * 4) / 4;
  const leaveState = getLeaveLedgerState_(employee);
  const balance = leaveState.configured ? Number(leaveState.balance || 0) : null;
  const available = balance == null ? null : Math.max(0, Math.round((balance - pendingDays) * 4) / 4);

  return {
    leaveBalanceConfigured: !!leaveState.configured,
    leaveBalance: balance,
    pendingLeaveDays: pendingDays,
    availableLeaveDays: available,
    pendingUnknownCount: pendingUnknown
  };
}

function getRequestsForEmployee_(employeeId) {
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return readRowsByColumnValues_(sheet,3,19,[employeeId])
    .filter(r => r[0])
    .map(requestRowToObject_);
}
function previewRequest(sessionToken, payload) {
  const employee = requireSession_(sessionToken).employee;
  payload = payload || {};
  const type = String(payload.type || '');
  if (!REQUEST_TYPES.includes(type)) throw new Error('申請種別を確認してください。');

  const startDate = normalizeDate_(payload.startDate);
  const endDate = normalizeDate_(payload.endDate || startDate);
  if (startDate > endDate) throw new Error('終了日は開始日以降にしてください。');
  if (['午前半休','午後半休','1/4日有給','打刻修正'].includes(type) && startDate !== endDate) {
    throw new Error(type + 'は1日単位で申請してください。');
  }
  // Reject invalid input before refreshing employee leave state.
  maybeReconcileLeave_(employee.employeeId);

  const paidTypes = ['有給','午前半休','午後半休','1/4日有給'];
  const context = getLeaveRequestContext_(employee.employeeId);
  let requestedDays = null;
  let projectedBalance = context.availableLeaveDays;

  if (paidTypes.includes(type)) {
    requestedDays = calculateLeaveDaysForRequest_(type, startDate, endDate);
    if (requestedDays <= 0) {
      throw new Error('この日付では有給を消化しません。会社カレンダーの勤務日を確認してください。');
    }
    projectedBalance = context.availableLeaveDays == null
      ? null
      : Math.round((context.availableLeaveDays - requestedDays) * 4) / 4;
  }

  return {
    type:type,
    requestedDays:requestedDays,
    leaveBalanceConfigured:context.leaveBalanceConfigured,
    leaveBalance:context.leaveBalance,
    pendingLeaveDays:context.pendingLeaveDays,
    availableLeaveDays:context.availableLeaveDays,
    projectedBalance:projectedBalance,
    sufficient:projectedBalance == null ? false : projectedBalance >= 0
  };
}

function submitRequest(sessionToken, payload) {
  const employee = requireSession_(sessionToken).employee;
  payload = payload || {};
  return withScriptLock_(function() {
    const type = String(payload.type || '');
    if (!REQUEST_TYPES.includes(type)) throw new Error('申請種別を確認してください。');
    const startDate = normalizeDate_(payload.startDate);
    const endDate = normalizeDate_(payload.endDate || startDate);
    if (startDate > endDate) throw new Error('対象期間を確認してください。');
    assertMonthRangeOpen_(startDate,endDate,'申請を登録');
    if (['午前半休','午後半休','1/4日有給','打刻修正'].includes(type) && startDate !== endDate) {
      throw new Error(type + 'は1日単位で申請してください。');
    }
    if (['有給','午前半休','午後半休','1/4日有給','欠勤'].includes(type)) {
      assertNoLeaveConflict_(employee.employeeId, type, startDate, endDate, '', false);
    }
    if (['有給','午前半休','午後半休','1/4日有給'].includes(type)) {
      reconcileLeaveUnlocked_(getEmployee_(employee.employeeId),Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'));
      const leaveContext = getLeaveRequestContext_(employee.employeeId);
      if (!leaveContext.leaveBalanceConfigured) {
        throw new Error('有給残日数が未設定です。管理者に社員情報の有給残日数を設定してもらってください。');
      }
      const requestedDays = calculateLeaveDaysForRequest_(type, startDate, endDate);
      if (requestedDays <= 0) {
        throw new Error('この日付では有給を消化しません。会社カレンダーの勤務日を確認してください。');
      }
      if (leaveContext.availableLeaveDays < requestedDays) {
        throw new Error(
          '有給残日数が不足しています。承認待ちを含む申請可能残数は ' +
          leaveContext.availableLeaveDays + '日、今回の申請は ' + requestedDays + '日です。'
        );
      }
    }
    const reason = safeSheetText_(payload.reason, 600);
    if (!reason) throw new Error('申請理由を入力してください。');

    let content = safeSheetText_(payload.content, 1500);
    if (type === '打刻修正') {
      const correction = payload.correction || {};
      const action = String(correction.action || '');
      if (!isTimePunchAction_(action)) throw new Error('修正する打刻種別を選択してください。');
      const time = normalizeTime_(correction.time || '');
      if (!time) throw new Error('修正後の時刻を入力してください。');
      content = JSON.stringify({
        originalPunchId: String(correction.originalPunchId || ''),
        action: action,
        time: time,
        workLocation: ['出社','在宅','外出'].includes(correction.workLocation) ? correction.workLocation : '出社'
      });
    }

    const now = new Date();
    const nowText = toTimestamp_(now);
    const requestId = createId_('R');
    getDb_().getSheetByName('申請').appendRow([
      requestId,
      Utilities.formatDate(now, DB.timeZone, 'yyyy-MM-dd'),
      employee.employeeId,
      employee.name,
      type,
      startDate,
      endDate,
      content,
      reason,
      '承認待ち',
      '',
      '',
      '',
      nowText,
      '', '', '', '', ''
    ]);
    appendAudit_({
      employeeId:employee.employeeId,employeeName:employee.name,operation:'申請登録',
      target:'申請',targetId:requestId,before:'',after:type+' '+startDate,
      source:'WEB',result:'SUCCESS',note:''
    });
    SpreadsheetApp.flush();
    return {ok:true,id:requestId};
  });
}
function cancelRequest(sessionToken, requestId) {
  const employee = requireSession_(sessionToken).employee;
  return withScriptLock_(function() {
    const rowInfo = findRequestRow_(requestId);
    if (!rowInfo) throw new Error('申請が見つかりません。');
    const r = rowInfo.values;
    if (r[2] !== employee.employeeId && employee.role !== 'ADMIN') throw new Error('この申請を取り消す権限がありません。');
    if (r[9] !== '承認待ち') throw new Error('承認待ちの申請だけ取り消せます。');
    assertRequestApprovalNotPartiallyApplied_(r);
    rowInfo.sheet.getRange(rowInfo.row,10).setValue('取消');
    appendAudit_({
      employeeId:employee.employeeId,employeeName:employee.name,operation:'申請取消',
      target:'申請',targetId:r[0],before:'承認待ち',after:'取消',source:'WEB',result:'SUCCESS',note:''
    });
    SpreadsheetApp.flush();
    return {ok:true};
  });
}
function approveRequest(sessionToken, requestId, decision, comment) {
  const approver = requireSession_(sessionToken).employee;
  const normalizedDecision = String(decision || '').toUpperCase();
  if (!['APPROVE','REJECT'].includes(normalizedDecision)) throw new Error('承認操作を確認してください。');

  return withScriptLock_(function() {
    const rowInfo = findRequestRow_(requestId);
    if (!rowInfo) throw new Error('申請が見つかりません。');
    const r = rowInfo.values;
    if (r[9] !== '承認待ち') throw new Error('この申請はすでに処理されています。');
    assertCanApproveRequest_(approver, r[2]);
    const approve = normalizedDecision === 'APPROVE';
    const rejectReason = safeSheetText_(comment, 500);
    if (approve) assertMonthRangeOpen_(r[5],r[6],'申請を承認');
    if (!approve && !rejectReason) throw new Error('差戻し理由を入力してください。');
    if (!approve) assertRequestApprovalNotPartiallyApplied_(r);

    const nowText = toTimestamp_(new Date());
    let leaveDaysToConsume = 0;
    let leaveEmployee = null;
    if (approve && ['有給','午前半休','午後半休','1/4日有給','欠勤'].includes(r[4])) {
      assertNoLeaveConflict_(r[2], r[4], r[5], r[6], r[0], true);
      if (r[4] !== '欠勤') {
        leaveEmployee = getEmployee_(r[2]);
        reconcileLeaveUnlocked_(leaveEmployee,Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd'));
        leaveEmployee = getEmployee_(r[2]);
        const leaveState = getLeaveLedgerState_(leaveEmployee);
        if (!leaveState.configured) throw new Error('有給残日数が未設定です。社員設定で残日数と年休基準日を設定してください。');
        if (!leaveEmployee.leaveBasisDate) throw new Error('年休基準日が未設定です。社員設定で登録してください。');
        leaveDaysToConsume = calculateLeaveDaysForRequest_(r[4], r[5], r[6]);
        if (leaveDaysToConsume <= 0) throw new Error('対象日に消化する有給日数がありません。会社カレンダーを確認してください。');
        const priorUse=findLeaveLedgerRequestPosting_(leaveEmployee.employeeId,r[0],'USE');
        if (!priorUse&&leaveState.balance < leaveDaysToConsume) throw new Error('有給残日数が不足しています。現在の残日数: ' + leaveState.balance + '日');
      }
    }

    // Apply idempotent side effects first. A failure must not mark the request approved
    // while its leave balance or corrected punch has not yet been recorded.
    if (approve && r[4] === '打刻修正') {
      applyApprovedPunchCorrection_(r);
    }
    if (approve && leaveEmployee && leaveDaysToConsume > 0) consumeLeaveBalance_(leaveEmployee,leaveDaysToConsume,r[0],approver);

    rowInfo.sheet.getRange(rowInfo.row,10,1,4).setValues([[
      approve ? '承認済' : '差戻し',
      approver.name,
      nowText,
      approve ? '' : rejectReason
    ]]);

    appendAudit_({
      employeeId:approver.employeeId,employeeName:approver.name,
      operation:approve?'申請承認':'申請差戻し',target:'申請',targetId:r[0],
      before:'承認待ち',after:approve?'承認済':'差戻し',source:'WEB',result:'SUCCESS',
      note:approve?'':rejectReason.slice(0,200)
    });
    SpreadsheetApp.flush();
    return {ok:true};
  });
}
function getPunchesForDate(sessionToken, date) {
  const employee = requireSession_(sessionToken).employee;
  const targetDate = normalizeDate_(date);
  return getActivePunchRows_(employee.employeeId, targetDate, targetDate)
    .sort((a,b)=>String(a[5]).localeCompare(String(b[5])))
    .map(r=>({
      id:r[0], action:r[4], timestamp:r[5], time:String(r[5]).slice(11,16),
      workLocation:r[6]||'出社', source:r[7]||''
    }));
}
function assertNoLeaveConflict_(employeeId, type, startDate, endDate, excludeRequestId, approvedOnly) {
  const dayOffTypes = ['有給','午前半休','午後半休','1/4日有給','欠勤'];
  if (!dayOffTypes.includes(type)) return;

  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Fetch only this employee's rows; ignore unrelated application history.
  const rows = readRowsByColumnValues_(sheet,3,19,[employeeId]);
  for (const r of rows) {
    if (!r[0] || r[0] === excludeRequestId || r[2] !== employeeId || !dayOffTypes.includes(r[4])) continue;
    if (approvedOnly ? !['承認済','取消申請中'].includes(r[9]) : !['承認待ち','承認済','取消申請中'].includes(r[9])) continue;
    if (r[6] < startDate || r[5] > endDate) continue;

    const newFullDay = type === '有給' || type === '欠勤';
    const existingFullDay = r[4] === '有給' || r[4] === '欠勤';
    if (newFullDay || existingFullDay) {
      throw new Error('同じ期間に有給・半休・欠勤の申請がすでに存在します。');
    }
    if (type === r[4] && startDate === r[5]) {
      throw new Error('同じ日の' + type + '申請がすでに存在します。');
    }
  }
}

function requestApprovedCancellation(sessionToken, requestId, reason) {
  const employee=requireSession_(sessionToken).employee;
  const note=safeSheetText_(reason,500);
  if(!note)throw new Error('取消理由を入力してください。');
  return withScriptLock_(function(){
    const rowInfo=findRequestRow_(requestId);
    if(!rowInfo)throw new Error('申請が見つかりません。');
    const r=rowInfo.values;
    if(r[2]!==employee.employeeId)throw new Error('自分の申請だけ取消依頼できます。');
    if(r[9]!=='承認済')throw new Error('承認済みの申請だけ取消依頼できます。');
    if(r[4]==='打刻修正')throw new Error('承認済みの打刻修正は直接取り消せません。新しい打刻修正申請で訂正してください。');
    assertMonthRangeOpen_(r[5],r[6],'承認済み申請の取消を依頼');
    const nowText=toTimestamp_(new Date());
    rowInfo.sheet.getRange(rowInfo.row,10).setValue('取消申請中');
    rowInfo.sheet.getRange(rowInfo.row,15,1,5).setValues([[note,nowText,'','','']]);
    appendAudit_({employeeId:employee.employeeId,employeeName:employee.name,operation:'承認済申請の取消依頼',target:'申請',targetId:r[0],before:'承認済',after:'取消申請中',source:'WEB',result:'SUCCESS',note:note});
    SpreadsheetApp.flush();
    return {ok:true};
  });
}

function decideApprovedCancellation(sessionToken, requestId, decision, comment) {
  const approver=requireSession_(sessionToken).employee;
  const normalized=String(decision||'').toUpperCase();
  if(!['APPROVE','REJECT'].includes(normalized))throw new Error('取消判断を確認してください。');
  return withScriptLock_(function(){
    const rowInfo=findRequestRow_(requestId);
    if(!rowInfo)throw new Error('申請が見つかりません。');
    const r=rowInfo.values;
    if(r[9]!=='取消申請中')throw new Error('取消依頼中の申請ではありません。');
    assertCanApproveRequest_(approver,r[2]);
    const note=safeSheetText_(comment,500);
    if(normalized==='REJECT'&&!note)throw new Error('取消却下理由を入力してください。');
    if(normalized==='REJECT'&&findLeaveLedgerRequestPosting_(r[2],r[0],'RESTORE'))
      throw new Error('有給の返却が途中まで実行されています。取消承認を再実行してください。');
    assertMonthRangeOpen_(r[5],r[6],'承認済み申請の取消を処理');

    if(normalized==='APPROVE'&&['有給','午前半休','午後半休','1/4日有給'].includes(r[4])){
      const employee=getEmployee_(r[2]);
      const use=findLeaveLedgerRequestPosting_(r[2],r[0],'USE');
      // A later calendar edit must not change the amount originally consumed.
      // Legacy approvals without a posting retain the existing calculation.
      const days=use?-Number(use.days):calculateLeaveDaysForRequest_(r[4],r[5],r[6]);
      if(use&&(!Number.isFinite(days)||days<=0||normalizeLeaveDays_(days)!==days))
        throw new Error('承認時の有給消化日数が不正です。管理者に確認してください。');
      restoreLeaveBalance_(employee,days,r[0],approver,'承認済み休暇申請の取消');
    }

    const nowText=toTimestamp_(new Date());
    const next=normalized==='APPROVE'?'取消済':'承認済';
    rowInfo.sheet.getRange(rowInfo.row,10).setValue(next);
    rowInfo.sheet.getRange(rowInfo.row,17,1,3).setValues([[note,approver.name,nowText]]);
    appendAudit_({employeeId:approver.employeeId,employeeName:approver.name,operation:normalized==='APPROVE'?'承認済申請の取消承認':'承認済申請の取消却下',target:'申請',targetId:r[0],before:'取消申請中',after:next,source:'WEB',result:'SUCCESS',note:note});
    SpreadsheetApp.flush();
    return {ok:true,status:next};
  });
}

function calculateLeaveDaysForRequest_(type, startDate, endDate) {
  if (type === '午前半休' || type === '午後半休' || type === '1/4日有給') {
    const days = getCompanyCalendarRange_(startDate, startDate);
    if (days.length !== 1) throw new Error('対象日の会社カレンダーが未登録です。');
    if (!days[0].working) return 0;
    return type === '1/4日有給' ? 0.25 : 0.5;
  }
  const expected = inclusiveDateCount_(startDate, endDate);
  const days = getCompanyCalendarRange_(startDate, endDate);
  if (days.length !== expected) {
    throw new Error('申請期間の会社カレンダーが未登録です。');
  }
  return days.filter(d => d.working).length;
}
function inclusiveDateCount_(startDate, endDate) {
  const a = startDate.split('-').map(Number);
  const b = endDate.split('-').map(Number);
  const start = Date.UTC(a[0],a[1]-1,a[2]);
  const end = Date.UTC(b[0],b[1]-1,b[2]);
  return Math.floor((end-start)/86400000)+1;
}

function findRequestRow_(requestId) {
  const sheet = getDb_().getSheetByName('申請');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const found = sheet.getRange(2,1,lastRow-1,1).createTextFinder(String(requestId||'')).matchEntireCell(true).findNext();
  if (!found) return null;
  const row = found.getRow();
  return {sheet:sheet,row:row,values:sheet.getRange(row,1,1,19).getDisplayValues()[0]};
}

function preparePunchCorrection_(requestRow) {
  let correction;
  try { correction = JSON.parse(requestRow[7] || '{}'); }
  catch(e) { throw new Error('打刻修正申請の内容が読み取れません。'); }

  const employeeId = requestRow[2];
  const employeeName = requestRow[3];
  const date = requestRow[5];
  const action = correction.action;
  const time = normalizeTime_(correction.time || '');
  if (!isTimePunchAction_(action) || !time) throw new Error('打刻修正内容が不正です。');

  const activeRows = getActivePunchRows_(employeeId, date, date);
  const originalId = String(correction.originalPunchId || '').trim();
  let originalLocation = ['出社','在宅','外出'].includes(correction.workLocation) ? correction.workLocation : '出社';

  if (originalId) {
    const original = activeRows.find(r => r[0] === originalId);
    if (!original) throw new Error('修正対象の打刻が見つからないか、すでに別の修正で置き換えられています。');
    originalLocation = original[6] || originalLocation;
  }

  const timestamp = date + ' ' + time + ':00';
  const candidate = activeRows
    .filter(r => r[0] !== originalId)
    .map(r => ({ id:r[0], action:r[4], timestamp:r[5], workLocation:r[6] }));
  candidate.push({ id:'PROPOSED', action:action, timestamp:timestamp, workLocation:originalLocation });
  validatePunchSequence_(candidate);

  return {
    employeeId: employeeId,
    employeeName: employeeName,
    date: date,
    action: action,
    timestamp: timestamp,
    workLocation: originalLocation,
    originalId: originalId
  };
}

function hasAppliedPunchCorrection_(requestRow) {
  const marker='申請承認による修正 '+requestRow[0];
  const punchSheet=getDb_().getSheetByName(DB.sheets.punches);
  if(punchSheet.getLastRow()>1){
    return readRowsByDateRange_(punchSheet,4,12,requestRow[5],requestRow[5],2,[requestRow[2]])
      .some(r=>String(r[1])===String(requestRow[2])&&r[7]==='CORRECTION'&&String(r[10]||'')===marker);
  }
  return false;
}

function assertRequestApprovalNotPartiallyApplied_(requestRow) {
  const type=requestRow[4];
  const applied=['有給','午前半休','午後半休','1/4日有給'].includes(type)
    ? !!findLeaveLedgerRequestPosting_(requestRow[2],requestRow[0],'USE')
    : type==='打刻修正'&&hasAppliedPunchCorrection_(requestRow);
  if(applied)throw new Error('承認処理が途中まで実行されています。承認者が承認を再実行して完了してください。');
}

function applyApprovedPunchCorrection_(requestRow) {
  if(hasAppliedPunchCorrection_(requestRow))return {alreadyApplied:true};
  const marker='申請承認による修正 '+requestRow[0];
  const punchSheet=getDb_().getSheetByName(DB.sheets.punches);
  const plan=preparePunchCorrection_(requestRow);
  const nowText=toTimestamp_(new Date());
  punchSheet.appendRow([
    createId_('P'), plan.employeeId, plan.employeeName, plan.date, plan.action,
    plan.timestamp, plan.workLocation, 'CORRECTION',
    false, plan.originalId, marker, nowText
  ]);
  return {alreadyApplied:false};
}
