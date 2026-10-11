import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import {createHash} from 'node:crypto';
class Range {
 constructor(sheet,row,col,rows,cols){Object.assign(this,{sheet,row,col,rows,cols});}
 getDisplayValues(){return Array.from({length:this.rows},(_,i)=>Array.from({length:this.cols},(_,j)=>String(this.sheet.rows[this.row+i-1]?.[this.col+j-1]??'')));}
 setValues(values){values.forEach((row,i)=>{while(this.sheet.rows.length<this.row+i)this.sheet.rows.push([]);row.forEach((v,j)=>this.sheet.rows[this.row+i-1][this.col+j-1]=v)});return this;}
 merge(){return this;}setFontWeight(){return this;}setFontSize(){return this;}setBackground(){return this;}setFontColor(){return this;}setNumberFormat(){return this;}
}
class Sheet {
 constructor(headers){this.rows=[headers.slice()];this.name='';}
 getLastRow(){return this.rows.length;}getMaxRows(){return 2000;}getMaxColumns(){return 35;}insertRowsAfter(){}
 getRange(row,col,h=1,w=1){return new Range(this,row,col,h,w);}
 appendRow(v){this.rows.push(v.slice());}
 setName(v){this.name=v;}setFrozenColumns(){}setFrozenRows(){}setColumnWidth(){}setColumnWidths(){}
}
class Workbook{
 constructor(){this.sheets=[new Sheet([])];this.id='EXAMPLE-SPREADSHEET';}
 getSheets(){return this.sheets;}getId(){return this.id;}
 insertSheet(name){const s=new Sheet([]);s.setName(name);this.sheets.push(s);return s;}
}
const sheets=new Map(),audit=[];let idSeq=0,trash=0,spreadsheet=null,lastExport='';
const utils={DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},
 getUuid:()=>String(++idSeq),formatDate:()=> '2026-10-11 15:00:00',
 computeDigest:(_alg,text)=>[...createHash('sha256').update(text).digest()].map(x=>x>127?x-256:x),
 base64Encode:bytes=>Buffer.from(bytes).toString('base64'),newBlob:text=>({getBytes:()=>[...Buffer.from(text,'utf8')]})};
const ctx=vm.createContext({console,Date,Number,Array,Map,Set,String,Math,Object,JSON,RegExp,
 DB:{timeZone:'Asia/Tokyo'},getDb_:()=>({getSheetByName:name=>sheets.get(name)||null}),
 safeSheetText_:v=>String(v).startsWith('=')?"'"+v:String(v),
 requireAdminSession_:token=>{if(token!=='ADMIN')throw Error('管理者のみ');return {employee:{employeeId:'A',name:'架空管理者'}};},
 withScriptLock_:fn=>fn(),appendAudit_:x=>audit.push(x),auditJson_:JSON.stringify,
 Utilities:utils,SpreadsheetApp:{flush(){},create(){spreadsheet=new Workbook();return spreadsheet;}},
 ScriptApp:{getOAuthToken:()=> 'NOT_A_REAL_TOKEN'},
 UrlFetchApp:{fetch:url=>{lastExport=url;const pdf=url.includes('format=pdf'),data=Array(120).fill(0);data[0]=pdf?37:80;data[1]=pdf?80:75;return{getResponseCode:()=>200,getContent:()=>data};}},
 DriveApp:{getFileById:()=>({setTrashed(value){if(value)trash++;}})}
});
for(const p of ['Schema.gs','CashFlow.gs','CashFlowBank.gs','CashFlowAnalysis.gs','CashFlowReport.gs','CashFlowTaxExport.gs','CashFlowPlanLink.gs'])vm.runInContext(fs.readFileSync('src/'+p,'utf8'),ctx,{filename:p});
const specs=JSON.parse(JSON.stringify(vm.runInContext('DB_SCHEMA_SPECS',ctx)));
for(const name of ['資金繰り年間','資金口座','資金予定','資金取引','資金月次確定','資金明細注記','資金分類ルール','資金シナリオ','資金月次照合','資金予定照合'])
 sheets.set(name,new Sheet(specs[name]));
