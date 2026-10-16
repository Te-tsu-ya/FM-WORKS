import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/CashFlowBank.gs','utf8');
const extract=name=>{
 const start=source.indexOf('function '+name+'(');
 assert.ok(start>=0,'missing source function '+name);
 const end=source.indexOf('\nfunction ',start+12);
 return source.slice(start,end<0?source.length:end);
};
let id=0,writes=0,flushes=0,locks=0;
const transactions=[];
const keys=['id','accountId','date','incoming','outgoing','description','balance','externalId','occurrence','fingerprint','transfer','sourceFile','importedAt','editorId','revision'];
const sheet={
 getLastRow:()=>transactions.length+1,getMaxRows:()=>10000,
 getRange:(r,c,count)=>({setValues:(vals)=>{writes++;for(const values of vals)transactions.push(Object.fromEntries(keys.map((k,i)=>[k,values[i]])));}})
};
const getFingerprint=(raw,accountId)=>[accountId,raw.date,raw.incoming,raw.outgoing,raw.description,raw.externalId].join('|');
const context=vm.createContext({String,Number,Array,Map,Object,Error,RegExp,
 requireAdminSession_:()=>({employee:{employeeId:'ADMIN'}}),
 cfpKey_:key=>String(key),cfpText_:value=>String(value),
 cfpTxValidate_:(r,accountId)=>({...r,accountId,fingerprint:getFingerprint(r,accountId),transfer:'FALSE',occurrence:r.occurrence||1}),
 cfpRows_:kind=>kind==='account'?{rows:[{id:'A'},{id:'B'}]}:{rows:transactions,sheet},
 cfpStamp_:()=>'now',cfpId_:()=>('TX-'+(++id)),
 withScriptLock_:cb=>{locks++;return cb();},
 CFP:{tx:{keys}},SpreadsheetApp:{flush:()=>flushes++},cfpAudit_:()=>true
});
vm.runInContext(['cfpSameImportedFingerprint_','importCashFlowBankRows'].map(extract).join('\n'),context,{filename:'CashFlowBank.gs'});
const payload=(accountId,externalId,amount=1000,balance=3000,extra={})=>({accountId,fileName:'synthetic',requestKey:'IMPORT-KEY-TEST',rows:[{date:'2026-10-10',incoming:amount,outgoing:0,description:'架空テスト',externalId,balance,...extra}]});
assert.equal(context.importCashFlowBankRows('ADMIN',payload('A','LEDGER-KEY-123456789')).added,1);
assert.equal(context.importCashFlowBankRows('ADMIN',payload('A','LEDGER-KEY-123456789')).skipped,1);
const before=writes;
for(const collision of [payload('B','LEDGER-KEY-123456789'),payload('A','LEDGER-KEY-123456789',2000),payload('A','LEDGER-KEY-123456789',1000,3001)]){
 assert.throws(()=>context.importCashFlowBankRows('ADMIN',collision),/送信識別子/);
 assert.equal(writes,before,'a collision must not write');
}
assert.equal(context.importCashFlowBankRows('ADMIN',payload('B','LEDGER-KEY-DIFFERENT')).added,1);
const beforeBatch=writes,chunk=payload('A','LEDGER-KEY-WITHIN-BATCH');
chunk.rows.push({...chunk.rows[0],incoming:1500});
assert.throws(()=>context.importCashFlowBankRows('ADMIN',chunk),/送信識別子/);
assert.equal(writes,beforeBatch,'conflicting batch must be rejected atomically');
assert.equal(context.importCashFlowBankRows('ADMIN',payload('A','BANK-EXTERNAL-001')).added,1);
assert.equal(context.importCashFlowBankRows('ADMIN',payload('B','BANK-EXTERNAL-001')).added,1,'normal bank IDs remain per account');
assert.equal(flushes,writes,'successful writes flush once');
assert.ok(locks>=8,'all collisions checked inside importer lock');
console.log('PASS: manual keys cannot cross accounts even at import; normal bank IDs remain per account');

