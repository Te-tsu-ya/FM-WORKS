import fs from 'node:fs';
import vm from 'node:vm';
import {createDemoRuntime,MemorySheet} from './seed-builder.mjs';

const {version:appVersion}=JSON.parse(fs.readFileSync('package.json','utf8'));
fs.mkdirSync('src/generated',{recursive:true});
const runtime=createDemoRuntime();
if(vm.runInContext("APP.version",runtime.context)!==appVersion)throw Error("Package and engine versions differ");
runtime.sheets.set('社内文書',new MemorySheet('社内文書',vm.runInContext('COMPANY_DOC_HEADERS',runtime.context)));
const meta=vm.runInContext('({specs:DB_SCHEMA_SPECS,db:DB.sheets,finance:FINANCE_MODELS,bank:CFP,analysis:CFA,quote:QUOTE_MODEL,somu:SOMU_MODELS,hub:PROJECT_HUB_MODELS})',runtime.context);
const tableNames={
 '社員マスタ':'employees','打刻ログ':'attendance_logs','工数':'work_logs','予定':'schedules','会社カレンダー':'company_calendar',
 '監査ログ':'audit_events','プロジェクト':'projects','申請':'leave_requests','設定':'settings','月次締め':'monthly_periods',
 '月次確認':'monthly_reviews','月次確定':'monthly_snapshots','月次確定日次':'monthly_snapshot_days','有給台帳':'leave_ledger',
 '見積取引先':'vendors','見積ヘッダー':'quotes','見積明細':'quote_lines','見積採番':'quote_sequences',
 '関連書類':'related_documents','関連書類採番':'document_sequences','社内文書':'company_documents',
 '資金口座':'bank_accounts','資金予定':'cashflow_plans','資金取引':'bank_transactions','資金月次確定':'cashflow_periods',
 '資金繰り年間':'cashflow_years','総務備品':'assets','総務貸出':'asset_loans','総務購買':'purchase_requests',
 '総務書類':'office_documents','総務契約':'contracts','総務施設設備':'facilities','総務依頼':'office_tickets',
 'プロジェクト計画':'project_plans','プロジェクト作業':'project_tasks','プロジェクト資料':'project_resources','プロジェクト共有':'project_updates',
 '経費記録':'expense_receipts','経費精算申請':'expense_claims','出張報告':'travel_reports','プロジェクト工数対応':'project_worklog_links','プロジェクト依存':'project_dependencies','プロジェクト添付':'project_attachments','プロジェクト既読':'project_read_receipts','プロジェクト原価':'project_costs','プロジェクト予算':'project_budgets','資金明細注記':'transaction_annotations','資金分類ルール':'classification_rules','資金シナリオ':'cashflow_scenarios','資金月次照合':'bank_reconciliations','資金予定照合':'plan_matches',
 'セッション':'legacy_sessions','PIN再発行':'legacy_pin_requests','日次勤怠':'legacy_daily_attendance'
};
const namedColumns={
 '社員マスタ':['employee_id','name','display_name','department','title','role','status','work_start','work_end','break_minutes','leave_balance','email','note','pin_salt','pin_hash','must_change_pin','failure_count','locked_until','last_login','pin_updated','auth_status','permissions_json','payroll_included','manager_id','leave_basis_date','hire_date'],
 '打刻ログ':['id','employee_id','name','date','action','timestamp','work_location','source','status','note','voided_at','voided_by'],
 '予定':['id','date','start','end','all_day','employee_ids','employee_names','title','category','location','detail','visibility','status','owner_id','created_at','updated_at','source','color_key'],
 '会社カレンダー':['date','type','name','work_start','work_end','break_minutes','working','source','updated_by','updated_at'],
 'プロジェクト':['id','name','client','status','start_date','end_date','note','updated_by','updated_at'],
 '工数':['id','date','employee_id','name','project','category','description','start','end','minutes','note','created_at','status','voided_at','updated_at'],
 '設定':['key','value','note','updated_at'],
 '社内文書':['id','title','category','summary','effective_date','status','revision','updated_at','updated_by','url','created_at','created_by','deleted_at','deleted_by','request_key','body','folder_id','tags'],
 '監査ログ':['id','timestamp','employee_id','name','operation','target','target_id','before_json','after_json','source','result','note']
};
for(const group of [meta.finance,meta.bank,meta.analysis,meta.quote,meta.somu,meta.hub])for(const model of Object.values(group))if(model?.sheet&&model?.keys)namedColumns[model.sheet]=model.keys;

