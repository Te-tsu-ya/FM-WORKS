import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// In-memory sheet only; never accesses real Google Sheets or employee data.
const header=['年月','社員ID','氏名','確認状態','確認日時','確認者','最終更新','メモ','作成日時','更新日時'];
const row=(month,id,status='PENDING',created='2026-09-28 09:00:00')=>
  [month,id,'架空社員',status,'','','','',created,''];
const rows=[
  header.slice(),
  row('2026-09','FM099','PENDING'),
  row('2026-08','FM001','CONFIRMED','2026-08-31 08:00:00'),
  row('2026-09','FM001','PENDING','2026-09-30 08:00:00'),
  row('2026-09','FM999','CONFIRMED')
];
const originalOther=rows[4].slice();
const originalEarlier=rows[2].slice();
const audits=[];
const stats={finderCalls:0,allWideReads:0,singleRowReads:0,writes:0,flush:0};
const sheet={
  getLastRow:()=>rows.length,
  getRange(r,c,h=1,w=1){
    if(h>1&&w>1){stats.allWideReads++;throw new Error('全社員×全期間の広い範囲を読み込んではいけません');}
    return {
      getDisplayValue(){
        assert.equal(h,1);assert.equal(w,1);
        return String(rows[r-1]?.[c-1]??'');
      },
      getDisplayValues(){
        if(h===1&&w===10)stats.singleRowReads++;
        return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>String(rows[r+i-1]?.[c+j-1]??'')));
      },
      createTextFinder(value){
        assert.equal(c,2);assert.equal(w,1);
        stats.finderCalls++;
        return {
          matchEntireCell(flag){assert.equal(flag,true);return this;},
          findAll(){
            return rows.slice(r-1,r+h-1)
              .map((v,i)=>String(v[c-1])===String(value)?{getRow:()=>i+r}:null)
              .filter(Boolean);
          }
        };
      },
      setValues(value){
        assert.equal(h,1);assert.equal(w,10);
        assert.equal(value.length,1);
        if(r===rows.length+1)rows.push(value[0].slice());
        else rows[r-1]=value[0].slice();
        stats.writes++;
      }
    };
  }
};
let blockers={missingPunchDays:0,worklogMismatchDays:0};
const ctx=vm.createContext({
  console,Date,Object,Number,Math,Array,Set,Map,JSON,RegExp,String,
  Utilities:{formatDate:()=> '2026-10'},
  DB:{timeZone:'Asia/Tokyo'},
  requireSession_:()=>({employee:{employeeId:'FM001',name:'架空社員',role:'USER'}}),
  withScriptLock_:fn=>fn(),
  SpreadsheetApp:{flush:()=>stats.flush++},
  safeSheetText_:(x,max)=>String(x||'').slice(0,max),
  toTimestamp_:()=> '2026-10-10 11:00:00',
  appendAudit_:data=>audits.push(data)
});
vm.runInContext(fs.readFileSync('src/Monthly.gs','utf8'),ctx,{filename:'src/Monthly.gs'});
ctx.getMonthlyReviewSheet_=()=>sheet;
ctx.getLatestMonthlyDataUpdate_=()=> '2026-09-30 19:00:00';
ctx.getMonthlySummary=()=>({totals:blockers});
ctx.getMonthlyReviewStatusInternal_=(month,id)=>({yearMonth:month,employeeId:id,
  record:rows.find((r,i)=>i>0&&r[0]===month&&r[1]===id)?.slice()});
const confirm=vm.runInContext('confirmMonthlyReview',ctx);

// Existing confirmation must update only the matching employee/month, not a neighbor.
const status=confirm('TOKEN','2026-09','確認済み');
assert.equal(status.employeeId,'FM001');
assert.equal(status.record[3],'CONFIRMED');
assert.equal(rows[3][8],'2026-09-30 08:00:00','creation timestamp must be retained');
assert.equal(rows[3][7],'確認済み');
assert.deepEqual(rows[2],originalEarlier,"same employee's earlier month must be untouched");
assert.deepEqual(rows[4],originalOther,"another employee's record must be untouched");
assert.equal(rows.length,5,'existing record must not be duplicated');
assert.equal(audits.at(-1).before,'PENDING');
assert.equal(audits.at(-1).after,'CONFIRMED');
assert.equal(stats.writes,1);
assert.equal(stats.singleRowReads,1);

// A missing employee-month creates exactly one record, again without changing other staff.
const created=confirm('TOKEN','2026-07','初回確認');
assert.equal(rows.length,6);
assert.equal(created.record[0],'2026-07');
assert.equal(created.record[1],'FM001');
assert.equal(created.record[7],'初回確認');
assert.deepEqual(rows[4],originalOther);
assert.equal(stats.writes,2);
assert.equal(stats.singleRowReads,1,'new month must not read wide prior data');

// Invalid state must refuse writes and avoid false confirmation.
blockers={missingPunchDays:1,worklogMismatchDays:0};
assert.throws(()=>confirm('TOKEN','2026-06','未完了'),/確認未完了/);
assert.equal(stats.writes,2);
blockers={missingPunchDays:0,worklogMismatchDays:0};
assert.throws(()=>confirm('TOKEN','2026-10','当月'),/当月または未来/);
assert.equal(stats.writes,2);
assert.equal(stats.allWideReads,0);
assert.ok(stats.finderCalls>=2);
assert.equal(stats.flush,2);
console.log('PASS: indexed monthly review confirmation, untouched peer/older rows, append path and blockers');
