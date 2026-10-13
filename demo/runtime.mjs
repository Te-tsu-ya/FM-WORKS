import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export class MemorySheet{
 constructor(name,header,rows=[]){this.name=name;this.rows=[header.slice(),...structuredClone(rows)];this.maxRows=Math.max(1000,this.rows.length);}
 getName(){return this.name;}getLastRow(){return this.rows.length;}getLastColumn(){return this.rows[0]?.length||0;}getMaxRows(){return this.maxRows;}
 appendRow(row){this.rows.push(row.slice());return this;}insertRowsAfter(_at,n){this.maxRows+=n;}deleteRows(at,n){this.rows.splice(at-1,n);}deleteRow(at){this.deleteRows(at,1);}
 getRangeList(refs){return {getRanges:()=>refs.map(ref=>{const m=/^A(\d+):([A-Z]+)(\d+)$/.exec(ref);let cols=0;for(const c of m[2])cols=cols*26+c.charCodeAt(0)-64;return this.getRange(+m[1],1,+m[3]-+m[1]+1,cols);})};}
 getRange(start,col,height=1,width=1){const sheet=this;return {
  getValues(){return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>sheet.rows[start+i-1]?.[col+j-1]??''));},
  getDisplayValues(){return this.getValues().map(r=>r.map(v=>String(v??'')));},
  setValues(values){if(values.length!==height||values.some(r=>r.length!==width))throw Error('Range size mismatch');values.forEach((r,i)=>{sheet.rows[start+i-1]||=[];r.forEach((v,j)=>sheet.rows[start+i-1][col+j-1]=v);});return this;},
  setValue(v){return this.setValues([[v]]);},getValue(){return this.getValues()[0][0];},
  createTextFinder(value){let regex=false,entire=false;return {useRegularExpression(v){regex=v;return this;},matchEntireCell(v){entire=v;return this;},matchCase(){return this;},
   findAll(){const found=[];const re=regex?new RegExp(value,'i'):null;for(let i=start-1;i<Math.min(sheet.rows.length,start-1+height);i++)for(let j=col-1;j<col-1+width;j++){const text=String(sheet.rows[i]?.[j]??'');if(re?re.test(text):entire?text===String(value):text.includes(String(value)))found.push({getRow:()=>i+1});}return found;},findNext(){return this.findAll()[0]||null;}};}
 };}
}
export function createDemoRuntime(input=JSON.parse(fs.readFileSync(path.join(root,'demo/data/financial.json'),'utf8'))){
 const seed=structuredClone(input);if(seed.meta.kind!=='SYNTHETIC_ONLY')throw Error('Only synthetic data may initialize the repository demo');
 const sheets=new Map(),cache=new Map(),audits=[];
 const format=(value,_zone,pattern)=>{const d=new Date(value);const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d).split(' ');return pattern==='yyyy-MM-dd'?parts[0]:pattern==='yyyy-MM'?parts[0].slice(0,7):parts.join(' ');};
 const noExternal=()=>{throw Error('説明用データでは外部サービス・実DB・公開・ファイル発行は実行しません。');};
 const props={getProperty:()=>null,setProperty:noExternal};
 const ctx=vm.createContext({console:{log(){},warn(){},error(){}},Date,Math,Object,Array,String,Number,Map,Set,JSON,RegExp,
  Utilities:{getUuid:()=>crypto.randomUUID(),formatDate:format,computeDigest:(_a,s)=>Array.from(crypto.createHash('sha256').update(String(s)).digest()),DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},base64Encode:s=>Buffer.from(s).toString('base64')},
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k),getAll:ks=>Object.fromEntries(ks.filter(k=>cache.has(k)).map(k=>[k,cache.get(k)])),putAll:o=>Object.entries(o).forEach(([k,v])=>cache.set(k,v)),removeAll:ks=>ks.forEach(k=>cache.delete(k))})},
  PropertiesService:{getScriptProperties:()=>props},SpreadsheetApp:{flush(){},openById:noExternal,create:noExternal},DriveApp:new Proxy({}, {get:()=>noExternal}),UrlFetchApp:{fetch:noExternal},
  LockService:{getScriptLock:()=>({waitLock(){},tryLock:()=>true,releaseLock(){}})}});
 for(const name of fs.readdirSync(path.join(root,'src')).filter(n=>n.endsWith('.gs')&&n!=='GeneratedDocs.gs').sort())vm.runInContext(fs.readFileSync(path.join(root,'src',name),'utf8'),ctx,{filename:name});
 const specs=vm.runInContext('DB_SCHEMA_SPECS',ctx);
 for(const [name,header] of Object.entries(specs))sheets.set(name,new MemorySheet(name,header));
 const baseSheets={'プロジェクト':['ID','案件','顧客','状態','開始','終了','備考','更新者','日時'],'工数':Array.from({length:15},(_,i)=>'工数'+i),'打刻ログ':Array.from({length:12},(_,i)=>'打刻'+i),'予定':Array.from({length:18},(_,i)=>'予定'+i),'会社カレンダー':Array.from({length:8},(_,i)=>'会社日'+i),'月次締め':Array.from({length:7},(_,i)=>'締め'+i)};
 for(const [name,header] of Object.entries(baseSheets))if(!sheets.has(name))sheets.set(name,new MemorySheet(name,header));
 for(const name of [...Object.values(vm.runInContext('DB.sheets',ctx)),'日次勤怠','設定','PIN再発行','セッション'])if(!sheets.has(name))sheets.set(name,new MemorySheet(name,Array.from({length:32},(_,i)=>'項目'+i)));
 const docs=Object.fromEntries([['requirements','REQUIREMENTS'],['technical','TECHNICAL_DESIGN']].map(([key,file])=>[key,{title:key==='requirements'?'要件定義書':'技術設計書',version:vm.runInContext('APP.version',ctx),updatedAt:seed.meta.asOf,markdown:fs.readFileSync(path.join(root,'docs',file+'.md'),'utf8')}]));
 vm.runInContext('const GENERATED_DOCS='+JSON.stringify(docs),ctx);
 const db={getSheetByName:n=>sheets.get(n)||null,getSheets:()=>[...sheets.values()],getId:()=> 'REPOSITORY-DEMO'};
 const nativeAudit=ctx.appendAudit_;
 Object.assign(ctx,{getDb_:()=>db,getDatabaseSpreadsheetId_:()=> 'REPOSITORY-DEMO',getEmployees_:()=>structuredClone(seed.employees),getEmployee_:id=>{const e=seed.employees.find(e=>e.employeeId===id);if(!e)throw Error('社員が見つかりません');return structuredClone(e);},
  requireSession_:token=>{if(token!=='REPO-DEMO')throw Error('AUTH_REQUIRED');return {employee:structuredClone(seed.employees[0])};},
  requireAdminSession_:token=>{const session=ctx.requireSession_(token);if(session.employee.role!=='ADMIN')throw Error('管理者のみ');return session;},withScriptLock_:fn=>fn(),appendAudit_:event=>{audits.push(structuredClone(event));return nativeAudit(event);}});
 const insert=(sheetName,keys,objects)=>{const sh=sheets.get(sheetName);objects.forEach(o=>sh.appendRow(keys.map(k=>o[k]??'')));};
 const finance=vm.runInContext('FINANCE_MODELS',ctx),cfp=vm.runInContext('CFP',ctx),cfa=vm.runInContext('CFA',ctx);
 for(const [k,data] of [['receipt',seed.finance.receipts],['expense',seed.finance.expenses],['travel',seed.finance.travels]])insert(finance[k].sheet,finance[k].keys,data);
 for(const [k,data] of [['account',seed.cashflow.accounts],['tx',seed.cashflow.transactions],['plan',seed.cashflow.plans]])insert(cfp[k].sheet,cfp[k].keys,data);
 insert(cfa.note.sheet,cfa.note.keys,seed.cashflow.notes);
 insert('資金繰り年間',['fiscalYear','openingBalance','monthsJson','revision','updatedAt','editorId','requestKey'],seed.cashflow.years);
 seed.projects.forEach(p=>sheets.get('プロジェクト').appendRow([p.projectId,p.name,p.client,p.status,p.startDate,p.endDate,'架空案件の説明用','','']));
 seed.employees.forEach(e=>{const row=Array(specs['社員マスタ'].length).fill('');Object.assign(row,{0:e.employeeId,1:e.name,2:e.displayName,3:e.department,5:e.role,6:'在籍',7:'09:00',8:'18:00',9:60,10:10,20:'ACTIVE'});sheets.get('社員マスタ').appendRow(row);});
 const initial=()=>({app:vm.runInContext('APP',ctx),today:seed.meta.asOf,serverTime:seed.meta.asOf+'T00:00:00Z',user:{...seed.employees[0],fullName:seed.employees[0].name},
  permissions:ctx.getPermissions_(seed.employees[0]),employees:structuredClone(seed.employees),projects:structuredClone(seed.projects),
  attendance:{state:'off',workedMinutes:0,workLocation:'出社',history:[],clockIn:'',clockOut:''},todaySchedule:[],companyToday:null,monthlyReview:null,month:null,tasks:null,overviewReady:false});
 ctx.getInitialData=()=>initial();ctx.resumeSession=()=>({initialData:initial(),mustChangePin:false});ctx.getPublicAuthConfig=()=>({needsSetup:false,pinLength:6,prototypeMode:true,support:{},branding:{}});
 ctx.login=ctx.prototypeLogin=()=>({sessionToken:'REPO-DEMO',initialData:initial(),mustChangePin:false});ctx.logout=()=>({ok:true});
 ctx.getFinanceSpendingInsights=(_token,p)=>({ok:true,...ctx.financeSpendingDigest_(ctx.financeRows_('receipt','',0,true).map(r=>[r.usedOn,r.category,r.vendor,'',r.item,r.amount,r.note,r.payer,r.paymentMethod,r.paid]),Number(p.year))});
 const allow=new Set(['getInitialData','resumeSession','getPublicAuthConfig','login','prototypeLogin','logout','getFinanceOverview','getMyFinanceItems','getFinanceSpendingInsights','saveFinanceReceipt','saveFinanceReceiptsBulk','submitFinanceExpense','submitFinanceTravel','reviewFinanceRequest','settleFinanceRequest','resubmitFinanceRequest','getCashFlowYear','saveCashFlowYear','getCashFlowBankWorkspace','saveCashFlowBankAccount','saveCashFlowScheduledItem','importCashFlowBankRows','setCashFlowTransfer','getCashFlowLedgerRows','saveCashFlowLedgerRows','getCashFlowAnalysisWorkspace','getCashFlowScenarioProjection','saveCashFlowAnnotation','saveCashFlowRule','saveCashFlowScenario','getHomeOverview','getNotifications','getProjectHubWorkspace','getProjectHubDetail','getWorklogs','getWorklogWindow','getRequests','getRequestsBundle','getCompanyDocuments','getSomuWorkspace','getSomuGrowthData','getSystemDocument']);
 return {seed,sheets,audits,initial,context:ctx,call(method,args=[]){if(!allow.has(method)||typeof ctx[method]!=='function')throw Error('この説明用環境では未対応の操作です: '+method);return JSON.parse(JSON.stringify(ctx[method](...args)));}};
}
