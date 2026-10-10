// Reproduce fast-click races without contacting production GAS or editing the DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let identity='session-A|FM0002';
const calls=[],renders=[];
const runner={
 withSuccessHandler(fn){this.success=fn;return this;},
 withFailureHandler(fn){this.failure=fn;return this;},
 getRelatedDocument(token,id){calls.push({token,id,success:this.success,failure:this.failure});return this;}
};
const state={sessionToken:'session-A'};
const quoteUi={data:{relatedDocs:[
 {id:'A',updatedAt:'2026-10-10 08:00:00'},
 {id:'B',updatedAt:'2026-10-10 09:00:00'}
]}};
const ctx=vm.createContext({
 console,Map,Date,String,Object,Array,JSON,Number,
 state,quoteUi,google:{script:{run:runner}},
 quoteIdentity_:()=>identity,
 renderPageIfActive:page=>renders.push(page),
 cleanApiErrorMessage:(_err,message)=>message
});
const html=fs.readFileSync('src/AppDocuments.html','utf8');
vm.runInContext(html.replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, ''),ctx,{filename:'src/AppDocuments.html'});
const api=vm.runInContext('({documentOpenRecord,docUi})',ctx);
const data=id=>({header:{id,kind:'invoice',number:id,status:'発行済'},lines:[{description:id}]});
const count=()=>calls.length;
const details=()=>api.docUi.selected&&api.docUi.selected.header&&api.docUi.selected.header.id;

api.documentOpenRecord('A');
assert.equal(count(),1,'first click should fetch A');
api.documentOpenRecord('A');
assert.equal(count(),1,'double click during loading must not duplicate an RPC');
api.documentOpenRecord('B');
assert.equal(count(),2,'selection B should fetch B');
assert.equal(api.docUi.selected,null,'previous document should be hidden while switching');
calls[1].success(data('B'));
calls[0].success(data('A'));
assert.equal(details(),'B','late A response must not replace B');
assert.equal(api.docUi.loading,false);
api.documentOpenRecord('B');
assert.equal(count(),2,'repeat selection with matching updatedAt should use in-memory details');
assert.equal(details(),'B');

quoteUi.data.relatedDocs[1].updatedAt='2026-10-10 09:01:00';
api.documentOpenRecord('B');
assert.equal(count(),3,'updated record must bypass previous cache');
assert.equal(api.docUi.selected,null,'new fetch should not display old snapshot');
api.documentOpenRecord('A');
assert.equal(count(),4);
calls[2].failure(new Error('old request'));
assert.equal(api.docUi.error,'','late failure must not replace the active selection');
calls[3].success(data('A'));
assert.equal(details(),'A');

api.documentOpenRecord('B');
assert.equal(count(),5,'new revision should be fetched');
calls[4].success(data('A'));
assert.equal(api.docUi.selected,null,'mismatched server ID must not be shown');
assert.match(api.docUi.error,/確認できません/);
api.documentOpenRecord('B');
assert.equal(count(),6,'invalid response must be retryable');
calls[5].success(data('B'));
assert.equal(details(),'B');

identity='session-B|FM0003';
state.sessionToken='session-B';
api.documentOpenRecord('B');
assert.equal(count(),7,'a new authenticated identity must not reuse previous session details');
assert.equal(api.docUi.selected,null,'old identity content must be cleared');
calls[6].failure(new Error('network'));
assert.equal(api.docUi.loading,false);
assert.match(api.docUi.error,/読み込めません/);
api.documentOpenRecord('B');
assert.equal(count(),8,'failed detail read should be retryable');
calls[7].success(data('B'));
assert.equal(details(),'B');
assert.ok(renders.includes('documentHistory'));
console.log('PASS: document history latest-selection, duplicate-RPC, revision cache, cross-session isolation and failure recovery');
