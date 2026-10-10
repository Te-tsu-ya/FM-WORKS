/**
 * Read-only legacy spending analysis, transparent travel allowance estimate
 * and official National Tax Agency invoice issuer lookup.
 * Legacy source: user-shared "事務所で必要なもの" > "経費" columns A:J.
 * NEVER modifies that workbook or merges it into FM WORKS accounting totals.
 */
const FINANCE_LEGACY_SPEND_ID='1jLC5gBcNrimWz57E3GKUNjQAeTqRdYshQB6zwdAoWeI';
const FINANCE_NTA_PUBLIC_URL='https://www.invoice-kohyo.nta.go.jp/';
const FINANCE_TRAVEL_RULES=Object.freeze({
  '代表':{day:5500,overnight:6500,early:3000,late:4500,both:6000,cap:8500,lodgingCity:20000,lodgingOther:18000},
  '役員':{day:3500,overnight:4000,early:2500,late:4000,both:5500,cap:7000,lodgingCity:18000,lodgingOther:16000},
  '部長':{day:2500,overnight:3500,early:2000,late:3500,both:5000,cap:6000,lodgingCity:14000,lodgingOther:12000},
  '課長':{day:2200,overnight:3000,early:1500,late:3000,both:4500,cap:5500,lodgingCity:12000,lodgingOther:10000},
  '係長':{day:2000,overnight:2500,early:1500,late:2500,both:4000,cap:5000,lodgingCity:10000,lodgingOther:8000},
  '主任':{day:1500,overnight:2000,early:1300,late:2000,both:3300,cap:4000,lodgingCity:10000,lodgingOther:8000},
  '係':{day:1000,overnight:1500,early:1000,late:1500,both:2500,cap:3000,lodgingCity:10000,lodgingOther:8000}
});
function financeAdvisorNumber_(value){
  const text=String(value==null?'':value).trim().replace(/[¥￥円,\s]/g,'');
  if(!text||!/^-?\d+(?:\.\d+)?$/.test(text))return null;
  const n=Number(text);
  return Number.isFinite(n)?n:null;
}
function financeSpendingDigest_(rows,year){
  const totals={months:{},payers:{},vendors:{},items:{}},records=[];
  let count=0,total=0,skipped=0;
  (rows||[]).forEach(row=>{
    const dateText=String(row[0]||'').trim();
    const m=dateText.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
    if(!m||Number(m[2])<1||Number(m[2])>12||Number(m[3])<1||Number(m[3])>31)return;
    if(Number(m[1])!==year)return;
    const amount=financeAdvisorNumber_(row[5]);
    if(amount===null){skipped++;return;}
    const ym=m[1]+'-'+m[2].padStart(2,'0');
    const payer=String(row[7]||'未設定').trim().slice(0,90)||'未設定';
    const vendor=String(row[2]||'未設定').trim().slice(0,100)||'未設定';
    const item=String(row[4]||'未記入').trim().slice(0,120)||'未記入';
    [[totals.months,ym],[totals.payers,payer],[totals.vendors,vendor],[totals.items,item]].forEach(([obj,key])=>{
      const entry=obj[key]||(obj[key]={name:key,amount:0,count:0});
      entry.amount+=amount;entry.count++;
    });
    count++;total+=amount;
    // Only a bounded preview is sent. Summary counts reflect *all* rows.
    records.push({date:m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'),
      payer,vendor,item,amount,method:String(row[8]||'').slice(0,70),
      invoiceNo:String(row[3]||'').slice(0,32),note:String(row[6]||'').slice(0,140)});
  });
  const rank=map=>Object.values(map).sort((a,b)=>b.amount-a.amount||a.name.localeCompare(b.name,'ja'));
  return {year,count,total,skipped,months:rank(totals.months).sort((a,b)=>a.name.localeCompare(b.name)),
    payers:rank(totals.payers).slice(0,30),vendors:rank(totals.vendors).slice(0,30),
    items:rank(totals.items).slice(0,30),
    records:records.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,160),truncated:count>160,
    source:'LEGACY_ONLY',sourceLabel:'旧・事務所経費台帳（読み取り専用）'};
}
function getFinanceSpendingInsights(sessionToken,params){
  requireFinanceOperator_(sessionToken);
  const year=Number((params||{}).year||new Date().getFullYear());
  if(!Number.isInteger(year)||year<2023||year>new Date().getFullYear()+1)
    throw new Error('表示する年を確認してください。');
  const props=PropertiesService.getScriptProperties();
  const spreadsheetId=String(props.getProperty('FM_LEGACY_EXPENSE_SPREADSHEET_ID')||FINANCE_LEGACY_SPEND_ID).trim();
  const cache=CacheService.getScriptCache(),key='finspend:v1:'+year+':'+spreadsheetId.slice(-12);
  const hit=cache.get(key);
  if(hit){try{return JSON.parse(hit);}catch(_e){}}
  try{
    const ss=SpreadsheetApp.openById(spreadsheetId),sheet=ss.getSheetByName('経費');
    if(!sheet)throw new Error('SOURCE_SHEET_MISSING');
    const header=sheet.getRange(1,1,1,10).getDisplayValues()[0];
    if(header[0]!=='利用日'||header[2]!=='取引先'||header[5]!=='利用金額'||header[7]!=='支払者')
      throw new Error('SOURCE_SCHEMA_CHANGED');
    const last=sheet.getLastRow();
    const rows=last<2?[]:sheet.getRange(2,1,last-1,10).getDisplayValues();
    const report=Object.assign({ok:true},financeSpendingDigest_(rows,year));
    const json=JSON.stringify(report);
    if(json.length<90000)cache.put(key,json,120);
    return report;
  }catch(e){
    console.error('legacy expense report unavailable',e);
    return {ok:false,year,source:'LEGACY_ONLY',message:'旧経費台帳を読み込めませんでした。元シートの閲覧権限と列名をご確認ください。'};
  }
}
function financeTravelRole_(value){
  const text=String(value||'').trim();
  if(/代表/.test(text))return '代表';
  if(/役員|取締役/.test(text))return '役員';
  for(const role of ['部長','課長','係長','主任'])if(text.includes(role))return role;
  if(text==='係'||/一般社員|従業員/.test(text))return '係';
  return '';
}
function financeTravelExplanation_(data,role){
  const p=data||{},position=financeTravelRole_(role),
    rules=FINANCE_TRAVEL_RULES[position],issues=[],steps=[];
  const nRaw=p.nights==null?'':String(p.nights).trim();
  const nights=nRaw===''?0:financeAdvisorNumber_(nRaw);
  const validNights=nights!==null&&Number.isInteger(nights)&&nights>=0&&nights<=365;
  if(!validNights)issues.push('宿泊日数は0～365の整数で入力してください。');
  if(!rules)issues.push('役職が確認できません。社内の社員情報を確認してください。');
  const kmRaw=String(p.oneWayKm==null?'':p.oneWayKm).trim(),km=kmRaw===''?null:financeAdvisorNumber_(kmRaw);
  const category=String(p.distanceCategory||'未確認');
  const far=km!==null&&km>=100||km===null&&category==='片道100km以上';
  const near=km!==null&&km>=0&&km<100||km===null&&category==='片道100km未満';
  if(km!==null&&(km<0||km>30000))issues.push('片道距離は0～30,000kmで入力してください。');
  if(km===null&&!far&&!near)issues.push('旧シートの「30km以上」は100km以上と同義ではありません。片道距離を確認してください。');
  const time=(v)=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(v||''))?String(v):null;
  const start=time(p.startsAt),end=time(p.endsAt);
  if(!start||!end)issues.push('早朝・夜間手当の判定には出発時刻と帰着時刻が必要です。');
  const early=!!start&&start<'07:00',late=!!end&&end>='20:00';
  const timeCode=early&&late?'both':early?'early':late?'late':'';
  const overnight=validNights&&nights>0;
  const dateValid=/^\d{4}-\d{2}-\d{2}$/.test(String(p.startsOn||''))&&/^\d{4}-\d{2}-\d{2}$/.test(String(p.endsOn||''));
  if(dateValid&&String(p.endsOn)<String(p.startsOn))issues.push('帰着日が出発日より前です。');
  if(dateValid&&validNights){
    const days=Math.round((Date.parse(p.endsOn+'T00:00:00Z')-Date.parse(p.startsOn+'T00:00:00Z'))/86400000);
    if(nights>days)issues.push('宿泊日数が出張期間より多くなっています。');
  }
  let daily=null,lodging=null,total=null;
  if(rules&&validNights){
    const base=overnight?rules.overnight*nights:far?rules.day:0;
    const extra=timeCode?rules[timeCode]:0;
    const cap=rules.cap*Math.max(1,nights);
    daily=Math.min(base+extra,cap);
    steps.push({label:overnight?'宿泊出張日当':'日帰り出張日当',
      equation:overnight?rules.overnight.toLocaleString('ja-JP')+'円 × '+nights+'泊':
       far?rules.day.toLocaleString('ja-JP')+'円（片道100km以上）':
       near?'0円（片道100km未満・日帰り）':'0円（距離が未確認）',amount:base});
    steps.push({label:'早朝・夜間の手当',equation:timeCode?
      (early&&late?'午前7時前と午後8時以降':early?'午前7時前の出発':'午後8時以降の帰着'):
      '該当なし',amount:extra});
    steps.push({label:'日当の上限適用',equation:'min('+(base+extra).toLocaleString('ja-JP')+'円, '+rules.cap.toLocaleString('ja-JP')+
      '円 × '+Math.max(1,nights)+'日〈参考〉)',amount:daily});
    if(overnight&&timeCode)issues.push('宿泊日数がある場合、早朝・夜間手当の適用日と日ごとの上限を承認者が確認してください。');
    if(!overnight&&!far&&!near)issues.push('片道100kmを確認するまで日帰り日当は確定できません。');
    if(!overnight&&near&&timeCode)issues.push('片道100km未満の早朝・夜間出張は業務理由、移動経路、会社承認の確認が必要です。');
    if(!overnight&&near&&!timeCode)issues.push('100km未満かつ早朝・夜間なしの場合、通常の出張日当対象外です。');
    if(overnight){
      const raw=String(p.lodgingActual==null?'':p.lodgingActual).trim();
      const cost=raw===''?null:financeAdvisorNumber_(raw);
      const area=String(p.lodgingArea||'').trim();
      const maxPerNight=area==='指定地域'?rules.lodgingCity:area==='指定地域外'?rules.lodgingOther:null;
      if(cost===null||cost<0||!Number.isInteger(cost))issues.push('宿泊費は領収書に記載された実費（円）を入力してください。');
      else lodging=cost;
      if(maxPerNight===null)issues.push('宿泊地域（指定地域／指定地域外）が未確定です。');
      if(maxPerNight!==null&&lodging!==null&&lodging>maxPerNight*nights)
        issues.push('宿泊費が規程の上限を超えています。会社の事前承認を確認してください。');
      steps.push({label:'宿泊実費',equation:lodging===null?'領収書未入力':
        lodging.toLocaleString('ja-JP')+'円（上限'+
        (maxPerNight===null?'地域未判定':(maxPerNight*nights).toLocaleString('ja-JP')+'円')+'）',
        amount:lodging});
    }else lodging=0;
    if(lodging!==null&&issues.length===0)total=daily+lodging;
  }
  return {policy:'Fusion Mind旅費規程 2025-12-01',role:position||'未確認',
    status:issues.length?'REVIEW_REQUIRED':'REFERENCE',issues,steps,daily,lodging,total,
    note:total===null?'':('[旅費試算2025-12-01/参考] '+position+
      '・片道'+(km===null?(far?'100km以上':near?'100km未満':'未確認'):km+'km')+
      '：'+steps.map(step=>step.label+' '+step.equation+' ='+step.amount+'円').join('；')+
      '。日当'+daily+'円＋宿泊実費'+lodging+'円＝参考合計'+total+'円。承認時は規程と領収書を照合。')};
}
function getFinanceTravelExplanation(sessionToken,params){
  const employee=requireSession_(sessionToken).employee;
  const data=params||{};
  // Admin/accounting may inspect a different role; employees cannot self-elevate it.
  const role=financeOperatorAllowed_(employee)&&data.roleOverride?
    String(data.roleOverride):String(employee.title||'');
  return financeTravelExplanation_(data,role);
}
function financeInvoiceNumber_(number){
  const clean=String(number||'').replace(/[\s　-]/g,'').toUpperCase();
  if(!/^T\d{13}$/.test(clean))throw new Error('適格請求書番号はT＋13桁で入力してください。');
  return clean;
}
function lookupFinanceInvoiceIssuer(sessionToken,number){
  requireFinanceOperator_(sessionToken);
  const normalized=financeInvoiceNumber_(number);
  const props=PropertiesService.getScriptProperties();
  const appId=String(props.getProperty('NTA_INVOICE_API_ID')||'').trim();
  if(!appId)return {status:'UNCONFIGURED',number:normalized,
    message:'国税庁Web-APIのアプリケーションIDが未設定です。発行申請後にスクリプトプロパティへ設定してください。',
    source:FINANCE_NTA_PUBLIC_URL};
  if(!/^\d{13}$/.test(appId))return {status:'UNCONFIGURED',number:normalized,
    message:'国税庁Web-APIの設定値が不正です。管理者に確認してください。',source:FINANCE_NTA_PUBLIC_URL};
  const cache=CacheService.getScriptCache(),key='fin-invoice-v1:'+normalized;
  const cached=cache.get(key);
  if(cached){try{return JSON.parse(cached);}catch(_e){}}
  const endpoint='https://web-api.invoice-kohyo.nta.go.jp/1/num?id='+encodeURIComponent(appId)+
    '&number='+normalized+'&type=21&history=0';
  try{
    const response=UrlFetchApp.fetch(endpoint,{method:'get',muteHttpExceptions:true,followRedirects:false});
    if(response.getResponseCode()!==200)throw new Error('NTA_HTTP_ERROR');
    const body=JSON.parse(response.getContentText('UTF-8'));
    const announcements=Array.isArray(body.announcement)?body.announcement:[];
    const record=announcements.find(x=>String(x.registratedNumber||'')===normalized);
    const result=record?{status:'FOUND',number:normalized,
      name:String(record.name||record.tradeName||record.popularName_previousName||''),address:String(record.address||record.addressRequest||''),
      registeredOn:String(record.registrationDate||''),cancelledOn:String(record.disposalDate||''),
      expiredOn:String(record.expireDate||''),checkedOn:Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd'),
      source:FINANCE_NTA_PUBLIC_URL,
      disclaimer:'国税庁公表情報をもとに取得した結果です。取引日の登録状況や請求書の内容は別途確認してください。'}:
      {status:'NOT_FOUND',number:normalized,source:FINANCE_NTA_PUBLIC_URL,
       message:'登録番号に対応する公表情報は見つかりませんでした。'};
    cache.put(key,JSON.stringify(result),21600);
    return result;
  }catch(e){
    console.error('official invoice lookup failed',String(e));
    return {status:'ERROR',number:normalized,source:FINANCE_NTA_PUBLIC_URL,
      message:'国税庁の情報取得に失敗しました。公式サイトから確認してください。'};
  }
}
