function searchApp(sessionToken, query) {
  const session = requireSession_(sessionToken);
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const results = [];
  const add = item => { if (results.length < 30) results.push(item); };

  // Reuse the active employee directory already loaded during login.
  for (const employee of getEmployees_()) {
    if (!employee || !employee.employeeId) continue;
    const hay = [employee.employeeId,employee.name,employee.displayName,employee.department,employee.title]
      .join(' ').toLowerCase();
    if (hay.includes(q)) add({
      type:'社員',title:employee.name,
      sub:[employee.employeeId,employee.department,employee.title].filter(Boolean).join(' / '),
      route:'people'
    });
    if (results.length >= 30) return results;
  }

  const db = getDb_();
  const scheduleSheet = db.getSheetByName(DB.sheets.schedule);
  if (scheduleSheet && scheduleSheet.getLastRow() >= 2) {
    const rows = searchScheduleRows_(scheduleSheet,q);
    for (const r of rows) {
      if (!r[0] || r[12] === '削除' || !canViewScheduleRow_(session.employee,r)) continue;
      const hay = [r[6],r[7],r[8],r[9],r[10]].join(' ').toLowerCase();
      if (hay.includes(q)) add({
        type:'予定',title:r[7],sub:[r[1],r[2],r[6],r[9]].filter(Boolean).join(' / '),
        route:'schedule',date:r[1],id:r[0]
      });
      if (results.length >= 30) return results;
    }
  }

  const requestSheet = db.getSheetByName('申請');
  if (requestSheet && requestSheet.getLastRow() >= 2) {
    const managedIds = getPermissions_(session.employee).requestApprove
      ? getManagedEmployeeIds_(session.employee) : new Set();
    const allowedIds = [...new Set([session.employee.employeeId,...managedIds])];
    // Read only the requester IDs visible to this user, and recheck ACL.
    const rows = readRowsByColumnValues_(requestSheet,3,19,allowedIds);
    for (const r of rows) {
      if (!r[0] || (r[2] !== session.employee.employeeId && !managedIds.has(r[2]))) continue;
      const hay = [r[3],r[4],r[5],r[7],r[8],r[9]].join(' ').toLowerCase();
      if (hay.includes(q)) add({
        type:'申請',title:r[4]+' / '+r[3],
        sub:[r[5],r[9],r[8]].filter(Boolean).join(' / '),
        route:'requests',id:r[0]
      });
      if (results.length >= 30) return results;
    }
  }

  return results;
}

/* Fetch only matching scheduled rows from large sheets. The exact original
 * substring semantics (including queries spanning columns) are retained by
 * falling back to the original full scan for whitespace/long queries. */
function searchScheduleRows_(sheet,query) {
  const lastRow=sheet.getLastRow();
  if(lastRow<2)return [];
  const full=()=>sheet.getRange(2,1,lastRow-1,18).getDisplayValues();
  const q=String(query||'');
  if(lastRow<=301||q.length>80||/\s/.test(q))return full();
  try{
    // G:K are exactly the five fields searched by searchApp's original haystack.
    const found=sheet.getRange(2,7,lastRow-1,5).createTextFinder(q)
      .useRegularExpression(false).matchCase(false).findAll();
    if(!found.length)return [];
    const blocks=contiguousRowBlocks_(found.map(r=>r.getRow()));
    if(blocks.length>48)return full();
    // Stable source-row ordering, with all 18 columns to enforce visibility.
    return sheet.getRangeList(blocks.map(b=>'A'+b.start+':R'+b.end))
      .getRanges().flatMap(range=>range.getDisplayValues());
  }catch(_){
    // Index failure must not change search semantics or leak any result.
    return full();
  }
}
