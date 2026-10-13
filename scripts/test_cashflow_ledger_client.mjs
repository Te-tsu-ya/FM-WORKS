import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=n=>fs.readFileSync('src/'+n+'.html','utf8').replace(/^\s*<script>\s*/,'').replace(/\s*<\/script>\s*$/,'');
const calls=[],dialogs=[];let identity='ADMIN-A',id=0;
const ctx=vm.createContext({console,Date,Math,Object,Array,String,Number,Map,Set,JSON,RegExp,Error,
 cashFlowUi:{open:true,year:2026},cfbUi:{loaded:{accounts:[{id:'A',active:true,name:'預金',bank:'架空銀行'}],monthly:[{month:'2026-11',importedCount:0,actualIn:0,scheduledIn:100,scheduledOut:200}]},busy:false},
 financeIdentity:()=>identity,cfbKey_:()=> 'LEDGER-CLIENT-KEY-'+(++id),cfbRpc_:(method,payload,ok,fail)=>calls.push({method,payload,ok,fail}),
 cfbMoney_:n=>String(n??0),cfbEscape_:s=>String(s??'').replace(/</g,'&lt;'),cfbLoadAfterWrite_:()=>{},
 showToast:()=>{},renderPageIfActive:()=>{},cleanApiErrorMessage:(e,d)=>e?.message||d,
 openConfirmDialog:(...args)=>dialogs.push(args),window:{addEventListener:()=>{}}});
vm.runInContext(read('AppCashFlowBankGrid')+'\n'+read('AppCashFlowLedger'),ctx);
const ui=()=>vm.runInContext('cflUi',ctx),row=(n=0)=>({date:'2026/10/13',description:'架空の入金'+n,outgoing:'',incoming:'1,000',balance:'',category:'売上',note:'',kind:'ACTUAL',requestKey:'LEDGER-CLIENT-ROW-'+n});
ctx.cflLoad_();ctx.cflLoad_();assert.equal(calls.length,1,'coalesce repeated loads');
calls.shift().ok({ok:true,total:1,rows:[],balanceAnchor:{date:'2026-10-12',balance:5000}});ctx.cflLoad_();assert.equal(calls.length,0,'fresh cache is reused');
ctx.cflLoad_(true);const old=calls.shift();ctx.cashFlowUi.year=2027;old.ok({ok:true,rows:[{description:'OLD YEAR'}]});assert.equal(ui().data,null,'old-year response never replaces current data');
ctx.cashFlowUi.year=2026;ctx.cflLoad_(true);calls.shift().ok({ok:true,total:1,rows:[],balanceAnchor:{date:'2026-10-12',balance:5000}});
ui().rows=[row()];ctx.cflBalances_();assert.equal(ui().rows[0].balance,6000,'balance continues from the known last bank balance');
let prevented=false;ctx.cflPaste_({clipboardData:{getData:()=> '2026/10/14\t架空出金\t250\t\t5750\t経費\tメモ\t実績'},preventDefault:()=>prevented=true},1,0);
assert.equal(prevented,true);assert.equal(ui().rows[1].outgoing,'250');assert.equal(ui().rows[1].kind,'ACTUAL');
ui().rows=Array.from({length:21},(_,i)=>row(i));ctx.cflSave_();ctx.cflSave_();assert.equal(calls.length,1,'double click never creates concurrent writes');assert.equal(calls[0].payload.rows.length,20);
const first=calls.shift();first.ok({ok:true,results:first.payload.rows.map(r=>({kind:r.kind,id:r.requestKey}))});assert.equal(calls.length,1);const tail=calls.shift();assert.equal(tail.payload.rows.length,1);tail.fail(Error('通信結果未確認'));
assert.equal(ui().uncertain,true);assert.equal(ctx.cflCanLeave_(),false);const preserved=JSON.stringify(ui().rows);ctx.cflSet_(0,'incoming','999');assert.equal(JSON.stringify(ui().rows),preserved,'uncertain input is immutable');
ctx.cflSave_();assert.deepEqual(calls[0].payload.rows.map(r=>r.requestKey),first.payload.rows.map(r=>r.requestKey),'retry preserves exact per-row keys');
const retry=calls.shift();retry.ok({ok:true,results:retry.payload.rows.map(r=>({kind:r.kind,id:r.requestKey}))});const retryTail=calls.shift();retryTail.ok({ok:true,results:retryTail.payload.rows.map(r=>({kind:r.kind,id:r.requestKey}))});assert.equal(ui().rows.length,0);assert.equal(ui().uncertain,false);
calls.length=0;ui().rows=[row(77)];ctx.cflSave_();const stale=calls.shift();identity='ADMIN-B';ctx.cflReset_();stale.ok({ok:true,results:[{id:'old',kind:'ACTUAL'}]});assert.equal(ui().rows.length,0);assert.equal(calls.length,0,'previous-session save cannot trigger current refresh');ctx.cfbUi.busy=false;
assert.match(ctx.cflAnnualTable_(),/未取込/);assert.match(ctx.cflAnnualTable_(),/取込済み分/);
console.log('PASS cashflow ledger client: Excel TSV columns, balance calculation, coalesced/cached reads, stale-year/session guards, 20-row chunks, immutable retry keys and unknown actual months');