const put=(name,row)=>sheets.get(name).appendRow(row);
const months=JSON.parse(JSON.stringify(ctx.cashFlowBlank_(2026)));
months[0].actualIn=900;months[0].actualOut=100; // legacy manual-only actual; verified empty bank month must override it.
put('資金繰り年間',[2026,1000,JSON.stringify(months),1,'2026-10-11','A','KEY']);
put('資金口座',['A','架空銀行','本店','架空口座','1234','TRUE',1,'','','']);
put('資金予定',['P1','毎月の保守入金','IN',100,'A','売上','MONTHLY','2025-12','2026-11',25,'TRUE','',1,'','','']);
put('資金予定',['P2','毎月の支払','OUT',40,'A','家賃','MONTHLY','2025-12','2026-11',28,'TRUE','',1,'','','']);
const tx={accountId:'A',rows:[{date:'2026-04-10',incoming:90,outgoing:0,description:'ABCから入金',balance:1090,externalId:'bank-01',occurrence:1,transfer:false},
 {date:'2026-04-14',incoming:0,outgoing:10,description:'事務所費',balance:1080,externalId:'bank-02',occurrence:1,transfer:false}],
 fileName:'copied-web.txt',requestKey:'BANK-IMPORT-TEST-01'};
assert.throws(()=>ctx.getCashFlowProjection('EMPLOYEE',{fiscalYear:2026}),/管理者/);
assert.equal(ctx.importCashFlowBankRows('ADMIN',tx).added,2);
assert.equal(ctx.importCashFlowBankRows('ADMIN',{...tx,requestKey:'BANK-IMPORT-TEST-02'}).skipped,2);
const ws=ctx.getCashFlowAnalysisWorkspace('ADMIN',2026);
assert.equal(ws.transactionsCount,2);assert.equal(ws.unreviewedCount,2);
const april=ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04'});
assert.equal(april.total,2);assert.equal(april.rows[0].reviewed,false);

assert.throws(()=>ctx.getCashFlowAnalysisMonth('EMPLOYEE',{fiscalYear:2026,month:'2026-04'}),/管理者/);
assert.equal(april.rows[0].planMatch.status,'NONE','month API returns safe nonmatching status');
const fixturePlans=[
 {id:'P-MATCH',title:'保守料',direction:'IN',amount:'100',accountId:'A',frequency:'MONTHLY',startMonth:'2025-12',endMonth:'2026-11',day:'25',active:'TRUE'},
 {id:'P-OTHER-BANK',title:'別口座の保守',direction:'IN',amount:'100',accountId:'B',frequency:'MONTHLY',startMonth:'2025-12',endMonth:'2026-11',day:'25',active:'TRUE'}
];
const originalPlans=JSON.stringify(fixturePlans);
const aprilOccurrences=ctx.cfaPlanOccurrences_(fixturePlans,'2026-04');
const fixtureTx={accountId:'A',date:'2026-04-26',incoming:100,outgoing:0,description:'保守料 入金',transfer:'FALSE'};
const originalTx=JSON.stringify(fixtureTx);
const matchedPlan=ctx.cfaPlanMatch_(fixtureTx,aprilOccurrences);
assert.equal(matchedPlan.status,'POSSIBLE');
assert.equal(matchedPlan.total,1);
assert.equal(matchedPlan.candidates[0].planId,'P-MATCH');
assert.equal(matchedPlan.candidates[0].gapDays,1);
assert.equal(matchedPlan.candidates[0].descriptionMatch,true);
assert.equal(ctx.cfaPlanMatch_({...fixtureTx,accountId:'C'},aprilOccurrences).status,'NONE');
assert.equal(ctx.cfaPlanMatch_({...fixtureTx,incoming:99},aprilOccurrences).status,'NONE');
assert.equal(ctx.cfaPlanMatch_({...fixtureTx,incoming:0,outgoing:100},aprilOccurrences).status,'NONE');
assert.equal(ctx.cfaPlanMatch_({...fixtureTx,date:'2026-04-29'},aprilOccurrences).status,'NONE');
assert.equal(ctx.cfaPlanMatch_({...fixtureTx,transfer:'TRUE'},aprilOccurrences).status,'TRANSFER');
assert.equal(ctx.cfaPlanMatch_({...fixtureTx,date:'2026-02-30'},aprilOccurrences).status,'INVALID_DATE');
const ambiguousPlans=ctx.cfaPlanOccurrences_([fixturePlans[0],{...fixturePlans[0],id:'P-ALSO',title:'別の保守料'}],'2026-04');
const ambiguous=ctx.cfaPlanMatch_(fixtureTx,ambiguousPlans);
assert.equal(ambiguous.status,'AMBIGUOUS');
assert.equal(ambiguous.total,2);
const janEnd=[{...fixturePlans[0],id:'P-MONTH-END',day:'31'}];
const febMatches=ctx.cfaPlanOccurrences_(janEnd,'2026-02');
assert.equal(ctx.cfaPlanMatch_({...fixtureTx,date:'2026-02-28'},febMatches).candidates[0].plannedDate,'2026-02-28');
assert.equal(ctx.cfaPlanMatch_({...fixtureTx,date:'2026-03-01'},febMatches).status,'POSSIBLE');
assert.equal(JSON.stringify(fixturePlans),originalPlans,'matching never changes the stored plan');
assert.equal(JSON.stringify(fixtureTx),originalTx,'matching never changes the bank original');