const seed={};let serial=0;
const specs=[];
for(const [name,table] of runtime.sheets){
 const headers=(meta.specs[name]||(name==='社内文書'?table.rows[0]:namedColumns[name])||table.rows[0]).slice();
 const keys=namedColumns[name]||[];
 const columns=headers.map((_,i)=>keys[i]||'field_'+String(i+1).padStart(2,'0'));
 const tableName=tableNames[name]||'domain_'+String(++serial).padStart(2,'0');
 specs.push({name,table:tableName,headers,columns});
 seed[name]=table.rows.slice(1).map(row=>headers.map((_,i)=>row[i]??''));
}
const byName=new Map(specs.map(s=>[s.name,s]));
const append=(name,item)=>{const spec=byName.get(name);if(!spec)return;seed[name].push(spec.columns.map(k=>item[k]??''));};
const at='2026-10-18 09:00:00';
for(let i=1;i<=3;i++){
 append('見積取引先',{code:'FI-000'+i,name:'架空取引先'+i,invoice:'',address:'架空県架空市',industry:'開発テスト',active:'有効',updatedAt:at});
 append('見積採番',{vendorCode:'FI-000'+i,lastNumber:0,verified:'確認済',updatedAt:at,updatedBy:'FM0001'});
}

seed['設定']=[['DB_VERSION','20','SQL adapter schema',''],['PROTOTYPE_MODE','TRUE','Synthetic only','']];
seed['社員マスタ'].forEach((row,i)=>{row[4]=i===0?'開発管理者':i===1?'リーダー':'担当者';row[5]=i===0?'ADMIN':i===1?'MANAGER':'USER';row[10]=10;row[20]='ACTIVE';row[22]='TRUE';row[23]=i>1?'FM0002':'';row[24]='2026-10-01';row[25]='2026-01-01';});
for(const [i,row] of seed['社員マスタ'].entries()){
 seed['有給台帳'].push(['SEED-LEAVE-'+i,row[0],row[1],'2026-10-01','2026-10-01','OPENING',10,10,'','FM0001','架空管理者',at,'SQL開発用の架空残数']);
}
for(let i=0;i<6;i++)append('社内文書',{id:'CD-SYNTHETIC-DOC-'+String(i).padStart(4,'0'),title:['開発版の使い方','勤怠入力の手順','経費精算の見本'][i%3],category:'マニュアル',summary:'動作確認のための架空文書',effective_date:'2026-10-01',status:'公開',revision:1,updated_at:at,updated_by:'FM0001',created_at:at,created_by:'FM0001',request_key:'SEED-COMPANY-DOC-'+i,body:'# 架空の手順書\n\nこの文書は開発用です。実際の社内ルールを表しません。',folder_id:'hr/work',tags:'開発,架空'});
for(let i=0;i<20;i++)append('総務備品',{id:'ASSET-'+i,code:'A-'+String(i+1).padStart(3,'0'),name:['開発用ノートPC','会議用モニター','テスト用タブレット'][i%3],category:'情報機器',maker:'架空メーカー',model:'DEMO-'+i,location:i%2?'会議室':'開発室',quantity:2,minimum:1,status:'利用可能',note:'全件架空データ',createdAt:at,updatedAt:at,updatedBy:'FM0001',revision:1});
for(let i=0;i<6;i++)append('総務書類',{id:'ODC-'+i,name:['就業ルール（架空）','備品管理マニュアル','出張申請の手順'][i%3],category:'マニュアル',location:'開発用',url:'',expiresOn:'2027-03-31',note:'開発用の見本です',status:'有効',creatorId:'FM0001',createdAt:at,updatedAt:at,requestKey:'SEED-DOC-'+String(i).padStart(8,'0')});
for(let i=0;i<3;i++)append('総務契約',{id:'CONTRACT-'+i,name:'架空のサービス契約'+i,category:'サービス',vendor:'架空ベンダー',startedOn:'2026-10-01',expiresOn:'2027-09-30',noticeOn:'2027-08-31',renewal:'自動更新',annualYen:120000,owner:'開発担当',status:'有効',revision:1,createdAt:at,updatedAt:at,requestKey:'SEED-CONTRACT-'+i});
for(let i=0;i<5;i++)append('総務施設設備',{id:'FACILITY-'+i,code:'FAC-'+i,name:'架空設備'+i,type:'情報設備',location:'開発室',owner:'開発担当',vendor:'架空メーカー',lastCheckedOn:'2026-10-01',nextCheckOn:'2027-01-01',status:'正常',revision:1,createdAt:at,updatedAt:at,requestKey:'SEED-FACILITY-'+i});
for(let i=0;i<8;i++)append('総務依頼',{id:'TICKET-'+i,subject:'架空の総務依頼'+i,category:'備品',priority:'通常',requesterName:'架空社員',assignee:'開発担当',dueOn:'2026-10-31',description:'入力操作を確認するための見本です。',status:i%2?'対応中':'未対応',revision:1,createdAt:at,updatedAt:at,requestKey:'SEED-TICKET-'+i});
for(let i=0;i<6;i++){
 const project=runtime.seed.projects[i];
 append('プロジェクト計画',{projectId:project.projectId,plannedMinutes:4800,ownerId:'FM0001',orderNo:'DEMO-'+i,receivedOn:'2026-10-01',orderValue:1000000+i*200000,orderStatus:'受注',revision:1,createdAt:at,updatedAt:at,createdBy:'FM0001',updatedBy:'FM0001',requestKey:'SEED-PLAN-'+i});
 for(let j=0;j<3;j++)append('プロジェクト作業',{id:'TASK-'+i+'-'+j,projectId:project.projectId,title:['要件を整理する','画面を実装する','操作を確認する'][j],ownerId:runtime.seed.employees[j].employeeId,startDate:'2026-10-01',dueDate:'2026-10-31',plannedMinutes:480,progress:j===0?100:j===1?50:0,status:j===0?'完了':'進行中',revision:1,createdAt:at,updatedAt:at,createdBy:'FM0001',updatedBy:'FM0001',requestKey:'SEED-TASK-'+i+'-'+j});
 append('プロジェクト資料',{id:'RESOURCE-'+i,projectId:project.projectId,title:'要件メモ（架空）',kind:'要件定義書',body:'# 開発用の要件メモ\n全データは架空です。',status:'有効',revision:1,createdAt:at,updatedAt:at,createdBy:'FM0001',updatedBy:'FM0001',requestKey:'SEED-RESOURCE-'+i});
}
for(let i=0;i<5;i++){
 const e=runtime.seed.employees[i];
 seed['打刻ログ'].push(['P-IN-'+i,e.employeeId,e.name,'2026-10-16','出勤','2026-10-16 09:00:00','出社','WEB','有効','','','']);
 seed['打刻ログ'].push(['P-OUT-'+i,e.employeeId,e.name,'2026-10-16','退勤','2026-10-16 18:00:00','出社','WEB','有効','','','']);
 seed['工数'].push(['WL-'+i,'2026-10-16',e.employeeId,e.name,runtime.seed.projects[0].name,'開発','架空の画面実装','09:00','12:00',180,'SQL移行の動作例',at,'有効','',at]);
 seed['予定'].push(['SCHEDULE-'+i,'2026-10-18',String(9+i).padStart(2,'0')+':00',String(10+i).padStart(2,'0')+':00','FALSE',e.employeeId,e.name,['朝の確認','設計レビュー','進捗共有','操作テスト','開発相談'][i],'社内','開発会議室','全件架空データ','社内','有効','FM0001',at,at,'SITES_SQL','社内']);
}
for(let i=0;i<5;i++)seed['申請'].push(['SEED-REQUEST-'+i,'2026-10-18',runtime.seed.employees[i].employeeId,runtime.seed.employees[i].name,'有給','2026-10-21','2026-10-21','架空の休暇申請','開発テスト','承認待ち','','','',at,'','','','','']);
seed['会社カレンダー']=[];
for(let date=new Date('2026-01-01T00:00:00Z');date.getUTCFullYear()===2026;date.setUTCDate(date.getUTCDate()+1)){
 const day=date.toISOString().slice(0,10),off=[0,6].includes(date.getUTCDay());
 seed['会社カレンダー'].push([day,off?'週末':'通常勤務',off?'週休日':'通常勤務',off?'':'09:00',off?'':'18:00',off?'':60,off?'FALSE':'TRUE','架空カレンダー','FM0001',at]);
}
const sqlSeed=JSON.stringify(seed);
fs.writeFileSync('src/generated/schema-meta.mjs','export const definitions = '+JSON.stringify(specs)+';\nexport const seed = '+sqlSeed+';\n');
fs.writeFileSync('db/table-mapping.json',JSON.stringify(specs,null,2)+'\n');
fs.writeFileSync('db/seeds/workspace.json',JSON.stringify(seed,null,2)+'\n');

