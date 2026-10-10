import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Simulate async GAS callbacks, including late responses after logout.
const reads=[],details=[],sequences=[],toasts=[],renders=[];
const gas={withSuccessHandler(success){
  return {withFailureHandler(failure){
    return {
      getQuoteWorkspace(token){reads.push({success,failure,token});},
      getRelatedDocument(token,id){details.push({success,failure,token,id});},
      configureQuoteSequence(token,id,value){sequences.push({success,failure,token,id,value});}
    };
  }};
}};
const state={sessionToken:'SESSION_A',page:'documentHistory',data:{user:{employeeId:'FM0002'}},adminTab:'quotes'};
const ctx=vm.createContext({
  console,Date,Map,state,google:{script:{run:gas}},
  renderPageIfActive:page=>renders.push(page),
  cleanApiErrorMessage:(error,fallback)=>String(error?.message||fallback),
  showToast:message=>toasts.push(message),
  closeModal:()=>{},
  financeYen:amount=>String(amount)+'円',
  escapeHtml:value=>String(value??''),
  quotePreviewDocument_:()=>'<h2>見積書</h2><div class="qb-paper-condition"></div>見積番号：見積日：お見積金額（税込）',
  document:{getElementById:()=>null},
  navigate:()=>{}
});
for(const path of ['src/AppQuotes.html','src/AppDocuments.html']){
  const src=fs.readFileSync(path,'utf8');
  vm.runInContext(src.replace(/^<script>\s*/,'').replace(/\s*<\/script>\s*$/,''),ctx,{filename:path});
}
const api=vm.runInContext('({loadQuoteWorkspace,resetQuoteUi,documentOpenRecord,documentHistoryPage,quoteCommitSequence})',ctx);
const quoteUi=()=>vm.runInContext('quoteUi',ctx);
const docUi=()=>vm.runInContext('docUi',ctx);
const data=(docs=[])=>({setupRequired:false,vendors:[],quotes:[],relatedDocs:docs,documentsSetupRequired:false,total:0,sequencesReady:[]});
const aDoc={id:'SECRET',kind:'invoice',number:'PRIVATE-A-2026',vendorName:'Private',subject:'Sensitive',updatedAt:'2026-10-10 09:00:00',status:'発行済'};
const detailsFor=(id,number)=>({header:{id,kind:'invoice',number,status:'発行済',vendorName:'Private',documentDate:'2026-10-10'},lines:[]});

api.loadQuoteWorkspace();
assert.equal(reads.length,1,'initial workspace must fetch');
api.loadQuoteWorkspace({force:true});
api.loadQuoteWorkspace({force:true});
assert.equal(reads.length,1,'repeated force must be queued, not parallel');
reads[0].success(data());
assert.equal(reads.length,2,'queued force must trigger one follow-up request');
assert.equal(quoteUi().data,null,'stale response must not become active');
reads[1].success(data([aDoc]));
assert.equal(quoteUi().data.relatedDocs.length,1);
assert.equal(quoteUi().refreshNeeded,false);
assert.equal(quoteUi().loading,false);
api.loadQuoteWorkspace();
assert.equal(reads.length,2,'fresh data cache must avoid extra read');

api.documentOpenRecord('SECRET');
assert.equal(details.length,1,'document detail must be fetched from server');
details[0].success(detailsFor('SECRET','PRIVATE-A-2026'));
assert.match(api.documentHistoryPage(),/PRIVATE-A-2026/,'same-session selected document visible');
api.documentOpenRecord('SECRET');
assert.equal(details.length,1,'same revision may reuse same-session document cache');

api.documentOpenRecord('INFLIGHT');
assert.equal(details.length,2);
api.resetQuoteUi();
assert.equal(docUi().selected,null,'logout must discard selected document');
assert.equal(docUi().selectedId,'','logout must discard selection id');
assert.equal(docUi().detailCache.size,0,'logout must discard all cached document snapshots');
assert.equal(docUi().busy,false,'logout clears pending action state');
state.sessionToken='SESSION_B';
state.data={user:{employeeId:'FM0003'}};
details[1].success(detailsFor('INFLIGHT','PRIVATE-A-2026'));
assert.equal(docUi().selected,null,'late document response from A must not update B');
assert.doesNotMatch(api.documentHistoryPage(),/PRIVATE-A-2026/,'document UI must not expose old user content');

api.loadQuoteWorkspace();
assert.equal(reads.length,3);
api.loadQuoteWorkspace({force:true});
reads[2].failure(new Error('timeout'));
assert.equal(reads.length,4,'pending refresh must retry after earlier request failed');
assert.equal(quoteUi().error,'','obsolete request failure must not show an error');
reads[3].success(data([aDoc]));
api.documentOpenRecord('SECRET');
assert.equal(details.length,3,'new session must fetch again, even if ID and revision match previous session');
details[2].success(detailsFor('SECRET','VISIBLE-ONLY-TO-B'));
assert.match(api.documentHistoryPage(),/VISIBLE-ONLY-TO-B/);

const lastValid=quoteUi().data;
api.loadQuoteWorkspace({force:true});
assert.equal(reads.length,5);
reads[4].success({quotes:[],relatedDocs:null,vendors:[]});
assert.equal(quoteUi().data,lastValid,'malformed response must preserve last known good data');
assert.match(quoteUi().error,/応答を確認できません/);
assert.equal(quoteUi().loading,false);
api.loadQuoteWorkspace({force:true});
reads[5].success(data());
assert.equal(quoteUi().error,'','successful retry clears malformed response error');

api.loadQuoteWorkspace({force:true});
assert.equal(reads.length,7);
api.resetQuoteUi();
state.sessionToken='SESSION_C';
state.data={user:{employeeId:'FM0004'}};
reads[6].success(data([aDoc]));
assert.equal(quoteUi().data,null,'late workspace response from earlier session must be ignored');
assert.doesNotMatch(api.documentHistoryPage(),/PRIVATE-A-2026/);

api.quoteCommitSequence('FI-0001','1');
assert.equal(sequences.length,1);
const toastCount=toasts.length;
api.resetQuoteUi();
state.sessionToken='SESSION_D';
state.data={user:{employeeId:'FM0005'}};
sequences[0].success({});
assert.equal(toasts.length,toastCount,'old account completion must not show a success message to new account');
assert.ok(renders.includes('quotes')&&renders.includes('documentHistory'),'both views receive refresh notification');

console.log('PASS: quote forced refresh queue, malformed server response, cross-session document isolation and stale callback protection');
