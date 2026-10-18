function getNotifications(sessionToken) {
  const perfStarted=Date.now();
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  const items = [];
  const today=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');
  const reconcile=maybeReconcileLeave_(employee.employeeId,today,employee);

  const monthlyReview=getMonthlyReviewPrompt_(employee.employeeId);
  if(monthlyReview.needsAttention){
    const backlog=!!monthlyReview.isBacklog;
    const pendingCount=Number(monthlyReview.pendingCount||1);
    items.push({
      type:'勤怠確認',
      title:monthlyReview.targetMonth+'の勤怠確認',
      subtitle:monthlyReview.stale
        ? '確認後に変更があります。再確認してください。'
        : backlog
          ? '以前の未確認月が残っています。古い月から確認してください。'+(pendingCount>1?' 残り'+pendingCount+'か月。':'')
          : '先月の勤怠に誤りがないか確認してください。',
      route:'monthly',
      yearMonth:monthlyReview.targetMonth,
      priority:monthlyReview.urgency
    });
  }

  const freshEmployee=reconcile&&(reconcile.granted||reconcile.repaired)
    ?getEmployee_(employee.employeeId):employee;
  const annualLeave=getAnnualLeaveFiveDayStatus_(freshEmployee,today);
  const automatic=leaveAutoForecast_(freshEmployee,today);
  if(automatic.status==='REVIEW'){
    items.push({type:'年休付与要確認',title:'有給の付与条件を確認してください',
      subtitle:'付与予定 '+automatic.dueDate+' / '+automatic.dueDays+'日。勤怠や会社カレンダーの記録を管理者に確認してください。',
      route:'requests',priority:'warning'});
  }
  const dueSchedule=leaveEntitlement_(freshEmployee.hireDate,today);
  if(annualLeave.status==='DATA_INCOMPLETE'||(annualLeave.status==='UNKNOWN'&&
     freshEmployee.leaveBalanceConfigured&&dueSchedule&&dueSchedule.due)){
    items.push({type:'年休5日',title:'有給5日取得状況の確認が必要です',
      subtitle:annualLeave.reason||'年休の付与記録・会社カレンダーを確認してください。',
      route:'requests',priority:'warning'});
  }
  if(annualLeave.previousOverdue){
    items.push({type:'年休5日',title:'前年度の年休5日未達を確認してください',
      subtitle:annualLeave.previousOverdue.periodStart+'〜'+annualLeave.previousOverdue.periodEnd+
        ' の取得が '+annualLeave.previousOverdue.takenDays+'日でした。管理者が履歴を確認してください。',
      route:'requests',priority:'danger'});
  }
  if(annualLeave.status==='OVERDUE'||(annualLeave.status==='TRACKING'&&annualLeave.remainingDays>0&&annualLeave.daysRemaining<=180)){
    items.push({
      type:'年休5日',
      title:annualLeave.status==='OVERDUE'?'年5日の年休取得を確認してください':'年休5日まで残り'+annualLeave.remainingDays+'日',
      subtitle:annualLeave.status==='OVERDUE'
        ? annualLeave.periodStart+'〜'+annualLeave.periodEnd+' の取得実績が '+annualLeave.takenDays+'日です。'
        : '期限 '+annualLeave.periodEnd+' / 現在 '+annualLeave.takenDays+'日取得済み。',
      route:'requests',
      priority:annualLeave.status==='OVERDUE'||annualLeave.daysRemaining<=60?'danger':'warning'
    });
  }

  const canApproveRequests = !!getPermissions_(employee).requestApprove;
  const requestIds=canApproveRequests?[...getManagedEmployeeIds_(employee)]:[employee.employeeId];
  const requestSheet=getDb_().getSheetByName('申請');
  const requestRows=requestSheet&&requestSheet.getLastRow()>=2?readRowsByColumnValues_(requestSheet,3,19,requestIds):[];
  requestRows
    .filter(r => canApproveRequests ? r[9] === '承認待ち' : ['承認待ち','差戻し'].includes(r[9]))
    .map(requestRowToObject_)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
    .forEach(r => items.push({
      type: '申請',
      title: canApproveRequests ? (r.name + ' / ' + r.type) : (r.type + ' / ' + r.status),
      subtitle: [r.startDate, r.reason].filter(Boolean).join(' / '),
      route: 'requests'
    }));

  if (employee.role === 'ADMIN') {
    const sheet = getDb_().getSheetByName(AUTH.resetSheet);
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, 9).getDisplayValues()
        .filter(r => r[0] && r[4] === '未対応')
        .slice(-12)
        .reverse()
        .forEach(r => items.push({
          type: 'PIN',
          title: r[3] + ' / PIN再発行依頼',
          subtitle: r[1],
          route: 'admin'
        }));
    }
  }

  const projectItems=[];
  if(typeof projectAdvancedAlerts_==='function'){
    try{projectAdvancedAlerts_(employee,false).forEach(item=>projectItems.push(item));}
    catch(err){if(typeof console!=='undefined'&&console.warn)console.warn('Project alerts unavailable: '+String(err.message||err));}
  }
  // Keep high-priority HR messages, but reserve room for up to eight project alerts.
  const slots=Math.min(projectItems.length,Math.max(8,20-Math.min(items.length,12)));
  const visible=items.slice(0,20-slots).concat(projectItems.slice(0,slots));
  const count=items.length+projectItems.length;
  logPerformance_('getNotifications',perfStarted,1200,{items:count});
  return { count, items: visible, monthlyReview:monthlyReview };
}
