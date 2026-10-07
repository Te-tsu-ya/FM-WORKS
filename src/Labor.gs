const LABOR_GENERAL_JP = Object.freeze({
  dailyStatutoryMinutes:480,
  weeklyStatutoryMinutes:2400,
  monthlyOvertimePrincipleMinutes:2700,
  monthlyOvertimePremium50Minutes:3600,
  specialSingleMonthOvertimeHolidayLimitMinutes:6000,
  nightStartMinutes:1320,
  nightEndMinutes:300
});
const LABOR_WEEKDAY_INDEX=Object.freeze({SUNDAY:0,MONDAY:1,TUESDAY:2,WEDNESDAY:3,THURSDAY:4,FRIDAY:5,SATURDAY:6});

function normalizeLaborWeekStartDay_(value){
  const v=String(value||'').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(LABOR_WEEKDAY_INDEX,v)?v:'';
}

function getLaborRuleConfig_(){
  const s=getSettingsMap_();
  const profile=String(s.LABOR_RULE_PROFILE||'UNCONFIGURED').trim().toUpperCase()==='GENERAL_JP'?'GENERAL_JP':'UNCONFIGURED';
  const weekStartDay=normalizeLaborWeekStartDay_(s.LABOR_WEEK_START_DAY);
  return {
    profile,weekStartDay,
    configured:profile==='GENERAL_JP'&&!!weekStartDay,
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
  if(profile==='GENERAL_JP'&&!weekStartDay)throw new Error('一般則プロファイルを有効にする場合は、就業規則上の週開始曜日を設定してください。');
  const before=getLaborRuleConfig_();
  const now=toTimestamp_(new Date());
  saveSettings_({
    LABOR_RULE_PROFILE:profile,
    LABOR_WEEK_START_DAY:weekStartDay,
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
  if(!config.configured)warnings.push('就業規則・36協定の確認が未完了です。表示値は一般則を基礎にした参考値です。');
  if(!config.weekStartDay)warnings.push('週40時間判定の週開始曜日が未設定です。');
  if(statutoryOvertimeMinutes>2700)warnings.push('法定時間外が月45時間を超えています。');
  if(statutoryOvertimeMinutes>3600)warnings.push('法定時間外が月60時間を超えています。');
  if(overtimeHolidayMinutes>=6000)warnings.push('法定時間外＋法定休日労働が単月100時間以上です。');
  return {ruleStatus:config.configured?'CONFIGURED':'UNCONFIGURED',profile:config.profile,weekStartDay:config.weekStartDay,
    statutoryOvertimeMinutes,lateNightMinutes,statutoryHolidayMinutes,overtimeHolidayMinutes,warnings};
}
