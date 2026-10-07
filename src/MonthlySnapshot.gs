function monthlySnapshotPayload_(summary) {
  return {
    yearMonth: String(summary && summary.yearMonth || ''),
    employeeId: String(summary && summary.employee && summary.employee.employeeId || ''),
    totals: {
      workDays: Number(summary && summary.totals && summary.totals.workDays || 0),
      absenceDays: Number(summary && summary.totals && summary.totals.absenceDays || 0),
      totalMinutes: Number(summary && summary.totals && summary.totals.totalMinutes || 0),
      overtimeMinutes: Number(summary && summary.totals && summary.totals.overtimeMinutes || 0),
      holidayMinutes: Number(summary && summary.totals && summary.totals.holidayMinutes || 0),
      lateEarlyMinutes: Number(summary && summary.totals && summary.totals.lateEarlyMinutes || 0),
      paidLeaveDays: Number(summary && summary.totals && summary.totals.paidLeaveDays || 0),
      remoteDays: Number(summary && summary.totals && summary.totals.remoteDays || 0),
      missingPunchDays: Number(summary && summary.totals && summary.totals.missingPunchDays || 0),
      worklogMinutes: Number(summary && summary.totals && summary.totals.worklogMinutes || 0),
      worklogMismatchDays: Number(summary && summary.totals && summary.totals.worklogMismatchDays || 0)
    },
    daily: (summary && summary.daily || []).map(d => ({
      date: String(d.date || ''),
      company: String(d.companyName || d.companyType || ''),
      workingDay: !!d.workingDay,
      clockIn: String(d.clockIn || ''),
      clockOut: String(d.clockOut || ''),
      workMinutes: Number(d.workMinutes || 0),
      overtimeMinutes: Number(d.overtimeMinutes || 0),
      holidayMinutes: Number(d.holidayMinutes || 0),
      lateEarlyMinutes: Number(d.lateEarlyMinutes || 0),
      breakMinutes: Number(d.breakMinutes || 0),
      worklogMinutes: Number(d.worklogMinutes || 0),
      worklogDifferenceMinutes: Number(d.worklogDifferenceMinutes || 0),
      workLocation: String(d.workLocation || ''),
      leaveStatus: String(d.leaveStatus || ''),
      issueType: String(d.issueType || ''),
      source: String(d.source || '')
    }))
  };
}

