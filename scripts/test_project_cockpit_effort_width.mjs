import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/ProjectHub.gs','utf8');
function part(a,b){
 const i=source.indexOf('function '+a+'('),j=source.indexOf('function '+b+'(',i+10);
 assert.ok(i>=0&&j>i,a+' source not found');
 return source.slice(i,j);
}
const rows=[
 ['W1','2026-10-10','U1','架空社員A','架空案件A','設計','作業内容','09:00','10:00','60','個人メモ','timestamp','有効'],
 ['W2','2026-10-11','U2','架空社員B','架空案件A','設計','作業内容','09:00','10:30','90','非公開メモ','timestamp','有効'],
 ['W3','2026-10-11','U1','架空社員A','架空案件B','設計','作業内容','09:00','10:00','60','個人メモ','timestamp','削除'],
 ['W4','2026-10-11','U1','架空社員A','架空案件B','設計','作業内容','09:00','10:00','0','個人メモ','timestamp','有効']
];
const cache=new Map(),reads=[];
const sheet={getLastRow:()=>rows.length+1,getRange:(r,c,h,w)=>({
 getDisplayValues:()=>{reads.push({column:c,width:w,cells:h*w});return rows.slice(r-2,r-2+h).map(item=>item.slice(c-1,c-1+w));}
})};
const c=vm.createContext({Map,Array,Object,String,Number,Date,Math,Set,console,
 projectHubStorage_:()=>({ready:true,missing:[],sheets:{resource:{getLastRow:()=>1}}}),
 getProjectsInternal_:()=>[],
 projectHubRows_:()=>[],
 getDb_:()=>({getSheetByName:()=>sheet}),
 cacheJsonGetLarge_:key=>cache.get(key),
 cacheJsonPutLarge_:(key,data)=>{cache.set(key,data);return true},
 cacheRemove_:key=>cache.delete(key)
});
vm.runInContext(part('projectHubRead_','projectHubName_')+
 part('projectHubWorklogRows_','projectHubRememberRename_'),c);
const summary=c.projectHubRead_(false);
assert.equal(summary.worklogs.length,2);
assert.deepEqual(Array.from(summary.worklogs,w=>w[8]),['60','90']);
assert.deepEqual(Array.from(summary.worklogs,w=>w[3]),['架空案件A','架空案件A']);
assert.deepEqual(reads.map(x=>x.width),[9]);
assert.equal(reads[0].cells,rows.length*9);
const summaryAgain=c.projectHubRead_(false);
assert.equal(summaryAgain.worklogs.length,2);assert.equal(reads.length,1,'warm summary cache hit');
const detail=c.projectHubRead_(false,'P-A');
assert.equal(detail.worklogs.length,2);
assert.equal(detail.worklogs[0][1],'U1');
assert.equal(detail.worklogs[0][5],'作業内容');
assert.deepEqual(reads.map(x=>x.width),[9,13],'detail still reads A:M');
c.projectHubInvalidateWorklogs_();
assert.equal(cache.size,0,'writes invalidate both caches');
c.projectHubRead_(false);assert.deepEqual(reads.map(x=>x.width),[9,13,9]);
console.log('PASS project cockpit: summary 9 columns, detail 13, deleted/zero excluded, both caches invalidated');
