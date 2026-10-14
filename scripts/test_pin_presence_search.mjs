import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('src/Auth.gs','utf8');
const start=source.indexOf('function hasAnyPinConfigured_(');
const end=source.indexOf('function getAuthConfig_(',start);
assert.ok(start>=0&&end>start);
let selectedHashes=[],displayReads=0,searches=0,failFinder=false;
const sheet={
 getLastRow:()=>selectedHashes.length+1,
 getRange:(row,col,height,width)=>{
  assert.equal(row,2);assert.equal(col,15);assert.equal(width,1);
  return {
   getDisplayValues:()=>{displayReads++;return selectedHashes.map(x=>[x])},
   createTextFinder:pattern=>{
    searches++;if(failFinder)throw Error('not supported');
    assert.equal(pattern,'.+');
    return {
     useRegularExpression(){return this},
     matchEntireCell(){return this},
     findNext(){return selectedHashes.some(x=>String(x||'').length>0)?{getRow:()=>2}:null}
    };
   }
  };
 }
};
const ctx=vm.createContext({DB:{sheets:{employees:'employee'}},getDb_:()=>({getSheetByName:()=>sheet})});
vm.runInContext(source.slice(start,end),ctx);
assert.equal(ctx.hasAnyPinConfigured_(),false);
assert.equal(displayReads,0);assert.equal(searches,0,'empty sheet avoids any range');
selectedHashes=['','','','ABCDEF',''];
assert.equal(ctx.hasAnyPinConfigured_(),true);
assert.equal(searches,1);assert.equal(displayReads,0,'no full PIN column transfer');
selectedHashes=['','',''];
assert.equal(ctx.hasAnyPinConfigured_(),false);
failFinder=true;
selectedHashes=['','PINHASH'];
assert.equal(ctx.hasAnyPinConfigured_(),true);
assert.equal(displayReads,1,'fallback remains available');
console.log('PASS no PIN, configured PIN, no full hash download, fallback');
