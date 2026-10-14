function getWorklogs(sessionToken, params) {
  const perfStarted=Date.now();
  const session = requireSession_(sessionToken);
  params = params || {};
  const start = normalizeDate_(params.start || Utilities.formatDate(new Date(), DB.timeZone, 'yyyy-MM-dd'));
  const end = normalizeDate_(params.end || start);
  if (start > end) throw new Error('期間指定を確認してください。');
  const requestedEmployeeId = String(params.employeeId || session.employee.employeeId);
  const employeeId = session.employee.role === 'ADMIN' ? requestedEmployeeId : session.employee.employeeId;
  const includeProjects=params.includeProjects!==false;
  const sheet = getDb_().getSheetByName('工数');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { items: [], totalMinutes: 0, projects:includeProjects?getProjectsInternal_(false):[],taskOptions:includeProjects&&typeof projectAdvancedTaskOptions_==='function'?projectAdvancedTaskOptions_(session.employee):[] };

  const items = (typeof projectAdvancedWorklogIds_==='function'?projectAdvancedWorklogIds_:items=>items)(readRowsByDateRange_(sheet,2,15,start,end,employeeId==='ALL'?undefined:3,[employeeId])
    .filter(r => r[0] && r[12] !== '削除' && r[1] >= start && r[1] <= end && (employeeId === 'ALL' || r[2] === employeeId))
    .map(r => ({
      id: r[0], date: r[1], employeeId: r[2], name: r[3], project: r[4],
      category: r[5], description: r[6], start: r[7], end: r[8],
      minutes: Number(r[9] || 0), note: r[10] || '', createdAt: r[11] || '',
      status: r[12] || '有効', updatedAt: r[14] || r[11] || ''
    }))
    .sort((a,b) => b.date.localeCompare(a.date) || (b.start||'').localeCompare(a.start||'')));

  logPerformance_('getWorklogs',perfStarted,PERFORMANCE_BUDGETS.worklogs,{items:items.length});
  return { items: items, totalMinutes: items.reduce((sum,x)=>sum+x.minutes,0), projects:includeProjects?getProjectsInternal_(false):[],taskOptions:includeProjects&&typeof projectAdvancedTaskOptions_==='function'?projectAdvancedTaskOptions_(session.employee):[] };
}

function saveWorklog(sessionToken, payload) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  payload = payload || {};

  return withScriptLock_(function() {
    const date = normalizeDate_(payload.date);
    assertMonthOpenForDate_(date,'工数を登録・編集');
    const project = String(payload.project || '').trim().slice(0, 120);
    const category = safeSheetText_(payload.category, 80);
    const description = safeSheetText_(payload.description, 500);
    const note = safeSheetText_(payload.note, 500);
    const start = normalizeTime_(payload.start || '');
    const end = normalizeTime_(payload.end || '');

    if (!project) throw new Error('プロジェクトを選択してください。');
    const projectRecord = getProjectByName_(project);
    if (!projectRecord) throw new Error('プロジェクトマスタに存在しないプロジェクトです。');
    if (!description) throw new Error('作業内容を入力してください。');
    if (!start || !end) throw new Error('開始時刻と終了時刻を入力してください。');

    const minutes = timeRangeMinutes_(start, end);
    if (minutes <= 0 || minutes > 1440) throw new Error('工数時間を確認してください。');

    const sheet = getDb_().getSheetByName('工数');
    const nowText = toTimestamp_(new Date());
    let id = String(payload.id || '').trim();
    let rowNumber = 0;
    let createdAt = nowText;
    let existingProject = '';
    let existingEmployeeId = '';
    let auditBefore = '';
    let previousRow = null;


    if (id) {
      const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1)
        .createTextFinder(id).matchEntireCell(true).findNext();
      if (!found) throw new Error('編集対象の工数が見つかりません。');
      rowNumber = found.getRow();
      const existing = sheet.getRange(rowNumber, 1, 1, 15).getDisplayValues()[0];
      previousRow=existing.slice();
      auditBefore = auditJson_({date:existing[1],employeeId:existing[2],project:existing[4],category:existing[5],description:existing[6],start:existing[7],end:existing[8],minutes:Number(existing[9]||0),note:existing[10],status:existing[12]});
      assertMonthOpenForDate_(existing[1],'工数を編集');
      if (existing[12] === '削除') throw new Error('削除済みの工数は編集できません。');
      if (employee.role !== 'ADMIN' && existing[2] !== employee.employeeId) {
        throw new Error('この工数を編集する権限がありません。');
      }
      existingProject = existing[4] || '';
      existingEmployeeId = String(existing[2] || '');
      createdAt = existing[11] || nowText;
    } else {
      id = createId_('W');
      rowNumber = Math.max(2, sheet.getLastRow() + 1);
    }

    if (projectRecord.status !== '進行中' && (!id || existingProject !== project)) {
      throw new Error('停止・完了したプロジェクトには新しい工数を登録できません。');
    }

    // Editing another employee's record must never silently transfer ownership to the admin.
    const targetEmployeeId = employee.role === 'ADMIN'
      ? (payload.employeeId ? String(payload.employeeId).trim().toUpperCase()
        : (existingEmployeeId || employee.employeeId))
      : employee.employeeId;
    const target = getEmployee_(targetEmployeeId);
    if (!target.active) throw new Error('在籍していない社員には工数を登録できません。');
    const linkage=typeof projectAdvancedWorklogPrepare_==='function'?projectAdvancedWorklogPrepare_(payload,projectRecord,employee,id):{sheet:null,taskId:'',requestKey:''};
    if(linkage.duplicateId){
      const foundDuplicate=sheet.getRange(2,1,Math.max(1,sheet.getLastRow()-1),1).createTextFinder(linkage.duplicateId).matchEntireCell(true).findNext();
      if(!foundDuplicate)throw new Error('重複送信の既存工数が見つかりません。管理者へ確認してください。');
      const prior=sheet.getRange(foundDuplicate.getRow(),1,1,15).getDisplayValues()[0];
      if(prior[12]==='削除'||prior[1]!==date||prior[2]!==target.employeeId||prior[4]!==project||
          prior[5]!==category||prior[6]!==description||prior[7]!==start||prior[8]!==end||Number(prior[9])!==minutes||prior[10]!==note)
        throw new Error('同じ送信識別子で異なる工数内容は登録できません。');
      return {ok:true,id:linkage.duplicateId,duplicate:true};
    }
    assertNoWorklogOverlap_(sheet, target.employeeId, date, start, end, id);

    const nextRow=[
      id, date, target.employeeId, target.name, project, category, description,
      start, end, minutes, note, createdAt, '有効', '', nowText
    ];
    sheet.getRange(rowNumber,1,1,15).setValues([nextRow]);
    if(linkage.sheet){
      try{projectAdvancedWorklogCommit_(linkage,id,projectRecord,employee);}
      catch(error){
        // Sheets and the separate mapping sheet are not transactional.
        // Restore edited rows; tombstone a new row so it cannot be counted twice.
        try{
          if(previousRow)sheet.getRange(rowNumber,1,1,15).setValues([previousRow]);
          else sheet.getRange(rowNumber,13,1,3).setValues([['削除',nowText,nowText]]);
          SpreadsheetApp.flush();
        }catch(rollbackError){
          throw new Error('工数関連付けと復旧の双方に失敗しました。再登録せず管理者に連絡してください: '+String(rollbackError.message||rollbackError));
        }
        throw new Error('作業への工数ひも付けに失敗し、工数変更を取り消しました。再試行してください: '+String(error.message||error));
      }
    }

    appendAudit_({
      employeeId: employee.employeeId, employeeName: employee.name,
      operation: payload.id ? '工数更新' : '工数登録', target: '工数', targetId: id,
      before: auditBefore, after: auditJson_({date:date,employeeId:target.employeeId,project:project,category:category,description:description,start:start,end:end,minutes:minutes,note:note,status:'有効'}),
      source: 'WEB', result: 'SUCCESS', note: target.name
    });
    if(typeof projectHubInvalidateWorklogs_==='function')projectHubInvalidateWorklogs_();
    SpreadsheetApp.flush();
    return { ok: true, id: id };
  });
}