// Tables are explicit SQL columns; the adapter only preserves existing rules.
let schema="import {sqliteTable, text, integer, check} from 'drizzle-orm/sqlite-core';\nimport {sql} from 'drizzle-orm';\n";
schema+="export const workspaceState=sqliteTable('workspace_state',{id:integer('id').primaryKey(),revision:integer('revision').notNull(),seedVersion:text('seed_version').notNull()});\n";
schema+="export const transactionGuard=sqliteTable('transaction_guard',{id:text('id').primaryKey(),expectedRevision:integer('expected_revision').notNull(),actualRevision:integer('actual_revision').notNull()},t=>[check('matching_revision',sql`${t.expectedRevision} = ${t.actualRevision}`)]);\n";
schema+="export const siteSessions=sqliteTable('site_sessions',{tokenHash:text('token_hash').primaryKey(),employeeId:text('employee_id').notNull(),visitorId:text('visitor_id').notNull(),expiresAt:integer('expires_at').notNull()});\n";
for(const [i,s] of specs.entries())schema+='export const domain'+i+' = sqliteTable('+JSON.stringify(s.table)+',{rowNo:integer("row_no").primaryKey(),'+s.columns.map((col,j)=>'c'+j+':text('+JSON.stringify(col)+')').join(',')+'});\n';
fs.writeFileSync('db/schema.ts',schema);

