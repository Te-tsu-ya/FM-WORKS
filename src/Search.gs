function searchApp(sessionToken, query) {
  const session = requireSession_(sessionToken);
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const results = [];
  const add = item => { if (results.length < 30) results.push(item); };

  const employeeSheet = getDb_().getSheetByName(DB.sheets.employees);
  if (employeeSheet.getLastRow() >= 2) {
    employeeSheet.getRange(2,1,employeeSheet.getLastRow()-1,13).getDisplayValues().forEach(r => {
      if (!r[0] || r[6] !== '在籍') return;
      const hay=[r[0],r[1],r[2],r[3],r[4]].join(' ').toLowerCase();
      if (hay.includes(q)) add({type:'社員',title:r[1],sub:[r[0],r[3],r[4]].filter(Boolean).join(' / '),route:'people'});
    });
  }

  const scheduleSheet = getDb_().getSheetByName(DB.sheets.schedule);
  if (scheduleSheet.getLastRow() >= 2) {
    scheduleSheet.getRange(2,1,scheduleSheet.getLastRow()-1,18).getDisplayValues().forEach(r => {
      if (!r[0] || r[12] === '削除') return;
      if (!canViewScheduleRow_(session.employee,r)) return;
      const hay=[r[6],r[7],r[8],r[9],r[10]].join(' ').toLowerCase();
      if (hay.includes(q)) add({type:'予定',title:r[7],sub:[r[1],r[2],r[6],r[9]].filter(Boolean).join(' / '),route:'schedule',date:r[1],id:r[0]});
    });
  }

  const requestSheet = getDb_().getSheetByName('申請');
  if (requestSheet.getLastRow() >= 2) {
    const managedIds=getPermissions_(session.employee).requestApprove?getManagedEmployeeIds_(session.employee):new Set();
    requestSheet.getRange(2,1,requestSheet.getLastRow()-1,19).getDisplayValues().forEach(r => {
      if (!r[0]) return;
      if (r[2]!==session.employee.employeeId&&!managedIds.has(r[2])) return;
      const hay=[r[3],r[4],r[5],r[7],r[8],r[9]].join(' ').toLowerCase();
      if (hay.includes(q)) add({type:'申請',title:r[4]+' / '+r[3],sub:[r[5],r[9],r[8]].filter(Boolean).join(' / '),route:'requests',id:r[0]});
    });
  }

  return results.slice(0,30);
}
