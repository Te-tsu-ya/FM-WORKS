import fs from 'node:fs';
// Entirely invented amounts/names. Never reads Sheets, Excel or environment secrets.
const seed={meta:{kind:'SYNTHETIC_ONLY',schemaVersion:1,asOf:'2026-10-13',fiscalYear:2026,description:'CTO説明用の架空データ。実取引・個人情報は含まない。'},
 employees:[{employeeId:'FM9001',name:'架空 管理者',displayName:'管理者',department:'経理部',role:'ADMIN',active:true},
 {employeeId:'FM9002',name:'架空 社員A',displayName:'社員A',department:'開発部',role:'USER',active:true}],
 finance:{receipts:[],expenses:[],travels:[]},cashflow:{accounts:[],transactions:[],notes:[],plans:[],years:[]},projects:[{projectId:'DEMO-P1',name:'架空社内アプリ整備',client:'架空企業A',status:'進行中',startDate:'2026-10-01',endDate:'2026-11-30'}]};
const months=Array.from({length:12},(_,i)=>i===0?'2025-12':'2026-'+String(i).padStart(2,'0'));
const categories=['売上入金','仕入・外注費','人件費','家賃・固定費','借入','借入元金返済','支払利息','その他経費'];
const banks=['架空みらい銀行','架空ふるさと信用金庫','架空ネット銀行'];let tx=0;
for(let a=0;a<3;a++){
 const id='DEMO-ACCOUNT-'+(a+1);seed.cashflow.accounts.push({id,bank:banks[a],branch:'架空本店',name:'普通預金'+(a+1),last4:'000'+(a+1),active:'TRUE',revision:1,updatedAt:'2026-10-13 09:00:00',editorId:'FM9001',requestKey:'DEMO-ACCOUNT-KEY-'+a});
 let balance=1500000+a*500000;
 for(const month of months){
  for(let d=0;d<10;d++){
   const date=month+'-'+String(3+d*2).padStart(2,'0');const category=categories[d%categories.length];
   const incoming=d%4===0?300000+a*50000+d*1100:0,outgoing=incoming?0:12000+(d+1)*3500+a*700;balance+=incoming-outgoing;
   if(date<=seed.meta.asOf){
    const idtx='DEMO-TX-'+String(++tx).padStart(5,'0');seed.cashflow.transactions.push({id:idtx,accountId:id,date,incoming,outgoing,description:'架空取引先'+(d+1)+' '+category,balance,externalId:'DEMO-REF-'+tx,occurrence:1,fingerprint:'seed-'+tx,transfer:'FALSE',sourceFile:'GitHub架空データ',importedAt:'2026-10-13 09:00:00',editorId:'FM9001',revision:1});
    seed.cashflow.notes.push({transactionId:idtx,category,tags:'架空',note:'CTO説明用の架空明細 '+tx,revision:1,updatedAt:'2026-10-13 09:00:00',editorId:'FM9001',requestKey:'DEMO-NOTE-'+tx});
   }
   seed.cashflow.plans.push({id:'DEMO-PLAN-'+a+'-'+month+'-'+d,title:'架空予定 '+category,direction:incoming?'IN':'OUT',amount:incoming||outgoing,accountId:id,category,frequency:'ONCE',startMonth:month,endMonth:month,day:Number(date.slice(8)),active:'TRUE',note:'銀行別の予定入力例',revision:1,updatedAt:'2026-10-13 09:00:00',editorId:'FM9001',requestKey:'DEMO-PLAN-KEY-'+a+'-'+month+'-'+d});
  }
 }
}
for(let m=0;m<12;m++)for(let d=0;d<25;d++){
 const usedOn=months[m]+'-'+String(1+d).padStart(2,'0'),amount=900+(d%9)*1100+m*30,owner=seed.employees[d%2],id='DEMO-RECEIPT-'+m+'-'+d;
 seed.finance.receipts.push({id,createdAt:usedOn+' 09:00:00',creatorId:owner.employeeId,creatorName:owner.name,usedOn,category:['消耗品費','交通費','通信費'][d%3],vendor:'架空取引先'+(d%7+1),invoiceNo:'',item:['文具','移動費','業務サービス'][d%3],amount,note:'架空経費 '+m+'-'+d,payer:owner.name,paymentMethod:d%2?'会社カード':'立替',paid:'済',receiptRef:'DEMO-REF-'+id,updatedAt:usedOn+' 09:00:00',requestKey:'DEMO-RECEIPT-KEY-'+m+'-'+d});
 if(d%5===0){const expenseOwner=seed.employees[(m+d)%2];seed.finance.expenses.push({id:'DEMO-EXPENSE-'+m+'-'+d,createdAt:usedOn+' 10:00:00',employeeId:expenseOwner.employeeId,employeeName:expenseOwner.name,usedOn,vendor:'架空文具店',item:'架空の立替経費',category:'消耗品費',amount,purpose:'社内業務の説明用',paymentMethod:'立替',receiptRef:'',status:['承認待ち','承認済','差戻し','精算済'][d%4],updatedAt:usedOn+' 10:00:00',requestKey:'DEMO-EXPENSE-KEY-'+m+'-'+d});}
}
for(let m=0;m<12;m++)seed.finance.travels.push({id:'DEMO-TRAVEL-'+m,createdAt:months[m]+'-06 09:00:00',employeeId:'FM9002',employeeName:'架空 社員A',title:'架空出張',startsOn:months[m]+'-05',startsAt:'09:00',endsOn:months[m]+'-05',endsAt:'17:00',destination:'架空市',purpose:'打合せの説明例',outcome:'要件を確認',distanceCategory:'近距離',spentAmount:6000+m*100,requestedAllowance:0,status:'承認待ち',updatedAt:months[m]+'-06 09:00:00',requestKey:'DEMO-TRAVEL-KEY-'+m});
seed.cashflow.years.push({fiscalYear:2026,openingBalance:6000000,monthsJson:JSON.stringify(months.map(month=>({month,planIn:null,planOut:null,actualIn:null,actualOut:null,note:''}))),revision:1,updatedAt:'2026-10-13 09:00:00',editorId:'FM9001',requestKey:'DEMO-YEAR-KEY-2026'});
fs.writeFileSync('demo/data/financial.json',JSON.stringify(seed,null,2)+'\n');
console.log(JSON.stringify({accounts:3,bankTransactions:tx,plans:seed.cashflow.plans.length,receipts:300,expenses:60,travels:12}));
