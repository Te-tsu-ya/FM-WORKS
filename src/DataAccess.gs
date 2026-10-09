const PERFORMANCE_BUDGETS = Object.freeze({
  initialData:900,
  homeOverview:1000,
  scheduleBundle:1200,
  requestsBundle:1200,
  monthlySummary:2500,
  worklogs:900,
  dateRangeRead:800,
  indexedRead:800
});

function dateRangeStrings_(start,end,maxDays){
  const from=String(start||''),to=String(end||from),limit=Math.max(1,Number(maxDays||370));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return [];
  const out=[];
  for(let d=from;out.length<limit;d=addDateString_(d,1)){
    out.push(d);
    if(d===to)return out;
  }
  return [];
}

function dateRangeRegex_(start,end,maxDays){
  const days=dateRangeStrings_(start,end,maxDays);
  if(!days.length)return '';
  return '^(?:'+days.join('|')+')$';
}

function regexEscape_(value){
  return String(value==null?'':value).replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');
}

function cacheJsonGet_(key){
  try{
    const raw=CacheService.getScriptCache().get(String(key||''));
    return raw?JSON.parse(raw):null;
  }catch(e){
    console.warn('cache get failed',key,e);
    return null;
  }
}

function cacheJsonPut_(key,value,ttlSeconds){
  try{
    const raw=JSON.stringify(value);
    if(raw.length>90000)return false;
    CacheService.getScriptCache().put(String(key||''),raw,Math.max(1,Number(ttlSeconds||60)));
    return true;
  }catch(e){
    console.warn('cache put failed',key,e);
    return false;
  }
}

function cacheRemove_(key){
  try{CacheService.getScriptCache().remove(String(key||''));}catch(e){console.warn('cache remove failed',key,e);}
}

// Cache only a row-number hint. Authentication, permissions, PIN fields,
// status and expiry are ALWAYS read fresh from the actual sheet row.
function findVerifiedSheetRow_(sheet,column,width,value,scope,display){
  const key=String(value==null?'':value);
  if(!key)return null;
  const lastRow=sheet.getLastRow();
  if(lastRow<2)return null;
  const started=Date.now();
  const cacheKey='fm:rowhint:v1:'+getDatabaseSpreadsheetId_()+':'+scope+':'+key;
  const hint=cacheJsonGet_(cacheKey);
  const rowHint=Number(hint&&hint.row);
  const readRow=rowNumber=>{
    const range=sheet.getRange(rowNumber,1,1,width);
    return (display?range.getDisplayValues():range.getValues())[0];
  };
  if(Number.isInteger(rowHint)&&rowHint>=2&&rowHint<=lastRow){
    try{
      const row=readRow(rowHint);
      if(String(row&&row[column-1])===key){
        if(Date.now()-started>400)logPerformance_('verifiedRowLookup',started,400,{scope,source:'ROW_HINT'});
        return {rowNumber:rowHint,row};
      }
    }catch(_){/* A moved or deleted row invalidates the hint. */}
  }
  const found=sheet.getRange(2,column,lastRow-1,1)
    .createTextFinder(key).matchEntireCell(true).findNext();
  if(!found)return null;
  const rowNumber=found.getRow();
  const row=readRow(rowNumber);
  if(String(row&&row[column-1])!==key)return null;
  cacheJsonPut_(cacheKey,{row:rowNumber},300);
  if(Date.now()-started>400)logPerformance_('verifiedRowLookup',started,400,{scope,source:'TEXT_FINDER'});
  return {rowNumber,row};
}

