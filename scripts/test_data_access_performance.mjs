import './test_monthly_review_index.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const c=vm.createContext({console,Date,Object,Array,Set,Map,JSON,RegExp,Math,Number,String,Boolean,Error});
for(const p of ['src/Code.gs','src/Auth.gs','src/DataAccess.gs'])
  vm.runInContext(fs.readFileSync(p,'utf8'),c,{filename:p});
const api=vm.runInContext('({DB,AUTH,getDb_,hashToken_,requireSession_})',c);
let failed=0;
function ok(name,result){console.log((result?'PASS: ':'FAIL: ')+name);if(!result)failed++}
function rejects(name,fn,expected){let error='';try{fn()}catch(e){error=String(e.message||e)}ok(name,error.includes(expected))}
const values=new Map();
c.CacheService={getScriptCache:()=>({get:k=>values.get(k)||null,put:(k,v)=>values.set(k,v),remove:k=>values.delete(k)})};
const props={FM_WORKS_ENVIRONMENT:'STAGING'};
c.PropertiesService={getScriptProperties:()=>({getProperty:k=>Object.prototype.hasOwnProperty.call(props,k)?props[k]:null})};
c.Utilities={DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},
  computeDigest:(_a,s)=>Array.from(crypto.createHash('sha256').update(String(s)).digest())};
function sheet(rows){
  const stats={finds:0,reads:0,updates:0};
  return {rows,stats,getLastRow:()=>rows.length+1,
    getRange:(start,col,count=1,width=1)=>({
      getValues:()=>{stats.reads++;return rows.slice(start-2,start-2+count).map(r=>r.slice(col-1,col-1+width))},
      getDisplayValues:()=>{stats.reads++;return rows.slice(start-2,start-2+count).map(r=>r.slice(col-1,col-1+width).map(v=>String(v??'')))},
      setValue:value=>{stats.updates++;rows[start-2][col-1]=value},
      createTextFinder:value=>{stats.finds++;return {matchEntireCell(){return this},
        findNext(){const i=rows.findIndex(r=>String(r[col-1])===String(value));return i<0?null:{getRow:()=>i+2}}}}
    })};
}
function user(id='FM0001',role='ADMIN'){
  const r=Array(26).fill('');r[0]=id;r[1]='架空社員';r[2]='テスト';r[5]=role;r[6]='在籍';
  r[10]='12';r[20]='ACTIVE';return r;
}
const token='fmworks-test-session-token-with-at-least-40-characters-12345';
const digest=api.hashToken_(token);
function session(hash=digest,id='FM0001'){
  return ['S-1',hash,id,'2026-10-09 10:00:00','2099-12-31 23:59:59',
    '2099-12-31 23:59:59','2099-01-01 00:00:00','ACTIVE','','','TRUE'];
}
function db(role){
  const sessions=sheet([session()]),employees=sheet([user('FM0001',role)]),settings=sheet([]);
  return {sessions,employees,getSheetByName:name=>
    name===api.AUTH.sessionSheet?sessions:
    name===api.DB.sheets.employees?employees:
    name===api.AUTH.settingsSheet?settings:null};
}
const first=db('ADMIN'),second=db('USER');
let opens=0;
const byId=new Map([[api.DB.spreadsheetId,first],['FM_WORKS_ALT_STAGING',second]]);
c.SpreadsheetApp={openById:id=>{opens++;if(!byId.has(id))throw Error('unknown DB');return byId.get(id)}};
ok('one SpreadsheetApp.openById for repeated getDb_ calls',api.getDb_()===api.getDb_()&&opens===1);
ok('first session verifies live authenticated employee',api.requireSession_(token).employee.role==='ADMIN');
ok('warm repeated session avoids both TextFinder scans',
  api.requireSession_(token).employee.role==='ADMIN'&&first.sessions.stats.finds===1&&first.employees.stats.finds===1&&opens===1);
const oldReads=first.sessions.stats.reads+first.employees.stats.reads;
api.requireSession_(token);
ok('warm auth still reads both live rows',first.sessions.stats.reads+first.employees.stats.reads>=oldReads+2);
first.employees.rows[0][5]='USER';
ok('role change takes effect without waiting for hint expiry',api.requireSession_(token).employee.role==='USER');
first.sessions.rows[0][7]='REVOKED';
rejects('revoked session is never accepted from a row hint',()=>api.requireSession_(token),'SESSION_EXPIRED');
ok('revocation status is updated in source sheet',first.sessions.rows[0][7]==='EXPIRED');
first.sessions.rows[0][7]='ACTIVE';
first.sessions.rows.unshift(session('wrong-session-hash','FM0099'));
ok('moved session falls back to verified live TextFinder',
  api.requireSession_(token).employee.employeeId==='FM0001'&&first.sessions.stats.finds===2);
first.employees.rows.unshift(user('FM0099','ADMIN'));
ok('moved employee falls back to verified live TextFinder',
  api.requireSession_(token).employee.role==='USER'&&first.employees.stats.finds===2);
props.FM_WORKS_DB_ID='FM_WORKS_ALT_STAGING';
ok('DB switch opens a different handle',api.getDb_()===second&&opens===2);
ok('DB change does not reuse other DB row hints',
  api.requireSession_(token).employee.role==='USER'&&second.sessions.stats.finds===1&&second.employees.stats.finds===1);
props.FM_WORKS_ENVIRONMENT='PRODUCTION';props.FM_WORKS_DB_ID=api.DB.spreadsheetId;
rejects('production DB guard stays active on memoized handles',()=>api.getDb_(),'STAGING既定DB');
console.log('Security-sensitive cache tests '+(failed?'FAILED':'PASSED'));
if(failed)process.exit(1);
