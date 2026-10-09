import fs from 'node:fs';
import vm from 'node:vm';
let pass=0,fail=0;const ok=(s,c)=>{(c?pass++:fail++);console.log((c?'PASS ':'FAIL ')+s)};
const no=(s,fn,re)=>{let v='';try{fn()}catch(e){v=String(e.message||e)}ok(s,!!v&&(!re||re.test(v)))};
const staff={employeeId:'FM0002',name:'架空社員',role:'USER',department:'開発'};
const admin={employeeId:'FM0001',name:'架空管理者',role:'ADMIN'};
const other={employeeId:'FM0003',name:'他の架空社員',role:'USER',department:'営業'};
const users={STAFF:staff,ADMIN:admin,OTHER:other};let uuid=0;
const audits=[],files={};
class Sheet{
 constructor(head){this.rows=[head]}
 getLastRow(){return this.rows.length}
 getMaxColumns(){return 45}
 appendRow(row){this.rows.push(row.slice())}
 deleteRow(n){this.rows.splice(n-1,1)}
 getRange(row,col,height=1,width=1){const self=this;
  const data=()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>(self.rows[row+r-1]||[])[col+c-1]??''));
  return {getValues:data,getDisplayValues:()=>data().map(a=>a.map(String)),
   setValues:next=>{if(next.length!==height||next.some(r=>r.length!==width))throw Error('Wrong setValues size');
    for(let r=0;r<height;r++){let ix=row+r-1;self.rows[ix]=self.rows[ix]||[];
      for(let c=0;c<width;c++)self.rows[ix][col+c-1]=next[r][c];}}};
 }}
function fakeRange(value,column,countRows=1,countColumns=1){
 let rows,cols;
 if(typeof value==='number'){rows=countRows;cols=countColumns;}
 else{
 const m=String(value).split(':');const parse=s=>{const x=s.match(/^([A-Z]+)(\d+)$/);return {col:[...x[1]].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0),row:+x[2]}};
 const a=parse(m[0]),b=parse(m[1]||m[0]);rows=b.row-a.row+1;cols=b.col-a.col+1;
 }
 let self={setValues:v=>{if(v.length!==rows||v.some(row=>row.length!==cols))throw Error('XLSX range mismatch '+value);return self;}};
 for(const n of ['setValue','merge','setFontSize','setFontWeight','setFontColor','setFontFamily','setBackground','setVerticalAlignment','setHorizontalAlignment','setWrap','setNumberFormat','setBorder','setWrapStrategy'])self[n]=()=>self;
 return self;
}
const folder={createFile:blob=>{const id='FILE-'+(++uuid);
 files[id]={getId:()=>id,getName:()=>blob.name,getMimeType:()=>blob.type,getBlob:()=>({getBytes:()=>blob.bytes}),setTrashed(){}};
 return files[id];}};
const ctx=vm.createContext({console,Date,Math,Number,String,Object,Array,Set,Map,JSON,RegExp,Error,Buffer,
 requireSession_:token=>{if(!users[token])throw Error('AUTH_REQUIRED');return {employee:users[token]}},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{getUuid:()=>('UUID-'+(++uuid)),formatDate:(_d,_z,f)=>f==='yyyy-MM-dd HH:mm:ss'?'2026-10-09 09:00:00':'2026-10-09',
 base64Encode:b=>Buffer.from(b).toString('base64')},
 SpreadsheetApp:{create:()=>({getId:()=>('TMP-'+(++uuid)),getSheets:()=>[{getRange:fakeRange,setName(){},getSheetId:()=>1,setHiddenGridlines(){},setColumnWidths(){},setColumnWidth(){},setRowHeights(){},setRowHeight(){}}]}),
 flush(){},BorderStyle:{SOLID:'solid'},WrapStrategy:{CLIP:'clip'}},
 ScriptApp:{getOAuthToken:()=>'FAKE'},
 DriveApp:{getFoldersByName:()=>({hasNext:()=>true,next:()=>folder}),createFolder:()=>folder,
 getFileById:id=>id.startsWith('TMP-')?{setTrashed(){}}:files[id]},
 UrlFetchApp:{fetch:url=>{
  const bytes=url.includes('format=pdf')?[37,80,68,70,...new Array(250).fill(0)]:[80,75,3,4,...new Array(300).fill(0)];
  return {getResponseCode:()=>200,getContent:()=>bytes,getBlob:()=>({
   bytes,name:'',type:'',setContentType(t){this.type=t;return this},setName(n){this.name=n;return this}
  })};
 }}
});
for(const file of ['src/Code.gs','src/Schema.gs','src/Finance.gs','src/Quotes.gs'])
 vm.runInContext(fs.readFileSync(file,'utf8'),ctx,{filename:file});
