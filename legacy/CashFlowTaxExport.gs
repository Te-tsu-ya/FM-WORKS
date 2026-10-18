/* FM WORKS | Authorized, read-only tax advisor bank statement CSV. */
function cftCsvCell_(value){
 const safe=cfrExportCell_(value==null?'':String(value));
 return '"'+String(safe).replace(/"/g,'""')+'"';
}
function cftBuildStatement_(transactions,accounts,notes,includeMemo){
 const byAccount=new Map(accounts.map(a=>[a.id,a]));
 const headings=['日付','金融機関','口座名','入金（円）','出金（円）','銀行摘要（原本）',
  '保存した分類','タグ',includeMemo?'個別メモ':'個別メモ（省略）','説明状態','内部振替','銀行明細ID'];
 const lines=[headings.map(cftCsvCell_).join(',')];
 let attentionCount=0;
 transactions.forEach(tx=>{
  const incoming=Number(tx.incoming||0),outgoing=Number(tx.outgoing||0);
  if(!Number.isSafeInteger(incoming)||incoming<0||!Number.isSafeInteger(outgoing)||outgoing<0||
      (incoming>0&&outgoing>0))throw Error('不正な入出金があります。銀行原本を確認してください。');
  const bank=byAccount.get(tx.accountId),annotation=notes.get(tx.id),transfer=tx.transfer==='TRUE';
  const status=transfer?'内部振替・両側要確認':annotation?'説明記録あり・税理士未確認':'説明待ち';
  if(transfer||!annotation)attentionCount++;
  lines.push([tx.date,bank?bank.bank:'不明口座',bank?bank.name:'不明口座',
   incoming,outgoing,tx.description,annotation?annotation.category:'未分類',
   annotation?annotation.tags:'',includeMemo&&annotation?annotation.note:'',
   status,transfer?'はい':'いいえ',tx.id].map(cftCsvCell_).join(','));
 });
 return {csv:'\uFEFF'+lines.join('\r\n')+'\r\n',attentionCount};
}
function exportCashFlowTaxAdvisorCsv(token,payload){
 requireAdminSession_(token);
 const p=payload||{},year=cashFlowYear_(p.fiscalYear);
 if(p.includeMemo!==undefined&&typeof p.includeMemo!=='boolean')throw Error('メモ出力指定が不正です。');
 if(!cfaReady_())throw Error('資金繰りのDB設定が未完了です。');
 const fiscalMonths=new Set(cashFlowMonths_(year));
 const transactions=cfpRows_('tx',false).rows.filter(x=>fiscalMonths.has(String(x.date).slice(0,7)))
  .sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
 if(transactions.length>2500)throw Error('明細が2500件を超えます。省略せず期間分割する機能が必要です。');
 const accounts=cfpRows_('account',false).rows,notes=new Map(cfaRows_('note',false).rows.map(x=>[x.transactionId,x]));
 const data=cftBuildStatement_(transactions,accounts,notes,p.includeMemo===true);
 const bytes=Utilities.newBlob(data.csv,'text/csv;charset=utf-8').getBytes();
 if(bytes.length>3*1024*1024)throw Error('取引説明CSVが3MiBを超えました。');
 return {ok:true,filename:'FM_WORKS_税理士向け明細_'+year+'年11月期.csv',
  mimeType:'text/csv;charset=utf-8',base64:Utilities.base64Encode(bytes),
  count:transactions.length,attentionCount:data.attentionCount,includeMemo:p.includeMemo===true};
}