function deleteWorklog(sessionToken, worklogId) {
  const employee = requireSession_(sessionToken).employee;
  const id = String(worklogId || '').trim();
  if (!id) throw new Error('工数IDを確認してください。');

  return withScriptLock_(function() {
    const sheet = getDb_().getSheetByName('工数');
    const found = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow() - 1), 1)
      .createTextFinder(id).matchEntireCell(true).findNext();
    if (!found) throw new Error('削除対象が見つかりません。');

    const row = found.getRow();
    const values = sheet.getRange(row, 1, 1, 15).getDisplayValues()[0];
    assertMonthOpenForDate_(values[1],'工数を削除');
    if (values[12] === '削除') return { ok: true };
    if (employee.role !== 'ADMIN' && values[2] !== employee.employeeId) {
      throw new Error('この工数を削除する権限がありません。');
    }

    const nowText = toTimestamp_(new Date());
    sheet.getRange(row, 13, 1, 3).setValues([['削除', nowText, nowText]]);
    appendAudit_({
      employeeId: employee.employeeId, employeeName: employee.name,
      operation: '工数削除', target: '工数', targetId: id,
      before: values[1] + ' ' + values[4] + ' ' + values[9] + '分', after: '削除',
      source: 'WEB', result: 'SUCCESS', note: ''
    });
    if(typeof projectHubInvalidateWorklogs_==='function')projectHubInvalidateWorklogs_();
    SpreadsheetApp.flush();
    return { ok: true };
  });
}

function assertNoWorklogOverlap_(sheet, employeeId, date, start, end, excludeId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  // Use the already-tested date index, instead of downloading all months of worklogs.
  const rows = readRowsByDateRange_(sheet,2,15,date,date,3,[employeeId]);
  const startMin = timeToMinutes_(start);
  const endMin = timeToMinutes_(end);

  for (const r of rows) {
    if (!r[0] || r[0] === excludeId || r[12] === '削除' || r[2] !== employeeId || r[1] !== date) continue;
    const existingStart = timeToMinutes_(r[7]);
    const existingEnd = timeToMinutes_(r[8]);
    if (startMin < existingEnd && existingStart < endMin) {
      throw new Error('同じ時間帯に別の工数が登録されています（' + r[7] + '–' + r[8] + ' / ' + r[4] + '）。');
    }
  }
}

function timeToMinutes_(value) {
  const parts = String(value || '').split(':').map(Number);
  if (parts.length !== 2 || parts.some(Number.isNaN)) return 0;
  return parts[0] * 60 + parts[1];
}

function timeRangeMinutes_(start, end) {
  const a = start.split(':').map(Number);
  const b = end.split(':').map(Number);
  return (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
}