const specs=vm.runInContext('DB_SCHEMA_SPECS',ctx),defs=vm.runInContext('QUOTE_MODEL',ctx),sheets={};
for(const k of Object.keys(defs))sheets[defs[k].sheet]=new Sheet(specs[defs[k].sheet]);
ctx.mockDb={getSheetByName:name=>sheets[name]||null};ctx.audits=audits;
vm.runInContext('getDb_=()=>mockDb;appendAudit_=v=>audits.push(v);',ctx);
const api=vm.runInContext('({getQuoteWorkspace,getQuote,saveQuoteDraft,issueQuote,getQuoteDocument,importQuoteVendors,configureQuoteSequence,quoteNormalize_,quoteStorageStatus_,getPermissions_})',ctx);
const vendors=[{name:'架空法人A',code:'FI-0001',invoice:'T1234567890123',address:'架空県'},
 {name:'架空法人B',code:'SV-0002',invoice:'',address:'架空県'}];
const lines=[{description:'月額開発',quantity:2,unit:'ヶ月',price:300000},
 {description:'出精値引き',quantity:2,unit:'式',price:-50000},
 {description:'※週10時間',noteOnly:true}];
const draft={vendorCode:'FI-0001',quoteDate:'2026-10-09',subject:'テスト',delivery:'ご相談',
 lines,requestKey:'quote-retry-0000001'};
ok('all roles have estimate permission',api.getPermissions_(staff).quoteWorkspace&&api.getPermissions_(admin).quoteWorkspace);
ok('new quote schema is complete',api.quoteStorageStatus_().ready);
no('invalid session cannot read',()=>api.getQuoteWorkspace('BAD'),/AUTH_REQUIRED/);
no('staff cannot import vendors',()=>api.importQuoteVendors('STAFF',vendors),/管理者/);
no('staff cannot set sequence',()=>api.configureQuoteSequence('STAFF','FI-0001',0),/管理者/);
const imported=api.importQuoteVendors('ADMIN',vendors);
ok('admin imports two vendors',imported.created===2&&sheets['見積取引先'].rows.length===3);
ok('legacy numbering is not silently approved',sheets['見積採番'].rows[1][2]==='未確認');
const calc=api.quoteNormalize_(draft);
ok('discount & note follow 21-line source',calc.subtotal===500000&&calc.taxAmount===50000&&calc.total===550000&&calc.lines[2].amount===0);
const saved=api.saveQuoteDraft('STAFF',draft);
ok('employee saves owned draft',saved.ok&&saved.status==='下書き');
const retry=api.saveQuoteDraft('STAFF',draft);
ok('retry is idempotent',retry.duplicate&&retry.id===saved.id&&sheets['見積ヘッダー'].rows.length===2);
no('another employee cannot reuse key',()=>api.saveQuoteDraft('OTHER',draft),/重複/);
no('other employee cannot view quote',()=>api.getQuote('OTHER',saved.id),/権限/);
ok('employee quote list is private by default',api.getQuoteWorkspace('OTHER').quotes.length===0&&api.getQuoteWorkspace('STAFF').quotes.length===1);
no('unconfirmed vendor number cannot be issued',()=>api.issueQuote('STAFF',saved.id,saved.revision),/未確認/);
api.configureQuoteSequence('ADMIN','FI-0001',1);
ok('admin confirmed pre-existing FI-0001-0001',sheets['見積採番'].rows[1][1]===1);
no('sequence cannot decrease',()=>api.configureQuoteSequence('ADMIN','FI-0001',0),/小さい/);
const issued=api.issueQuote('STAFF',saved.id,saved.revision);
ok('staff issues both PDF and Excel',issued.number==='FI-0001-0002'&&Object.keys(files).length===2&&api.getQuote('STAFF',saved.id).header.status==='発行済');
const again=api.issueQuote('STAFF',saved.id,saved.revision);
ok('repeat issue returns original number without new files',again.number===issued.number&&Object.keys(files).length===2);
no('issued quote cannot be edited',()=>api.saveQuoteDraft('STAFF',{...draft,id:saved.id,revision:saved.revision,requestKey:'quote-update-0000001'}),/編集できません/);
no('unauthorized download denied',()=>api.getQuoteDocument('OTHER',saved.id,'pdf'),/権限/);
const pdf=api.getQuoteDocument('STAFF',saved.id,'pdf'),xlsx=api.getQuoteDocument('STAFF',saved.id,'xlsx');
ok('PDF/Excel download returns correct binaries',pdf.base64.startsWith('JVBER')&&xlsx.base64.startsWith('UEs')&&pdf.name.endsWith('.pdf')&&xlsx.name.endsWith('.xlsx'));
no('invalid file type is rejected',()=>api.getQuoteDocument('STAFF',saved.id,'xml'),/形式/);
no('negative total is rejected',()=>api.quoteNormalize_({...draft,lines:[{description:'過大値引き',quantity:1,unit:'式',price:-1000}]}),/小計/);
no('more than 21 lines rejected',()=>api.quoteNormalize_({...draft,lines:new Array(22).fill(lines[0])}),/21行/);
no('8 percent tax is not silently miscalculated',()=>api.quoteNormalize_({...draft,taxRate:8}),/10%/);
ok('admin sees all employee drafts',api.getQuoteWorkspace('ADMIN').quotes.length===1);
ok('issuance logged in audit',audits.some(x=>x.operation==='見積正式発行'));
console.log('QUOTE TESTS: '+pass+' passed, '+fail+' failed');
if(fail)process.exitCode=1;
