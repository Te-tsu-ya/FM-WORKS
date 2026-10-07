function getNotifications(sessionToken) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  const items = [];
  const today=Utilities.formatDate(new Date(),DB.timeZone,'yyyy-MM-dd');

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

  const annualLeave=getAnnualLeaveFiveDayStatus_(employee,today);
  if(annualLeave.status==='OVERDUE'||(annualLeave.status==='TRACKING'&&annualLeave.remainingDays>0&&annualLeave.daysRemaining<=120)){
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
  const requestScope = canApproveRequests ? 'ALL' : 'SELF';
  getRequests(sessionToken, { scope: requestScope })
    .filter(r => canApproveRequests ? r.status === '承認待ち' : ['承認待ち','差戻し'].includes(r.status))
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

  return { count: items.length, items: items.slice(0, 20) };
}
