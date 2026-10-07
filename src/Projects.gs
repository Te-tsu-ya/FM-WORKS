const PROJECT_STATUS = Object.freeze(['進行中','停止','完了']);

function getProjects(sessionToken, includeInactive) {
  const session = requireSession_(sessionToken);
  const allowInactive = !!includeInactive && session.employee.role === 'ADMIN';
  return getProjectsInternal_(allowInactive);
}

function getProjectsInternal_(includeInactive) {
  const sheet = getDb_().getSheetByName(DB.sheets.projects);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet.getRange(2,1,lastRow-1,9).getDisplayValues()
    .filter(r => r[0] && (includeInactive || r[3] === '進行中'))
    .map(r => ({
      projectId: r[0],
      name: r[1],
      client: r[2] || '',
      status: r[3] || '進行中',
      startDate: r[4] || '',
      endDate: r[5] || '',
      note: r[6] || '',
      updatedBy: r[7] || '',
      updatedAt: r[8] || ''
    }))
    .sort((a,b) => a.name.localeCompare(b.name, 'ja'));
}

function getProjectByName_(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return getProjectsInternal_(true).find(p => p.name.toLowerCase() === key) || null;
}

function saveProject(sessionToken, payload) {
  const admin = requireAdminSession_(sessionToken).employee;
  payload = payload || {};

  return withScriptLock_(function() {
    const name = safeSheetText_(payload.name, 120);
    if (!name) throw new Error('プロジェクト名を入力してください。');

    const client = safeSheetText_(payload.client, 100);
    const status = PROJECT_STATUS.includes(payload.status) ? payload.status : '進行中';
    const startDate = payload.startDate ? normalizeDate_(payload.startDate) : '';
    const endDate = payload.endDate ? normalizeDate_(payload.endDate) : '';
    if (startDate && endDate && startDate > endDate) throw new Error('終了日は開始日以降に設定してください。');
    const note = safeSheetText_(payload.note, 500);

    const sheet = getDb_().getSheetByName(DB.sheets.projects);
    const lastRow = sheet.getLastRow();
    let projectId = String(payload.projectId || '').trim();
    let rowNumber = 0;
    let before = '';

    if (lastRow >= 2) {
      const rows = sheet.getRange(2,1,lastRow-1,9).getDisplayValues();
      rows.forEach((r,idx) => {
        if (projectId && r[0] === projectId) {
          rowNumber = idx + 2;
          before = [r[1],r[2],r[3]].join(' / ');
        }
        if ((!projectId || r[0] !== projectId) && String(r[1] || '').trim().toLowerCase() === name.toLowerCase()) {
          throw new Error('同じプロジェクト名がすでに登録されています。');
        }
      });
    }

    if (!projectId) projectId = nextProjectId_(sheet);
    if (!rowNumber) rowNumber = Math.max(2, sheet.getLastRow() + 1);
    const nowText = toTimestamp_(new Date());

    sheet.getRange(rowNumber,1,1,9).setValues([[
      projectId,name,client,status,startDate,endDate,note,admin.name,nowText
    ]]);

    appendAudit_({
      employeeId:admin.employeeId,employeeName:admin.name,
      operation:before?'プロジェクト更新':'プロジェクト追加',
      target:'プロジェクト',targetId:projectId,before:before,
      after:[name,client,status].join(' / '),source:'WEB',result:'SUCCESS',note:''
    });
    SpreadsheetApp.flush();
    return {ok:true,projectId:projectId};
  });
}

function nextProjectId_(sheet) {
  const lastRow = sheet.getLastRow();
  let max = 0;
  if (lastRow >= 2) {
    sheet.getRange(2,1,lastRow-1,1).getDisplayValues().forEach(r => {
      const m = String(r[0] || '').match(/^PRJ-(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]));
    });
  }
  return 'PRJ-' + String(max + 1).padStart(3,'0');
}
