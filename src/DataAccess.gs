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

// Cache entries must never follow a switch between staging and production DBs.
function databaseCacheKey_(key){return 'fm:db:'+getDatabaseSpreadsheetId_()+':'+String(key||'');}
function utf8Bytes_(text){
  let bytes=0;
  for(const ch of String(text)){const cp=ch.codePointAt(0);bytes+=cp<128?1:cp<2048?2:cp<65536?3:4;}
  return bytes;
}
function cacheJsonGet_(key){
  try{
    const raw=CacheService.getScriptCache().get(databaseCacheKey_(key));
    return raw?JSON.parse(raw):null;
  }catch(e){
    console.warn('cache get failed',key,e);
    return null;
  }
}

function cacheJsonPut_(key,value,ttlSeconds){
  try{
    const raw=JSON.stringify(value);
    if(utf8Bytes_(raw)>90000)return false;
    CacheService.getScriptCache().put(databaseCacheKey_(key),raw,Math.max(1,Number(ttlSeconds||60)));
    return true;
  }catch(e){
    console.warn('cache put failed',key,e);
    return false;
  }
}

function cacheRemove_(key){
  try{CacheService.getScriptCache().remove(databaseCacheKey_(key));}catch(e){console.warn('cache remove failed',key,e);}
}

// Immutable generations keep a concurrent reader from mixing old/new chunks.
// Any missing part is a cache miss; partial business records are never returned.
function cacheJsonGetLarge_(key){
  const value=cacheJsonGet_(key);
  if(!value||value._fmChunks!==1)return value;
  try{
    if(!/^[A-Za-z0-9-]+$/.test(value.generation)||!Number.isInteger(value.count)||value.count<1||value.count>80)return null;
    const prefix=databaseCacheKey_(key)+':'+value.generation+':';
    const keys=Array.from({length:value.count},(_,i)=>prefix+i);
    const parts=CacheService.getScriptCache().getAll(keys);
    if(keys.some(k=>typeof parts[k]!=='string'))return null;
    return JSON.parse(keys.map(k=>parts[k]).join(''));
  }catch(e){console.warn('large cache get failed',key,e);return null;}
}
function cacheJsonPutLarge_(key,value,ttlSeconds){
  try{
    const raw=JSON.stringify(value),bytes=utf8Bytes_(raw);
    if(bytes<=90000)return cacheJsonPut_(key,value,ttlSeconds);
    if(bytes>4800000){cacheRemove_(key);return false;}
    const generation=Utilities.getUuid(),prefix=databaseCacheKey_(key)+':'+generation+':',parts={};let part='',size=0,count=0;
    for(const ch of raw){const n=utf8Bytes_(ch);if(size+n>60000){parts[prefix+count++]=part;part='';size=0;}part+=ch;size+=n;}
    parts[prefix+count++]=part;
    CacheService.getScriptCache().putAll(parts,Math.max(1,Number(ttlSeconds||60)));
    return cacheJsonPut_(key,{_fmChunks:1,generation,count},ttlSeconds);
  }catch(e){cacheRemove_(key);console.warn('large cache put failed',key,e);return false;}
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

function readRowsByColumnValues_(sheet,column,width,values,caseInsensitive,withRowNumbers){
  const lastRow=sheet.getLastRow();
  if(lastRow<2)return [];
  const normalize=value=>caseInsensitive?String(value||'').toUpperCase():String(value||'');
  const wanted=[...new Set((values||[]).map(v=>normalize(String(v||'').trim())).filter(Boolean))];
  if(!wanted.length)return [];
  const wantedSet=new Set(wanted);
  const select=(rows,start)=>rows.map((r,i)=>withRowNumbers?{rowNumber:start+i,values:r}:r)
    .filter(r=>wantedSet.has(normalize((withRowNumbers?r.values:r)[column-1])));
  const pattern='^(?:'+wanted.map(regexEscape_).join('|')+')$';
  const started=Date.now();
  if(lastRow-1<=250&&(lastRow-1)*width<=10000){
    const rows=select(sheet.getRange(2,1,lastRow-1,width).getDisplayValues(),2);
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'SMALL_BATCH'});return rows;
  }
  if(pattern.length>5000||wanted.length>80){
    const rows=select(sheet.getRange(2,1,lastRow-1,width).getDisplayValues(),2);
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'FULL_FALLBACK',values:wanted.length});
    return rows;
  }
  let cells;
  try{cells=sheet.getRange(2,column,lastRow-1,1).createTextFinder(pattern).useRegularExpression(true).matchEntireCell(true).findAll();}
  catch(_){
    const rows=select(sheet.getRange(2,1,lastRow-1,width).getDisplayValues(),2);
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:rows.length,source:'INDEX_UNAVAILABLE',values:wanted.length});
    return rows;
  }
  if(!cells.length){
    logPerformance_('indexedRead',started,PERFORMANCE_BUDGETS.indexedRead,{rows:0,source:'TEXT_FINDER',values:wanted.length});
    return [];
  }
  const blocks=indexedRowWindows_(cells.map(c=>c.getRow()));
  const endCol=columnLetter_(width);
  const rows=sheet.getRangeList(blocks.map(b=>'A'+b.start+':'+endCol+b.end)).getRanges()
    .flatMap((range,i)=>select(range.getDisplayValues(),blocks[i].start));
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