const sources=fs.readdirSync('src/domain').filter(n=>n.endsWith('.js')).sort().map(n=>fs.readFileSync('src/domain/'+n,'utf8')).join('\n');
const publicNames=[...sources.matchAll(/^function ([A-Za-z]\w*)\(/gm)].map(m=>m[1]).filter(n=>!n.endsWith('_'));
const blocked=/install|Job|Pin|Prototype|Backup|Trigger|initialize|migrate|export|Export|Attachment|issueQuote|retryQuote|getQuoteFile|createRelatedDocument|retryRelatedDocument|getRelatedDocumentFile|importJapan|importHolidays/;
const allowed=publicNames.filter(n=>!blocked.test(n)&&!['doGet','login','logout','resumeSession','getPublicAuthConfig','requestPinHelp'].includes(n));
const generatedDocs={requirements:{title:'FM WORKS 要件定義書',version:appVersion,updatedAt:'2026-10-18',markdown:fs.readFileSync('docs/REQUIREMENTS.md','utf8')},technical:{title:'FM WORKS 技術設計書',version:appVersion,updatedAt:'2026-10-18',markdown:fs.readFileSync('docs/TECHNICAL_DESIGN.md','utf8')}};
const engine='export const appVersion = '+JSON.stringify(appVersion)+';\nexport const apiMethods = '+JSON.stringify(allowed)+';\nexport function createEngine(services,actor,sessionToken){\nconst {Utilities,CacheService,PropertiesService,SpreadsheetApp,DriveApp,UrlFetchApp,LockService,Session,ScriptApp}=services;\n'+sources+'\nconst GENERATED_DOCS='+JSON.stringify(generatedDocs)+';\n'+`
 getDb_=services.getDb;getDatabaseSpreadsheetId_=()=> 'SITES_SQL_ONLY';getRuntimeEnvironment_=()=> 'DEVELOPMENT';
 getRuntimeInfo_=()=>({environment:'DEVELOPMENT',databaseId:'Sites SQL / D1',explicitDb:true,usingDefaultStagingDb:false});
 requireSession_=(token)=>{if(!actor||token!==sessionToken)throw Error('AUTH_REQUIRED');const employee=getEmployee_(actor.employeeId);if(!employee.active)throw Error('AUTH_REQUIRED');return {employee};};
 requireAdminSession_=(token)=>{const session=requireSession_(token);if(session.employee.role!=='ADMIN')throw Error('管理者権限が必要です。');return session;};
 withScriptLock_=(fn)=>fn();
 const api={${allowed.join(',')}};
 return {employee:id=>getEmployee_(id),directory:()=>getEmployees_(),initial:()=>buildInitialDataForEmployee_(getEmployee_(actor.employeeId)),invoke(method,args){if(!Object.hasOwn(api,method))throw Error('SITES_MIGRATION_PENDING: この操作はSites版への移行中です。');return api[method](...args);}};
}\n`;
fs.writeFileSync('src/generated/engine.mjs',engine);

const index=fs.readFileSync('src/ui/Index.html','utf8');
let html=index.replace(/<!-- FM_INCLUDE:([A-Za-z0-9_/-]+) -->/g,(_,n)=>fs.readFileSync('src/ui/'+n+'.html','utf8'));
if(html.includes('<!-- FM_INCLUDE:'))throw Error('Unresolved HTML include');
const bridge=fs.readFileSync('src/browser/bridge.js','utf8');
const overrides=fs.readFileSync('src/browser/overrides.js','utf8').replaceAll('__APP_VERSION__',appVersion);
html=html.replace('<head>','<head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><script>'+bridge+'</script>');
html=html.replace('</body>','<script>'+overrides+'</script></body>');
fs.writeFileSync('src/generated/shell.mjs','export const html = '+JSON.stringify(html)+';\n');
fs.writeFileSync('src/generated/api-contract.json',JSON.stringify({allowed,blocked:publicNames.filter(n=>blocked.test(n)),tables:specs.length},null,2));
console.log(JSON.stringify({tables:specs.length,seedRows:Object.values(seed).reduce((n,r)=>n+r.length,0),apiMethods:allowed.length,htmlBytes:Buffer.byteLength(html)}));