function readRowsByColumnValues_(sheet,column,width,values){
  const lastRow=sheet.getLastRow();
  if(lastRow<2)return [];
  const wanted=[...new Set((values||[]).map(v=>String(v||'').trim()).filter(Boolean))];
  if(!wanted.length)return [];
  const wantedSet=new Set(wanted);
  const pattern='^(?:'+wanted.map(regexEscape_).join('|')+')$';
  const started=Date.now();
  if(pattern.length>5000||wanted.length>80){
    const rows=sheet.getRange(2,1,lastRow-1,width).getDisplayValues().filter(r=>wantedSet.has(String(r[column-1]||'')));
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'FULL_FALLBACK',values:wanted.length});
    return rows;
  }
  const cells=sheet.getRange(2,column,lastRow-1,1).createTextFinder(pattern).useRegularExpression(true).matchEntireCell(true).findAll();
  if(!cells.length){
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:0,source:'TEXT_FINDER',values:wanted.length});
    return [];
  }
  const blocks=contiguousRowBlocks_(cells.map(c=>c.getRow()));
  if(blocks.length>48){
    const rows=sheet.getRange(2,1,lastRow-1,width).getDisplayValues().filter(r=>wantedSet.has(String(r[column-1]||'')));
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'FULL_FALLBACK',blocks:blocks.length,values:wanted.length});
    return rows;
  }
  const endCol=columnLetter_(width);
  const rows=sheet.getRangeList(blocks.map(b=>'A'+b.start+':'+endCol+b.end)).getRanges().flatMap(range=>range.getDisplayValues())
    .filter(r=>wantedSet.has(String(r[column-1]||'')));
  logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'VALUE_INDEX',blocks:blocks.length,values:wanted.length});
  return rows;
}
function contiguousRowBlocks_(rowNumbers){
  const rows=[...new Set((rowNumbers||[]).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b),blocks=[];
  rows.forEach(row=>{
    const last=blocks[blocks.length-1];
    if(last&&row===last.end+1)last.end=row;
    else blocks.push({start:row,end:row});
  });
  return blocks;
}

function columnLetter_(column){
  let n=Math.max(1,Number(column||1)),out='';
  while(n){n--;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);}
  return out;
}

function logPerformance_(label,startedAt,budgetMs,meta){
  const elapsed=Math.max(0,Date.now()-Number(startedAt||Date.now()));
  const payload={type:'FM_WORKS_PERF',label:String(label||''),elapsedMs:elapsed,budgetMs:Number(budgetMs||0),overBudget:!!budgetMs&&elapsed>budgetMs,meta:meta||{}};
  console.log(JSON.stringify(payload));
  return payload;
}

function readRowsByDateRange_(sheet,dateColumn,width,start,end){
  const lastRow=sheet.getLastRow();
  if(lastRow<2)return [];
  const regex=dateRangeRegex_(start,end,370);
  // Long date spans exceed the indexed regex cap. Never expose out-of-range rows.
  if(!regex){
    if(String(start)>String(end))return [];
    return sheet.getRange(2,1,lastRow-1,width).getDisplayValues()
      .filter(r=>String(r[dateColumn-1]||'')>=String(start)&&String(r[dateColumn-1]||'')<=String(end));
  }
  const started=Date.now();
  const cells=sheet.getRange(2,dateColumn,lastRow-1,1).createTextFinder(regex).useRegularExpression(true).matchEntireCell(true).findAll();
  if(!cells.length){logPerformance_('dateRangeRead',started,PERFORMANCE_BUDGETS.dateRangeRead,{rows:0,source:'TEXT_FINDER'});return [];}
  const blocks=contiguousRowBlocks_(cells.map(c=>c.getRow()));
  if(blocks.length>48){
    const rows=sheet.getRange(2,1,lastRow-1,width).getDisplayValues().filter(r=>r[dateColumn-1]>=start&&r[dateColumn-1]<=end);
    logPerformance_('dateRangeRead',started,PERFORMANCE_BUDGETS.dateRangeRead,{rows:rows.length,source:'FULL_FALLBACK',blocks:blocks.length});
    return rows;
  }
  const endCol=columnLetter_(width);
  const ranges=sheet.getRangeList(blocks.map(b=>'A'+b.start+':'+endCol+b.end)).getRanges();
  const rows=ranges.flatMap(range=>range.getDisplayValues());
  logPerformance_('dateRangeRead',started,PERFORMANCE_BUDGETS.dateRangeRead,{rows:rows.length,source:'DATE_INDEX',blocks:blocks.length});
  return rows;
}