// At most eight Sheet value reads. Keep the seven largest gaps unread: among
// ordered row windows this minimizes extra cells for this service-call budget.
// Callers must filter live row values again because a window may include gaps.
function indexedRowWindows_(rowNumbers,minGapRows){
  const blocks=contiguousRowBlocks_(rowNumbers);
  if(blocks.length<=1)return blocks;
  // Default path preserves the existing smallest-cell, at-most-eight-window behavior.
  // Optional minimum gap avoids paying extra Sheets round trips for tiny holes.
  const minGap=Math.max(0,Math.floor(Number(minGapRows)||0));
  if(blocks.length<=8&&!minGap)return blocks;
  const gaps=blocks.slice(1).map((b,i)=>({after:i,size:b.start-blocks[i].end-1}))
    .filter(g=>g.size>=minGap);
  const cuts=new Set(gaps.sort((a,b)=>b.size-a.size||a.after-b.after).slice(0,7).map(g=>g.after));
  const windows=[];let start=blocks[0].start;
  blocks.forEach((b,i)=>{if(cuts.has(i)||i===blocks.length-1){windows.push({start,end:b.end});start=blocks[i+1]?.start;}});
  return windows;
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

// Optional owner index intersects with the date index before any wide-row read.
// Every result is rechecked against live values; indexes never grant access.
function readRowsByDateRange_(sheet,dateColumn,width,start,end,scopeColumn,scopeValues){
  const lastRow=sheet.getLastRow();if(lastRow<2||String(start)>String(end))return [];
  const scoped=Number.isInteger(scopeColumn)&&scopeColumn>=1&&scopeColumn<=width;
  const wanted=scoped?[...new Set((scopeValues||[]).map(v=>String(v||'')).filter(Boolean))]:[];
  if(scoped&&!wanted.length)return [];
  const owners=new Set(wanted),started=Date.now();
  const select=rows=>rows.filter(r=>String(r[dateColumn-1]||'')>=String(start)&&
    String(r[dateColumn-1]||'')<=String(end)&&(!scoped||owners.has(String(r[scopeColumn-1]||''))));
  const fallback=source=>{
    const rows=select(sheet.getRange(2,1,lastRow-1,width).getDisplayValues());
    logPerformance_('dateRangeRead',started,PERFORMANCE_BUDGETS.dateRangeRead,{rows:rows.length,source,scoped});return rows;
  };
  if(lastRow-1<=250&&(lastRow-1)*width<=10000)return fallback('SMALL_BATCH');
  const regex=dateRangeRegex_(start,end,370);
  if(!regex)return fallback('LONG_RANGE_FALLBACK');
  const ownerRegex='^(?:'+wanted.map(regexEscape_).join('|')+')$';
  if(scoped&&(wanted.length>80||ownerRegex.length>5000))return fallback('SCOPE_LIMIT_FALLBACK');
  let cells;
  try{
    cells=sheet.getRange(2,dateColumn,lastRow-1,1).createTextFinder(regex).useRegularExpression(true).matchEntireCell(true).findAll();
    if(scoped&&cells.length){
      const matches=sheet.getRange(2,scopeColumn,lastRow-1,1).createTextFinder(ownerRegex).useRegularExpression(true).matchEntireCell(true).findAll();
      const positions=new Set(matches.map(c=>c.getRow()));cells=cells.filter(c=>positions.has(c.getRow()));
    }
  }catch(_){return fallback('INDEX_UNAVAILABLE');}
  if(!cells.length){logPerformance_('dateRangeRead',started,PERFORMANCE_BUDGETS.dateRangeRead,{rows:0,source:'TEXT_FINDER',scoped});return [];}
  const blocks=indexedRowWindows_(cells.map(c=>c.getRow()));
  const endCol=columnLetter_(width);
  const ranges=sheet.getRangeList(blocks.map(b=>'A'+b.start+':'+endCol+b.end)).getRanges();
  const rows=select(ranges.flatMap(range=>range.getDisplayValues()));
  logPerformance_('dateRangeRead',started,PERFORMANCE_BUDGETS.dateRangeRead,{rows:rows.length,source:scoped?'DATE_OWNER_INDEX':'DATE_INDEX',blocks:blocks.length});return rows;
}
