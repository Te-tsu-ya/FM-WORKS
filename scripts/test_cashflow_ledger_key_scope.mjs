import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/CashFlowLedger.gs','utf8');
const start=source.indexOf('function saveCashFlowLedgerRows(');
assert.ok(start>=0,'saveCashFlowLedgerRows not found');
const next=source.indexOf('\nfunction ',start+10);
const body=source.slice(start,next>=0?next:source.length);
const key='LEDGER-CROSS-ACCOUNT-KEY-20261016';
const existing={id:'TX-1',accountId:'ACC-A',externalId:'LEDGER-'+key,
 fingerprint:'ACC-A|'+key+'|1000',date:'2026-10-10'};
const txs=[existing];let writes=0,notesWritten=0;
const context=vm.createContext({
 Set,Array,Object,String,Number,Error,
 requireAdminSession_:()=>({employee:{employeeId:'ADMIN'}}),
 cfpRows_:kind=>({rows:kind==='account'?[{id:'ACC-A',active:'TRUE'},{id:'ACC-B',active:'TRUE'}]:kind==='tx'?txs:[]}),
 cfaRows_:()=>({rows:[]}),
 cashFlowLedgerNormalize_:(r,accountId)=>({kind:r.kind||'ACTUAL',requestKey:r.requestKey,category:'その他',note:'',tx:{accountId,date:'2026-10-10',incoming:r.amount,outgoing:0,description:'架空テスト',externalId:'LEDGER-'+r.requestKey,fingerprint:accountId+'|'+r.requestKey+'|'+r.amount}}),
 cfpSameImportedFingerprint_:(a,b)=>String(a.balance??'')===String(b.balance??'')&&Number(a.occurrence||1)===Number(b.occurrence||1),
 cfaAssertUnlocked_:()=>{},
 importCashFlowBankRows:(token,p)=>{writes++;const tx=p.rows[0];if(!txs.some(t=>t.accountId===p.accountId&&t.fingerprint===tx.fingerprint))txs.push({id:'TX-'+(txs.length+1),...tx});return {auditRecorded:true};},
 saveCashFlowAnnotation:()=>{notesWritten++;return {auditRecorded:true}},
 saveCashFlowScheduledItem:()=>({id:'PLAN-1',auditRecorded:true}),
 withScriptLock_:fn=>fn()
});
vm.runInContext(body,context,{filename:'CashFlowLedger.gs'});
const payload=(accountId,requestKey,amount=1000)=>({accountId,rows:[{requestKey,amount,kind:'ACTUAL'}]});
assert.equal(context.saveCashFlowLedgerRows('ADMIN',payload('ACC-A',key)).ok,true);
const before=writes;
assert.throws(()=>context.saveCashFlowLedgerRows('ADMIN',payload('ACC-B',key)),/送信識別子|金融機関|口座/,
 'same key must not create a transaction in a different account');
assert.equal(writes,before,'rejected retry must not write another transaction');
assert.equal(txs.length,1,'no duplicate across bank accounts');
assert.throws(()=>context.saveCashFlowLedgerRows('ADMIN',payload('ACC-A',key,2000)),/送信識別子/);
const newKey='LEDGER-UNIQUE-KEY-20261016';
assert.equal(context.saveCashFlowLedgerRows('ADMIN',payload('ACC-B',newKey)).ok,true);
assert.equal(txs.length,2);
txs.push({id:'TX-CORRUPT',accountId:'ACC-B',externalId:'LEDGER-'+key,
 fingerprint:'ACC-B|'+key+'|1000',date:'2026-10-10'});
const beforeCorrupt=writes;
assert.throws(()=>context.saveCashFlowLedgerRows('ADMIN',payload('ACC-A',key)),/送信識別子|金融機関|口座|複数行/);
assert.equal(writes,beforeCorrupt,'corrupted replay must not write');
console.log('PASS: ledger same-key cross-account and duplicate history blocked, valid retries allowed');