const rule=ctx.saveCashFlowRule('ADMIN',{keyword:'ABC',direction:'IN',category:'売上入金',tags:'定期請求',priority:90,revision:0,requestKey:'RULE-FINANCE-00001'});
assert.equal(rule.ok,true);
assert.equal(ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04'}).rows.find(r=>r.description.includes('ABC')).suggested,true);
const tgt=ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04'}).rows.find(r=>r.description.includes('ABC')).id;
const note={transactionId:tgt,category:'売上入金',tags:'保守,請求書',note:'請求書と一致（架空）',revision:0,requestKey:'ANNOTATION-0000001'};
assert.equal(ctx.saveCashFlowAnnotation('ADMIN',note).revision,1);
assert.equal(ctx.saveCashFlowAnnotation('ADMIN',note).duplicate,true);
assert.throws(()=>ctx.saveCashFlowAnnotation('ADMIN',{...note,category:'不一致'}),/識別子/);
assert.throws(()=>ctx.saveCashFlowAnnotation('ADMIN',{...note,revision:0,requestKey:'ANNOTATION-0000002'}),/変更/);
const notSaved=ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04'}).rows.find(r=>r.id!==tgt);
const applied=ctx.applyCashFlowRules('ADMIN',{transactionIds:[notSaved.id],requestKey:'RULEAPPLY-0000001'});
assert.equal(applied.added,0,'nonmatching rule must never force classification');
assert.equal(ctx.getCashFlowAnalysisWorkspace('ADMIN',2026).unreviewedCount,1);

const pendingOnly=ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04',onlyUnreviewed:true});
assert.equal(pendingOnly.total,1,'review queue must exclude separately annotated rows');
assert.equal(pendingOnly.rows[0].id,notSaved.id);
const fullView=ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04',onlyUnreviewed:false});
assert.equal(fullView.total,2,'default month view must retain the complete statement');
assert.throws(()=>ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04',onlyUnreviewed:'true'}),/表示条件/);


assert.throws(()=>ctx.exportCashFlowTaxAdvisorCsv('EMPLOYEE',{fiscalYear:2026}),/管理者/);
const redacted=ctx.exportCashFlowTaxAdvisorCsv('ADMIN',{fiscalYear:2026});
assert.equal(redacted.ok,true);assert.equal(redacted.count,2);assert.equal(redacted.includeMemo,false);
const csv0=Buffer.from(redacted.base64,'base64').toString('utf8');
assert.ok(csv0.startsWith('\uFEFF'));assert.ok(csv0.includes('個別メモ（省略）'));
assert.ok(!csv0.includes('請求書と一致（架空）'),'private notes must be hidden by default');
assert.equal(redacted.attentionCount,1);
const full=ctx.exportCashFlowTaxAdvisorCsv('ADMIN',{fiscalYear:2026,includeMemo:true});
const csv1=Buffer.from(full.base64,'base64').toString('utf8');
assert.ok(csv1.includes('請求書と一致（架空）'));
assert.ok(csv1.includes('説明記録あり・税理士未確認'));
assert.ok(csv1.includes('説明待ち'));
assert.throws(()=>ctx.exportCashFlowTaxAdvisorCsv('ADMIN',{fiscalYear:2026,includeMemo:'yes'}),/指定/);
assert.ok(ctx.cftCsvCell_('  =HYPERLINK("x")').startsWith('"'+String.fromCharCode(39)+'  ='));
assert.ok(ctx.cftCsvCell_('+1').startsWith('"'+String.fromCharCode(39)+'+1'));


// Cross-boundary approval checks: bank originals are never touched.
const manualSheet=sheets.get('資金予定照合');
sheets.delete('資金予定照合');
assert.equal(ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04'}).linkReady,false,
 'v19 data stores remain usable while plan-link storage is not installed');
sheets.set('資金予定照合',manualSheet);
const originalBank=JSON.stringify(sheets.get('資金取引').rows);
const planSheet=sheets.get('資金予定'),priorPlanCount=planSheet.rows.length;
put('資金予定',['P-MANUAL','ABC入金予定','IN',90,'A','売上','MONTHLY',
 '2025-12','2026-11',10,'TRUE','',1,'','','']);
const bankTx=ctx.cfpRows_('tx',false).rows.find(x=>Number(x.incoming)===90);
const link={action:'APPROVE',transactionId:bankTx.id,planId:'P-MANUAL',
 plannedDate:'2026-04-10',reason:'架空入金と予定を画面で確認',
 revision:0,requestKey:'MANUAL-APR-00000001'};
assert.throws(()=>ctx.saveCashFlowPlanLink('EMPLOYEE',link),/管理者/);
assert.throws(()=>ctx.saveCashFlowPlanLink('ADMIN',{...link,plannedDate:'2026-04-11',requestKey:'MANUAL-APR-BAD0001'}),/金額・口座・予定日/);
assert.throws(()=>ctx.saveCashFlowPlanLink('ADMIN',{...link,planId:'P1',requestKey:'MANUAL-APR-BAD0002'}),/金額・口座・予定日/);
put('資金予定照合',['TX-OTHER','P-MANUAL','2026-04-10','APPROVED','hash','hash','別取引',
 1,'2026-10-11','A','OTHER-LINK-000001']);
assert.throws(()=>ctx.saveCashFlowPlanLink('ADMIN',link),/別の明細で承認済み/);
manualSheet.rows.pop();
const saved=ctx.saveCashFlowPlanLink('ADMIN',link);
assert.equal(saved.ok,true);assert.equal(saved.status,'APPROVED');assert.equal(saved.revision,1);
assert.equal(ctx.saveCashFlowPlanLink('ADMIN',link).duplicate,true,'same request can be safely retried');
assert.throws(()=>ctx.saveCashFlowPlanLink('ADMIN',{...link,reason:'changed'}),/送信識別子/);
const linked=ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04'});
assert.equal(linked.linkReady,true);
assert.equal(linked.rows.find(x=>x.id===bankTx.id).planLink.status,'APPROVED');
const record=ctx.cfmlRows_(false).rows.find(x=>x.transactionId===bankTx.id),
 bankPlan=ctx.cfpRows_('plan',false).rows.find(x=>x.id==='P-MANUAL');
assert.equal(ctx.cfmlReadLink_(record,bankTx,[{...bankPlan,title:'名称変更'}]).status,'STALE');
assert.equal(ctx.cfmlReadLink_(record,{...bankTx,description:'別の銀行明細'},[bankPlan]).status,'STALE');
assert.throws(()=>ctx.saveCashFlowPlanLink('ADMIN',{action:'UNLINK',transactionId:bankTx.id,revision:0,
 reason:'取消',requestKey:'MANUAL-UNLINK-BAD1'}),/変更/);
const unlink={action:'UNLINK',transactionId:bankTx.id,reason:'照合のやり直し',
 revision:1,requestKey:'MANUAL-UNLINK-0001'};
assert.equal(ctx.saveCashFlowPlanLink('ADMIN',unlink).status,'UNLINKED');
assert.equal(ctx.saveCashFlowPlanLink('ADMIN',unlink).duplicate,true);
assert.equal(ctx.getCashFlowAnalysisMonth('ADMIN',{fiscalYear:2026,month:'2026-04'})
 .rows.find(x=>x.id===bankTx.id).planLink.status,'NONE');
assert.equal(JSON.stringify(sheets.get('資金取引').rows),originalBank,'approval must never mutate imported bank rows');
assert.equal(planSheet.rows.length,priorPlanCount+1);
planSheet.rows.pop();

const baseline=ctx.getCashFlowProjection('ADMIN',{fiscalYear:2026});
assert.equal(baseline.rows[0].forecastEnd,1060);
assert.equal(baseline.rows.find(x=>x.month==='2026-04').source,'予定','unreconciled bank rows must not replace forecast');
const scenario=ctx.saveCashFlowScenario('ADMIN',{fiscalYear:2026,name:'銀行入金1か月遅延',
 changes:[{type:'SHIFT',month:'2026-05',planId:'P1',monthsDelta:1}],revision:0,requestKey:'SCENARIO-TEST-001'});
assert.equal(scenario.ok,true);
const shifted=ctx.getCashFlowProjection('ADMIN',{fiscalYear:2026,scenarioId:scenario.id});
assert.equal(shifted.rows.find(r=>r.month==='2026-05').difference,-100);
assert.equal(shifted.plannedCategories.filter(r=>r.month==='2026-05'&&r.direction==='IN').reduce((sum,r)=>sum+r.amount,0),0,'shifted revenue must be removed from planned income categories');
assert.equal(shifted.plannedCategories.filter(r=>r.month==='2026-06'&&r.direction==='IN').reduce((sum,r)=>sum+r.amount,0),200,'shifted revenue must be present in June categories');
assert.equal(shifted.rows.find(r=>r.month==='2026-06').difference,0,'delayed payment catches up on following month');
assert.throws(()=>ctx.cfrScenarioApply_(2026,[{id:'P1',active:true,direction:'IN',amount:100,frequency:'MONTHLY',startMonth:'2025-12',endMonth:'2026-11'}],
 [{type:'SHIFT',month:'2026-05',planId:'P1',monthsDelta:1},{type:'OMIT',month:'2026-05',planId:'P1'}],''),/複数/);
for(const month of ['2025-12','2026-01','2026-02','2026-03']){
 ctx.saveCashFlowBankReconciliation('ADMIN',{fiscalYear:2026,month,accountId:'A',closingBalance:1000,note:'銀行Webで取引なし確認',revision:0,requestKey:'RECON-'+month+'-00001'});
}
assert.throws(()=>ctx.saveCashFlowClosedThrough('ADMIN',{fiscalYear:2026,through:'2026-04',revision:0,requestKey:'CLOSE-RECON-000001'}),/照合/);
ctx.saveCashFlowBankReconciliation('ADMIN',{fiscalYear:2026,month:'2026-04',accountId:'A',closingBalance:1080,note:'Web残高を照合',revision:0,requestKey:'RECON-2026-04-00001'});
assert.throws(()=>ctx.saveCashFlowBankReconciliation('ADMIN',{fiscalYear:2026,month:'2026-04',accountId:'A',closingBalance:1080,note:'別根拠',revision:0,requestKey:'RECON-2026-04-00001'}),/識別子/,'changing reconciliation evidence with the same request identity must be rejected');
const closed=ctx.saveCashFlowClosedThrough('ADMIN',{fiscalYear:2026,through:'2026-04',revision:0,requestKey:'CLOSE-RECON-000001'});
assert.equal(closed.ok,true);
const afterClose=ctx.getCashFlowProjection('ADMIN',{fiscalYear:2026});
assert.equal(afterClose.rows[0].actualIn,0,'certified zero-bank month cannot inherit stale annual manual actual');
assert.equal(afterClose.rows[0].actualOut,0);
assert.equal(afterClose.rows[0].forecastEnd,1000);
assert.throws(()=>ctx.importCashFlowBankRows('ADMIN',{accountId:'A',rows:[{date:'2026-04-18',incoming:0,outgoing:5,description:'締め後の新規明細',balance:1075,externalId:'late',occurrence:1,transfer:false}],
 fileName:'late.txt',requestKey:'BANK-LATE-IMPORT-001'}),/確定済み/,'new cash movements in a closed month must be rejected');
assert.equal(ctx.getCashFlowProjection('ADMIN',{fiscalYear:2026}).rows.find(r=>r.month==='2026-04').source,'確定実績');
assert.throws(()=>ctx.setCashFlowTransfer('ADMIN',tgt,true,1),/確定済み/);
assert.throws(()=>ctx.saveCashFlowAnnotation('ADMIN',{...note,requestKey:'ANNOTATION-0000003',revision:1}),/確定済み/);
assert.throws(()=>ctx.saveCashFlowPlanLink('ADMIN',{...link,requestKey:'MANUAL-APR-CLOSED1',revision:2}),/確定済み/);
const exported=ctx.exportCashFlowReport('ADMIN',{fiscalYear:2026,scenarioId:scenario.id,format:'XLSX'});
assert.equal(exported.ok,true);assert.match(lastExport,/format=xlsx/);assert.equal(trash,1);
assert.ok(Buffer.from(exported.base64,'base64').length>=100);
assert.equal(spreadsheet.sheets.length,6);
 assert.ok(spreadsheet.sheets[5].rows.some(r=>r[0]==='口座間振替'&&String(r[1]).includes('内部振替を除外')),
  'official report must explain difference between gross bank flows and corporate net flows');assert.equal(spreadsheet.sheets[2].name,'予定の計上区分');assert.equal(spreadsheet.sheets[3].name,'区分別月次集計');
assert.equal(spreadsheet.sheets[3].rows[0].length,15);
const matrixSales=spreadsheet.sheets[3].rows.find(r=>r[0]==='売上'&&r[1]==='予定入金');
assert.ok(matrixSales,'planned revenue category must appear in 12-month matrix');
assert.equal(matrixSales[7],0,'scenario moved May revenue out of May (C=Dec, H=May)');
assert.equal(matrixSales[8],200,'June receives moved May revenue in addition to June base');assert.equal(spreadsheet.sheets[0].name,'年間資金繰り');
assert.equal(spreadsheet.sheets[0].rows[11][1].startsWith('=IF('),true,'monthly balance should be recalculable Excel formula');
const pdf=ctx.exportCashFlowReport('ADMIN',{fiscalYear:2026,format:'PDF'});
assert.match(lastExport,/format=pdf/);assert.equal(pdf.mimeType,'application/pdf');assert.equal(trash,2);
assert.throws(()=>ctx.exportCashFlowReport('STAFF',{fiscalYear:2026,format:'PDF'}),/管理者/);
assert.throws(()=>ctx.exportCashFlowReport('ADMIN',{fiscalYear:2026,format:'TXT'}),/形式/);
assert.ok(audit.length>3);

 // A single scheduled receipt in October does not establish zero cashflow for all preceding months.
 const oncePlan={id:'ONCE-UNKNOWN',active:true,direction:'IN',amount:1000,
  category:'売上入金',frequency:'ONCE',startMonth:'2026-10',endMonth:'2026-10',day:20};
 const fiscal=JSON.parse(JSON.stringify(ctx.cashFlowMonths_(2026)));
 const isolated=ctx.cfrScenarioApply_(2026,[oncePlan],[],'');
 const emptyBank=new Map(fiscal.map(month=>[month,{month,scheduledCount:0,actualIn:0,actualOut:0,importedCount:0}]));
 const unknown=ctx.cfrMonthTotals_(fiscal,[oncePlan],[],isolated,emptyBank,'',new Map(),2000);
 assert.equal(unknown.rows[0].source,'未入力','unplanned month must not be inferred zero');
 assert.equal(unknown.rows[0].plannedIn,null);
 assert.equal(unknown.rows.find(row=>row.month==='2026-10').plannedIn,1000,'one-time income remains planned');
 assert.equal(unknown.yearEnd,null,'missing months make year-end forecast unknown');
 const manualZero=fiscal.map(month=>({month,planIn:0,planOut:0}));
 const explicit=ctx.cfrMonthTotals_(fiscal,[oncePlan],manualZero,isolated,emptyBank,'',new Map(),2000);
 assert.equal(explicit.rows[0].source,'予定','explicit zero is a meaningful input');
 assert.equal(explicit.yearEnd,3000,'explicit zero for other months yields correct 12-month forecast');


// Bank-by-bank totals include real account transfers even though company-wide totals exclude them.
const transferFixture=[
 {id:'BANK-A-TRANSFER',accountId:'A',date:'2026-07-11',incoming:0,outgoing:800,
  balance:1200,transfer:'TRUE',rowNo:100,fingerprint:'TR-A'},
 {id:'BANK-B-TRANSFER',accountId:'B',date:'2026-07-11',incoming:800,outgoing:0,
  balance:4400,transfer:'TRUE',rowNo:101,fingerprint:'TR-B'},
 {id:'BANK-A-SALE',accountId:'A',date:'2026-07-12',incoming:450,outgoing:0,
  balance:1650,transfer:'FALSE',rowNo:102,fingerprint:'SALE'}
];
const aJuly=ctx.cfaBankMonth_(transferFixture,'2026-07','A');
const bJuly=ctx.cfaBankMonth_(transferFixture,'2026-07','B');
assert.equal(aJuly.count,2);
assert.equal(aJuly.inAmount,450);
assert.equal(aJuly.outAmount,800,'bank A reconciliation must include outgoing transfer');
assert.equal(bJuly.inAmount,800,'bank B reconciliation must include incoming transfer');
assert.equal(bJuly.outAmount,0);
assert.equal(transferFixture.filter(row=>row.transfer!=='TRUE').reduce((s,r)=>s+r.incoming,0),450,
 'company-wide cash receipts exclude internal transfers');
assert.equal(transferFixture.filter(row=>row.transfer!=='TRUE').reduce((s,r)=>s+r.outgoing,0),0,
 'company-wide cash payments exclude internal transfers');

assert.equal(ctx.cfrExportCell_('  =SUM(1,2)'),"'  =SUM(1,2)",'spreadsheet formula after leading whitespace must be neutralized');
assert.equal(ctx.cfrExportCell_('\t+1+2'),"'\t+1+2",'tab-prefixed spreadsheet formulas must be neutralized');
assert.equal(ctx.cfrExportCell_('expense - adjustments'),'expense - adjustments','normal narrative should remain unmodified');
console.log('PASS finance: copy import, duplicate rejection, memo, classification, what-if, reconciliation before close, XLSX and PDF signatures, ADMIN-only');
