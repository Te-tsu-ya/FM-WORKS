/* November-close annual cash flow. Manual cash-basis inputs; only ADMIN may read or write. */
const CASH_FLOW_SHEET='資金繰り年間';
const CASH_FLOW_FIELDS=['planIn','planOut','actualIn','actualOut'];
function cashFlowYear_(input){
 const raw=String(input==null?'':input).trim(),year=Number(raw);
 if(!/^\d{4}$/.test(raw)||!Number.isInteger(year)||year<2000||year>2100)throw new Error('決算年度を確認してください（2000～2100年）。');
 return year;
}
function cashFlowMonths_(year){
 const y=cashFlowYear_(year),a=[];
 for(let i=0;i<12;i++)a.push(String(i?y:y-1)+'-'+String(i||12).padStart(2,'0'));
 return a;
}
function cashFlowMoney_(value,label,negative,optional){
 if(value===null||value===undefined||String(value).trim()===''){
  if(optional)return null;
  throw new Error(label+'を入力してください。');
 }
 const raw=String(value).trim(),rule=negative?/^-?(0|[1-9]\d{0,11})$/:/^(0|[1-9]\d{0,11})$/;
 if(!rule.test(raw))throw new Error(label+'は整数の円単位で入力してください（上限9999億9999万9999円）。');
 const n=Number(raw);
 if(!Number.isSafeInteger(n)||Math.abs(n)>999999999999)throw new Error(label+'の金額が大きすぎます。');
 return n;
}
function cashFlowMonthsValidate_(year,records){
 const months=cashFlowMonths_(year);
 if(!Array.isArray(records)||records.length!==12)throw new Error('月別データは12か月分必要です。');
 return months.map((month,i)=>{
  const row=records[i];
  if(!row||typeof row!=='object'||Array.isArray(row)||String(row.month||'')!==month)throw new Error('月の並びを確認してください: '+month);
  const result={month};
  CASH_FLOW_FIELDS.forEach(key=>result[key]=cashFlowMoney_(row[key],month+'の'+key,false,true));
  const note=String(row.note==null?'':row.note).replace(/\r\n?/g,'\n').trim();
  if(note.length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(note))throw new Error(month+'の備考は300文字以内にしてください。');
  result.note=note;
  return result;
 });
}
function cashFlowBlank_(year){return cashFlowMonths_(year).map(month=>({month,planIn:null,planOut:null,actualIn:null,actualOut:null,note:''}));}
function cashFlowSummary_(opening,months){
 const totals={planIn:0,planOut:0,actualIn:0,actualOut:0},counts={plan:0,actual:0};
 let plan=opening,actual=opening,forecast=opening,lowest=opening,firstNegative='';
 const rows=months.map(row=>{
  CASH_FLOW_FIELDS.forEach(key=>{if(row[key]!=null)totals[key]+=Number(row[key]);});
  const hp=row.planIn!=null||row.planOut!=null,ha=row.actualIn!=null||row.actualOut!=null;
  if(hp)counts.plan++;if(ha)counts.actual++;
  plan=plan!==null&&hp?plan+(row.planIn||0)-(row.planOut||0):null;
  actual=actual!==null&&ha?actual+(row.actualIn||0)-(row.actualOut||0):null;
  forecast=forecast!==null&&(ha||hp)?forecast+(ha?row.actualIn||0:row.planIn||0)-(ha?row.actualOut||0:row.planOut||0):null;
  if(forecast!==null){if(lowest===null||forecast<lowest)lowest=forecast;if(forecast<0&&!firstNegative)firstNegative=row.month;}
  return {month:row.month,planEnd:plan,actualEnd:actual,forecastEnd:forecast,source:ha?'実績':hp?'計画':'未入力'};
 });
 return {months:rows,totals,counts,forecastYearEnd:forecast,lowestForecast:lowest,firstShortage:firstNegative};
}
function cashFlowSheet_(optional){
 const sh=getDb_().getSheetByName(CASH_FLOW_SHEET);
 if(!sh){if(optional)return null;throw new Error('資金繰り表が未作成です。管理者がバックアップ付きDB更新を実行してください。');}
 if(schemaHeaderIssues_(sh.getRange(1,1,1,7).getDisplayValues()[0],DB_SCHEMA_SPECS[CASH_FLOW_SHEET]).length)
  throw new Error('資金繰り表の列名が正しくありません。管理者が確認してください。');
 return sh;
}
function cashFlowRows_(sheet){
 if(!sheet||sheet.getLastRow()<2)return [];
 return sheet.getRange(2,1,sheet.getLastRow()-1,7).getDisplayValues().map((row,i)=>({row,rowNo:i+2})).filter(e=>e.row[0]);
}
function cashFlowSaved_(entry,year){
 if(!entry)return {openingBalance:null,months:cashFlowBlank_(year),revision:0,updatedAt:'',exists:false};
 try{
  const r=entry.row,opening=cashFlowMoney_(String(r[1]).replace(/,/g,''),'期首残高',true,false);
  const months=cashFlowMonthsValidate_(year,JSON.parse(String(r[2]||''))),revision=Number(r[3]);
  if(!Number.isSafeInteger(revision)||revision<1)throw Error('revision');
  return {openingBalance:opening,months,revision,updatedAt:String(r[4]||''),exists:true};
 }catch(_){throw new Error('保存済み資金繰り表を読めません。管理者がデータを確認してください。');}
}
function getCashFlowYear(sessionToken,fiscalYear){
 requireAdminSession_(sessionToken);
 const year=cashFlowYear_(fiscalYear),sheet=cashFlowSheet_(true),empty=cashFlowSaved_(null,year);
 if(!sheet)return {ok:true,setupRequired:true,fiscalYear:year,periodStart:(year-1)+'-12-01',periodEnd:year+'-11-30',record:empty,availableYears:[],summary:cashFlowSummary_(null,empty.months)};
 const rows=cashFlowRows_(sheet),matches=rows.filter(x=>String(x.row[0])===String(year));
 if(matches.length>1)throw new Error('同じ年度のレコードが重複しています。');
 const record=cashFlowSaved_(matches[0]||null,year);
 const years=[...new Set(rows.map(r=>Number(r.row[0])).filter(v=>Number.isInteger(v)&&v>=2000&&v<=2100))].sort((a,b)=>b-a);
 return {ok:true,setupRequired:false,fiscalYear:year,periodStart:(year-1)+'-12-01',periodEnd:year+'-11-30',record,availableYears:years,summary:cashFlowSummary_(record.openingBalance,record.months)};
}
function saveCashFlowYear(sessionToken,payload){
 const admin=requireAdminSession_(sessionToken).employee,p=payload||{},year=cashFlowYear_(p.fiscalYear);
 const opening=cashFlowMoney_(p.openingBalance,'期首残高',true,false);
 const months=cashFlowMonthsValidate_(year,p.months),json=JSON.stringify(months),key=String(p.requestKey||''),expected=Number(p.revision);
 if(!/^[A-Za-z0-9_-]{16,100}$/.test(key))throw new Error('保存識別子が正しくありません。');
 if(!Number.isSafeInteger(expected)||expected<0)throw new Error('改訂番号が正しくありません。');
 return withScriptLock_(function(){
  const sheet=cashFlowSheet_(false),matches=cashFlowRows_(sheet).filter(e=>String(e.row[0])===String(year));
  if(matches.length>1)throw new Error('同じ年度のレコードが重複しています。');
  const current=matches[0]||null,stored=current?cashFlowSaved_(current,year):null;
  if(current&&String(current.row[6])===key){
   if(stored.openingBalance===opening&&JSON.stringify(stored.months)===json)return {ok:true,duplicate:true,revision:stored.revision,auditRecorded:null};
   throw new Error('同じ保存識別子で金額の異なる内容は保存できません。');
  }
  const previous=stored?stored.revision:0;
  if(previous!==expected)throw new Error('別の人が更新しました。再読み込みしてから保存してください。');
  const at=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd HH:mm:ss');
  const next=[String(year),opening,json,previous+1,at,admin.employeeId,key];
  if(current)sheet.getRange(current.rowNo,1,1,7).setValues([next]);else sheet.appendRow(next);
  SpreadsheetApp.flush();
  const observed=sheet.getRange(current?current.rowNo:sheet.getLastRow(),1,1,7).getDisplayValues()[0];
  if(String(observed[0])!==String(year)||Number(String(observed[1]).replace(/,/g,''))!==opening||
     String(observed[2])!==json||Number(observed[3])!==previous+1)
   throw new Error('保存後の読み取り検証に失敗しました。再送する前に再読み込みしてください。');
  let auditRecorded=true;
  try{
   appendAudit_({employeeId:admin.employeeId,employeeName:admin.name,operation:'年間資金繰り保存',target:CASH_FLOW_SHEET,targetId:String(year),
    before:auditJson_({revision:previous,openingBalance:stored?stored.openingBalance:null}),
    after:auditJson_({revision:previous+1,openingBalance:opening}),source:'WEB',result:'SUCCESS',note:'11月決算'});
  }catch(err){auditRecorded=false;console.warn('Cash flow saved, audit failed: '+String(err&&err.message||err));}
  return {ok:true,revision:previous+1,duplicate:false,auditRecorded};
 },30000);
}
