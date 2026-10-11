import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/AppCashFlowAnalysis.html','utf8');
const match=source.match(/function cfaDownloadReport_\(format\)\{[\s\S]*?\n\}\nfunction cfaAnalysisPage_/);
assert.ok(match,'report handler exists');
const scenarioMatch=source.match(/function cfaScenarioSelect_\(id\)\{[\s\S]*?\n\}\nfunction cfaScenarioNew_/);
assert.ok(scenarioMatch,'scenario selection handler exists');
const callbacks=[];
let downloads=0,render=0,failClick=false,revoked=0;
const state={sessionToken:'ADMIN'};
const cashFlowUi={year:2026,open:true};
const cfaUi={seq:1,scenarioId:'',projection:{ok:true},exporting:false,error:'',notice:''};
const ctx=vm.createContext({state,cashFlowUi,cfaUi,cfbUi:{demo:false},cashFlowAllowed_:()=>true,renderPageIfActive:()=>render++,
 cfbRpc_:(method,payload,success,failure)=>callbacks.push({method,payload,success,failure}),
 atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array,Blob,
 URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{revoked++;}},
 document:{body:{appendChild:()=>{}},createElement:()=>({click(){if(failClick)throw Error('blocked');downloads++},remove(){}})},
 setTimeout:()=>0,cfaLoadProjection_:()=>{},cfaShowError_:(err)=>{cfaUi.error=err.message;cfaUi.exporting=false;}});
vm.runInContext(match[0].replace(/\nfunction cfaAnalysisPage_$/,''),ctx);
vm.runInContext(scenarioMatch[0].replace(/\nfunction cfaScenarioNew_$/,''),ctx);
const result={ok:true,base64:Buffer.from('test').toString('base64'),filename:'report.pdf',mimeType:'application/pdf'};
ctx.cfaDownloadReport_('PDF');
assert.equal(callbacks.length,1);
assert.equal(cfaUi.exporting,true);
state.sessionToken='OTHER';
callbacks[0].success(result);
assert.equal(downloads,0,'stale session must not download');
state.sessionToken='ADMIN';cfaUi.exporting=false;
ctx.cfaDownloadReport_('PDF');
cashFlowUi.year=2027;
callbacks[1].success(result);
assert.equal(downloads,0,'stale year must not download');
cashFlowUi.year=2026;cfaUi.exporting=false;
ctx.cfaDownloadReport_('PDF');
cfaUi.scenarioId='changed';
callbacks[2].success(result);
assert.equal(downloads,0,'stale scenario must not download');
cfaUi.scenarioId='';cfaUi.exporting=false;
ctx.cfaDownloadReport_('PDF');
callbacks[3].success(result);
assert.equal(downloads,1,'valid download succeeds');
cfaUi.exporting=true;ctx.cfaScenarioSelect_('new');
assert.equal(cfaUi.exporting,false,'scenario change releases pending export state');
cfaUi.scenarioId='';
assert.equal(cfaUi.exporting,false);
cfaUi.projection={ok:true}; // Scenario switching intentionally invalidated the projection; simulate its successful reload.
failClick=true;ctx.cfaDownloadReport_('PDF');
assert.equal(callbacks.length,5,'new projection allows a subsequent report request');
callbacks[4].success(result);
assert.ok(revoked>0,'failed download should release blob URL');
assert.match(cfaUi.error,/再試行/);
console.log('PASS cashflow report stale session/year/scenario guard');
