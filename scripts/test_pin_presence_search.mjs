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
// Both PIN-setting surfaces must honor the server's configured length.
const shellSource=fs.readFileSync('src/AppShell.html','utf8');
const adminSource=fs.readFileSync('src/AppAdmin.html','utf8');
const ownModal=shellSource.match(/function openChangePinModal\(force=false\)\{[\s\S]*?\r?\n\}/);
const adminModal=adminSource.match(/function openTempPinModal\(employeeId\)\{[\s\S]*?\r?\n\}/);
assert.ok(ownModal&&adminModal,'both PIN modal implementations must exist');
const modal={innerHTML:''};
const uiState={publicConfig:{pinLength:8},authAdmin:{employees:[{employeeId:'FM9001',name:'架空管理者'}]}};
const ui=vm.createContext({state:uiState,closeProfileMenu(){},ensureModal:()=>modal,
  escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});
vm.runInContext(ownModal[0]+'\n'+adminModal[0],ui);
ui.openChangePinModal(false);
assert.equal([...modal.innerHTML.matchAll(/maxlength='8'/g)].length,3,
  'change-own-PIN form must accept an eight-digit configured PIN');
ui.openTempPinModal('FM9001');
assert.equal([...modal.innerHTML.matchAll(/maxlength='8'/g)].length,2);
assert.match(modal.innerHTML,/8桁の仮PIN/,'operator-facing PIN length must agree with setting');
uiState.publicConfig.pinLength=6;
ui.openTempPinModal('FM9001');
assert.equal([...modal.innerHTML.matchAll(/maxlength='6'/g)].length,2,
  'six-digit default remains supported');

console.log('PASS no PIN, configured PIN, indexed hash lookup, configurable operator PIN dialogs');
