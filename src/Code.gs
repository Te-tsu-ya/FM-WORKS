const APP = Object.freeze({
  name: 'FM WORKS',
  version: '0.1.0',
  locale: 'ja-JP'
});

function doGet() {
  const template = HtmlService.createTemplateFromFile('Index');
  template.appName = APP.name;
  template.appVersion = APP.version;

  return template
    .evaluate()
    .setTitle(APP.name)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getInitialData() {
  const now = new Date();
  return {
    app: APP,
    demo: true,
    serverTime: now.toISOString(),
    user: {
      displayName: '坂井さん',
      role: '管理者'
    },
    attendance: {
      state: 'working',
      clockIn: '08:57',
      workLocation: '出社',
      worked: '3時間42分'
    },
    month: {
      workHours: '72時間36分',
      overtime: '8時間12分',
      leaveBalance: '12日'
    },
    tasks: [
      { label: '工数入力', status: '未完了', tone: 'danger' },
      { label: '勤怠の確認', status: '2件', tone: 'warning' },
      { label: '申請の確認', status: '1件', tone: 'info' }
    ]
  };
}

function healthCheck() {
  return {
    ok: true,
    app: APP.name,
    version: APP.version,
    timestamp: new Date().toISOString()
  };
}
