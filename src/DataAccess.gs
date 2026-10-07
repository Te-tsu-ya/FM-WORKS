const PERFORMANCE_BUDGETS = Object.freeze({
  monthlySummary:3500,
  worklogs:1500,
  dateRangeRead:1200
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
  if(!regex)return sheet.getRange(2,1,lastRow-1,width).getDisplayValues();
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