function monthlySnapshotHash_(summary) {
  const json = JSON.stringify(monthlySnapshotPayload_(summary));
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function persistMonthlyCloseSnapshots_(yearMonth, summaries, admin) {
  const ym = normalizeYearMonth_(yearMonth);
  const snapshotId = 'MC-' + ym.replace('-','') + '-' + Utilities.getUuid();
  const nowText = toTimestamp_(new Date());
  const summarySheet = getDb_().getSheetByName(DB.sheets.monthlySnapshot);
  const dailySheet = getDb_().getSheetByName(DB.sheets.monthlySnapshotDaily);
  if (!summarySheet || !dailySheet) throw new Error('月次確定スナップショット用シートがありません。DB更新を実行してください。');

  const summaryRows = [];
  const dailyRows = [];
  summaries.forEach(summary => {
    const t = summary.totals;
    summaryRows.push([
      snapshotId, ym, summary.employee.employeeId, summary.employee.name, nowText, admin.name,
      t.workDays, t.absenceDays, t.totalMinutes, t.overtimeMinutes, t.holidayMinutes, t.lateEarlyMinutes,
      t.paidLeaveDays, t.remoteDays, t.missingPunchDays, t.worklogMinutes, t.worklogMismatchDays,
      monthlySnapshotHash_(summary), nowText
    ]);
    summary.daily.forEach(d => dailyRows.push([
      snapshotId, ym, summary.employee.employeeId, d.date, d.companyName || d.companyType || '',
      !!d.workingDay, d.clockIn || '', d.clockOut || '', Number(d.workMinutes || 0), Number(d.overtimeMinutes || 0),
      Number(d.holidayMinutes || 0), Number(d.lateEarlyMinutes || 0), Number(d.breakMinutes || 0),
      Number(d.worklogMinutes || 0), d.workLocation || '', d.leaveStatus || '', d.issueType || '',
      d.source || '', Number(d.worklogDifferenceMinutes || 0)
    ]));
  });

  if (summaryRows.length) {
    const start = Math.max(2, summarySheet.getLastRow() + 1);
    summarySheet.getRange(start,1,summaryRows.length,19).setValues(summaryRows);
  }
  if (dailyRows.length) {
    const start = Math.max(2, dailySheet.getLastRow() + 1);
    dailySheet.getRange(start,1,dailyRows.length,19).setValues(dailyRows);
  }
  SpreadsheetApp.flush();
  return snapshotId;
}

function getMonthlySnapshotSummaries_(yearMonth, snapshotId, employeeIds) {
  const ym = normalizeYearMonth_(yearMonth);
  const id = String(snapshotId || '').trim();
  if (!id) throw new Error('月次確定スナップショットIDがありません。');
  const wanted = new Set((employeeIds || []).map(String));
  const summarySheet = getDb_().getSheetByName(DB.sheets.monthlySnapshot);
  const dailySheet = getDb_().getSheetByName(DB.sheets.monthlySnapshotDaily);
  if (!summarySheet || !dailySheet) throw new Error('月次確定スナップショットが利用できません。');

  const summaryRows = summarySheet.getLastRow() < 2 ? [] :
    summarySheet.getRange(2,1,summarySheet.getLastRow()-1,19).getDisplayValues()
      .filter(r => r[0] === id && r[1] === ym && (!wanted.size || wanted.has(r[2])));
  const dailyRows = dailySheet.getLastRow() < 2 ? [] :
    dailySheet.getRange(2,1,dailySheet.getLastRow()-1,19).getDisplayValues()
      .filter(r => r[0] === id && r[1] === ym && (!wanted.size || wanted.has(r[2])));

  const dailyByEmployee = {};
  dailyRows.forEach(r => {
    const diff = Number(r[18] || 0);
    const item = {
      date:r[3], companyType:r[4]||'', companyName:r[4]||'', workingDay:String(r[5]).toUpperCase()==='TRUE',
      clockIn:r[6]||'', clockOut:r[7]||'', workMinutes:Number(r[8]||0), overtimeMinutes:Number(r[9]||0),
      holidayMinutes:Number(r[10]||0), lateEarlyMinutes:Number(r[11]||0), breakMinutes:Number(r[12]||0),
      requiredBreakMinutes:requiredBreakMinutes_(Number(r[8]||0)), worklogMinutes:Number(r[13]||0),
      worklogDifferenceMinutes:diff, worklogIssue:Math.abs(diff)>5, workLocation:r[14]||'',
      remote:(r[14]||'')==='在宅', leaveStatus:r[15]||'', absence:String(r[15]||'').includes('欠勤'),
      source:r[17]||'SNAPSHOT', issue:!!r[16], issueType:r[16]||''
    };
    (dailyByEmployee[r[2]]||(dailyByEmployee[r[2]]=[])).push(item);
  });
  Object.values(dailyByEmployee).forEach(rows => rows.sort((a,b)=>a.date.localeCompare(b.date)));

  return summaryRows.map(r => ({
    yearMonth:ym,
    snapshotId:id,
    snapshotHash:r[17]||'',
    employee:{employeeId:r[2],name:r[3],displayName:r[3]},
    totals:{
      workDays:Number(r[6]||0), absenceDays:Number(r[7]||0), totalMinutes:Number(r[8]||0),
      overtimeMinutes:Number(r[9]||0), holidayMinutes:Number(r[10]||0), lateEarlyMinutes:Number(r[11]||0),
      paidLeaveDays:Number(r[12]||0), remoteDays:Number(r[13]||0), missingPunchDays:Number(r[14]||0),
      worklogMinutes:Number(r[15]||0), worklogMismatchDays:Number(r[16]||0)
    },
    daily:dailyByEmployee[r[2]]||[],
    requests:[],
    closeStatus:getMonthlyCloseStatusInternal_(ym),
    reviewStatus:null
  }));
}

function getMonthlySnapshotSummary_(yearMonth, employeeId, snapshotId) {
  const rows = getMonthlySnapshotSummaries_(yearMonth, snapshotId, [employeeId]);
  if (!rows.length) throw new Error('締め済み月の確定データが見つかりません。');
  return rows[0];
}

function getMonthlySummaryForExport_(sessionToken, yearMonth, employeeId) {
  const session = requireSession_(sessionToken);
  const ym = normalizeYearMonth_(yearMonth);
  const requested = employeeId ? String(employeeId).trim().toUpperCase() : session.employee.employeeId;
  if (requested !== session.employee.employeeId && !canManageEmployee_(session.employee, requested)) {
    throw new Error('この社員の月次データを出力する権限がありません。');
  }
  const closeStatus = getMonthlyCloseStatusInternal_(ym);
  if (closeStatus.closed) {
    if (!closeStatus.snapshotId) throw new Error('締め済み月に確定スナップショットがありません。締めを解除し、再締めしてください。');
    return getMonthlySnapshotSummary_(ym, requested, closeStatus.snapshotId);
  }
  return getMonthlySummary(sessionToken, ym, requested);
}
