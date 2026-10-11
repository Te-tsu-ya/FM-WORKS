/* FM WORKS cashflow projection and private financial-report export.
   Derived exclusively from authenticated server records; neither scenarios nor reports alter base data. */
function cfrMoneySafe_(value,label){
 if(!Number.isSafeInteger(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)
  throw Error((label||'集計')+'の合計が安全な整数範囲を超えました。');
 return value;
}
function cfrAdd_(bucket,direction,amount){
 const field=direction==='IN'?'incoming':'outgoing';
 bucket[field]=cfrMoneySafe_(bucket[field]+amount,'予定');
}
function cfrScenarioApply_(year,plans,changes,confirmedThrough){
 const months=cashFlowMonths_(year),lookup=new Map(months.map(m=>[m,{month:m,incoming:0,outgoing:0}]));
 const occurrences=new Map(),categoryTotals=new Map();
 const bump=(month,direction,category,amount)=>{
  cfrAdd_(lookup.get(month),direction,amount);
  const name=String(category||'未分類予定'),key=month+'|'+name+'|'+direction;
  const record=categoryTotals.get(key)||{month,category:name,direction,amount:0};
  record.amount=cfrMoneySafe_(record.amount+amount,'区分別予定');
  categoryTotals.set(key,record);
 };
 (plans||[]).forEach(plan=>{
  if(!plan.active)return;
  months.forEach(month=>{
   if(!cfpPlannedMonth_(Object.assign({},plan,{active:'TRUE'}),month))return;
   const amount=Number(plan.amount);
   if(!Number.isSafeInteger(amount)||amount<0)throw Error('予定金額が不正です。');
   const record={month,direction:plan.direction,amount,planId:plan.id,category:plan.category||'未分類予定'};
   occurrences.set(plan.id+'|'+month,record);
   bump(month,record.direction,record.category,record.amount);
  });
 });
 const seen=new Set(),warnings=[];
 (changes||[]).forEach((change,index)=>{
  const month=change.month;
  if(!lookup.has(month))throw Error('シナリオ条件の対象月が決算年度外です。');
  if(change.type==='EXTRA'){
   if(confirmedThrough&&month<=confirmedThrough){
    warnings.push(month+' の臨時条件は確定実績を変更しないため反映されません。');return;
   }
   bump(month,change.direction,'臨時入出金',Number(change.amount));return;
  }
  const key=change.planId+'|'+month;
  if(seen.has(key))throw Error('同じ予定・同じ月に複数の変更条件を設定できません。');
  seen.add(key);
  const line=occurrences.get(key);
  if(!line)throw Error((index+1)+'番目の条件に一致する有効な予定がありません。');
  if(confirmedThrough&&month<=confirmedThrough){
   warnings.push(month+' の変更条件は確定済みのため反映されません。');return;
  }
  if(change.type==='SHIFT'){
   const targetIndex=months.indexOf(month)+Number(change.monthsDelta);
   if(targetIndex<0||targetIndex>=months.length)throw Error('入金・出金の移動が決算年度の範囲外です。');
   const destination=months[targetIndex];
   if(confirmedThrough&&destination<=confirmedThrough)
    throw Error('確定済みの月へ予定を移動できません。');
   bump(month,line.direction,line.category,-line.amount);
   bump(destination,line.direction,line.category,line.amount);
  }else if(change.type==='OMIT'){
   bump(month,line.direction,line.category,-line.amount);
  }else if(change.type==='SCALE'){
   const revised=Math.round(line.amount*Number(change.percent)/100);
   bump(month,line.direction,line.category,cfrMoneySafe_(revised-line.amount,'倍率'));
  }else throw Error('対応していないシナリオ条件があります。');
 });
 return {months:lookup,warnings,categories:[...categoryTotals.values()].filter(x=>x.amount!==0)};
}
function cfrMonthTotals_(months,plans,manual,schedule,bank,confirmedThrough,verifiedByMonth,opening){
 const manualMap=new Map((manual||[]).map(row=>[row.month,row]));
 let balance=opening,lowest=opening,shortage='',plannedInSum=0,plannedOutSum=0;
 const rows=months.map(month=>{
  const s=schedule.months.get(month),adjustment=manualMap.get(month)||{},bankRow=bank.get(month)||{};
  const manualPlan=adjustment.planIn!==null&&adjustment.planIn!==undefined&&adjustment.planOut!==null&&adjustment.planOut!==undefined;
  const manualActual=adjustment.actualIn!==null&&adjustment.actualIn!==undefined&&adjustment.actualOut!==null&&adjustment.actualOut!==undefined;
  // A plan in a different month is not evidence that this month's missing cashflow equals zero.
   const hasPlan=Number(bankRow.scheduledCount||0)>0||s.incoming!==0||s.outgoing!==0||manualPlan;
  const plannedIn=hasPlan?cfrMoneySafe_(s.incoming+(manualPlan?Number(adjustment.planIn):0),'予定入金'):null;
  const plannedOut=hasPlan?cfrMoneySafe_(s.outgoing+(manualPlan?Number(adjustment.planOut):0),'予定出金'):null;
  const confirmed=!!confirmedThrough&&month<=confirmedThrough;
  const verified=verifiedByMonth.get(month)===true;
  const adoptActual=confirmed&&verified;
  // Verified bank entries are authoritative even if there were no transactions.
  const actualIn=adoptActual?Number(bankRow.actualIn||0):bankRow.importedCount?Number(bankRow.actualIn||0):manualActual?Number(adjustment.actualIn):null;
  const actualOut=adoptActual?Number(bankRow.actualOut||0):bankRow.importedCount?Number(bankRow.actualOut||0):manualActual?Number(adjustment.actualOut):null;
  let source=confirmed&&!verified?'要照合':adoptActual?'確定実績':hasPlan?'予定':'未入力';
  if(adoptActual&&actualIn===null&&actualOut===null){
   // Every active account explicitly reconciled as zero transactions for this month.
   source='確定実績';
  }
  const inputIn=source==='確定実績'?actualIn===null?0:actualIn:source==='予定'?plannedIn:null;
  const inputOut=source==='確定実績'?actualOut===null?0:actualOut:source==='予定'?plannedOut:null;
  if(plannedIn!==null){plannedInSum=cfrMoneySafe_(plannedInSum+plannedIn,'年間予定入金');
    plannedOutSum=cfrMoneySafe_(plannedOutSum+plannedOut,'年間予定出金');}
  if(balance!==null&&inputIn!==null&&inputOut!==null){
   balance=cfrMoneySafe_(balance+inputIn-inputOut,'見込み残高');
   lowest=lowest===null?balance:Math.min(lowest,balance);
   if(balance<0&&!shortage)shortage=month;
  }else balance=null;
  return {month,plannedIn,plannedOut,actualIn,actualOut,inputIn,inputOut,forecastEnd:balance,
    source,confirmed,verified,bankCount:Number(bankRow.importedCount||0),
    note:String(adjustment.note||''),manualAdjustment:manualPlan,
    transferIn:Number(bankRow.transferIn||0),transferOut:Number(bankRow.transferOut||0)};
 });
 return {rows,yearEnd:balance,lowest,firstShort:shortage,plannedIn:plannedInSum,plannedOut:plannedOutSum};
}
function getCashFlowProjection(token,payload){
 requireAdminSession_(token);
 const p=payload||{},year=cashFlowYear_(p.fiscalYear),scenarioId=String(p.scenarioId||'').trim();
 if(scenarioId.length>128)throw Error('シナリオIDが不正です。');
 const annual=getCashFlowYear(token,year),bank=getCashFlowBankWorkspace(token,year);
 if(annual.setupRequired||bank.setupRequired||typeof cfaReady_!=='function'||!cfaReady_())
  return {ok:true,setupRequired:true,fiscalYear:year};
 const months=cashFlowMonths_(year),scenarios=cfaRows_('scenario',false).rows.filter(r=>Number(r.fiscalYear)===year);
 const selected=scenarioId?scenarios.find(r=>r.id===scenarioId):null;
 if(scenarioId&&!selected)throw Error('シナリオが見つかりません。');
 let changes=[];
 if(selected){try{changes=cfaScenarioChanges_(JSON.parse(selected.changesJson),year,bank.plans);}catch(error){throw Error('シナリオの保存済み条件を確認してください: '+error.message);}}
 const confirmedThrough=bank.closing.through||'',accounts=cfpRows_('account',false).rows,
  imported=cfpRows_('tx',false).rows,checks=cfaRows_('check',false).rows;
 const byMonth=new Map(bank.monthly.map(r=>[r.month,r])),verifiedByMonth=new Map();
 const review=months.flatMap(month=>{
  const findings=cfaReviewMonth_(year,month,accounts,imported,checks);
  verifiedByMonth.set(month,accounts.some(x=>x.active==='TRUE')&&findings.every(x=>x.verified));
  return findings;
 });
 const opening=annual.record.openingBalance===null?null:Number(annual.record.openingBalance);
 const empty=cfrScenarioApply_(year,bank.plans,[],confirmedThrough);
 const scenario=cfrScenarioApply_(year,bank.plans,changes,confirmedThrough);
 const base=cfrMonthTotals_(months,bank.plans,annual.record.months,empty,byMonth,confirmedThrough,verifiedByMonth,opening);
 const active=cfrMonthTotals_(months,bank.plans,annual.record.months,scenario,byMonth,confirmedThrough,verifiedByMonth,opening);
 const warnings=scenario.warnings.slice();
  const manualByMonth=new Map((annual.record.months||[]).map(x=>[x.month,x]));
  const overlapMonths=active.rows.filter(row=>{
   const input=manualByMonth.get(row.month)||{},bankRow=byMonth.get(row.month)||{};
   return Number(bankRow.scheduledCount||0)>0&&(Number(input.planIn||0)!==0||Number(input.planOut||0)!==0);
  }).map(row=>row.month);
  if(overlapMonths.length)warnings.push('定期予定と月別調整を併用: '+overlapMonths.join(', ')+'。同一入出金の二重計上がないか確認してください。');
 if(opening===null)warnings.push('期首残高が入力されていません。');
 const missing=active.rows.filter(x=>x.source==='未入力').map(x=>x.month);
 if(missing.length)warnings.push('計画未入力: '+missing.join(', '));
 const unverified=active.rows.filter(x=>x.confirmed&&!x.verified).map(x=>x.month);
 if(unverified.length)warnings.push('月次照合が未完了: '+unverified.join(', '));
 const noteRows=cfaRows_('note',false).rows,noteMap=new Map(noteRows.map(r=>[r.transactionId,r]));
 const rules=cfaRulesSorted_(cfaRows_('rule',false).rows),summary=new Map(),unreviewed=[];
 imported.forEach(t=>{
  const month=String(t.date).slice(0,7);
  if(!months.includes(month)||t.transfer==='TRUE')return;
  const n=noteMap.get(t.id),classification=cfaAnnotated_(t,n,rules),k=month+'|'+classification.category;
  if(!n)unreviewed.push(t.id);
  const record=summary.get(k)||{month,category:classification.category,incoming:0,outgoing:0};
  record.incoming=cfrMoneySafe_(record.incoming+Number(t.incoming||0),'分類入金');
  record.outgoing=cfrMoneySafe_(record.outgoing+Number(t.outgoing||0),'分類出金');
  summary.set(k,record);
 });
 if(unreviewed.length)warnings.push('未確定の明細分類: '+unreviewed.length+'件');
 const plannedCategories=scenario.categories.slice();
 (annual.record.months||[]).forEach(row=>{
  if(row.planIn===null||row.planOut===null)return;
  if(Number(row.planIn)!==0)plannedCategories.push({month:row.month,category:'月別調整',direction:'IN',amount:Number(row.planIn)});
  if(Number(row.planOut)!==0)plannedCategories.push({month:row.month,category:'月別調整',direction:'OUT',amount:Number(row.planOut)});
 });
 const resultRows=active.rows.map((row,i)=>Object.assign({},row,
  {baselineEnd:base.rows[i].forecastEnd,
   difference:row.forecastEnd===null||base.rows[i].forecastEnd===null?null:
     cfrMoneySafe_(row.forecastEnd-base.rows[i].forecastEnd,'シナリオ差額')}));
 return {ok:true,setupRequired:false,fiscalYear:year,scenarioId:selected?selected.id:'',
  scenarioName:selected?selected.name:'通常計画',conditions:changes,confirmedThrough,openingBalance:opening,
  rows:resultRows,yearEnd:active.yearEnd,lowest:active.lowest,firstShort:active.firstShort,
  plannedIn:active.plannedIn,plannedOut:active.plannedOut,categorySummary:[...summary.values()],plannedCategories,
  bankReview:review,unreviewedCount:unreviewed.length,warnings,
  status:warnings.length?'要確認':'照合確認済',generatedAt:cfpStamp_()};
}
function cfrExportCell_(value){
 if(value===null||value===undefined)return '';
 if(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+\-@]/.test(value))return "'"+value;
 return value;
}
function cfrColumn_(index){return String.fromCharCode(66+index);}
function cfrWriteReport_(spreadsheet,model){
 const sheet=spreadsheet.getSheets()[0],year=model.fiscalYear;
 sheet.setName('年間資金繰り');
 const labels=['予定入金（円）','予定出金（円）','取込実績入金（円）','取込実績出金（円）','採用入金（円）','採用出金（円）','月末予測残高（円）',
  '通常計画残高（円）','通常との差額（円）','採用データ','照合状態','月の説明'];
 const grid=Array.from({length:17},()=>Array(13).fill(''));
 grid[0][0]='FM WORKS　年間資金繰り表 / '+year+'年11月期';
 grid[1][0]='条件：'+model.scenarioName+' ／ 状態：'+model.status;
 grid[2][0]='期首現預金残高（円）';grid[2][1]=model.openingBalance===null?'':model.openingBalance;
 grid[4][0]='区分／対象月';
 model.rows.forEach((r,i)=>{
  const cell=cfrColumn_(i),last=i===0?'$B$3':cfrColumn_(i-1)+'12';
  grid[4][i+1]=r.month;grid[5][i+1]=r.plannedIn;grid[6][i+1]=r.plannedOut;
  grid[7][i+1]=r.actualIn;grid[8][i+1]=r.actualOut;
  grid[9][i+1]='=IF(OR('+cell+'15="要照合",'+cell+'15="未入力"),"",IF('+cell+'15="確定実績",'+cell+'8,'+cell+'6))';
  grid[10][i+1]='=IF(OR('+cell+'15="要照合",'+cell+'15="未入力"),"",IF('+cell+'15="確定実績",'+cell+'9,'+cell+'7))';
  grid[11][i+1]='=IF(OR('+last+'="",' +cell+'10="",'+cell+'11=""),"",'+last+'+'+cell+'10-'+cell+'11)';
  grid[12][i+1]=r.baselineEnd;
  grid[13][i+1]='=IF(OR('+cell+'12="",'+cell+'13=""),"",'+cell+'12-'+cell+'13)';
  grid[14][i+1]=r.source;
  grid[15][i+1]=r.verified?'照合済':r.confirmed?'要再照合':'予定';
  grid[16][i+1]=cfrExportCell_(r.note);
 });
 labels.forEach((label,i)=>grid[i+5][0]=label);
 sheet.getRange(1,1,17,13).setValues(grid);
 sheet.getRange(1,1,1,13).merge().setFontWeight('bold').setFontSize(16).setBackground('#102c4d').setFontColor('#ffffff');
 sheet.getRange(2,1,1,13).merge().setBackground('#eaf1f8');
 sheet.getRange(5,1,1,13).setFontWeight('bold').setBackground('#dceaf8');
 sheet.getRange(6,1,12,1).setFontWeight('bold');
 sheet.getRange(6,2,9,12).setNumberFormat('#,##0;[Red](#,##0);"-"');
 sheet.getRange(12,1,1,13).setFontWeight('bold').setBackground('#e3f2eb');
 sheet.setFrozenColumns(1);sheet.setFrozenRows(5);sheet.setColumnWidth(1,195);
 for(let j=2;j<=13;j++)sheet.setColumnWidth(j,123);
 const details=spreadsheet.insertSheet('入出金分類');
 const cats=[['対象月','計上区分','入金（円）','出金（円）'],...model.categorySummary.map(x=>[x.month,cfrExportCell_(x.category),x.incoming,x.outgoing])];
 details.getRange(1,1,cats.length,4).setValues(cats);
 details.getRange(1,1,1,4).setBackground('#102c4d').setFontColor('#ffffff').setFontWeight('bold');
 if(cats.length>1)details.getRange(2,3,cats.length-1,2).setNumberFormat('#,##0;[Red](#,##0);"-"');
 details.setFrozenRows(1);details.setColumnWidths(1,4,175);
 const planned=spreadsheet.insertSheet('予定の計上区分');
 const plannedRows=[['対象月','予定区分','入金（円）','出金（円）'],...(model.plannedCategories||[]).map(x=>[
  x.month,cfrExportCell_(x.category),x.direction==='IN'?x.amount:0,x.direction==='OUT'?x.amount:0])];
 planned.getRange(1,1,plannedRows.length,4).setValues(plannedRows);
 planned.getRange(1,1,1,4).setBackground('#102c4d').setFontColor('#ffffff').setFontWeight('bold');
 if(plannedRows.length>1)planned.getRange(2,3,plannedRows.length-1,2).setNumberFormat('#,##0;[Red](#,##0);"-"');
 planned.setFrozenRows(1);planned.setColumnWidths(1,4,180);
 const matrix=spreadsheet.insertSheet('区分別月次集計');
 const period=model.rows.map(row=>row.month),labelsByType=[
  ['予定入金','IN',model.plannedCategories||[]],['予定出金','OUT',model.plannedCategories||[]],
  ['実績入金','IN',model.categorySummary||[]],['実績出金','OUT',model.categorySummary||[]]];
 const categoryGrid=[['計上区分','集計種類',...period,'年間合計（円）']];
 labelsByType.forEach(([label,direction,source])=>{
  const grouped=new Map();
  source.forEach(item=>{
   const amount=label.startsWith('予定')?Number(item.amount||0):
    Number(direction==='IN'?item.incoming||0:item.outgoing||0);
   if((label.startsWith('予定')&&item.direction!==direction)||!amount)return;
   const monthIndex=period.indexOf(item.month);if(monthIndex<0)return;
   const category=String(item.category||'未分類'),totals=grouped.get(category)||Array(12).fill(0);
   totals[monthIndex]=cfrMoneySafe_(totals[monthIndex]+amount,'区分別月次合計');grouped.set(category,totals);
  });
  [...grouped.keys()].sort((a,b)=>a.localeCompare(b,'ja')).forEach(category=>{
   const excelRow=categoryGrid.length+1;
   categoryGrid.push([cfrExportCell_(category),label,...grouped.get(category),'=SUM(C'+excelRow+':N'+excelRow+')']);
  });
 });
 matrix.getRange(1,1,categoryGrid.length,15).setValues(categoryGrid);
 matrix.getRange(1,1,1,15).setBackground('#102c4d').setFontColor('#ffffff').setFontWeight('bold');
 if(categoryGrid.length>1)matrix.getRange(2,3,categoryGrid.length-1,13).setNumberFormat('#,##0;[Red](#,##0);"-"');
 matrix.setFrozenRows(1);matrix.setFrozenColumns(2);matrix.setColumnWidth(1,200);matrix.setColumnWidth(2,125);
 for(let c=3;c<=15;c++)matrix.setColumnWidth(c,115);
 const check=spreadsheet.insertSheet('銀行月次照合');
 const checks=[['月','口座名','取込件数','入金（円）','出金（円）','照合残高（円）','照合状況'],...model.bankReview.map(x=>[
  x.month,cfrExportCell_(x.accountName),x.importedCount,x.actualIn,x.actualOut,x.closingBalance===null?'':x.closingBalance,x.verified?'照合済':x.outdated?'再照合':'未照合'])];
 check.getRange(1,1,checks.length,7).setValues(checks);
 check.getRange(1,1,1,7).setBackground('#102c4d').setFontColor('#ffffff').setFontWeight('bold');
 check.setFrozenRows(1);check.setColumnWidths(1,7,145);check.setColumnWidth(2,200);
 const explanation=spreadsheet.insertSheet('条件・注意事項');
 const rows=[['項目','説明'],['決算年度',year+'年11月期'],['対象期間',(year-1)+'年12月～'+year+'年11月'],
  ['シナリオ',cfrExportCell_(model.scenarioName)],['出力状態',model.status],['作成日時',model.generatedAt],
  ['計算方法','確定済みの月は照合済実績、その他は基本予定と条件変更を採用'],
  ['口座間振替','銀行別月次照合の入出金には自社口座間振替を含みます。会社全体の資金繰り実績では内部振替を除外します。'],
  ['注意','予測値は資金不足を保証するものではありません。']];
 model.conditions.forEach((v,i)=>rows.push(['条件'+(i+1),cfrExportCell_(JSON.stringify(v))]));
 model.warnings.forEach((v,i)=>rows.push(['要確認'+(i+1),cfrExportCell_(v)]));
 explanation.getRange(1,1,rows.length,2).setValues(rows);
 explanation.getRange(1,1,1,2).setBackground('#102c4d').setFontColor('#ffffff').setFontWeight('bold');
 explanation.setColumnWidth(1,175);explanation.setColumnWidth(2,660);explanation.setFrozenRows(1);
 return spreadsheet;
}
function exportCashFlowReport(token,payload){
 requireAdminSession_(token);
 const p=payload||{},format=String(p.format||'').toUpperCase();
 if(!['PDF','XLSX'].includes(format))throw Error('出力形式はPDFまたはXLSXを選択してください。');
 const model=getCashFlowProjection(token,p);
 if(model.setupRequired)throw Error('資金繰りの初回DB設定が完了していません。');
 let spreadsheet=null;
 try{
  spreadsheet=SpreadsheetApp.create('FM_WORKS_CASHFLOW_TEMP_'+model.fiscalYear);
  cfrWriteReport_(spreadsheet,model);
  SpreadsheetApp.flush();
  const id=spreadsheet.getId(),url='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(id)+'/export?'+
   (format==='PDF'?'format=pdf&size=7&portrait=false&fitw=true&gridlines=false&sheetnames=false&printtitle=false':'format=xlsx');
  const response=UrlFetchApp.fetch(url,{method:'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw Error('帳票変換に失敗しました（HTTP '+response.getResponseCode()+'）。');
  const bytes=response.getContent(),signature=format==='PDF'?[37,80]:[80,75];
  if(!bytes||bytes.length<100||bytes.length>5*1024*1024||bytes[0]!==signature[0]||bytes[1]!==signature[1])
   throw Error('帳票ファイル形式またはファイルサイズを確認できませんでした。');
  const filename='FM_WORKS_資金繰り_'+model.fiscalYear+'年11月期_'+
   String(model.scenarioName).replace(/[^\w\u3040-\u30ff\u3400-\u9fff\-]/g,'_').slice(0,35)+'.'+format.toLowerCase();
  return {ok:true,filename,mimeType:format==='PDF'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
   base64:Utilities.base64Encode(bytes),status:model.status,warnings:model.warnings};
 }finally{
  if(spreadsheet){
   try{DriveApp.getFileById(spreadsheet.getId()).setTrashed(true);}
   catch(error){console.warn('FM WORKS temporary financial report cleanup failed.');}
  }
 }
}
