function getNotifications(sessionToken) {
  const session = requireSession_(sessionToken);
  const employee = session.employee;
  const items = [];

  const requestScope = employee.role === 'ADMIN' ? 'ALL' : 'SELF';
  getRequests(sessionToken, { scope: requestScope })
    .filter(r => employee.role === 'ADMIN' ? r.status === '承認待ち' : ['承認待ち','差戻し'].includes(r.status))
    .slice(0, 12)
    .forEach(r => items.push({
      type: '申請',
      title: employee.role === 'ADMIN' ? (r.name + ' / ' + r.type) : (r.type + ' / ' + r.status),
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
