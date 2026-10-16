# FM WORKS 技術設計書

> **2026-10-12 運用変更:** 最初に [`AGENTS.md`](../AGENTS.md) を読む。GitHub Actions・課金枠を使う機能は禁止。検証はGPT環境の `node scripts/run_local_checks.mjs` で行う。以下の過去のCI/自動Deploy記載は履歴であり、再実行・復元しない。GAS公開は認証済み直接操作またはローカルclaspで別途確認する。

**文書版:** 0.25.35
**更新日:** 2026-10-16
**正本:** GitHub `docs/TECHNICAL_DESIGN.md`

## 1. アーキテクチャ

FM WORKSはGoogle Apps Script HTML Serviceを実行基盤とするSPAである。

```
Browser
  ├─ Index.html
  ├─ Styles.html
  ├─ AppCore.html
  ├─ AppOperations.html
  ├─ AppPeopleMonthly.html
  ├─ AppAdmin.html
  └─ AppShell.html
       │ google.script.run
       ▼
Google Apps Script (V8)
  ├─ Code.gs
  ├─ Auth.gs
  ├─ Worklog.gs
  ├─ Requests.gs
  ├─ Monthly.gs / MonthlySnapshot.gs
  ├─ Labor.gs / LeaveLedger.gs
  ├─ Employees.gs / Projects.gs
  ├─ Notifications.gs / Maintenance.gs
  ├─ Holidays.gs / Schema.gs / DataAccess.gs
  └─ Docs.gs
       │
       ▼
Google Sheets: FM WORKS DB
       │
       └─ Google Drive: Backup / Excel Export
```

## 2. リポジトリ

| パス | 責務 |
| --- | --- |
| `src/Index.html` | HTMLシェル、SVG、トップバー |
| `src/Styles.html` | CSS、テーマ、レスポンシブ |
| `src/AppCore.html` | SPA状態、キャッシュ、共通UI、ナビ、ホーム |
| `src/AppOperations.html` | 勤怠、工数、予定、会社カレンダー、申請 |
| `src/AppPeopleMonthly.html` | 社員、月次 |
| `src/AppAdmin.html` | 設定、認証管理、バックアップ、設計文書 |
| `src/AppShell.html` | ページ描画、ログイン、検索、通知、プロフィール、起動 |
| `src/App.html` | 旧モノリス廃止を示す互換スタブ |
| `src/Code.gs` | 定数、初期データ、打刻、予定、会社カレンダー |
| `src/Auth.gs` | PIN、セッション、権限 |
| `src/Worklog.gs` | 工数 |
| `src/Requests.gs` | 申請 |
| `src/Monthly.gs` | 月次、本人確認、締め、出力 |
| `src/Employees.gs` | 社員 |
| `src/Projects.gs` | プロジェクト |
| `src/Notifications.gs` | 通知 |
| `src/Maintenance.gs` | 監査、運用状態、バックアップ |
| `src/Holidays.gs` | 祝日・標準会社カレンダー |
| `src/Docs.gs` | 設計文書API |
| `scripts/generate_docs.mjs` | Markdown→GeneratedDocs.gs |
| `scripts/check_docs_sync.mjs` | 文書同期CI |

## 3. バージョン

`APP.version = 0.25.17`

DBスキーマ: 20。  
認証スキーマ: 3。  
タイムゾーン: `Asia/Tokyo`。

## 4. 主要シート

| シート | 用途 |
| --- | --- |
| 社員マスタ | 人員、権限、有給、認証状態 |
| 打刻ログ | 原始打刻と修正打刻 |
| 日次勤怠 | 旧データ互換スナップショット |
| 工数 | 作業時間 |
| 予定 | 共有予定 |
| 会社カレンダー | 勤務日、休日 |
| 申請 | 休暇、打刻修正等 |
| プロジェクト | 工数選択肢 |
| 月次締め | 月のロック状態 |
| 月次確認 | 本人の前月確認 |
| 監査ログ | 操作証跡 |
| セッション | 認証セッション |
| 設定 | 各種設定 |

## 5. 月次確認シート

`月次確認` は10列。

| 列 | 項目 | 型/例 |
| --- | --- | --- |
| A | 年月 | 2026-09 |
| B | 社員ID | FM0001 |
| C | 氏名 | 架空氏名 |
| D | 状態 | CONFIRMED |
| E | 確認日時 | YYYY-MM-DD HH:mm:ss |
| F | 確認者 | 氏名 |
| G | 確認時最終更新 | timestamp |
| H | メモ | text |
| I | 登録日時 | timestamp |
| J | 更新日時 | timestamp |

主キー相当は `年月 + 社員ID`。

## 6. 月次確認サーバーAPI

### 6.1 `getMonthlyReviewPrompt_(employeeId)`

- 当日を取得。
- `previousYearMonth_` で前月。
- `getMonthlyReviewStatusInternal_` で状態。
- `MONTHLY_REVIEW_DUE_DAY` を参照。
- 未確認またはstaleなら `needsAttention=true`。

### 6.2 `getMonthlyReviewStatus(sessionToken, yearMonth, employeeId)`

- `requireSession_`。
- ADMINのみ他社員IDを指定可能。
- stale判定を返す。

### 6.3 `confirmMonthlyReview(sessionToken, yearMonth, note)`

- 本人のみ。
- 過去月のみ。
- `getMonthlySummary` を再集計。
- `missingPunchDays === 0`。
- `worklogMismatchDays === 0`。
- 行をupsert。
- 監査ログへ `月次勤怠確認`。

## 7. stale判定

`getLatestMonthlyDataUpdateMap_` は対象期間を1回のシート走査で月別に集計する。単月API `getLatestMonthlyDataUpdate_` はこの結果を再利用する。

対象データ:

1. 打刻ログ: `createdAt`
2. 工数: `updatedAt`
3. 申請: `createdAt`, `approvedAt`
4. 会社カレンダー: `updatedAt`

確認日時より新しい更新があれば `stale=true`。

この方式により、確認後の打刻修正、工数変更、休暇承認、会社休日変更を再確認へ戻す。

## 8. 初期表示とホーム概要

### 8.1 高速初期シェル

`getInitialData(sessionToken)` は、ログイン後の最初の画面を早く出すために次だけを返す。

- app
- serverTime
- today
- user
- permissions
- employees
- projects
- attendance
- todaySchedule
- companyToday
- `monthlyReview: null`
- `month: null`
- `tasks: null`
- `overviewReady: false`

初期シェルでは `getMonthlySummary` と `getRequests` を呼ばない。今日の予定取得では `getScheduleBundle(..., includeEmployees:false)` を指定し、社員マスタを二重読込しない。

### 8.2 ホーム概要

`getHomeOverview(sessionToken)` は初期描画後に別通信で取得する。

戻り値:

```
{
  generatedAt,
  monthlyReview,
  month: {
    workHours,
    overtime,
    leaveBalance,
    paidLeaveDays,
    worklogMinutes,
    worklogGapMinutes,
    missingPunchDays
  },
  tasks
}
```

申請の「承認待ち件数」は `getPendingRequestCount_(employee)` でC:J列だけを読み、ホーム表示のために申請14列全件をオブジェクト化しない。

クライアントの `loadHomeOverview` は `pageCache.homeOverview` と `pendingLoads` で重複通信を抑止する。概要取得後は `syncGlobalActionBanner` で月次確認コーションだけを更新でき、別画面を表示中でもページ全体を再描画しない。

強制再取得が既存のホーム概要通信と重なった場合は `state.homeOverview.reloadRequested=true` とし、先行レスポンスを画面へ確定反映せず、直後に再取得する。`callbacks` は最終的に確定したレスポンス後にまとめて実行し、打刻・月次確認直後の古い集計値による上書きを防ぐ。

取得失敗時は `state.homeOverview.error` に復旧可能な状態を保存し、ホームの「やること」カード内に再読込ボタンを表示する。月次指標は `—` にフォールバックし、無限スケルトンを禁止する。


## 9. 通知

`getNotifications` は月次確認を最優先候補として追加する。

通知項目:

```
{
  type: '勤怠確認',
  title,
  subtitle,
  route: 'monthly',
  yearMonth,
  priority
}
```

クライアント `openNotificationItem` は `yearMonth` をstateへ入れて月次へ遷移する。

## 9.1 勤怠ワークスペース v0.10.7

トップナビの勤怠は、内部的に以下の既存ルートを束ねる。

- 本日: `attendance`
- 月間: `monthly` + `state.monthly.view='calendar'`
- 履歴: `monthly` + `state.monthly.view='list'`

`attendanceWorkspaceTabs(activeId)` が3タブを描画する。月次・履歴は既存の `getMonthlySummary` と月次UIを再利用し、別系統の集計ロジックを作らない。

本日画面は初期データの `attendance` と `companyToday` だけで主要操作を即時描画する。二次情報は `state.attendancePreview` に保持し、`loadAttendancePreview()` が当月本人の `getMonthlySummary` を描画後に取得する。

`attendancePreview`:
- key: `YYYY-MM|employeeId`
- TTL: 120秒
- 初回失敗時は本日打刻を止めず、月間領域だけ再読込可能にする
- 打刻成功時はpreviewをstale化し、勤怠画面を表示中なら遅延再取得する

本日画面のDOM構成:

```
attendance-dashboard
├─ attendance-workspace-tabs
├─ attendance-top-grid
│  ├─ attendance-focus-card
│  ├─ attendance-timeline-card
│  └─ attendance-side-stack
│     ├─ attendance-alert-card
│     └─ attendance-today-card
└─ attendance-bottom-grid
   ├─ attendance-calendar-card
   └─ attendance-history-card
```

幅1260px以下は2列、820px以下は1列へ落とし、横スクロールを主要レイアウトに要求しない。履歴表だけは列情報を保持するためパネル内横スクロールを許可する。
## 9.2 勤怠1画面レイアウト / QAサンプル v0.10.8

`renderPage` は `home / attendance` で `.content.one-screen` を付与し、勤怠では追加で `.attendance-one-screen` を付与する。

PC幅1141px以上:
- `.content.attendance-one-screen` をflex columnとし、グローバル警告は固定高、`.attendance-dashboard` が残り高を使用する。
- `.attendance-dashboard` は page-head / workspace tabs / top grid / bottom grid の4段を `minmax(0,...)` で配分する。
- 上段は3カラム、下段は2カラムを維持し、ページ全体のoverflowをhiddenにする。
- 多件数のタイムラインと直近履歴だけカード内部スクロールを許可する。
- 高さ760px以下はcompact ruleで余白、文字、操作高を縮小する。

幅1140px以下:
- `.attendance-one-screen` の固定高を解除し、通常スクロールへ戻す。

表示確認用サンプル:
- `attendanceDisplayPreview()` は実月次データに意味のある行があればそのまま返す。
- 実データが空で `permissions.adminConsole=true` の場合だけ `buildAttendanceSamplePreview()` を返す。
- サンプルはブラウザメモリ上だけで生成し、`google.script.run` やSheetsへの書込を行わない。
- サンプルは正常出社 / 在宅 / 工数差異 / 有給 / 打刻不足を含み、`_sample=true` で識別する。
- サンプル日クリックは `openAttendanceSampleDay` の読み取り専用モーダルへ限定する。月次締め・申請・Excel等へサンプルを渡さない。

## 9.3 可読性モード / 勤務場所変更 v0.10.9

### 文字サイズ
`Index.html` のトップバーに `#fontSizeToggleButton` を配置する。

クライアント:
- `getFontSizeMode()`
- `setFontSizeMode(mode)`
- `toggleFontSize()`
- `initFontSize()`

保存先は `localStorage['fmworks.fontSize']`。HTMLルートへ `data-font-size="standard|large"` を付与する。

標準モードでも勤怠の本文・表・カレンダーをv0.10.8より1段階拡大する。大きめモードでは固定1画面を解除できるCSSとし、可読性を優先する。

### 勤務場所変更
`PUNCH.LOCATION_CHANGE = '勤務場所変更'` を追加するが、時刻打刻として扱う4種とは `TIME_PUNCH_ACTIONS` で分離する。

`recordWorkLocationChange(sessionToken, workLocation)`:
1. `requireSession_`
2. 勤務場所値を検証
3. ScriptLock取得
4. 当日の勤怠状態を取得
5. 状態が working / break のみ許可
6. 打刻ログへ action=勤務場所変更 を追記
7. 監査ログへ before / after を記録
8. 追加後の attendance を返す

勤務場所変更イベントは、勤務状態を変えない。そのため `buildAttendanceStateFromRows_` は「最終行だけで状態を判定」せず、時系列に出勤・休憩・退勤を走査し、LOCATION_CHANGEは状態遷移から除外する。

`validatePunchSequence_` は勤務中・休憩中のLOCATION_CHANGEを許可する。打刻修正申請では `isTimePunchAction_` を使い、LOCATION_CHANGEを修正対象へ含めない。

`summarizeWorkLocations_(rows)` は勤務場所の連続重複を除去し、`出社→在宅` のような日単位要約を返す。月次の `workLocation` にこの要約を使用し、`remote` は従来どおり当日行のいずれかが在宅ならtrueとする。

クライアントの `selectWorkLocation(location)`:
- 勤務外（未出勤）: ローカル選択のみ
- working / break: `recordWorkLocationChange` を呼ぶ
- finished: 変更を拒否

タイムラインではLOCATION_CHANGEを紫系の状態点で表示し、`変更前 → 変更後` を表示する。

## 9.4 工数ハイブリッドUI v0.11.0

工数画面は既存の `getWorklogs / saveWorklog / deleteWorklog` を維持し、クライアントの表示・入力導線を再構成する。

主要クライアント関数:
- `worklogDisplayData()`: 実データまたはADMIN向けQAサンプルを返す
- `worklogTimelineSegments()`: 工数、休憩、未入力区間を時間境界で分割
- `worklogTimelineHtml()`: 縦タイムラインを描画
- `worklogFirstGap()`: 最初の未入力区間をクイック入力初期値へ利用
- `setQuickWorklogRange()`: 未入力区間クリック時に時刻を転記
- `worklogQuickForm()`: 常設入力フォーム
- `saveQuickWorklog()`: 既存 `saveWorklog` APIへ保存
- `worklogTableHtml()`: 当日一覧

当日のタイムライン範囲:
- QAサンプル: 09:00-18:00
- 当日実データ: 出勤時刻から退勤時刻、勤務中なら現在時刻まで
- 過去日: 登録済み工数の最初の開始から最後の終了まで

休憩区間は当日の `attendance.history` の「休憩開始 / 休憩終了」を利用する。休憩以外で工数が存在しない区間を未入力として扱う。

QAサンプルはADMINかつ当日工数0件の場合だけクライアントメモリ上で生成する。`_sample=true` を付け、編集・削除を無効化する。実プロジェクトが0件ならクイック入力の保存も無効化する。 サンプル表示には実在顧客名・実案件名を使用しない。

`renderPage` はworklogで `.one-screen.worklog-one-screen` を付与する。1141px以上ではページ全体を固定し、一覧のみ内部スクロールを許可する。1140px以下は固定高を解除する。

## 9.5 工数の日付切替キャッシュ v0.11.1

従来の `loadWorklogs` は日付切替ごとに `getWorklogs(start=date,end=date)` を呼び出していた。ブラウザ側に短期複数日ウィンドウキャッシュを追加し、サーバーAPIの呼び出し回数を削減する。GAS側の書込処理・権限制御・APIシグネチャは変更しない。

クライアント:
- `worklogWindowRange(date)`: 選択日が属する月曜始まり週の前週月曜日～当週日曜日を返す（14日間、月境界をまたぐ）。
- `worklogWindowCache`: 最大6件の期間キャッシュ（2分TTL）。値はセッション＋社員・期間・取得時刻・レコードを含む。
- `worklogCachedWindow(date)`: 現在セッション・社員に一致する区間から、対象日を含む最新エントリを選択する。
- `worklogShowCachedDay(date,entry)`: 日付でフィルタした工数と分数合計を即時に `state.worklog` へ反映する。工数0件もキャッシュ済みとして扱う。
- `loadWorklogs(options)`: キャッシュが新鮮ならGAS呼出しゼロ。キャッシュ期限後は一旦キャッシュを描画し、背景で最新化する。キャッシュが無い場合のみローディングを表示する。
- `worklogActiveRequest`: GASの期間読込は同時に最大1件とし、連続した日付移動は最後に選択された日付を優先する。完了後に範囲外ならその日付を再取得する。
- `invalidateWorklogWindowCache()`: `invalidatePageCache('worklog')` の経由で実行する。登録/編集/削除の成功後に全キャッシュを破棄し、世代番号によって古いレスポンスの採用を禁止する。
- `state.worklog.loadedDate`: 空データと未取得データを区別し、古い日付の内容を選択先の内容として誤表示しない。
- `state.worklog.error`: 取得失敗時に再読込ボタンを表示する。

画面レイアウトでは工数クイック入力欄だけをスクロール可能にし、PC版の「登録する」ボタンをパネル内の固定領域として常時利用できるようにする。

テスト:
- 14日間の単一リクエストで別の日付データを即時切替
- 0件の日付を含むキャッシュ利用で追加通信なし
- 日付連打中の通信多重送信なし
- 遅れて戻るレスポンスで最新選択日を描画
- 作成/修正/削除後のキャッシュ破棄
- UI再試行とクイック登録の回帰

## 9.6 工数フォーム・日付操作の改善 v0.11.2

- `jumpWorklogDate(date)` を経由して今日/前日/翌日/日付ピッカーの移動を統合。日付変更は既存の14日ウィンドウキャッシュへ接続し、キャッシュ内ではリクエストを発行しない。
- `WORKLOG_QUICK_FIELDS` と `worklogQuickDrafts` (`Map`) を用い、`renderPage` がDOMを差し替える前に `rememberWorklogQuickDraft()`、差し替え後に `restoreWorklogQuickDraft()` を呼ぶ。描画済みの日付は `state.worklog.renderedDate` で保持し、選択日が変更されても元の日付へ紐付ける。
- 一時入力キーは既存の `worklogWindowIdentity()` + 日付。保持数は最大20。localStorage・Apps Script・Sheetsには保存しない。`clearLocalSession()` で一時入力と工数キャッシュを破棄し、進行中取得の参照も解除する。
- `saveQuickWorklog()` は `state.busy` で同時送信を拒否し、保存ボタンを一時無効化する。失敗時は解除、成功時は保存済み日付の一時入力を削除し再取得する。
- `AppShell.renderPage()` は日付ナビゲーションとクイック入力のフォーカスを再描画後も復元する。存在しない選択肢へ古いプロジェクト値を戻さない。
- UI契約試験で日付ジャンプ・一時入力の日付分離/セッション分離・二重送信防止を検証する。ブラウザ実測と多端末目視は別途確認が必要。


## 10. 月次UI

状態:

```
state.monthly = {
  yearMonth: null,
  employeeId: null,
  data: null,
  view: 'calendar',
  loading: false
}
```

関数:

- `monthlyCalendarView`
- `monthlyListView`
- `monthlyReviewPanel`
- `monthlySummaryStrip`
- `openMonthlyDay`
- `confirmMonthlyReviewFromPage`

### 10.1 カレンダー

7列CSS Grid。

セル状態クラス:

- `ok`
- `leave`
- `warning`
- `danger`
- `off`
- `neutral`

クリックで日詳細モーダル。

`monthlyReviewPanel(d)` は本人表示とADMIN表示を分ける。本人には確認完了操作を表示し、ADMINが他社員を表示している場合は本人確認済み / 未確認 / 再確認を読み取り専用で表示する。代理確認ボタンは出さない。

### 10.2 1画面レイアウト

`renderPage` は月次・設定で `.content.one-screen` を付ける。

`.single-screen-layout` はflex column。

- ヘッダ: 固定領域
- ツールバー: 固定領域
- サマリー: 固定領域
- 本体: `flex:1; min-height:0`
- 表 / 文書: 内部スクロール

## 10.3 ホーム1画面ダッシュボード

`renderPage` は `home / monthly / admin` に `.content.one-screen` を付与する。

ホームは `.single-screen-layout.home-screen` の2段構成。

```
home-screen
├─ home-commandbar
│  ├─ greeting / date / company calendar status
│  └─ home-stats (勤務 / 残業 / 有給)
└─ home-dashboard
   ├─ home-attendance-panel
   ├─ home-schedule-panel
   └─ home-task-panel
```

デスクトップ:

- `home-screen`: height 100%, min-height 0
- `home-commandbar`: 固定高相当
- `home-dashboard`: flex余剰高をすべて使用
- 各 `home-panel`: overflow hidden
- `home-panel-scroll`: パネル内部のみoverflow auto
- 画面高760px以下はcompact rulesを適用
- 幅1141〜1180pxは3カラム比率とクイック導線を圧縮

狭いデスクトップ/タブレット/モバイル:

- 幅1140px以下で `:has(>.home-screen)` を使い、ホームの `.content.one-screen` だけ `height:auto / overflow:visible` へ戻す
- `home-dashboard` を1カラム化
- ページ全体の通常スクロールを許可
- パネル内部は必要に応じて最大高を設定

共有予定表の独立カードは「今日の予定」パネルへ、打刻履歴は「現在の勤怠」パネルへ統合し、機能や導線は失わない。




## 10.5 ホーム視認性と横断デザイン監査 v0.11.10

- Styles.html の最後にデスクトップ限定 `@media(min-width:1200px) and (min-height:690px)` を設定。ホームのヘッダー、KPI、カード、打刻操作などを読みやすさを保つ範囲で圧縮。
- `@media(min-width:1200px) and (max-height:689px)` では自然スクロールを維持。文字ズームや予定・タスクの増加を考慮し、content を切らない。
- 変更は `.home-portal-*` の範囲に制限。全画面共通のキーボードフォーカスだけ `:focus-visible` に一貫した outline を追加。
- コードと提供画像による現状のデザインの整合性・残課題は `docs/UI_UX_CONSISTENCY_AUDIT.md` に記録。残る全ページの実機/倍率検証前はUI統一が完了したと表現しない。

## 10.4 ホーム個人ポータル再設計 v0.11.9

- `src/AppHomePortal.html` を独立したクライアント表示モジュールとして追加し、`Index.html` で `AppCore` の直後に読み込む。`homePage()` を差し替えるが、既存の `punchButtons()`、`homeWorkLocationSelector()`、`homePunchHistory()` と予定のイベントID付き遷移を再利用する。
- ヘッダーは現在の勤務状態と時間帯に応じた挨拶、次に4つの月次KPI。月次情報は従来の `getHomeOverview` 1回を再利用する。`Code.gs` は既存の `pendingRequests` 変数を `month.pendingRequests` の数値として返す。管理者は担当チームの承認待ち、一般社員は自分の承認待ちを表示する。
- `homePortalTaskRows()` はサーバーから取得した `tasks` の `tone` を元に危険・注意・その他へ分類し、既存の `worklog`／`attendance`／`requests` のルートへ移動する。危険状態の処理を隠さず、その他をネイティブ `details` に畳む。データがない場合はローディング／再試行、要対応0件なら完了表示。
- `homePortalScheduleRows()` は取得済み `todaySchedule` のみを表示し、0件は登録導線付きの小さい空状態、1件以上は最大4件＋残件数で表示。予定クリックでは `date` と `eventId` を既存 `state.schedule` に渡してから `navigate('schedule')`。
- `Styles.html` の `.home-portal-*` にデザインをスコープ化。高さは自然高、2列の主領域、4列の指標、1010px以下では縦積みと指標2列。HTML上の読み上げ・Tab順も出退勤→要対応→予定→ショートカットとし、CSSだけで別順にしない。ダークテーマと視認性を保証する。
- `loadHomeOverview()` は cache key にセッションを含め、応答時に要求元の `sessionToken` と `data` の同一性を照合。ログイン変更後の遅延した旧レスポンスが管理値を書き戻すことを禁止する。既存 `reloadRequested` と読み込み中の古い値の保持も維持する。
- 打刻/工数/申請の権限判定、実データの保存API、Google Sheets のスキーマは変更しない。描画時の追加 GAS 通信0回を契約試験で確認する。
- 入力・空状態・エラー・スマホのタップ/フォーカスをチェックし、既存 v0.8.4 固定3カラムは過去の構成として残すが本番レンダリングは `AppHomePortal` を正本にする。

## 10.1 予定表月・週・日ハイブリッド v0.11.3

- 変更ファイル：`AppCore.html`（選択日・イベント・モバイルペイン状態）、`AppOperations.html`（ビュー描画と制御）、`AppShell.html`（初期選択日・検索導線・Escape）、`Styles.html`（応答的な2ペイン/タイムボード）、テスト、要件定義。
- データ：既存の `getScheduleBundle(sessionToken,{start,end,employeeId,category,includeEmployees:false})` の認可済み `events/companyDays` のみ使用。保存APIは変更しない。
- `schedule.loadedKey` を `scheduleCacheKey()` と照合。フィルター等が変わる間は以前の結果を表示せずスケルトンか再試行を表示し、成功時だけ最新条件のイベントを表示する。古いレスポンスはキーで破棄する。
- `eventsFor(date)` は取得結果の参照が変わるたびに日別 `Map` を再構築する。
- `selectScheduleDay(date,eventId)` は選択日を保持し、同一月では週/月ビューを変更せず、選択日の詳細を即時再描画する。`eventChip`/一覧/時間軸も詳細ペインで詳細表示に統一。
- `scheduleDetailPanel()` は選択日に含まれる予定の全件、会社カレンダーの公開日区分、選択予定の時間/参加者/場所/メモ、権限に合った編集導線を提供する。
- `scheduleTimeboard` / `scheduleTimelineLayout` は週7列・日社員列に時間軸のカードを配置し、時間重複は同じ時間帯の列に分離する。時間付きの予定が存在しなければ時間トラックを省略し、空状態か終日予定だけを示す。社員6人以上は5人ずつ段を分割。社員フィルター指定時は共同参加者の別レーンを作らない。
- 1320px以下はボトムシート、760px以下は時間軸カードを縦に並べ、月表示は各日の件数・分類色を表示して横スクロールを避ける。
- ボトムシートは選択日の詳細から戻る際に閉じる・背景・Escapeを提供し、表示時とサーバー取得完了後にフォーカスを移動する。ホーム画面の予定導線は対象日・イベントIDを選択状態として渡す。Tabはシート内に保持。
- 会社カレンダーの年次画面、編集権限、予定のセキュリティ判定は既存のサーバー実装を再利用する。
- 試験は `scripts/test_client_contract.mjs` に月選択/予定詳細/フィルター/重複/スマホペイン/エスケープを追加。`scripts/validate.mjs` はUI必須マーカーを検証する。
- 実端末での画面描画、iOS/Android/Windows/Mac、ズーム5〜500%、Apps Script実通信時間の確認は別途実ブラウザで実施する。


## 10.2 スケジュールのクライアントデータ層 v0.11.4

- `scheduleCacheKey()` は表示形式やフィルターではなく対象月の `monthGridRange()` だけに依存させる。4つの表示は同じ全社員・全分類の元データを共有する。
- `SCHEDULE_RETRY_COOLDOWN` は一時的な通信失敗後30秒の再検証間隔を設け、読み込み済みの予定を残したままリクエスト連打を防ぐ。
- 休日ラベルの色は土曜青、日曜・祝日赤に背景とあわせて統一する。
- `scheduleWindowCache` (`Map`) はセッションID + 社員ID + 期間で管理する。保持数6、TTL 180秒。古いデータは即時表示しつつ非同期再検証する（SWR）。
- `getScheduleBundle` は `{start,end,employeeId:'ALL',category:'ALL',includeEmployees:false}` の1回だけ。サーバーの `canViewScheduleRow_` による行単位の閲覧認可を必ず維持する。
- `scheduleFilterEvents(rawEvents,employeeId,category)` は取得済みの認可済みデータだけを絞り込み、`state.schedule.events` に反映する。日別索引 `eventsFor` は表示配列の参照が変わった時だけ再生成。
- `scheduleWindowRequests` は同じ期間の重複通信を抑止し、同時実行は最大2件。切替・日付ジャンプ・キャッシュ再訪時にキャンセル不能な遅延通信が上書きしないよう、セッション同一性・generation・現在キーを検証する。最新要求が待機中なら先行通信終了後に処理する。
- 予定更新・削除、会社カレンダーの更新、セッション破棄時の `invalidatePageCache('schedule')` / `invalidateScheduleWindowCache()` で元データ・表示配列とキャッシュを失効させる。古い応答を無視する。
- `validate.mjs` のUI契約マーカーは、強調状態のクラスを含んだ動的HTMLテンプレートと一致させる。
- 強調状態のCSSでは `position:relative` を共通適用しない。時間軸の `.schedule-timed-event` は `position:absolute` を維持し、強調時も時間座標を守る。静的QAで再発を防ぐ。
- `schedulePeopleLegend()` はネイティブボタンと `aria-pressed` / 操作状態テキストを持つ。 `toggleScheduleEmployeeHighlight()` はDOMクラスを更新するだけで描画処理・API呼び出しを発生させない。
- 月/週/日/一覧の予定行に `data-schedule-employee-ids` を付け、共同参加者を含む参加IDで強調を判定する。
- `Styles.html` の末尾で日セル境界、日曜・土曜・祝日・調整勤務日の背景を強調する。darkテーマと縮小画面にも適用する。
- CIの契約試験で初回認可済み全件取得1回、画面/フィルター変更0回、戻る0回、期間変更1回、編集失効、社員強調0回を検証。実ブラウザでの体感時間は別途計測が必要。

## 11. 管理画面

`state.adminTab`:

- auth
- projects
- operation
- requirements
- technical

`projects` は `projectAdminSection()`、`openProjectModal()`、`saveProjectFromModal()` を使用する。設定画面の再構成時もこの3関数を削除しないこと。

`settingsTabs()` と左ナビのサブメニューを同期。

### 11.1 文書

`loadSystemDocument(type, options)` でADMIN APIを呼ぶ。通常はクライアントキャッシュを利用し、`options.force === true` の場合はキャッシュを無視して再取得する。文書ヘッダーの「再読込」は必ず `force:true` を指定する。

`Docs.gs`:

```
getSystemDocument(sessionToken, documentType)
```

必ず `requireAdminSession_`。

戻り値:

```
{
  type,
  title,
  version,
  updatedAt,
  markdown
}
```

ブラウザ側 `renderMarkdownDoc` で見出し、表、リスト、コードをHTML化する。

## 12. 文書生成

正本:

- `docs/REQUIREMENTS.md`
- `docs/TECHNICAL_DESIGN.md`

`scripts/generate_docs.mjs` が以下を生成。

`src/GeneratedDocs.gs`

```
const GENERATED_DOCS = Object.freeze({
  requirements: {...},
  technical: {...}
});
```

生成物はGit管理しない。

## 13. 文書同期CI

`scripts/check_docs_sync.mjs`:

1. `git diff --name-only HEAD^ HEAD`
2. `src/**` 変更の有無を確認
3. 変更ありなら両文書の変更を必須
4. 不足時 `exit 1`

`validate.mjs` でさらに `APP.version` と両文書の文書版一致を確認。

## 14. GitHub Actions

順序:

```
checkout(fetch-depth: 2)
→ check_docs_sync.mjs
→ generate_docs.mjs
→ validate.mjs
→ test_logic.mjs
→ clasp install
→ credentials restore
→ clasp push --force
→ existing deployment update
```

workflow pathsに `docs/**` を含め、文書だけの変更でもアプリ文書を更新する。

## 15. テーマ

Index.htmlのheadで早期にテーマを決定し、フラッシュを減らす。

優先順位:

1. `localStorage['fmworks.theme']`
2. `prefers-color-scheme`
3. light

`setTheme(theme, animate)`:

- `html[data-theme]` 更新
- `colorScheme` 更新
- localStorage保存
- ボタンARIA更新
- View Transition APIがあれば利用
- CSSグラデーションオーバーレイを約680ms表示

`prefers-reduced-motion` 時は短縮。

## 16. クリック視認性

CSS対象:

- button
- `[role=button]`
- a
- select
- nav
- schedule event
- mini day
- request card
- monthly day
- settings tab
- checkbox/radio label

disabledは `cursor:not-allowed`。

小型操作要素 `.small-button`、申請理由チップ、設定サブメニュー、設定タブは `min-height:28px` とし、24px未満の独立クリック領域を作らない。

`:focus-visible` は青系3pxアウトライン。

ダークテーマでは、管理画面のsmall-button / security-item / readiness-row / maintenance-detail / auth-stateにも個別の暗色面・枠・文字色を指定し、ライト背景の取り残しを防ぐ。


## 16.1 申請ダッシュボード/ガイド付き入力 v0.11.5

- `src/AppOperations.html` の `requestsPage()` は、役割別4指標→クイック申請＋承認/直近状況→本人履歴の順で描画する。APIは引き続き `getRequestsBundle(state.sessionToken)` の1回。
- `requestOverview()` は本人の `own`、承認権限者は `requestPendingTeam()` を使用。取消申請中の部下を対応対象とし、自己承認はUI/サーバー双方で防止する。
- `requestApprovalPanel()` は初期4件、表示数+8件のローカルページングを行い、100件以降も `requestPendingTeam().length` まで進める。APIの追加読込は行わない。
- `requestHistoryPanel()`、`filteredOwnRequests()`、`setRequestHistoryFilter()`、`searchRequestHistory()` は取得済み `state.requests.own` のみをローカル処理し、DOMリストだけを再描画する。検索とステータス変更では通信せず、入力フォーカスも維持する。
- ページの表示状態 `state.requests` は `createEmptyRequestsState()` で初期化。キャッシュキー `requestsIdentity()` はセッショントークン＋社員番号。ログアウト/認証マウントでキャッシュと申請データを消去。非同期応答ではキー/トークンが一致する時だけ代入する。
- ステータス詳細は `openRequestDetail(id,teamMode)` がサーバーから認可済みの `own/team` から取得し、`escapeHtml` で文字列をサニタイズする。申請IDは inline JS引用文字列へ埋めず、data属性＋DOM datasetで渡す。
- 半休区分変更は `openRequestModal(type,currentDate,true)` で初回プレビューを抑制し、値を復元した後 `refreshRequestPreview()` を一度だけ実行する。
- 入力画面 `openRequestModal()` は既存の申請入力項目を維持し、3段ガイドと `updateRequestDraftSummary()` によるブラウザ内確認を追加。半休区分変更時に `reqContent` と `reqReason` と日付を維持する。
- 送信では `state.requests.submitting` で二重リクエストをブロックし、失敗時は解除。ログインユーザーが変わった後の古い成功/失敗応答はUIに適用しない。
- `src/Styles.html` の `.request-dashboard` を起点にCSSをスコープ化。4列KPI/メイン2列/スマホ2列以下で適応、darkテーマにも対応。モーダルは本文領域のみスクロールし、下部の送信ボタンを維持。
- 既存 `submitRequest`/`cancelRequest`/`approveRequest`/`requestApprovedCancellation`/`decideApprovedCancellation` および有給残日数検証・監査を変更しない。権限は引き続きサーバーを正本とする。
- `scripts/test_client_contract.mjs` でステータス/役割切替、履歴ローカル処理、二重送信、ログイン分離、エスケープの動作契約をテストする。CI成功とは別に実端末の画面・操作・読込秒数を確認する。


## 16.2 管理ハイブリッドUI・社員登録ガイド v0.11.6

- `AppAdmin.html`: `ADMIN_CATEGORIES`（6カテゴリ）と `settingsTabs()`（縦メニュー）、`adminOverviewStats()`（認可済み社員から4指標）、`adminWorkspaceShell()`（共通管理シェル）、`setAdminTab()`（既存scopeごとの遅延読込）を導入。社員タブは既存 `people` ルートを使用する。
- `AppPeopleMonthly.html`: `adminPeopleFiltered()`、`adminPeopleRows()` と `adminEmployeeDetail()` を実装。検索/絞り込み/選択/詳細タブをクライアント内で反映し、GAS通信は追加しない。入力値はHTMLエスケープし、社員IDは `data-employee-id` に保持する。
- `AppPeopleMonthly.html`: 追加モーダルは `adminWizardShowStep()` で4段階表示切替。必須社員ID・氏名、メール、権限、承認者、勤務時間、休憩、有給残・基準日を `validateAdminWizardStep()` で検証。最終確認は `adminWizardReviewHtml()` で生成し、保存処理は既存 `saveEmployeeFromModal()` → `performEmployeeSave()` → `saveEmployee` を再利用する。
- `AppCore.html` / `AppShell.html`: `state.adminUi=createAdminUiState()` で検索条件と選択社員、ガイドの進行状態を管理。管理ルートの初期値は `people`。ログアウトおよびログインマウント時に管理データ・ページキャッシュ・UI選択を破棄する。
- `loadAuthAdmin()`: 認可済み `getAuthAdminData(token,scope)` を利用。キャッシュキーを `scope|sessionToken|employeeId` とし、終了応答時に同じIDとトークンであることを確認。認証scopeが新鮮なら社員scopeは既取得社員一覧を再利用。既存の `auth` / `projects` / `people` の分割取得は維持する。
- `Styles.html`：4指標・縦カテゴリメニュー・一覧＋詳細のレスポンシブレイアウト。880px以下ではメニューを折りたたみ、1520px以下では一覧と詳細を縦に配置する。新規登録モーダルは本文だけスクロールし、フッターの保存操作を維持する。
- 危険操作の権限判定、年休台帳処理、管理者昇格や無効化の確認、監査ログは `Employees.gs`、`Auth.gs` 等の既存バックエンドを変更せず使用する。変更時はCIのリポジトリ検証、ロジック試験、クライアント契約試験を再実行する。
- 実運用の画面・認証・ズーム/スマホの端末別目視は自動試験とは別に確認する。

## 16.3 年休自動付与・年5日取得アラート（v0.11.7）

- `leaveDueAtIndex_` と `leaveEntitlement_` は既存 `normalizeDate_` で入社日・判定基準日を検証し、不正日付の場合はそれぞれ空文字・nullを返す。補正した架空日付で付与処理を進めない。`scripts/test_logic.mjs` で2月31日、13月、存在しない判定日、月末とうるう年を検証する。

- 新規サーバーモジュール AnnualLeaveAutomation.gs に付与日計算、社員ごとの標準勤務対象設定、80％出勤率チェック、期限到来時の付与台帳への書き込み、日次ジョブを実装する。
- 社員設定は既存の設定シートに FM_AUTO_LEAVE_V1_ と社員IDを組み合わせたキーでJSON保存。初回有効化日は保持し、それ以前の過去分はさかのぼって自動付与しない。
- 出勤率評価は勤務対象日の会社カレンダーと有効な打刻・承認済み年休を合算。カレンダー欠落、出勤記録不足、未集計のみなし出勤期間があれば法令遵守を勝手に確定せず、管理者確認が必要な状態を返す。
- reconcileLeaveUnlocked_ は既存のGRANT/OPENING・付与基準日と照合して重複を防ぐ。maybeReconcileLeave_ は対象期間で付与が必要なときだけスクリプトロックを使用し、平常時のナビゲーション通信を増やさない。
- 社員編集・申請の承認処理など、既にロックを使っている処理では再帰ロックをかけずreconcileLeaveUnlocked_を呼び出す。
- leaveAutoEarlierMissing_ は現在の法定付与回より以前、かつ自動管理の開始日以降のGRANT/OPENINGが欠けた基準日を照合してREVIEWを返す。古い期間の残数を推測して自動加算しない。
- repairAnnualLeaveMaster_ は自動GRANTが台帳にあるのに社員マスタ11/25列の書込に失敗した状態を次回判定で再同期する。再GRANTせず修復を監査記録する。
- 年休台帳、社員マスタ11列・25列、監査ログの既存スキーマを利用。従来のUSE/RESTORE/OPENING/ADJUST/GRANTは破壊しない。最初の有効化前の初期残数は管理者が確認する。
- 日次ジョブ annualLeaveDailyJob_ は管理者が installAnnualLeaveDailyJob を承認すると午前5時ごろに実行。トリガー実行はApps Scriptの実行時間仕様に従う。
- 前回の年10日以上付与期間の取得未達は previousOverdue として現行年度とは別に返す。翌年度の新GRANTが前年度の警告を消さないようにする。
- 申請コンテキストにfiveDayとautoLeaveを返し、申請画面で取得日数・残り・期限・保留状態を表示。Notifications.gsの通知にも年5日不足・付与保留の注意を追加する。
- 付与履歴不明や会社カレンダー不足により年5日判定ができない場合は Notifications.gs と申請画面で確認メッセージを出す。継続勤務6か月未満の社員は取得義務がまだないため過度な通知を避ける。
- Home概要の残数は、ログイン時の古い社員情報ではなく最新の年休台帳を参照する。社員マスタ変更時の競合検出はexpectedLeaveBalanceによって実施する。
- 2年間の付与ロット別自動失効は実装せず、手動失効を維持する。標準勤務以外の比例付与や、アプリ外の出勤扱いの自動判定は今回対象外とする。
- 受入試験に付与日数と2月末の補正、出勤率境界、基準日重複防止、取得5日通知、UI権限分離、既存回帰を追加する。


## 16.4 架空社員の有給デモ（v0.11.8）

- 新規のクライアントHTMLモジュール AppLeaveDemo.html を Index.html に追加し、管理・申請画面の「動作デモ」から leaveDemoOpen() を呼び出す。Apps Script の新しいサーバーAPIやDBスキーマ変更は行わない。
- 固定基準日 LEAVE_DEMO_AS_OF=2026-10-08、架空4名の LEAVE_DEMO_PEOPLE、独立したブラウザ上の leaveDemoState を使い、本番の state.authAdmin / state.requests / 年休台帳に触れない。
- leaveDemoGrants() は勤続6か月後以降の10/11/12/14/16/18/20日を計算し、説明用に直近の有効付与を可視化。leaveDemoCompute() は確定残、仮引き残、年5日の取得実績と期限を再計算する。
- leaveDemoDayReserved() は対象日の承認済み/承認待ち合計が1日を超えないように入力制限する。デモの再描画では選択中の操作ボタンのフォーカスとモーダルのスクロール位置を保持する。
- leaveDemoClose() はデモ状態を明示的に破棄してモーダルを閉じる。
- leaveDemoApplyRequest()→leaveDemoApprove()／leaveDemoWithdraw()→leaveDemoCancel() は架空イベントのメモリ状態のみを変更する。leaveDemoEditHire() は付与日を再計算し架空の古い取得履歴を消去する。leaveDemoReset() は元の架空シナリオへ戻す。
- resetLeaveDemoSession() はログアウト・認証マウント時にデモ状態を破棄する。新規HTML内に google.script.run / SpreadsheetApp / localStorage / sessionStorage を記述しないことをCI静的検査で強制する。
- Styles.html に .leave-demo-* の専用スタイル、4シナリオボタン、確定残・申請可能の数字カード、5日進捗バー、ダミー台帳、モバイルでの縦積みを追加する。デモラベルを常時表示する。
- scripts/test_client_contract.mjs に付与10/11/20、初期21日−7.5日=13.5日、承認待ち1日、承認・取消・半休・取下げ、期限間近と達成、付与前の申請防止、入社日入力検証、再オープン・ログアウト破棄、実サーバーAPI呼び出し0回の試験を追加する。
- デモ表示は出勤率80％を確認済みと仮定した説明であり、実際の短時間勤務の比例付与、実出勤率、法定付与の確定や本番の2年間の自動失効を代行しない。

## 16.5 全画面UIトークン・ダークロゴ・ホーム1画面密度（v0.12.0）

- `Styles.html` の最後の `<style>` を正規の **FM WORKS Design System v1** とする。ページごとに増えた `font-size` / `border-radius` / `color` は、共通UI用の `--ui-type-*` / `--ui-radius-*` / `--muted` / `--blue` に収束させる。
- `--blue` はライトで `#0969da`、ダークで `#4d9aff`、`--muted` はライト `#60728a`、ダーク `#aebcd0`。テキスト色はW3C WCAG 2.2 AAの通常文字の比率4.5:1を目標とする。カレンダー社員色など意味のある個別色は維持する。
- インラインSVGのFMロゴは既存 `fill=currentColor` を維持し、全モード共通の `--ui-brand-ink` でライト `#111c23`／ダーク `#f5f9ff`。画像データは再生成せず、PC・モバイル・ログインに共通適用する。
- ホームは `@media(min-width:1100px) and (min-height:700px)` の範囲でカラムカードの余白・高さを圧縮し、スクロール可能な100svh枠内に収める。A＋モードと画面が狭い場合は高さ制限を解除して自然スクロールに切り替える。隠したり読み取り不能にする圧縮は行わない。
- `docs/UI_DESIGN_SYSTEM.md` を全画面共通のデザイン契約とする。CIでトークン、ダークロゴ、ホームの1画面条件、専用モジュールとCSSの組み込みを検証する。

## 16.6 事務・経理の基本ナビゲーション（v0.12.0）

- `Code.gs/getPermissions_(employee)` に `officeWorkspace` を追加。 `ADMIN`・`MANAGER`・部署名に総務を含む利用者へ「事務」画面の閲覧権を付与する。金銭情報のサーバーAPI権限には利用しない。
- `AppCore.html` の `NAV` に `office` を追加し、`visibleNav()` と `navigate()` で権限を確認する。`MOBILE_NAV` は日常業務の5タブを維持し、事務はモバイルドロワーに表示。`AppShell.html` の `renderPage()` とログインマウントで `officePage` を接続し、`state.officeUi.selected` を切り替える。ログイン切替時は初期化。
- `Index.html` に `i-briefcase` SVGアイコンと `AppOffice` スクリプトを読み込む。
- `AppOffice.html` は `OFFICE_MODULES`（帳票・領収書・経費申請・出張履歴・備品・取引先）の名称・説明・項目一覧だけを宣言する。クリック時の `selectOfficeModule()` はブラウザだけの状態変更。`officePage()` は許可された利用者だけを表示。
- 完了していない保存・発行・承認・証憑アップロードをUIで押せる形にしない。本番Sheets、監査ログ、スタッフの個人情報、金額を読み込むコードは一切追加しない。
- 参照元4つのExcelのシート・列は `docs/OFFICE_SOURCE_MAPPING.md` に個人名・金額を除外して整理済み。将来の要件決定時に詳細を確定する。
- テストは権限の役割差、officeモジュール6件の切替、レンダリング時のAPI呼び出し0、初期化、共通メニュー連携、ページ欠落なし、CSSの可読性を追加する。

## 17. クライアントキャッシュ

`pageCache` TTL:

| 対象 | TTL |
| --- | ---: |
| homeOverview | 45秒 |
| worklog | 90秒 |
| schedule | 90秒 |
| requests | 90秒 |
| monthly | 120秒 |
| company | 300秒 |
| authAdmin | 120秒 |
| maintenance | 60秒 |
| documents | 600秒 |

`pendingLoads` で同一キーの重複通信を抑止。

`startMenuPrefetch` は初回描画とホーム概要通信を優先するため、予定表950ms、工数1350ms、申請1800ms、月次2300ms、会社カレンダー2800ms、ADMIN情報3400msを目安に段階実行する。通知は約900ms、自動バックアップ確認は約1800ms以降に遅延する。

## 17.1 ライブ勤怠表示とキーボード操作

`recordPunch` は `attendance` と同時に `serverTime` を返す。

クライアントの `liveWorkedMinutes(attendance)` は、サーバーが返した `workedMinutes` を基準値とし、状態が `working` の場合だけ `Date.now() - state.data.serverTime` の経過分を加算する。休憩中・退勤済みは加算しない。

`startLiveAttendanceTicker()` は30秒間隔で、表示中ページがホームまたは勤怠かつ勤務中の場合だけ再描画する。タブが非表示のときは再描画しない。

`initGlobalKeyboardShortcuts()` は1回だけdocumentへ登録する。

- `Escape`: モーダルを最優先で閉じ、その後検索結果・通知・プロフィール・モバイルドロワーを閉じる。
- `/`: input / textarea / select / contentEditable以外からデスクトップ検索へフォーカス。
- ナビ移動後は `main#content` へフォーカスし、キーボード/支援技術の現在位置を明確にする。

## 18. 認証

### PIN

- Salt: 社員別
- Pepper: Script Properties
- HMAC-SHA256
- 平文禁止

### Session

- 生tokenはクライアント
- DBはhash
- absolute/idle expiry
- remembered login対応

## 19. 権限

- 一般API: `requireSession_`
- ADMIN API: `requireAdminSession_`
- 会社カレンダー:編集ロール再確認

UI非表示だけで権限を守らない。

## 20. エラー

`handleApiError`:

- AUTH_REQUIRED / SESSION_EXPIRED → ログイン
- その他 → safe message

入力フォームは可能な限りインライン。

申請画面は `requestFormError` を使い、該当欄へフォーカス。

## 21. パフォーマンス

Apps Scriptの原則:

- ログイン後のFirst Paintを月次集計・申請全件読込でブロックしない。
- `getInitialData` は高速シェル、`getHomeOverview` は重い集計、という2段階に分離する。
- 今日の予定取得と社員マスタ取得の重複を避ける。
- ホームの承認待ち件数は専用の軽量カウントを使う。
- 管理画面は表示中タブに不要な保守APIを呼ばない。
- 通知・バックアップ確認は初回描画後に段階実行する。
- 全画面の一括先読みは行わず、予定表・工数・申請は利用意図ベース、勤怠の月間プレビューは本日画面描画後のアイドル時間に取得する。
- Sheets呼び出しを減らす。
- 範囲を一括read。
- JS配列で加工。
- 一括write。
- UIから細かい `google.script.run` を連打しない。
- キャッシュ済み画面を先に表示。

## 22. 月次締め

`月次締め` シートに状態を保存。

締め時:

- ADMIN
- 過去月
- 給与対象存在
- 要確認0
- 工数差異0
- 承認待ち0

解除時は理由必須。

工数・申請側は `assertMonthOpenForDate_` / `assertMonthRangeOpen_` でロックを実施。

## 23. 監査

主要operation:

- ログイン
- PIN
- 打刻
- 申請
- 承認
- 工数
- 月次確認
- 月次締め
- 社員変更
- バックアップ
- 本番切替

## 24. バックアップ

- DriveへDBコピー。
- 90日保持。
- Script Propertiesに最終バックアップ。
- 管理者利用時に日次確認。
- 手動作成可能。

## 25. テスト

`scripts/test_logic.mjs`:

- 勤務時間
- 日付境界
- 打刻遷移
- 有給推論
- Formula injection
- Timestamp parsing
- Prototype PIN
- 休憩閾値
- 年月
- 前月算出
- 月次確認期限トーン
- 設定画面のプロジェクト管理関数の存在
- 文書再読込のforce指定
- ADMINによる他社員の月次確認状態表示
- 初期シェルから重い月次/申請読込が除外されていること
- ホーム概要API・段階先読み・管理保守APIの遅延条件
- ホーム概要失敗時のインライン再読込
- ライブ実働時間のserverTime基準更新
- Escape / 検索ショートカット / ナビ後フォーカス
- ホームの1画面レイアウト / 760px compact / 1140px narrow-screen fallback
- ホーム統合後も打刻履歴・予定表・工数・申請・月次の導線を保持

`scripts/validate.mjs`:

- 必須ファイル
- JS構文
- 認証境界
- 文書版
- 月次確認マーカー
- テーマ
- クリック視認性
- パフォーマンス
- 本番安全ゲート

## 26. 再実装手順

1. シートを本書どおり作成。
2. 認証・Sessionを実装。
3. 打刻・工数・申請を実装。
4. 会社カレンダー・予定を実装。
5. 月次集計を実装。
6. 月次確認とstale判定を実装。
7. 月次締めを実装。
8. SPAとキャッシュを実装。
9. 設定・設計文書ビューを実装。
10. テーマ・アクセシビリティを実装。
11. CI文書同期を実装。
12. 回帰テスト後に既存Web Appを更新。


## 27. DB完全スキーマ

以下の列順は実装上の契約である。Apps Scriptは列番号で読み書きする箇所があるため、列追加時は既存列の途中へ挿入せず、原則として末尾追加とする。

### 27.1 社員マスタ

| 列 | 項目 | 用途 |
| --- | --- | --- |
| A | 社員ID | `FM0001` 形式、一意 |
| B | 氏名 | 正式表示名 |
| C | 表示名 | UI短縮名 |
| D | 部署 | 組織表示 |
| E | 役職 | 組織表示 |
| F | 権限 | USER / CALENDAR_EDITOR / ADMIN |
| G | 在籍状況 | 在籍 / 退職 |
| H | 標準勤務開始 | HH:mm |
| I | 標準勤務終了 | HH:mm |
| J | 標準休憩分 | number |
| K | 有給残日数 | 0.25日単位、空欄=未設定 |
| L | メール | 任意 |
| M | 備考 | 任意 |
| N | PINソルト | 認証内部 |
| O | PINハッシュ | 認証内部 |
| P | PIN変更必須 | TRUE/FALSE |
| Q | ログイン失敗回数 | number |
| R | ロック期限 | timestamp |
| S | 最終ログイン日時 | timestamp |
| T | PIN更新日時 | timestamp |
| U | 認証状態 | ACTIVE / DISABLED |
| V | 権限詳細 | 拡張用 |
| W | 給与集計対象 | TRUE/FALSE |

### 27.2 打刻ログ

| 列 | 項目 |
| --- | --- |
| A | 打刻ID |
| B | 社員ID |
| C | 氏名 |
| D | 日付 |
| E | 種別 |
| F | 打刻日時 |
| G | 勤務場所 |
| H | 入力元 |
| I | 修正済 |
| J | 元打刻ID |
| K | 備考 |
| L | 登録日時 |

有効打刻判定は修正レコードの元打刻IDを用い、置換済み元レコードを集計から除外する。

### 27.3 日次勤怠

旧運用データ互換用スナップショット。

`日付 / 社員ID / 氏名 / 出勤 / 退勤 / 休憩分 / 実働分 / 残業分 / 休日出勤分 / 勤務場所 / 欠勤 / 遅刻早退分 / 在宅 / 有給 / 確定状況 / 備考`

新しい打刻が存在する日は打刻ログを優先し、日次勤怠はフォールバックとして扱う。

### 27.4 工数

`工数ID / 日付 / 社員ID / 氏名 / プロジェクト / 作業分類 / 作業内容 / 開始 / 終了 / 工数分 / 備考 / 登録日時 / 状態 / 削除日時 / 更新日時`

状態 `削除` はソフトデリートであり、物理行削除は禁止する。

### 27.5 申請

`申請ID / 申請日 / 社員ID / 氏名 / 申請種別 / 対象日開始 / 対象日終了 / 申請内容 / 理由 / ステータス / 承認者 / 承認日時 / 差戻し理由 / 登録日時`

ステータス: `承認待ち / 承認済 / 差戻し / 取消`。

打刻修正の申請内容はJSONを格納する。

```json
{
  "originalPunchId": "P-...",
  "action": "退勤",
  "time": "18:05",
  "workLocation": "出社"
}
```

### 27.6 会社カレンダー

`日付 / 区分 / 名称 / 標準勤務開始 / 標準勤務終了 / 休憩分 / 勤務日フラグ / 備考 / 更新者 / 更新日時`

区分: `通常勤務 / 法定祝日 / 会社休日 / 調整出勤日 / 週末`。

### 27.7 監査ログ

`監査ID / 日時 / 社員ID / 氏名 / 操作 / 対象 / 対象ID / 変更前 / 変更後 / 入力元 / 結果 / 備考`

主要な書込操作は成功・失敗を問わず可能な範囲で監査対象とする。

### 27.8 設定

`キー / 値 / 説明 / 更新日時`

主要キー:

| キー | 既定 |
| --- | --- |
| TIMEZONE | Asia/Tokyo |
| DB_VERSION | 4 |
| AUTH_VERSION | 3 |
| SESSION_HOURS | 12 |
| SESSION_IDLE_MINUTES | 120 |
| MAX_LOGIN_FAILURES | 5 |
| LOCK_MINUTES | 15 |
| PIN_LENGTH | 6 |
| PROTOTYPE_MODE | TRUE（試作時のみ） |
| REMEMBER_SESSION_DAYS | 30 |
| REMEMBER_IDLE_DAYS | 30 |
| MONTHLY_REVIEW_DUE_DAY | 5 |
| MONTHLY_REVIEW_START_MONTH | 2026-09（現行導入開始月） |

### 27.9 予定

`予定ID / 日付 / 開始 / 終了 / 終日 / 参加者ID / 参加者名 / タイトル / カテゴリ / 場所 / 詳細 / 公開範囲 / ステータス / 登録者 / 登録日時 / 更新日時 / 元データ / 色キー`

参加者ID/名は複数人を保持する。表示時は社員マスタと突合し、名前をカードへ直接表示する。

### 27.10 セッション

`セッションID / トークンハッシュ / 社員ID / 作成日時 / 絶対有効期限 / アイドル有効期限 / 最終利用日時 / 状態 / クライアント情報 / ログアウト日時 / ログイン保持`

状態: `ACTIVE / REVOKED / EXPIRED` 相当。

### 27.11 PIN再発行

`依頼ID / 依頼日時 / 社員ID / 氏名 / ステータス / メモ / 対応者 / 対応日時 / 入力元`

### 27.12 プロジェクト

`プロジェクトID / プロジェクト名 / 顧客表示名 / ステータス / 開始日 / 終了日 / 備考 / 更新者 / 更新日時`

ステータス: `進行中 / 停止 / 完了`。

### 27.13 月次締め

`年月 / 状態 / 締め日時 / 締め者 / 再開日時 / 再開者 / 備考 / 更新日時`

状態: `OPEN / CLOSED`。

### 27.14 月次確認

`年月 / 社員ID / 氏名 / 状態 / 確認日時 / 確認者 / 確認時最終更新 / メモ / 登録日時 / 更新日時`

主キー相当: `年月 + 社員ID`。

## 28. 公開API契約

代表的なクライアント呼出しを以下に固定する。すべて戻り値はJSON化可能なプレーンオブジェクトとする。

| API | 認証 | 入力 | 主な戻り値 |
| --- | --- | --- | --- |
| `getPublicAuthConfig()` | 不要 | なし | ログイン公開設定 |
| `login(...)` | 不要 | 社員ID, PIN, clientInfo, remember | sessionToken, user |
| `resumeSession(token)` | token | token | user, mustChangePin |
| `getInitialData(token)` | Session | token | 共通初期データ |
| `recordPunch(token, action, location)` | Session | 打刻種別,場所 | 最新attendance |
| `getScheduleBundle(token, params)` | Session | 範囲,社員,カテゴリ | events, companyDays, employees |
| `saveSchedule(token,payload)` | Session | 予定 | ok,id |
| `getCompanyCalendar(token,year)` | Session | 年 | 年カレンダー |
| `saveCompanyCalendarDay(token,payload)` | 編集権限 | 日付設定 | ok |
| `getWorklogs(token,params)` | Session | 範囲,社員 | items,totalMinutes |
| `saveWorklog(token,payload)` | Session | 工数 | ok,id |
| `getRequestsBundle(token)` | Session | なし | own,team,context |
| `submitRequest(token,payload)` | Session | 申請 | ok,id |
| `approveRequest(token,id,decision,comment)` | Session + 承認範囲 | 申請ID | ok |
| `getMonthlySummary(token,ym,employeeId)` | Session | 年月,社員 | daily,totals,reviewStatus,closeStatus |
| `confirmMonthlyReview(token,ym,note)` | Session | 年月 | reviewStatus |
| `closeMonthlyPeriod(token,ym)` | ADMIN | 年月 | closeStatus |
| `getAuthAdminData(token)` | ADMIN | なし | employees,resetRequests,support |
| `getSystemStatus(token)` | ADMIN | なし | readiness,backup,sheets |
| `getLeaveLedger(token,employeeId)` | ADMIN | 社員ID | state,rows,fiveDay |
| `postLeaveLedgerEntry(token,employeeId,type,days,date,note)` | ADMIN | 年休台帳更新 | ok,balance |
| `getSystemDocument(token,type)` | ADMIN | requirements/technical | markdown,version |

新しい公開関数を追加する場合、`scripts/validate.mjs` の認証境界検査を通すこと。

## 29. 主要シーケンス

### 29.1 月初確認

```
login / resume
  → getInitialData
    → getMonthlyReviewPrompt_
      → yearMonthsBetween_
      → getMonthlyReviewHistoryInternal_
      → getLatestMonthlyDataUpdateMap_
  → globalActionBanners
  → user clicks review
  → getMonthlySummary(previous month)
  → user inspects calendar
  → confirmMonthlyReview
  → 月次確認 upsert
  → 監査ログ append
  → getInitialData refresh
  → 未確認月が残る場合は次の最古月をalert
  → 全対象月完了でalert disappears
```

### 29.2 打刻修正

```
Monthly day detail
  → openRequestModal('打刻修正', date)
  → getPunchesForDate
  → submitRequest
  → ADMIN approveRequest
  → preparePunchCorrection_
  → validatePunchSequence_
  → applyApprovedPunchCorrection_
  → new punch record + originalPunchId
  → 月次確認 stale判定
```

### 29.3 月次締め

```
ADMIN closeMonthlyPeriod
  → payroll employees
  → getMonthlySummary each
  → missing punch = 0
  → worklog mismatch = 0
  → pending requests = 0
  → 月次締め CLOSED
  → audit log
  → worklog/request mutations blocked
```

## 30. UIルートと読み込み

| route | サーバー読込 | キャッシュ |
| --- | --- | --- |
| home | getInitialData内 | 初期データ |
| attendance | getInitialData内 | 初期データ |
| worklog | getWorklogs | 90秒 |
| schedule | getScheduleBundle | 90秒 |
| companyCalendar | getCompanyCalendar | 300秒 |
| requests | getRequestsBundle | 90秒 |
| people | getAuthAdminData(ADMIN時) | 120秒 |
| monthly | getMonthlySummary | 120秒 |
| admin/auth | getAuthAdminData | 120秒 |
| admin/operation | getSystemStatus + getAuditLogs | 60秒 |
| admin/requirements | getSystemDocument | 600秒 |
| admin/technical | getSystemDocument | 600秒 |

ログイン後の `startMenuPrefetch` はユーザーの操作をブロックしないよう遅延実行する。

## 31. 変更時チェックリスト

ソースを変更するエンジニアは最低限以下を実施する。

1. 変更する業務要件を `docs/REQUIREMENTS.md` へ反映。
2. データ構造/API/UI/シーケンスを `docs/TECHNICAL_DESIGN.md` へ反映。
3. 必要なロジックテストを追加。
4. 必要な静的回帰マーカーを `scripts/validate.mjs` へ追加。
5. 既存認証境界を確認。
6. DB列を追加する場合は末尾追加を優先。
7. UI変更はPC/モバイル、ライト/ダーク、エラー/空/読込状態を確認。
8. GitHub ActionsのCIとDeployが両方成功してから完了扱いとする。


## 32. 承認認可モデル

社員マスタの追加列:

| 列 | 項目 | 内容 |
| --- | --- | --- |
| X | 直属承認者ID | MANAGER / ADMINの社員ID。空欄可 |

`canManageEmployeeRecord_(viewer, target)` を認可の単一ルールとする。

- 同一社員ID: false
- ADMIN: true（他社員）
- MANAGER: `target.managerId === viewer.employeeId`
- その他: false

`approveRequest` は `requireAdminSession_` ではなく `requireSession_` + `assertCanApproveRequest_` で申請単位の認可を行う。

`getRequestsBundle` / `getRequests` は `getManagedEmployeeIds_` で可視範囲を限定する。

`getMonthlySummary` / `getMonthlyReviewStatus` も同じ管理範囲をサーバー側で検証する。

UIでは `monthlyTeamView` と `adminConsole` を分離する。MANAGERは直属部下の月次閲覧のみ、締め・給与一括出力・社員設定はADMINのみ。


## 33. 月次確定スナップショット

DB:

- `月次確定`: 1 snapshot × 1 employee = 1 row、19列
- `月次確定日次`: 1 snapshot × 1 employee × 1 date = 1 row、19列
- `月次締め.I`: スナップショットID

`closeMonthlyPeriod` は全blocker確認後に `persistMonthlyCloseSnapshots_` を実行し、そのIDを月次締めへ保存してからCLOSEDにする。

`monthlySnapshotHash_` は、月次合計と日次事実を正規化した `monthlySnapshotPayload_` のJSONへSHA-256を適用する。

`getMonthlySummaryForExport_` は締め済みなら再集計せず、月次確定/日次確定から復元する。

`createTeamMonthlyExport` は月次締め済み + snapshotId必須。現在のSheets値を再計算して給与提出データに使用しない。

締め解除は過去スナップショットを削除しない。再締め時は新しいIDを発行するため、履歴比較と監査が可能。


## 34. 有給台帳

`有給台帳` 13列を追加する。

`getLeaveLedgerState_` は台帳があれば最終残高を正本として返し、未移行社員だけ社員マスタの既存残数へフォールバックする。

初回のUSE/RESTORE/ADJUST前に `ensureLeaveLedgerOpening_` がOPENING行を作る。

`consumeLeaveBalance_` / `restoreLeaveBalance_` はScript Lock内で台帳追記と社員マスタK列キャッシュ更新を行う。

社員マスタ追加列:

- X: 直属承認者ID
- Y: 年休基準日
- Z: 雇入日

申請追加列:

- O: 取消理由
- P: 取消申請日時
- Q: 取消判断理由
- R: 取消判断者
- S: 取消判断日時

取消フロー:

```
承認済
  -> requestApprovedCancellation
  -> 取消申請中
  -> decideApprovedCancellation(APPROVE) -> 取消済
  -> decideApprovedCancellation(REJECT)  -> 承認済
```

有給系の取消承認ではRESTOREを台帳へ記録する。打刻修正は補償処理の複雑性から直接取消対象外とし、新規打刻修正で訂正する。


### 34.1 Export entrypoint authentication

`createMonthlyExport` は公開API入口で `requireSession_` を実行し、その後 `getMonthlySummaryForExport_` へ委譲する。


## 35. Schedule Visibility Authorization

`canViewScheduleRow_` を共通認可関数とし、L列visibilityを `社内 / 参加者のみ / 管理者のみ` として解釈する。`getScheduleBundle` と `searchApp` は非公開予定をレスポンスから除外する。`normalizeScheduleVisibility_` は非ADMINによる管理者限定予定の作成を拒否する。


## 36. Runtime Environment Boundary

`normalizeRuntimeEnvironment_` は許可値を DEVELOPMENT / STAGING / PRODUCTION に限定する。

`getRuntimeEnvironment_` はScript Propertiesの `FM_WORKS_ENVIRONMENT` を読む。

`getDatabaseSpreadsheetId_`:
- DEVELOPMENT/STAGING: `FM_WORKS_DB_ID` があれば使用し、なければ既定STAGING DBへフォールバック。
- PRODUCTION: `FM_WORKS_DB_ID` 必須。
- PRODUCTION: 既定STAGING DBと同一IDを拒否。

`getRuntimeInfo_` をSystem Statusへ返し、管理者が環境を常時確認できる。Production ReadinessはPRODUCTION以外をblockerとする。


## 37. Scheduled Backup Trigger

`MAINTENANCE.backupTriggerHandler = scheduledDailyMaintenance_`。

`installDailyBackupTrigger_` は同名Triggerを削除して1件だけ作成し、Asia/Tokyoの03時台に日次実行する。

`scheduledDailyMaintenance_`:
1. AUTO_BACKUP設定確認
2. 当日バックアップ済み判定
3. Script Lock取得
4. 再判定
5. 原本Spreadsheetのシート形状を取得
6. DriveへDB copy
7. コピーを再オープンし、全シート名・最終行・最終列を原本と照合
8. 検証成功後のみ最終成功時刻/verified=trueを保存
9. 監査ログ
10. 90日超Backup cleanup

公開UIから呼べる `installDailyBackupTrigger(sessionToken)` はADMIN認証必須。Trigger handler自体は末尾underscoreのprivate functionとし、client APIとして公開しない。


## 38. 労務ルールエンジン

`Labor.gs` に法定区分計算を分離する。純粋関数 `dailyStatutoryOvertimeMinutes_`、`lateNightOverlapMinutes_`、`laborWeekKey_`、`applyWeeklyStatutoryOvertimeToFacts_` をロジックテスト対象とする。

設定は `LABOR_RULE_PROFILE`、`LABOR_WEEK_START_DAY`、`LABOR_STATUTORY_HOLIDAY_SOURCE`、確認者・確認日時・メモを保持する。

`getMonthlySummary` は各日の深夜実働を算出後、`applyLaborModelToMonthlyDaily_` で法定日次/週次時間外、法定休日労働を付与する。週次計算は月初・月末の週について `laborBoundaryFacts_` で月外日を補う。

月次確定/日次確定は24列へ拡張し、法定時間外、深夜、法定休日、労務ルール状態を締め時点で固定する。

`getProductionReadiness_` と `closeMonthlyPeriod` は労務ルール未確定をブロッカーとする。加えて今後90日の会社カレンダーに明示的な `法定休日` が1日もない場合は本番READYを拒否する。標準カレンダー生成は法定休日を推測しない。給与額や割増賃金額は本エンジンで算出しない。


## 39. 構造化監査ログ

`auditJson_` は監査対象の業務状態をJSON化し、Spreadsheet式注入を防止した上で最大4000文字へ正規化する。

予定・工数・プロジェクト・社員の更新では、更新前の行から業務フィールドを抽出して `before` に保存し、書込後の業務状態を `after` に保存する。

社員のPINソルト、PINハッシュ、セッショントークン等は監査状態JSONへ含めない。申請承認/取消、月次締め等の状態遷移は既存の明示的before/afterを継続する。


## 40. Schema Contract / Migration

`Schema.gs` に `DB_SCHEMA_VERSION=10` と `DB_SCHEMA_SPECS` を保持する。

`getDatabaseSchemaStatus_` は設定のDB_VERSIONと、進化対象シートの1行目ヘッダを比較する。`schemaHeaderIssues_` は純粋関数としてロジックテストする。

`migrateDatabaseToCurrent` はADMIN専用、Script Lock内で実行し、変更前に `createDatabaseBackup_` を実行する。`ensureSchemaSheet_` は欠けた列/シートを追加するが、既存の非空欄ヘッダが契約と異なる場合は破壊的上書きを行わず例外停止する。

`getProductionReadiness_` はSchema Contract不一致をblockerにする。


### 40.1 Validation hardening

`validate.mjs` は新設した `Labor.gs` / `Schema.gs` / `LeaveLedger.gs` / `MonthlySnapshot.gs` をrequired fileおよびJavaScript構文検査対象に含める。管理画面のSchema状態検査は `Maintenance.gs` の実ソースを明示的に読み込んで検証する。


## 41. Date-scoped Data Access

`DataAccess.gs` に `dateRangeStrings_`、`dateRangeRegex_`、`contiguousRowBlocks_`、`readRowsByDateRange_`、`logPerformance_` を配置する。

補正データは古い日付でも末尾へ追記され得るため、単純な先頭/末尾行推定ではなく日付列TextFinderを使う。該当行が48ブロック以下ならRangeListで必要行だけ取得し、それ以上はfull-scan fallbackとする。

適用先:
- `getActivePunchRows_`
- `getCompanyCalendarRange_`
- `getWorklogs`
- `getLatestMonthlyDataUpdateMap_` の打刻/工数/会社カレンダー
- `getMonthlySummary` の工数

Performance Budget超過は処理失敗にせずJSON logで観測する。


## 42. Production Authentication Fail-Closed

`Auth.gs` は試作モードを「設定状態」と「実効状態」に分離する。

- `prototypeSettingEnabled_`: 設定値 TRUE/FALSE/ON/OFF を正規化する。
- `isPrototypeConfigured_`: DB上で試作モードが設定されているかを返す。
- `prototypeModeEnabledForEnvironment_`: PRODUCTIONなら必ずfalseを返す。
- `isPrototypeMode_`: 実際に共通PIN認証を許可してよいかを返す。

`getPublicAuthConfig` は共通PIN値を返さない。クライアントもPIN値を表示しない。ログイン入力欄にも共通PINを自動入力しない。

`Maintenance.getProductionReadiness_` は `isPrototypeConfigured_` を使うため、PRODUCTIONで共通PINが実効無効になっていても、設定 `PROTOTYPE_MODE=TRUE` が残る限りREADYを拒否する。これにより「安全にログインできること」と「本番設定が正しいこと」を別々に保証する。

CIでは `validate.mjs` が以下を検査する。

1. 試作モード既定値がfalse。
2. PRODUCTION強制無効化ロジックが存在する。
3. 共通PINを公開設定APIや画面へ流していない。
4. Readinessが設定状態と実効状態を分離している。

`test_logic.mjs` は STAGING / PRODUCTION / OFF の境界条件を純粋関数で検証する。


## 43. Client Module Boundaries v0.10.1

旧 `App.html` 1700行超のクライアント実装を、機能境界に沿った5つのHTML Scriptモジュールへ分割した。

読み込み順:
1. AppCore
2. AppOperations
3. AppPeopleMonthly
4. AppAdmin
5. AppShell

関数宣言は同一ブラウザGlobal Environment上で相互参照する。起動イベント `DOMContentLoaded -> bootstrap` は最後の `AppShell` のみに置き、全モジュールが読み込まれてから実行される。

CIの `validate.mjs` はモジュールを読み込み順に連結して構文検査し、従来のUI契約マーカーも連結ソースへ対して検査する。これによりファイル分割そのものによる機能欠落を検知する。


## 44. Usability / Accessibility Hardening v0.10.2

### 44.1 Live attendance DOM update

`AppCore.updateLiveWorkedNodes` は `[data-live-worked]` のtextContentだけを更新する。30秒タイマーは`renderPage`を呼ばず、DOM全置換によるスクロール・フォーカス喪失を防ぐ。

### 44.2 Modal focus boundary

`AppOperations` に以下を配置する。

- `modalFocusables_`
- `activateModalA11y_`
- `trapModalFocus_`
- focus restore付き `ensureModal / closeModal`

`AppShell.initGlobalKeyboardShortcuts` はTabキーを`trapModalFocus_`へ渡す。Escapeの既存クローズ動作は維持する。

### 44.3 Schedule keyboard semantics

月表示の各セルは背景クリックを維持しつつ、日番号をネイティブbutton `.day-open` として提供する。日表示の予定詳細行 `.agenda-item` はarticle+onclickからbuttonへ変更する。

### 44.4 Readable density / scroll planes

CSSのpx指定font-sizeは11px未満を禁止する。CIが正規表現で検査する。

`content.one-screen` はホームと勤怠「本日」へ適用する。管理・月次の外側スクロールを復活させ、設定コンテンツと年間カレンダーの固定高内部スクロールを解除する。ホーム内部の打刻履歴・予定など、明示的な長一覧は内部スクロールを許可する。

### 44.5 Session garbage collection

`createSession_` からGCを除去する。

`sessionRowsToDelete_` が削除対象のシート行番号を計算し、`cleanupExpiredSessions_` は `contiguousRowBlocks_` で連続行を束ね、下側ブロックから `deleteRows(start,count)` を実行する。

`scheduledDailyMaintenance_` がバックアップ判定より先にセッションGCを実行するため、バックアップ無効時でもGCは継続する。

### 44.6 Regression gate

`validate.mjs` は以下を検査する。

- 11px未満のfont-size禁止
- live timerの部分DOM更新
- one-screen対象がhomeのみ
- modal focus trap
- schedule keyboard control
- login pathからGC除去
- scheduled maintenanceへのGC移行

`test_logic.mjs` は期限切れ/無効セッション行の抽出を純粋ロジックで検証する。


## 45. General-JP Labor Period Monitoring v0.10.3

`Labor.gs` の `LABOR_GENERAL_JP` に以下の一般則監視定数を保持する。

- annualOvertimePrincipleMinutes = 21,600（360h）
- specialAnnualOvertimeLimitMinutes = 43,200（720h）
- specialSingleMonthOvertimeHolidayLimitMinutes = 6,000（100h）
- specialMultiMonthAverageLimitMinutes = 4,800（80h）
- specialExcessMonthLimit = 6

設定には `LABOR_36_PERIOD_START_MONTH` と `LABOR_SPECIAL_CLAUSE` を追加する。`GENERAL_JP` は週開始曜日、起算月、特別条項の状態がすべて確定して初めて `configured=true` とする。

`getClosedLaborHistory_` は `月次確定` 24列から社員・対象月の最新スナップショットを取得する。再締めがある場合は作成日時/締め日時が新しい行を採用する。

`evaluateGeneralLaborHistory_` は純粋ロジックとして、36協定対象期間内の法定時間外合計、45時間超月数、対象月を末尾とする2〜6か月の時間外＋法定休日平均の最大値を計算する。

対象月そのものは最新のライブ集計でスナップショット値を上書きする。過去確定月が欠ける場合は年次判定の完全性をfalseにし、警告を返す。

本モデルは一般則の早期警告であり、会社の個別36協定や変形/フレックス/業種特例の法令適合判定を代替しない。


## 46. Headless Client Contract Test

`scripts/test_client_contract.mjs` は外部依存を追加せず、Node.js `vm` 上へ5つのクライアントモジュールを実際の読み込み順でロードする。

最小DOM、Storage、`google.script.run` チェーンをテストダブルとして与え、以下のユーザーフローが期待するGAS API契約へ到達することをCIで検査する。

- 社員ID + PINログイン → `login`
- 打刻 → `recordPunch`
- 有給申請 → `submitRequest`
- 承認 → `approveRequest`
- 月次本人確認 → `confirmMonthlyReview`
- ライト/ダーク切替
- 予定表の日付/予定のキーボード操作用HTML

これは実ブラウザのレイアウト・axe・視覚差分を代替しない。Webアプリ公開範囲が `MYSELF` の現在は、デプロイ済み環境のBrowser E2Eを別Gateとして残す。

## 47. Operational Integrity Hardening v0.10.4

### 47.1 Approval graph integrity

`Employees.gs`:
- `managerAssignmentCreatesCycle_` は社員→直属承認者の連鎖を純粋ロジックで検査する。
- `assertManagerAssignmentAcyclic_` は循環する直属承認者設定を拒否する。
- `getActiveDirectReports_` と `assertManagerRoleChangeSafe_` は直属部下を残したまま承認権限を失う降格/無効化を拒否する。

`Notifications.gs` はロール名ではなく `getPermissions_(employee).requestApprove` を使い、ADMINとMANAGERの両方へ管理対象の承認待ちを通知する。

### 47.2 Verified backup

`spreadsheetShape_` は各シートの name / lastRow / lastColumn を取得する。`compareBackupShape_` で原本とコピーを比較し、`verifyDatabaseBackupCopy_` が3回までコピーを再オープンして検査する。

検証失敗したコピーはゴミ箱へ移し、`FM_WORKS_LAST_BACKUP_VERIFIED=false` のままにする。成功後だけ `FM_WORKS_LAST_BACKUP_AT` とverifiedを更新する。

### 47.3 Annual leave five-day evidence monitor

`getAnnualLeaveFiveDayStatus_` は有給台帳のGRANT >= 10日の最新記録を根拠に対象期間を決める。承認済/取消申請中の全日有給を1日、午前/午後半休を0.5日として集計する。

`1/4日有給` はQ-026が解消するまで法定5日取得実績から除外する。付与根拠・会社カレンダーが不足する場合はUNKNOWN / DATA_INCOMPLETEとして「達成済み」と判定しない。

ADMINは社員一覧の「年休」からGRANT / EXPIRE / ADJUSTを登録し、最新100件と年5日状況を確認できる。

### 47.4 Apps Script batching

`updateEmployeeAuthCells_` は認証9列を1 Rangeでread-modify-writeする。`invalidateEmployeeSessions_` は対象H列をRangeListでまとめてREVOKEDへ変更する。

### 47.5 CI / deployment parity

CIとDeployの双方で `test_logic.mjs` と `test_client_contract.mjs` を実行する。workflowは `actions/checkout@v5`、`actions/setup-node@v6`、Node 24を使用する。

静的Gateは、承認通知スコープ、承認経路整合性、年休5日監視、バックアップ整合性、法定休日READY、モーダル閉じるボタンのアクセシブルネームを検査する。

## 48. Response-First Architecture v0.10.5

### 48.1 Auth bootstrap fast path

`login` と `resumeSession` は認証完了後、ロック外で `buildInitialDataForEmployee_` を実行して `initialData` を同じレスポンスに同梱する。クライアントは `mountAuthenticatedApp` へ直接渡し、追加の `getInitialData` 往復を避ける。

保存セッション起動時は公開ログイン設定を先に取得しない。`resumeSession` が失敗した場合だけ `getPublicAuthConfig` を取得してログイン画面へフォールバックする。

### 48.2 User-intent scheduling

`startMenuPrefetch` の全画面先読みは無効化する。`queueRoutePrefetch` は schedule / worklog / requests のナビゲーションへ pointerenter または focus が220ms継続した場合のみ先読みする。

`scheduleBackgroundTask` は `state.busy`、`pendingLoads`、`document.hidden` を確認し、ユーザー操作中または前景通信中なら後ろへ送る。通知は初期表示後2.4秒を起点とするが、前景通信を優先する。

### 48.3 Server caches and indexed reads

`DataAccess.gs` に `cacheJsonGet_` / `cacheJsonPut_` / `cacheRemove_` と `readRowsByColumnValues_` を追加する。

- Settings: 90秒
- Employees: 120秒
- Projects: 180秒
- Company calendar per year: 600秒
- Calendar available years: 600秒

更新APIは対応キャッシュを明示的に削除する。社員IDや日付が既知の読込では TextFinder → contiguous row blocks → RangeList を優先し、分散が大きい場合だけ全件読込へフォールバックする。

### 48.4 Lightweight home aggregation

`getHomeOverview` は `getMonthlySummary` を呼ばず、`getHomeMonthStats_` で当月開始日〜今日の打刻・旧日次・会社カレンダー・承認済休暇・工数だけを集計する。年次36協定履歴、月次締め状態、詳細日次配列はホームでは計算しない。

月次確認通知は `getNotifications` 側へ分離し、ホームの主要KPI表示を通知計算でブロックしない。

### 48.5 Punch fast path

`getAttendanceContext_` が打刻前の当日行と表示用stateを1回で返す。書込後は新規行をそのタイムラインへメモリ上で追加して `buildAttendanceStateFromRows_` で応答を生成する。書込後の当日シート再読込と `SpreadsheetApp.flush()` を廃止する。

### 48.6 Performance observability

`FM_WORKS_PERF` の警告予算を次へ更新する。

- getInitialData: 900ms
- getHomeOverview: 1000ms
- getScheduleBundle: 1200ms
- getRequestsBundle: 1200ms
- getMonthlySummary: 2500ms
- getWorklogs: 900ms
- date/index read: 800ms

これはネットワーク往復を含むUX時間ではなく、Apps Scriptサーバー実行の警告予算である。

### 48.7 Scoped admin payloads

`getAuthAdminData(sessionToken, scope)` は `people / auth / projects` の3スコープを受け取り、画面が必要とするデータだけを返す。

- people: 社員編集に必要な社員26列
- auth: 社員認証状態 + 直近50件のPIN再発行依頼 + サポート設定
- projects: プロジェクトマスタ

クライアントは `authAdminPeople / authAdminAuth / authAdminProjects` を別キャッシュとして管理する。運用設定タブは `loadAuthAdmin` を呼ばず `loadMaintenance` のみ実行する。


## 49. Primary Navigation Architecture v0.10.6

`NAV` はトップ階層を Home / Attendance / Worklog / Schedule / Requests / Admin に限定する。

`primaryNavIdForPage` は互換ルートを親ナビゲーションへマッピングする。

- monthly -> attendance
- companyCalendar -> schedule
- people -> admin

`attendanceWorkspaceTabs` と `scheduleWorkspaceTabs` は、トップ階層を増やさず下位ビューを明示的に切り替える。

ADMIN内は `settingsTabs` で、社員・権限 / 認証・サポート / プロジェクト / 運用・労務 / 要件定義 / 技術設計を切り替える。社員画面は互換ルートpeopleを維持するが、主ナビゲーションではAdminとして扱う。

CIの静的GateとClient Contract Testで、旧トップ階層の再混入と親ルートマッピングを回帰検査する。


## v0.12.1 実ブラウザQAゲート

- `scripts/test_home_viewport.mjs` をGitHub CIに追加。Chromiumで実ホーム生成関数を架空の管理者・予定・要対応データで描画し、DOM座標、ページ高、横はみ出し、操作ボタン高さを測定する。
- 標準PC 1366×768、1440×900、1792×854、1920×1080、1366×768の予定4件・要対応3件、ダーク表示、1100px、スマホ、文字拡大を検証する。
- 1200〜1439px幅・高さ690〜820pxのPCのみ、ホームのKPI・見出し・カード間隔を圧縮。長い予定・要対応・打刻一覧には内部スクロールを設け、打刻ボタン高さ40px以上を維持する。
- `.github/workflows/ci.yml` のビューポート検証をゲートにし、架空画面のスクリーンショットをActions artifactsに保存する。実ユーザーの認証済み画面・実端末での検証は別途必要。


## 50. Finance module v0.13.0

- Backend: src/Finance.gs。公開GAS APIは getMyFinanceItems, getFinanceOverview, submitFinanceExpense, submitFinanceTravel, saveFinanceReceipt, reviewFinanceRequest, settleFinanceRequest。
- Client: src/AppFinance.html。社員フォームは既存の申請画面に挿入し、経理担当用の finance route を新設。取得結果はブラウザメモリ内のみ保持し、セッション切替で破棄する。
- DB: src/Schema.gs の DB_SCHEMA_VERSION=10で「経費記録」「経費精算申請」「出張報告」の列を定義。既存シートの列構成は変更せず、管理者のバックアップ付き migrateDatabaseToCurrent 実行で新設する。
- Authorization: getPermissions_ が financeWorkspace をADMINまたは部署名に「経理」「総務」を含む社員にだけ提供する。getFinanceOverview / saveFinanceReceipt / reviewFinanceRequest / settleFinanceRequest は requireFinanceOperator_ で再認可する。
- Privacy: getMyFinanceItems はセッションから取得した社員IDのレコードのみ返す。申請APIは社員ID・氏名をクライアントから信頼せず、requireSession_ の情報を用いる。
- Integrity: withScriptLock_、Sheet契約確認、厳密な整数金額・日付チェック、再送信識別子重複判定。承認／差戻し／精算は対象IDをロック内で再取得し、自己承認・自己精算を拒否し、既存appendAudit_で監査を記録する。
- Financial domain constraints: 自動日当・宿泊費算定、領収書PDFや画像の保存、会計仕訳、銀行連携は未実装であり、原本証憑保存を代替しない。支給希望額は承認者が確認する。
- Test: scripts/validate.mjs、test_logic.mjs、test_client_contract.mjs、既存ホームChromium QA。実社員E2Eと本番環境確認は別工程。

### 50.1 Finite in-memory integration tests
- `scripts/test_finance_integration.mjs` は実GAS接続と実顧客データを使わず、社員役割5種類と3シートをメモリ内で再現。作成・二重登録、申請者本人だけの履歴、閲覧拒否、自己承認拒否、承認／差戻し／精算、再精算拒否、数値・日付チェック、Spreadsheet式インジェクション対策、監査、スキーマ不一致を実証する。
- CI・Deployで共通のテストを実行する。Finance.gsは画面へ返す一覧にgetDisplayValuesを使用し、状態更新に使用する対象行はgetValuesを維持して型を保存する。


## 51. 実データ構造との整合と経理ワークフローデバッグ（v0.13.1）

- `Schema.gs`: 読み取り専用で取得したFM WORKS DBの実ヘッダーと `DB_SCHEMA_SPECS['申請']` を一致。`assertDatabaseMigrationSafe_` が既存シートの非空見出し不一致をDB変更より先に検出して中断する。
- `Finance.gs`: `resubmitFinanceRequest` は本人の差戻し申請だけをScript Lock下で再登録し、申請ID・作成日時・本人IDを維持、旧判断は監査ログへ保存する。承認・精算は既存権限を維持。
- `financeReceiptCrossCheck_` は経費精算申請と経費記録の `receiptRef` を大小文字・前後空白を正規化して照合する。分割申請の合計額、金額差異、未登録、複数登録を区別し、会計原本の更新はしない。
- `getFinanceOverview` は承認待ち・承認済み優先の表示と、閲覧上限1000件・未表示件数をサーバーから返す。`financeRows_` の送信用日付は文字列に正規化し、対象行を書換える際は元のセル型を維持する。
- `AppFinance.html`: 社員の差戻し理由と修正・再提出導線、経理担当の詳細照会・承認前確認、証憑整理番号の一致状況、追加読み込みを表示。文字列はHTMLエスケープする。
- `DataAccess.gs`: 370日を超える読み取りで検索用正規表現を使えない場合は、全行読み取り後にも入力期間で絞る。逆順指定は空配列を返す。
- 本番公開URL・スクリプトプロパティが接続するPRODUCTION DBは接続環境次第なので、読み取り専用で確認したDBと同一とは断定しない。データ移行・本番操作は実施しない。
- `scripts/test_finance_integration.mjs`, `scripts/test_logic.mjs`, `scripts/test_client_contract.mjs`, ChromiumホームQAで回帰検証し、CIが不合格の変更はmainへ統合しない。


## 52. 画面レスポンス高速化（v0.13.2）

- AppCore.html: navigateは即時renderPageを使用し、不要なView Transitionフレームを省略する。invalidatePageCache('monthly')とログアウト時は月次メモリキャッシュを無効化する。
- AppPeopleMonthly.html: monthlyResultCache（Map、TTL120秒、最大10件）をセッション|本人ID|対象月|対象社員で厳密に隔離。monthlyPendingRequestsに同一キーへのコールバックを統合し、getMonthlySummaryへの同時RPCを1件にまとめる。月・社員・セッションが違う応答を画面へ反映しない。
- AppOperations.html: 勤怠月間プレビューは月次の共通取得関数を使用。worklogWindowRequestsは同一レンジの重複を除外し、異なる14日レンジを最大2件まで同時読み込む。既存LRUと世代番号、セッション判定を維持する。
- AppFinance.html: 経理と本人の経費・出張履歴に30秒のメモリTTLを適用。保存・承認・精算・手動更新はforceで再取得。進行中の強制再取得要求は完了後に1回追加で処理する。
- 表示中のデータの鮮度・権限は元のサーバー側の検証を維持する。キャッシュはlocalStorage・sessionStorage・GitHub・実DBへ書き込まない。
- scripts/test_client_contract.mjsにRPC削減、同時呼び出しの集約、月の取り違え防止、キャッシュ失効、経理強制更新、工数の最大2並列の検証を追加する。
- 認証済み実端末の表示所要時間・通信待ち時間はこのCIでは測定していない。運用環境で別途計測する。


## 53. 事務ハイブリッドワークスペース（v0.13.3）

- AppOffice.html: 現行6項目の OFFICE_MODULES を保持し、officeOverviewPage_ で案4（トップダッシュボード）、officeModulePage_ で案3（業務メニュー／一覧／詳細）を生成する。初期状態は state.officeUi={selected:'overview',recordId:'',query:'',status:'all'} とする。
- 事務トップ: 既存financeUi.overviewの経費精算・出張報告・経費記録のみ使用。未処理優先で行表示し、件数はサーバーのtotalsから取得。未取得時は読込中／エラー／未初期化を表示する。
- 情報の保護: financeWorkspaceがない利用者には金融レコードを渡さず描画もしない。MANAGER単独では経理閲覧不可。サーバーAPIの認可・自己承認禁止・監査は変更しない。
- 内訳画面: officeRecordList_、officeRecordDetails_、officeFilteredRecords_は認可済みメモリ上のオブジェクトだけを使用。入力文字列をescapeHtmlで表示し、onclickは静的メソッド＋datasetを使う。検索・状態変更・行選択だけでサーバーに問い合わせない。
- 保存済みの経費・出張では既存の openFinanceForm、financeDetailRows_、financeApprovalDialog、financeSettlementDialogを再利用し、新しいSheetや保存APIを作らない。
- AppCore.html と AppShell.html は officeの初回遷移時に経理権限者にだけ loadFinanceOverview({silent:true}) を呼ぶ。AppFinance.html は成功・失敗時にofficeとfinanceの表示を更新する。経理キャッシュ／強制更新は従来と同一。
- 未実装モジュール（帳票・見積、備品・購買、取引先マスタ）では説明／出典／項目プレビューのみ表示。保存や帳簿・原本PDFの処理を模擬しない。
- Styles.htmlに.office-v2で範囲限定したCSSを追加。画面幅1520／1180／960／640pxに合わせて3列→2列→1列へ切替。状態は色だけでなく日本語文字も併記。
- 検証: test_client_contract.mjs（認可・実データ・フィルター0通信・XSS防止）、test_office_viewport.mjs（実Chrome描画9ケースとスクリーンショット）、既存ロジック／経理統合／ホーム検証、GitHub ActionsとGASデプロイ。
- UI参考: Shopify Polaris Index table、Atlassian Design System Empty state。いずれも設計原則の参照であり、FM WORKSの独自画面として再構成する。

- UI補足：officeRecentActivity_ は経費・出張の申請者または記録者を、許可された利用者に限り escapeHtml を通じて表示する。テストDOM取得も document.getElementById を使用する。

- レイアウト追補: officeOverviewPage_ のDOMは対応待ち→業務メニュー→右側補助情報の順。CSSのgrid-areaは大画面でメニュー／対応待ち／補助情報の順、960px以下でDOM順に表示する。CIのChromeにはfonts-noto-cjkをインストールし、日本語の実字幅で検証する。

## 54. 事務トップのモバイル見出し（v0.13.4）

- `.office-v2.office-overview > .page-head` に限定した640px以下のCSSで見出し・説明を縦配置にし、短いタイトルの不自然な折り返しを防ぐ。
- `test_office_viewport.mjs` にタイトルの描画行数を追加し、390pxで必ず1行を要求する。
- 初回のv0.13.3公開後にスクリーンショットで発見した差分修正。経理API・保存データ・権限・DOM順は変更しない。


## 55. 見積の業務エンジンと文書出力（v0.14.0）

- Code.gs getPermissions_ の quoteWorkspace は認証済み全員に許可。NAVに「見積」を追加し、AppShellとIndexにAppQuotes.htmlを接続。事務側「見積書」からも独立メニューに遷移。
- Schema.gs の DB_SCHEMA_VERSION は11。追加DBシートは「見積取引先」「見積ヘッダー」「見積明細」「見積採番」。管理者のバックアップ付きDBマイグレーションで新設する。
- Quotes.gs: getQuoteWorkspace/getQuote/saveQuoteDraft/issueQuote/getQuoteDocument を全認証済み社員が利用。vendor import/configure sequence は管理者だけが利用。クライアントではなくサーバーで所有者・状態・金額・明細行数・取引先コードを検証する。
- 保存は UUID 見積IDと送信識別子で重複防止。既存更新は revision を一致確認。正式発行時にScript Lock下で見積番号を予約し、Google Sheets一時シートへ明細を組み立てる。
- 原本の21行明細と10%税率・負単価による値引きを踏襲。SpreadsheetApp/UrlFetchApp/DriveAppでPDF・XLSXを生成し、バイナリ署名を検証。両方成功した場合だけ発行済みにし非公開Driveフォルダに保管する。途中失敗は「出力失敗」として同番号を保持する。
- getQuoteDocument はログインと所有権を確認し、PDFまたはXLSXのbase64を返す。ブラウザ側でBlobダウンロード。Driveを匿名公開しない。
- 取引先実データはGitHubへハードコードしない。ユーザー提供のベンダーコードExcel Sheet1を管理者が認証後に貼り付けて取り込む。既存の最大番号は別途確認済にする必要がある。
- 公式のPDF作成手順参照: https://developers.google.com/apps-script/samples/automations/generate-pdfs
- scripts/test_quote_integration.mjs に架空DB/Drive/URLFetchによる認可・採番・保存・金額・出力テストを追加。CIとデプロイで実行する。実際のGAS/OAuthでの出力・本番DB接続先は現時点では未検証。

- v0.14.0 UI補足: 破棄・正式発行・採番確認はAppQuotes内のensureModal()/closeModal()を使用し、App本体と一貫したDialog UI・閉じる操作・フォーカス処理を継承する。

- スクリーンショットQA: scripts/test_quote_viewport.mjs が架空の見積データで一覧・編集中・正式発行後をそれぞれPC/スマホ表示し、横スクロールとボタン配置を検証する。CI成果物 fmworks-quote-layout-qa に画像を保管する。

- エラーフロー追加: quoteDetail_は発行済／出力失敗／発行処理中を区別。出力失敗は同じ番号で再試行するアクションを設けるが、正式発行完了まではgetQuoteDocumentのダウンロードボタンを表示しない。クライアント契約テストで確認する。

## 56. 業務UI再設計（v0.15.0）
- AppCore: NAV_GROUPSによる4分類。内部financeEntryは申請・報告の画面として表示。認証していない直リンクは申請へ戻す。
- AppShell: PC/モバイルとも同じグループ。financeEntryPageを画面ルートへ追加。
- AppFinance: 経費・出張の独立フォームを既存認可/保存APIへ接続。経理ページはサーバーが返す件数を表示し、絞込はローカル処理。
- AppQuotes: 見積一覧のKPI・検索・状態表示を統一。取引先取込と採番設定はAppAdminに移動。業務の金額検証と正式発行ルールは変更しない。
- AppOffice: 総務の未実装領域と利用可能な関連メニューを区別し、経理明細を重複表示しない。
- AppOperations: 申請一覧から経費申請・出張報告へ直接アクセス可能。
- AppHomePortal: 勤怠・予定・TODOを維持し、見積/経費/出張/工数を優先ショートカットに設定。
- StylesWorkflowV15: 共通ヘッダー、4枚の指標、2カラム入力/概要、検索/絞込、画面幅別の配置を定義。
- Code.gs: ADMINまたは経理・総務部門のみofficeWorkspaceを許可。一般MANAGERには総務権限を自動付与しない。
- DBスキーマ・GAS保存API・実顧客情報は変更なし。見積原本とPDF/Excel完全一致、領収書アップロードは未実装のため実装済みと表現しない。

- v0.15.0 QA補足: StylesWorkflowV15の共有ヘッダーはホームに限って1200px以上・690px以上でコンパクト化し、既存の1366×768/1792×854一画面表示条件を保つ。共通スタイルの変更後には新旧CSSを同時に読み込むChromium試験を再実行する。
- `scripts/test_workflow_viewport_v15.mjs` で経費・出張独立フォーム、経理の検索と承認一覧、見積一覧、管理者用取引先・採番設定のPCとスマホ10条件を実DOMレンダリングで検証しCIで必須とする。

### v0.15.0 ホーム高密度レイアウトの調整
- StylesWorkflowV15.html に `min-width:1200px; min-height:690px; max-height:820px` の限定メディアクエリを追加。ホームの予定、タスク、打刻履歴はカード内でスクロールできるようにし、1366×768の実データ多件ケースで一画面要件を維持する。
- CI の `test_home_viewport.mjs` に含まれるdenseケースを、他の画面テストとともに再実行する。

## v0.15.1 データベース読み込み最適化（2026-10-09）

- `Code.gs:getDb_` はV8実行コンテキストでID別にSpreadsheetハンドルを保持。取得前に `getDatabaseSpreadsheetId_` を毎回実行し、PRODUCTIONからSTAGING既定DBへの接続を拒否する。
- `DataAccess.gs:findVerifiedSheetRow_` はDB ID/スコープ/検索キー別にScriptCacheへ行番号だけを300秒保存。キャッシュに行の内容を入れない。
- 位置ヒントがある場合も毎回該当行全列を再読込し、検索キーの完全一致を検査。ヒントなし・行移動・位置競合は `TextFinder` へフォールバックする。
- `Auth.gs:requireSession_` の期限/無効化チェック、`getEmployeeAuthRecord_` の在籍・権限チェックは従来通りライブデータ。認証ハッシュと社員IDのキャッシュスコープを分離。
- `scripts/test_data_access_performance.mjs` はダミーSheetで接続重複、検索回数、セッション失効、権限変更、行移動、DB切替を回帰検証。実時間の効果は `FM_WORKS_PERF` ログで評価する。

### v0.15.1 工数画面のウィンドウキャッシュ拡大

- `AppOperations.html:worklogWindowRange(date)` は `monthGridRange(date)` の開始・終了を7日ずつ拡張。リクエストは既存の `getWorklogs` に限定し、一度得た `items` を `worklogShowCachedDay` で日付抽出する。
- `loadWorklogs` は初回/強制取得以外の `includeProjects` を省略し、`projects:[]` の応答を既存の取得済みマスタへ上書きしない。保存・削除時の `invalidatePageCache('worklog')` と最大2並列・世代管理は従来通り。
- `scripts/test_client_contract.mjs` で10月から11月への移動のRPC=0、プロジェクト情報維持、別月キャッシュ、書き込み後の破棄を検証する。


## v0.16.0 見積書の作成・プレビュー・発行（2026-10-09）

- AppQuotes.htmlのquoteEditor_はquote-builder、qb-edit-column、qb-preview-columnで構成。quoteLineEditor_の編集表で明細の複製・移動・削除・注記操作を行う。
- quotePreviewDocument_は編集状態からA4風の見積プレビューHTMLを生成し、quoteRefreshPreview_がプレビューDOMのみ更新する。外部入力はescapeHtmlでサニタイズし、毎キー入力のGAS通信は行わない。
- StylesWorkflowV15.htmlへquote-builderスコープのCSSを追加。狭幅では編集→プレビューの順に積み、表部分のみ横スクロールする。
- Quotes.gsのquotePaintSheet_はB7:F7に取引先所在地、B9:I9に件名を含め、明細見出しを「品名・内容」とする。正式発行後にGoogle SheetsからPDF・Excel形式を作成する。
- 管理者が明示確認した場合だけquoteSetupStorage_から既存migrateDatabaseToCurrentを実行し、バックアップを作成して必要シートを追加する。quoteAddSingleVendor_はimportQuoteVendorsを呼び出すが、過去番号の確認を省略しない。
- test_quote_integration.mjsで帳票文字列を検証し、test_client_contract.mjsでライブプレビュー・行編集・HTMLエスケープと追加RPCなしを確認。test_quote_viewport.mjsでスマホとPCのレイアウトを確認する。
- 元Excelの帳票書式完全一致と本番GASの実出力E2Eは未確認である。

## v0.16.1 見積確定情報のスナップショット表示（2026-10-09）

- quoteDetail_ は quotePreviewDocument_(Object.assign({},header,{lines})) を使い、エディターと同じ帳票コンポーネントを表示する。
- quotePreviewDocument_ は状態が「発行済」「発行処理中」「出力失敗」のとき、quoteVendor_ に依存せず header.vendorName/vendorAddress を使い、header.subtotal/taxAmount/total と line.amount の保存値を表示する。
- test_client_contract.mjs は発行済み詳細のプレビューデザイン一致・サーバー保存金額優先・後日のマスタ名称変更の非影響を検証する。既存のファイル発行・認証・権限検証を維持する。

## v0.16.2 帳票プレビューCSSの詳細画面上書き（2026-10-09）

- StylesWorkflowV15.html末尾に .quote-detail .qb-issued-preview .qb-paper .qb-paper-title の高特異度上書きを追加し、旧 .quote-preview header のflex/border指定を無効化する。内部タイトル罫線 .qb-paper-title-rule を使う。
- 既存 scripts/test_quote_viewport.mjs のデスクトップ/スマホ詳細画像で中央タイトル位置と罫線を目視検証する。金融計算/認証は変更しない。

## v0.16.3 見積生成シートの書き込み最適化（2026-10-09）

- `Quotes.gs:quotePaintSheet_` は `B17:I37` の21行×8列を `setValues` 1回で書き込む。B:Eの明細説明は行ごとに結合し、偶数行は白、奇数行は薄い灰色とする。ゼロ円を有効な数値として出力し、注記行のみ金額セルを空欄にする。
- 明細ヘッダーをB16:I16、帳票件名をB12:E12、取引先住所をB7:E7へ配置。小計・消費税・合計は従来のB38:I40に続く行へ表示し、ユーザーに連動する帳票構成を維持。PDF・Excel変換は既存の `quoteCreateFiles_` の二段階発行処理を継続する。
- `AppQuotes.html:quotePreviewDocument_` と `StylesWorkflowV15.html` には参考帳票に近い青い区切り・薄灰ストライプ・発行元詳細を反映。現行帳票の細部や原本比較は未検証。
- `scripts/test_quote_integration.mjs` では21行一括setValues、マイナス値引き、注記、取引先住所と件名セル配置を検査する。既存の再送耐性と発行済み書換禁止テストも維持する。


## v0.17.0 統合書類作成・関連帳票の技術設計（2026-10-10）

- UI: AppCore.html の NAV に書類作成（quotes既存ルート）と書類一覧・履歴（documentHistory新規ルート）を追加。AppShellで documentHistoryPage に配信。AppQuotes.html の共通入力・下書き・見積正式発行は従来APIを利用し、見積正式発行後に AppDocuments.html の documentCreateFromQuote を表示。
- 共通入力: quoteUi.editor は現行見積データだけを編集する。取引先の新規登録は quoteQuickVendorDialog_ で既存の管理者専用 importQuoteVendors を呼び、フォームの編集中データを失わず新規コードを選択する。登録情報と採番確認済み状態は別に検査。
- 新規 Apps Script Documents.gs: documentStorageStatus_, documentRows_, getRelatedDocument, createRelatedDocument, retryRelatedDocument, getRelatedDocumentFile。取引先／単価／明細／金額は発行済み元見積からスナップショットとして関連書類シートに記録。明細JSONは45,000文字を上限とする。
- 番号: 種別・年ごとの最終番号を関連書類採番シートに格納。LockService経由の withScriptLock_ を利用した予約処理で1つの元見積ID・種別につき1つの番号に制限する。発行に失敗したときは状態「出力失敗」にし、再試行でも元の番号を維持する。
- 発行: quotePaintSheet_ を呼んで既存見積テンプレートのレイアウトを引き継いだ後、タイトル・書類番号・発行日・期限/納品日/入金日・合計見出しを種別ごとに差し替え、一時Google SheetsからPDF/ExcelをエクスポートしてDriveへ保存。一時ファイルは処理終了時に破棄する。
- セキュリティ: 書類一覧・詳細・ダウンロード・再試行で requireSession_ による所有者チェックを毎回実施。管理者は全社員を閲覧可能。ユーザー入力は quoteText_／financeDate_／quoteKey_ を用いて検証。ブラウザ側の文字列はescapeHtmlで表示する。
- 運用: Schema.gs DB_SCHEMA_VERSION=12。関連書類（32列）・関連書類採番（5列）を追加。既存migrateDatabaseToCurrentのバックアップ→ヘッダー整合検査→作成→DB_VERSION更新→監査の工程を再利用。関連書類シートが無い場合は既存見積が利用可能なまま設定導線を表示。
- 回帰: scripts/test_quote_integration.mjs は見積書既存テンプレート、独立番号、PDF/Excel出力、金額凍結、領収入金確認、本人以外のアクセス遮断と重複発行防止を検証。test_client_contract.mjs は作成・履歴画面、変換ボタン、領収確認UIを検証。横幅と表示は既存viewportテストで確認する。

## v0.17.1 モーダルテーマの実測・再発防止（2026-10-10）

- 根本原因: Styles.html の `.modal-card` が背景 `#fff` 固定だった一方、darkテーマでルート `--text:#edf4ff` を継承した。ユーザー実機画像では文字が白背景に埋没していた。従来の viewport テストは通常の画面のみ描画し、共通モーダルを開いた状態を確認していなかった。
- 修正: `.modal-card` に `background:var(--surface);color:var(--text);border:1px solid var(--line)` を適用し、`.modal-head small`、閉じる `.icon-button`、dark `.field>span` をテーマに応じた色にする。`.request-modal-actions` も `var(--surface)` と `var(--line)` に揃え、スクロール時の白いフッターを回避する。
- 新設 `scripts/test_modal_theme.mjs`: 実際の AppQuotes.html / AppDocuments.html のダイアログ生成関数をVMで実行し、Styles.html + StylesWorkflowV15.html をChromiumでレンダリング。1366×768と390×844、light/dark、5種のモーダルを検証し、computedStyle色からWCAGコントラスト比4.5以上、モーダル枠の画面内配置、申請フッター色一致を検査する。
- CI / mainデプロイの両方で、既存の業務テストに加えてモーダルの表示契約テストを必須化。CIではスクリーンショットを `fmworks-modal-theme-qa` の成果物として保存。元の見積Excel描画・DB構造・業務権限・採番ルールに変更を加えない。

## v0.17.2 デモデータ保存および動作確認UI（2026-10-10）

- デモ見積レコードは全て既存見積ヘッダー・見積明細・取引先・採番の各シートに実体を保存する。デモIDはDEMO-QUOTE-接頭辞で分類し、取引先名・件名にも【デモ】を入れる。
- AppQuotes.htmlのquoteOverview_は表示権限があるデモ下書き件数を表示し、書類履歴へ遷移できるようにする。AppDocuments.htmlでは該当見積にDEMOラベルを表示する。
- スプレッドシートの保存値は再読込で検算。テストスクリプトでデモ表示導線と一覧ラベルの契約を検証。既存の見積PDF/Excel描画・採番・認可ロジックは変更しない。

## v0.17.3 経理2ペイン・台帳・サンプル切替の技術設計（2026-10-10）

- データソースと分離：AppFinance.htmlのfinanceUi.overviewはサーバーからの認可済みデータのみ。financeUi.demoDataは初回のサンプル切替時だけ架空データを生成するメモリキャッシュ。financeDisplayedOverview_()でどちらを表示するか選ぶが、実データの参照は書き換えず、ログアウト時のresetFinanceUiで両者を破棄する。サンプルにはDEMO- IDを付け、取引先・人名は架空表現を使用する。
- 保護：サンプル中は右側の承認・差戻し・精算ボタンを表示せず、経費記録ボタンも無効化。financeApprovalDialog / financeSettlementDialog に加え、最終financeSubmitDecision / financeSubmitSettlementのガードでGAS送信を抑止。正式な経理権限・状態・自己承認拒否は従来のFinance.gsで実施する。サンプル切替にGoogle Sheets更新・WebStorage書込・DBシード処理はない。
- UI：financeOverviewRowsはPC向けのセマンティックな表と、スマートフォン向けの記録カードを同じ閲覧データから構築。financeSelectRecordはdata-finance-idの選択状態とfinanceSelectedDetailだけ更新し通信しない。タブ・月・状態・照合を変えるとフィルタ状態を適用して再表示。入力中のキーワード検索は結果領域だけを置き換え、入力フォーカスを維持する。
- 集計：現行getFinanceOverviewのtotalsで経費承認待ち、出張承認待ち、精算待ち（経費／出張内訳）、経費・出張・経費記録の総件数を計算。証憑要確認だけはexpensesの現行取得範囲に含まれるreceiptMatchesにより計算し、全件数と区別する。照合は会計仕訳の証明ではない旨を注記する。
- 変更境界：src/AppFinance.html、src/StylesWorkflowV15.htmlの.finance-v0173限定スタイル、2設計書、test_client_contract.mjs、test_workflow_viewport_v15.mjsを変更する。Finance.gs、Schema.gs、AppQuotes.html、AppDocuments.html、Code.gs、共通Styles.htmlは変更しない。v0.17.2の見積デモ表示機能は保持する。
- 検証：既存Node VM契約・架空経理統合テスト・文書同期テスト・Chromiumのライト/ダーク・1366×768/1600×900/390×844/320×700 viewportテストを実行。CIが失敗した場合はmainに取り込まず、実DBを変更しない。

### v0.17.3 スクリーンショット検証による調整

- scripts/test_workflow_viewport_v15.mjs の iframe 内で finance-priority-stats の computedStyle.gridTemplateColumns を計測し、PC（1200px以上）は4列、スマホ（760px以下）は2列を必須化する。スクリーンショットで確認された1366px時の2段化を防止する。

## v0.17.4 書類履歴の非同期読み込み・短期メモリキャッシュ（2026-10-10）

- `AppDocuments.html:documentOpenRecord` は `quoteIdentity_`（sessionToken＋社員ID）と単調増加する `docUi.requestSeq`、`selectedId` でレスポンスをガードする。現在選択中でない結果・失敗は破棄し、読み込み中は旧書類の明細を非表示にする。
- `docUi.detailCache: Map` は書類IDに対する `updatedAt` と詳細スナップショットを最大12件保存する。詳細の再選択が同一 revision ならRPC不要。更新された行・不明な行はキャッシュを使わずサーバーから再取得する。別セッションの `quoteIdentity_` でキャッシュを破棄する。
- 取得結果の `header.id` が要求IDと一致することもクライアントで検査する。これは防御的検査であり、認証・認可の代替にはしない。
- 新設 `scripts/test_document_history.mjs` は、遅延レスポンス、遅延エラー、ダブルクリック、一覧更新、別ユーザーへの切替、異なるIDの応答、通信失敗後の再取得をNode VMで再現。既存の `scripts/test_quote_integration.mjs` から読み込み、CI・Deploy双方の書類発行ゲートに含める。

## v0.17.5 見積明細の差分書込とDB I/O改善（2026-10-10）

- `Quotes.gs:quoteReplaceDetails_` は対象見積ID列のみ1回読取、物理行番号を収集する。既存の行と新しい配列の共通部分は連続した行番号ごとに `setValues` で一括更新する。
- 新しい明細が少ない場合だけ不要な行を末尾側から `deleteRows(start,count)` で削除し、他見積行の順序と値を保つ。行が増える場合だけ追加分の `setValues` を1回行う。新規見積と既存見積のDB形式は不変。
- `logPerformance_('quoteDetailSave',...)` に過去/新行数、書込・削除ブロック数、計測所要時間を記録する（個人情報・取引先名・品目の文字列は記録しない）。
- 既存 `scripts/test_quote_integration.mjs` のSheetモックに `deleteRows` と書込回数計測を加え、21行全更新、21→2行、行が交互に存在する他見積の保護を回帰確認する。アプリのバージョン文字列を 0.17.5 に統一する。

## v0.17.5 経理保存結果・遅延観測・大容量読込の実装設計（2026-10-10）

- Finance.gs:financeRows_(kind,employeeId,limit,verified) は、financeStorageStatus_で先に3シートの見出しを検証した呼び出しに限りverified=trueでヘッダー再読込を省く。社員IDに対して大量行（100行超）かつ一致行10件以下の場合は列Cの所有者IDを先に取得して対象行を選択的に読取る。条件外は従来の一括読取に戻す。共有行数にかかわらず本人だけを返す。
- getFinanceOverview: 認証後に合計を全件集計。証憑照合は全件の申請金額で分割申請を集計しながら、表示用のreceiptMatchesマップを160〜1000件の取得範囲に限定する。従来の全件×表示件検索の繰り返しを廃止し、メモリ計算と応答ペイロードを削減。保存・監査・シートの列構造は変更しない。
- financeWriteNew_ / resubmitFinanceRequest: GASからrecord（保存済み内容）をok/id/duplicateと同時に返す。requestKeyを除外し、日付型はGASが返却可能な文字列へ正規化する。これらはサーバー側で保存確認できた値だけであり、ローカルの未保存ドラフトは使用しない。
- AppFinance.html:financeApplyServerSavedRecord_ は成功後の本人の履歴・経理レシート一覧へ記録を先行表示し、既存loadMyFinanceItems/loadFinanceOverview(force)を引き続き実行して整合させる。失敗・okがtrueでない応答ではフォームを残し、二重送信を防ぐ同一識別子を維持。承認と精算の処理結果もokを検査して画面を閉じる。API応答時間をブラウザのメモリに記録し、経理画面に表示する。
- scripts/test_finance_integration.mjs は完全にメモリ上の架空シートだけを使用。500件超のレコードによる読込量と照合マップ上限・非表示行の分割照合・保存レコード・再送重複防止を追加。test_client_contract.mjs は数値フォーム入力制限、成功応答前の送信中、未確定応答後のフォーム保全、保存結果による即時表示を追加。
- 実本番スプレッドシートへの書き込みは行わず、公開後の認証環境で書込／再読込／監査ログを照合する受け入れ確認を残す。ゼロ秒通信は保証しない。

- 追加の操作性QA：実ブラウザ内で架空経理記録の選択、検索入力、フォーカス保持、対象月フィルター、出張タブ切替、表示詳細の正当性、サンプル操作中のGAS通信禁止をPCとスマホ幅で検査する。

## v0.17.6 見積ワークスペースのシート参照再利用（2026-10-10）

- `quoteStorageStatus_(validatedSheets)` は全4シートの存在とDB_SCHEMA_SPECSの一致を検証し、検証済みSheet参照を任意の出力引数へ記録する。従来の引数なし呼出しは変更せず利用できる。
- `getQuoteWorkspace` は同一呼出し内で取得した検証済み `validated.vendor/header/sequence` を `quoteRows_(model,validatedSheet)` に渡し、ヘッダーの重複検査を省略する。検証で不一致があればデータ一覧を返さない。
- `documentListForUser_(user,storageAlreadyValidated)` は呼出し元が `documentStorageStatus_` の結果を確認したときに限り二重検査を省く。実際のデータ読取で `documentSheet_` が引き続きヘッダーを検査する。個別APIの従来動作も保持する。
- `logPerformance_('quoteWorkspace',...)` は経過時間と見積・書類・取引先件数を記録する。Sheet参照はサーバーリクエストを跨いで保存しない。
- `scripts/test_quote_integration.mjs` は1回の正常ワークスペース取得時のヘッダー7回と、不正な取引先シートヘッダーの拒否、帳票全体の回帰を検証する。APP.versionは0.17.6に整合。

## v0.17.7 書類詳細のセッション破棄と一覧更新キュー（2026-10-10）

- `resetQuoteUi()` から `resetDocumentUi()` を呼び、文書詳細、`Map` キャッシュ、選択ID、busy/loadingを全消去する。既存の `clearLocalSession()`・`mountAuthenticatedApp()` から実行される。描画側でも `docUi.cacheIdentity===quoteIdentity_()` とログイン済み状態を検査する。
- `loadQuoteWorkspace(options)` は読み込み中の `force` を `refreshNeeded=true` に記録し、先行通信の完了後に最後の1回を再取得する。古いレスポンスの描画を回避し、配列構造不一致で旧正常データを破棄しない。
- 取引先単体追加、貼付インポート、採番設定は `quoteIdentity_` でログイン元の遅延コールバックを拒否する。
- 新規 `scripts/test_quote_session.mjs` にて、連続force・通信失敗・異常データ・書類詳細の別ログイン混入・遅延応答をVMで模擬。既存 `test_quote_integration.mjs` に組み込んで全CIとGAS公開前チェックへ適用する。

## v0.17.6 経理の非同期応答・データ整合性・大容量読取の設計追加（2026-10-10）

- `Finance.gs:financeText_`: `safeSheetText_` の文字数上限による黙ったトリミングを禁止し、入力文字数を先に検証してエラーとする。APIが許容する最大文字数は `AppFinance.html:FINANCE_FIELD_LIMITS` へ反映。
- `financeSameSubmittedRecord_`: 送信識別子一致に加え、本人と送信内容の一致を要求する。種類別の入力フィールドだけを比較し、数値は桁区切りを無視、日付は表示文字列／Dateを正規化、スプレッドシートの計算式保護用先頭アポストロフィを考慮する。内容が異なる場合は前回の保存結果を新しい入力の成功として扱わない。重複申請防止の本体判定は引き続きLockService下で行う。
- `financeReceiptCrossCheck_`: 全申請を参照する番号ごとの請求数と金額合計を計算し、同一番号の申請が2件以上なら `MULTIPLE_CLAIMS` として返す。非表示の申請も重複判定に含む。経費記録の番号重複（`MULTIPLE`）とは別の状態で扱う。
- `financeFindRow_`: `DataAccess.gs:findVerifiedSheetRow_` を共用。5分のキャッシュは行番号のヒントだけで、対象を開く際は毎回その行のIDを読み直す。候補不一致ならTextFinderで検索し、権限・申請状態は現在の行内容で再判定する。
- `AppFinance.html`: overview／mineの読込開始時に画面の書込世代番号を保持し、保存・承認・精算の成功時に世代番号を進める。開始後に状態が変わった旧取得結果は破棄して最新を再読込する。サンプルモードは経理記録だけでなく経費精算と出張報告の登録フォームにも適用し、送信関数で最終的な遮断を行う。
- `getFinanceOverview` は `performance.serverMs` のみ追加返却し、ユーザー画面では既存のネットワーク込みの計測 `financeUi.lastLatencyMs` と別表示。個人情報や認証情報は計測値に含めない。
- CIは `scripts/test_finance_integration.mjs`／`scripts/test_client_contract.mjs` で登録内容一致、長文、重複申請、行番号照合、書込中と古いレスポンスの順不同を検証する。実本番データへの書き込み、監査ログの偽造、本人承認を伴う試験は行わない。

- AppFinance.html の submitFinanceForm は実際のフォームの input/select/textarea/button を元の disabled 状態ごと記録し、書込中は凍結する。失敗や確認不能時に restore() で復旧し、保存成功時は画面遷移で破棄する。PC台帳の日付ボタンのクリックは伝播停止し、親行からの重複処理を抑止する。

- AppFinance.html の経理モーダルに financeCloseModalIfIdle() を使用し、financeUi.busy 中は閉じる動作を抑止する。完了後は通常の closeModal() を実行し、異常応答時にはダイアログ内のエラーを確認できる状態を維持する。


## 社内文書の独立モジュール（2026-10-10）
- `src/CompanyDocs.gs` が `社内文書` 独立シートにデータ保存。新規作成・編集・論理削除の書込みは `withScriptLock_`、状態変更は `appendAudit_` を利用。既存見積・関連書類とデータを共有しない。
- 列は文書ID／文書名／分類／概要／施行日／公開状態／改訂番号／更新日時／更新者ID／参照URL／登録日時／登録者ID／削除日時／削除者ID／送信識別子／本文。既存 `DB_SCHEMA_VERSION` を変更せず、初回ADMINによる `initializeCompanyDocuments` でバックアップ成功後のみ追加する。
- `getCompanyDocuments` は本文列を取得せずメタデータのみ返却。`getCompanyDocument` は選択文書だけ本文を読込。一般社員には公開文書だけ返す。管理者・総務だけに編集・非公開閲覧を許す。各サーバーAPIは `requireSession_` で認証し、各編集操作は総務・ADMINの権限を再確認する。
- `saveCompanyDocument` は送信識別子による二重登録抑止と revision による競合検出。削除は `削除日時` を入れる論理削除。外部参照はHTTPSに限定。
- 画面: `AppCompanyDocs.html` / `StylesCompanyDocs.html`。既存ナビゲーションに独立の社内文書を追加し、遷移時遅延読込・ユーザー切替時のメモリ破棄に対応。本文は HTML エスケープしプレーンテキスト表示。
- 統合の手順: 社内文書専用PRで先にCI検証。並行する総務PRとの更新競合を防ぐ。GAS公開は統合後のActions完走まで未確認。

## v0.18.0 総務ワークスペース
- フロントは AppSomu.html、スタイルは StylesSomu.html、既存ルート office / AppOffice.html が読み込み完了後に切替。
- サーバーは Somu.gs。getSomuWorkspace、saveSomuAsset、createSomuLoan、returnSomuLoan、createSomuPurchase、advanceSomuPurchase、saveSomuDocument を実装。
- 読み取りと書き込みの双方で requireSession_ → assertPermission_(officeWorkspace) を実行。保存は ScriptLock で直列化し、改訂番号/送信識別子で競合・重複を防ぐ。
- DB_SCHEMA_VERSION=13 で総務備品/総務貸出/総務購買/総務書類の4シートを追加。管理者が既存の migrateDatabaseToCurrent によりバックアップ後に移行する。自動移行は行わない。
- サーバー側で管理番号重複、保有数上限、貸出期限、購買状態・自己承認を検証。書類管理はURL参照情報のみ。
- 総務読込はナビゲーション後の一度だけ、画面内の検索/切替はローカル操作で無通信。保存成功後に再読み込みする。権限・期限はAPIごとに再照合。
- サンプルはブラウザ内の架空データで本番書込不可。既存の見積、経理、人事などのAPI・DBスキーマはそのまま。

- 返却と購買状態変更は総務専用の確認ダイアログを使う。ネイティブのalert/confirm/promptは使わない。

- 総務台帳の各日付列を受信時にYYYY-MM-DDへ正規化し、期限比較の誤判定を防止。強制再取得時は画面の旧データ表示を維持し、戻り後に更新。初期DB未設定時も架空データの画面サンプルを閲覧可能。

## 監査ログ記録の観測可能性・経理モーダルの保護（2026-10-10）

- `Code.gs:appendAudit_`: 既存の呼出側に影響しないよう、監査シートへ正常に追記したらboolean `true`、失敗時は従来どおりコンソール記録のうえ `false` を返す。SpreadsheetAppは経理行と監査行の書込みを原子的に保証しないため、結果を一括成功とは表示しない。
- `Finance.gs`: 新規・再申請・承認／差戻し・精算後の戻り値へ`auditRecorded`を追加。会計データの保存結果`ok`とは独立の状態であり、既存の`id`、`status`、`duplicate`を維持する。重複送信で新しい監査行を自動増加させない。
- `AppFinance.html`: `financeTrackAuditResult_`が`auditRecorded===false`のみを検出し、保存済みの事実と監査未確認の事実を併記して、対象IDつきの常設警告を表示。読み込み時のエラー／キャッシュ更新と独立した画面状態に保存する。ログアウトでは`resetFinanceUi()`が警告を破棄する。
- `AppFinance.html`と`AppShell.html`: 通信中の経理モーダルを`data-finance-modal`で識別し、共通Esc処理が経理処理中だけ閉じる動作を止める。背景クリックと閉じる／キャンセルボタンの既存`financeCloseModalIfIdle()`と同じ原則に合わせる。
- 自動テスト：成功／監査失敗をメモリ上のSheetsで再現し、保存済みデータと監査の結果が独立して返ること、警告が継続表示されること、共通Escキー操作が処理中のみ禁止になることを検証する。実本番DBへの書込は行わない。

- v0.18.1: Somu.gs に resubmitSomuPurchase を追加。ScriptLockの中で requesterId == 操作者を確認し、差戻し状態だけ新しいrequestKeyで更新。既存の差戻し理由はnoteとして残し、更新前後の状態を監査ログへ記録する。誤った本人以外の同一requestKey再使用も拒否する。
- AppSomu.html は差戻し本人に「修正して再申請」を表示し、既存モーダルの入力を再利用する。再申請は (sessionToken,id,payload) API契約、通常新規申請は従来どおり (sessionToken,payload)。DB_VERSIONと既存データ形式は変更しない。
- 総務DB未移行時の管理者用ボタンは setAdminTab('operation') を通じて既存のバックアップ付きマイグレーションUIへ移動する。画面のローカル検索/ソートはGASへ追加リクエストしない。

## v0.17.8 工数所有者の保存不変条件と非同期セッション境界（2026-10-10）

- `saveWorklog` の管理者編集時、`payload.employeeId` がない場合は既存行の社員IDを保存先に採用し、社員マスタでアクティブ状態を検査する。新規登録は従来どおり本人。既存レコードのアクセス権チェックは維持。
- `assertNoWorklogOverlap_` では `readRowsByDateRange_(sheet,2,15,date,date)` による対象日付の行だけを使う。複数行・境界時間・他社員・削除済みの判定を `test_worklog_integrity.mjs` で検証する。
- `changeWorkLocation`、`performPunch` では元セッショントークンを成功・失敗ハンドラで照合する。`clearLocalSession` は `state.busy=false` とする。
- `saveQuickWorklog`、`saveWorklogFromModal`、`deleteWorklogItem`、`refreshRequestPreview`、`loadCorrectionPunchOptions` は `requestsIdentity()` をコールバック時に検証し、旧社員の画面情報を新社員へ混在させない。
- 既存クライアントVMテストにログイン変更の遅延応答確認を追加し、勤怠・工数・申請の回帰テストを通す。

- `performLogout` のGAS完了ハンドラは現セッション/初期化済みユーザーの有無を再確認する。旧セッションのlogout応答は新ログイン画面へ `showLogin()` を適用しない。成功/失敗の両系統をVMで検証する（遅延ログアウト応答）。

## 2026-10-10 監査済み再送を返すAPI契約

- `financeAuditRequestNote_(requestKey)` は経理レコード既存の送信識別子に対する監査ログ`note`で、`経理新規登録`および`経理再申請`時にのみ記録する。追加の列やテーブルは作らない。送信識別子はログインの認証トークンではなく、経理APIでは認証済み社員の本人確認と内容一致を従来どおり必須とする。
- `financeAuditConfirmedForRetry_(kind,id,operation,requestKey)` は`DB.sheets.audit`の対象ID列（G列）でTextFinderを実行し、操作名・対象種類・対象ID・成功状態を照合する。再申請では送信識別子を含む監査記録`note`も厳密に一致させる。未取得時はfail-closed（`false`）。既存の古い再申請ログに識別子が記録されていない場合も確認不能として扱う。
- 新規登録と再申請の`duplicate:true`応答は`auditRecorded`を必ず返す。データ本体の重複登録を防ぐLockServiceとユーザー・内容一致判定は保持し、再送時の追加監査書込は行わない。
- audit TextFinderは正常な初回登録や一覧取得では呼び出さない。CIの仮想シートを実監査表と同じ12列で構築し、`findAll`による再照合と両系統の失敗応答を確認する。

## v0.18.2 総務読込高速化
- src/Somu.gs: getSomuWorkspace(sessionToken,forceFresh) は somuOperator_ による認証・権限チェック後だけ、CacheService に保持した表示用snapshotを読む。スクリプト全体共通なのでアクセス制御は省略不可。鍵は getDatabaseSpreadsheetId_ を含む。保存成功時の somuNew_ / somuWrite_ がcacheRemove_する。
- スナップショットは20秒TTLかつJSON UTF-8 85KB以下。貸出制約・購買状態・楽観ロックは従来どおりシート実体をScriptLock下で検査し、snapshotを更新判定に使わない。DBが未準備の状態はキャッシュしない。
- フレッシュ取得の先行見出しチェック後、4シートは preverifiedSheet を使って重複ヘッダーI/Oを削除。logPerformance_ に SHEETS / SCRIPT_CACHE / SETUP_REQUIRED のソースを記録。
- src/AppSomu.html: UIスナップショットは45秒。戻り遷移やタグ切り替えでは即描画。期限経過時は画面保持してバックグラウンド更新。明示更新・保存成功後は forceFresh=true としてキャッシュを迂回。ロード失敗時も取得済みデータを保持。
- 表示台帳は先頭60件、もっと見るで60件ずつ追加。貸出可能数は貸出台帳の集計結果をWeakMapで再利用し、備品数×貸出数のループを避ける。
- src/AppCore.html: office を 220ms の意図プリフェッチ対象に追加。他のホーム・工数・経理の読込ロジックは変更しない。
- 品質ゲート: scripts/test_somu_integration.mjs は実Sheets模擬の読取回数、ログイン別権限、保存時のキャッシュ破棄を検査。scripts/test_somu_client.mjs は通信0のローカル再表示・60件表示・明示更新・失敗時表示維持を検査。

## v0.17.9 申請・月次締めの索引付き読取と逆転期間防御（2026-10-10）

- `Requests.gs:assertNoLeaveConflict_` は `readRowsByColumnValues_(sheet,3,19,[employeeId])` で対象社員行だけを取得する。`excludeRequestId`、`approvedOnly`、期間重複、同一半日種別の判定は不変。
- `Monthly.gs:closeMonthlyPeriod` は給与対象社員IDの集合 `payrollIds` に対する `readRowsByColumnValues_(requestSheet,3,14,[...payrollIds])` を使い、既存の申請状態・対象月重複フィルタは保持する。
- `Monthly.gs:assertMonthRangeOpen_` は正規化した日付の開始・終了を比較し、開始が終了より後であれば月ごとの反復前にエラーとする。
- `scripts/test_request_indexing.mjs` は架空シートのRead APIをモックし、社員別索引利用、関連なし社員の除外、期間重複、月次締め、逆転期間拒否を検証。`scripts/test_logic.mjs` から統合テストを実行する。
- APP.versionと要件定義書・技術設計書の文書版は0.17.9に同期。


## 社内文書：フォルダ・検索タグと高速化（2026-10-10）

- 対象ソース：src/CompanyDocs.gs、src/AppCompanyDocs.html、src/StylesCompanyDocs.html。商取引書類・総務備品・勤怠など既存機能の保存先を変更しない。
- スキーマ：旧16列（A:P）を維持し、Q=業務フォルダID、R=カンマ区切りタグ。旧16列のみのDBは読み取りを許し、更新はADMINによるバックアップ付き初期化を実施するまで拒否する。
- 移行：initializeCompanyDocuments はADMIN＋ScriptLock必須。バックアップ成功後、ensureSchemaSheet_ が不足列を追加し、既存本文・版番号を保持する。
- 分類：COMPANY_DOC_FOLDERS に親子2階層の安定IDを定義。文書は末端フォルダのみ保存し、保存時に登録済みIDか検証する。古い未分類文書は「その他の文書」として表示する。
- API：getCompanyDocumentsはA:OとQ:Rのみ読み、本文Pを読まない。getCompanyDocumentは選択時だけ本文を読み込む。検索API searchCompanyDocumentBodies は2～80文字の語でP列TextFinderを使い、権限により公開文書IDのみ最大250件を返す。
- クライアント：検索APIは入力後320ms遅延、返答のセッション・リクエスト識別を照合して古い応答を除外。文書詳細はID＋revisionでキャッシュ。60件ずつ段階描画する。
- UI：3ペインGrid、1120px以下で2段階、760px以下でフォルダ・一覧・本文の切替。すべての本文・属性をHTMLエスケープし、外部リンクはHTTPSだけ許可。
- QA：test_company_documents.mjs（既存16列アップグレード／権限／検索／CRUD）、test_company_documents_client.mjs（ブラウザ操作契約）、test_company_documents_viewport.mjs（Chromiumによる明暗・PC・タブレット・スマホ表示）。


### 社内文書・横断検索と安全性の品質ゲート（2026-10-10）

- companyDocsSetQuery：検索入力開始時に folderId='all' に戻し、必要なときだけ画面再描画後に入力欄のフォーカスを復元する。通常の入力更新は一覧DOMだけを書き換える。
- searchCompanyDocumentBodies：空白区切りの複数語を重複排除し、Range.createTextFinder(term).matchCase(false).useRegularExpression(false).findAll() を語ごとに実行。結果の行番号集合の共通部分を求め、権限を再チェックし文書IDのみ最大250件返す。
- 編集UI：dirty フラグを入力変更時に設定し、保存後に解消。キャンセルと画面遷移時はモーダル確認を要求する。AppCore.navigateから会社文書モジュールの companyDocsConfirmLeave_ を呼ぶ。ブラウザ再読み込みはbeforeunloadガードで確認する。
- 安全なイベント属性：companyDocsInlineId_ は JSON.stringify した値全体をHTMLエスケープ。サーバーも companyDocsValidId_ で想定外IDを除外する。
- 視認性：darkテーマの公開・下書きバッジは明示RGB色を採用し、Chromium viewport QAで getComputedStyle によりforeground/backgroundを取得しコントラスト比4.5以上を検証する。

- 複合語検索は業務フォルダやタグ等の軽量メタデータと、本文TextFinderの一致行番号を語ごとに和集合にしてから、語間の共通部分を計算する。権限外の文書は事前・返却前の双方で除外する。
- companyDocsDropHiddenSelection_ が絞り込み後の不一致プレビューを解除する。AppShell.performLogout も companyDocsConfirmLogout_ を経由し、未保存文書の破棄を明示確認する。

## 月次確認保存のB列社員ID索引による行特定（2026-10-10）

- `Monthly.gs:confirmMonthlyReview` は `getRange(2,2,lastRow-1,1).createTextFinder(employee.employeeId).matchEntireCell(true).findAll()` で候補行を取得し、それぞれのA列の年月を `getDisplayValue()` で照合する。
- 対象行を見つけた場合だけA:Jの10列を1行取得し、`createdAt` と監査前状態を保持して更新。なければ末尾に10列を新規記録する。従来の `getRange(2,1,lastRow-1,10)` 全件転送は廃止する。
- `scripts/test_monthly_review_index.mjs` のNode VMモックを既存 `scripts/test_data_access_performance.mjs` から実行し、同社員別月・別社員同月・月次未完了・当月拒否を検査する。
- 権限・月次統計・監査ログ・DBスキーマに変更はない。具体的なGAS実測値は未測定。

## 経理アドバイザーの実装（2026-10-10）

- **src/FinanceAdvisor.gs**: read-only `getFinanceSpendingInsights(sessionToken,{year})`、`financeSpendingDigest_`、`financeTravelExplanation_`、`getFinanceTravelExplanation`、`lookupFinanceInvoiceIssuer`。保存APIは既存Finance.gsのまま。旧台帳へのWrite/Append/Deleteは行わない。
- **支出分析データ境界**: スクリプトプロパティ `FM_LEGACY_EXPENSE_SPREADSHEET_ID`、未設定では共有済みの旧台帳IDを使用し、シート「経費」A:Jの見出し確認後に読み取り。使用日が対象年に属する全行を集計し、不正金額はskipとして件数を示す。年月（月別グループ）と支払者／取引先／品目の合計を返し、明細は最大160件の新しい順。サーバーキャッシュ有効期限120秒。承認トップではこのAPIを呼ばない。
- **旅費の内訳**: 社内規程2025-12-01、役職別rate tableを基礎に片道100km・早朝7時前・夜間20時以降・宿泊実費と上限を個別検証。宿泊を伴い時間帯手当の適用日が不明な場合などは`REVIEW_REQUIRED`で総額`null`とし、担当者の承認前に確定しない。現行「出張報告」の列を追加せず、根拠の転記は既存`note`と`requestedAllowance`へ利用者の明示操作で行う。
- **国税庁**: `NTA_INVOICE_API_ID`をスクリプトプロパティのみから取得（13桁）。ブラウザ・ログに秘匿IDを出さない。公式JSON`announcement[].registratedNumber`（原文のリソース名はregistratedNumber）を厳密照合し、`name`, `address`, `registrationDate`, `disposalDate`, `expireDate`等のみを返す。未設定／番号不正／取得失敗／未該当と成功を区別して扱う。公式情報の免責をUIに表示。
- **src/AppFinance.html**: 経理トップの支出分析切替、経費記録の事業者照会、旅費申請画面に計算根拠を表示。**src/AppFinanceAdvisor.html**を専用の追加フロントモジュールとし、CSSを**src/StylesFinanceAdvisor.html**に分離。Index.htmlから読み込み。支出分析の人別検索や明細検索はページ内だけで処理し、不要なGAS通信を避ける。
- **テスト**: in-memoryの旧台帳のみを読み取り、複数年・支払者別・アクセス権限、出張の100km境界・実費12,000円／上限20,000円・多泊条件・未確認を検証。国税庁APIはモックで`registratedNumber`を返し、未設定なら通信せず会社名を捏造しない。新しいUI表示・フロントRPC引数・操作後の権限制御を全既存回帰検証とともに実行する。

- 片道100km未満、宿泊なし、早朝または夜間の経路は `issues` に業務理由・経路・会社承認の必須確認を加え、`status='REVIEW_REQUIRED'`・`total=null` とする。後日の説明に備え、備考へ転記する参照計算はNo.1～No.5、上限適用、宿泊実費それぞれの式を含める。

- サーバー側で年月×支払者の集計表`payerMonths`を事前生成し、上位30支払者の12か月を転送する。UIでの支払者選択は`payerMonths`を使うため通信しない。分類集計にはプロトタイプを持たない辞書を用い、`__proto__`等の取引先文字列も安全に扱う。
- 国税庁Web-APIへのHTTP呼び出し例外にURLとアプリケーションIDが含まれる可能性があるため、エラーの原文を運用ログに出力せず固定の診断コードのみを記録する。

## v0.19 総務コックピット拡張設計
- Overviewは D案「優先対応」＋B案「一覧/詳細」のハイブリッド。サイドバーのメニュー名「総務」を維持し、内部で日常処理・資産設備・情報管理の3グループにナビゲーションを整理する。
- DB_SCHEMA_VERSION=14。総務契約(20列)、総務施設設備(17列)、総務依頼(17列)を追加。既存の経費や社内文書、総務基本4シートの見出し/保存APIを変更しない。管理者が既存migrateDatabaseToCurrentで事前バックアップ後に追加する。
- src/SomuGrowth.gs: getSomuGrowthData(sessionToken,forceFresh)、saveSomuGrowthRecord(sessionToken,kind,payload)。登録時送信識別子の重複と更新時revisionをScriptLock下で判定、登録者IDをサーバーから採番して記録、監査ログで変更経緯を保持。原本の保存はせずHTTPS参照先のみ。
- Somu.gsのSOMU_MODELSへcontract/facility/ticketを追加するが、somuStorageStatus_は従来4種類のみを検査して既存機能をブロックしない。getSomuWorkspaceは従来4台帳だけを取得し初回速度を維持する。
- 新規3台帳は任意の遅延取得と20秒の短命CacheServiceスナップショットで読込。すべてのキャッシュヒットの前にサーバーで権限を再検証。保存後somuInvalidateSnapshot_経由で両キャッシュを破棄する。
- UI側の入力は項目の必須/最大文字数/日付/ENUMをGASとHTML両方で検査。明示的な保存成功が確認できたときだけ表示を更新し、通信失敗時は編集フォームを保持する。

- 総務の既存client contract回帰テストはv0.19の8グループ化ナビ・「今日、対応すること」ホームを契約として評価する。旧ラベル「総務ホーム」の固定文言チェックは除外する。

- 統合テストではbase 4シートのsnapshotと追加3シートのsnapshotを別キーで保持し、実書込後は両方無効化されることを検査する。

- scripts/test_somu_viewport.mjs は既存8パターンに新機能4パターンを追加。新台帳は架空データをセットしたうえで Chromium の幅/横スクロール/ナビ8項目/一覧表示を検証し、画像をGitHub Actionsに保存。

- v0.19の実画面レビューで下部の重複CONTRACT WATCHを除き、ホームは未処理件数/要対応一覧/管理入口に限定。契約の期限詳細は契約タブに保持。台帳一覧の注意バッジは状態値ではなく「期限注意/点検注意/要対応」を出し、状態と注意を混同しない。

- 1366×768/1440×900は somu-hub-grid の実画面下端がviewport内であることを自動判定。KPI・優先対応行を44px操作領域を保ちながら圧縮し、余計なスクロールを減らす。

- 画面高さの客観測定で1366×768のホーム下端が803.2pxとなったため、優先表示を4件へ制限。すべての対応は既存の個別管理台帳で確認でき、残件数を表示。増量テストで5件以上でも最初の4件のみ描画することを確認する。

- 増量フィクスチャは実際の期限条件で表示件数が変わるため、残件の具体数値を固定せず、優先4件と「残りN件」の表示をチェックする。

- 1366px画面の再測定でホーム下端803pxが持続した原因は、優先対応行ではなく右側6カードの3段積みとリンク行にある。入口カードの「開く」テキストを右端矢印として絶対配置して2行に圧縮し、60pxのクリック領域を確保する。


## 共通ロータリーローダーの実装構成（2026-10-10）

- ユーザー提供のProduction ZIPのハウジング形状・ローターと偏心軸3:1連動・色・高速回転を、src/RotaryEngine.html、src/StylesRotaryLoader.htmlに移植する。SVG生成後はアニメーションフレームごとに変換行列のみ変更し、外部通信は行わない。
- src/AppRotaryIntegration.html は FMRotaryRPC() を提供し、従来の google.script.run.withSuccessHandler / withFailureHandler / withUserObject とAPI引数の仕様を維持しつつRPC開始・終了を追跡する。全フロントエンドのRPC呼び出しはこの関数を経由し、単体テストでローダーが存在しない場合は従来APIへフォールバックする。
- Index.htmlはスタイルをheadに、ロータリー描画・共通RPCをAppCoreより先に読み込み、初回DOMが利用可能になった時点でページ起動ローダーを開始する。
- pageはbody、regionは再描画で削除されない #app .workspace をホストに利用し、検索欄はinline。Mapによる参照件数で並列処理の全完了を判定する。
- 成功コールバック実行後にcomplete、失敗コールバック実行後にfailを通知。タイムアウト疑似エラーは作らない。長時間通信は説明文を表示する。
- 通常のGAS通信では進捗％を指定せず不確定表示、実進捗が取得できる他処理のみsetProgressを利用できる。
- scripts/test_rotary_integration.mjsとscripts/test_rotary_viewport.mjsをCIおよび公開前検証に組み込む。

## v0.18.0 入力保全・読取再利用・再試行整合性

- AppCoreのPAGE_CACHE_TTL、AppOperationsの対象期間キャッシュ、AppPeopleMonthlyの結果キャッシュ、見積・経理・総務・社内文書の読取期限を300000msに揃える。キー・セッション識別・権限検査は既存仕様を維持する。localStorageへ業務記録は保存しない。
- FMRotaryRPCの成功ハンドラの前にinvalidateBusinessViewsAfterWriteを実行し、見積/経理/総務の読取期限とホーム/勤怠の関連キャッシュを失効させる。経理は読取revisionと分析serialも更新し、保存前に開始した応答を排除する。保存コールバックは確認済みレコードの反映と再取得を引き続き担当する。
- AppRotaryIntegrationはget/list/find/search/healthCheckのみが動作中のregionへfmr-read-statusを付与する。StylesRotaryLoaderで固定位置の小さなpointer-events:none表示に切り替える。完了アニメーション中も同じ表示を維持し、全画面表示への一瞬の切替を防ぐ。認証pageと変更操作regionは従来方式。認証失効は共通エラーハンドラへ渡す。
- AppShellはcompositionstart/endによってIME変換中のinnerHTML差替えを延期する。同一ページでは入力欄の識別子と選択範囲、details[data-form-section]の状態を復元する。経理入力はAppFinance.financeRememberEntry_でsourceへ転記し、画面切替前にも保持する。旅費試算の補助入力もsourceへ保持するがサーバー提出payloadの項目は増やさない。試算の応答はフォーム参照と送信時入力signatureが一致した場合のみ採用する。
- AppQuotesは未保存editorを一覧取得から分離して描画を保全する。quoteUpdateFieldで発行ボタンを即時無効化する。quoteParsePaste_はTSV4列を一括検証してから編集モデルへ追加し、検証失敗時は元の明細を保持する。StylesWorkflowV15の追記は既存画面へ限定して適用する。
- Somu.getSomuWorkspace(token,forceFresh,includeGrowth)の第3引数trueでgetSomuGrowthDataの結果をgrowthへ同梱する。2引数の既存呼出しは基本4台帳のみという互換性を保持する。サーバーキャッシュは従来の基本/追加の別キーのまま、同梱前に各APIがセッションと総務権限を検査する。初回取得中に追加タブを選んでも追加RPCを発生させない。追加台帳の読取serialによって旧単独取得が新しい同梱結果を上書きしない。
- 総務タブ状態はMapで保持し、somuReset時に消去する。入荷から備品登録へは入力補助として転記し、備考に[購買:ID]を記録する。取得済み一覧で同じ記録を検出した場合は該当備品へ移動する。全履歴の一意な購買関連付けをDB制約として保証するものではない。
- LeaveLedgerはemployeeId/requestId/type（USE・RESTORE）で既存記録を確認する。再試行では日数一致を検査し、最新の台帳残数から社員マスタを修復する。Requestsは台帳/修正打刻を適用してから承認状態を保存する。打刻の申請IDマーカーで再appendを防ぐ。途中副作用のある申請を差戻し・取消、返却済み途中取消を却下する操作を拒否する。Google Sheets間の書込は原子的なトランザクションではなく、失敗後に同じ判断で再実行することで回復する設計。
- 検査は既存統合・権限・I/O・画面検査を維持する。scripts/test_business_workflows.mjsをCI/公開前に追加。scripts/test_leave_transaction_retries.mjsをtest_logicから実行する。既存Chromium検査へ見積の入力幅優先と経費/出張の項目グループを追加し、既存の画面数で確認する。
- 運用上の残確認：実GASへのGoogle認証、既存DBのschema14の適用状況、原本Excelの印刷一致、実権限での業務一巡。検査結果と公開状態はPRで追跡し、接続不可を成功扱いしない。

- 画像レビューで旧4列時代のgrid-column:span指定が3列の基本情報を縦に引き延ばしていたため、取引先2列/番号1列、主要入力各1列へ明示的に上書きする。見積の余白を圧縮し、test_quote_viewportの既存PC編集ケースを1366×768へ変更してfirstLineTop+38<=heightを検査する。検査画面数は増やさない。

- 1366×768の実測でfirstLineTop=772.8pxだったため、1200px以上では取引先検索・取引先選択・番号を各1列の同一行へ配置し、基本情報の行数をさらに削減する。
- 既定DBのmetadataと設定B6の読取結果はDB_VERSION=12、総務7シートなし。経費記録17列、精算申請20列、出張報告の先頭26列、見積ヘッダーの先頭26列、明細7列、取引先7列は期待見出しと一致した。実行中GASの環境/DB上書き設定は未確認のため、既定DBを実稼働DBと断定しない。DB変更は行っていない。既存migrateDatabaseToCurrentは管理者セッション・ScriptLock・見出し事前検査・バックアップ・事後schema検査・監査を備え、実接続先確認後に利用する。


### 運用状態の更新連携（2026-10-10）

AppAdmin.loadMaintenanceのforce要求は実行中でもrefreshNeededに保持する。2本の運用RPC結果を一時保持し、両方完了後に適用する。再取得予約があれば旧結果を破棄してforceで再取得する。セッショントークンとmaintenanceオブジェクトを照合し、古いセッション応答を無視する。明示更新・DB移行後・労務設定保存後はforceを使用する。

## ProjectHub / DB v15（v0.19.0）

`ProjectHub.gs`、`AppProjectHub.html`、`StylesProjectHub.html`に案件集約を分離する。Indexのinclude、AppCoreのNAV/route/保存後無効化、AppShellの初期routeと入力保持へ接続する。既存のプロジェクト9列・工数15列・見積列を変更しない。

| 追加台帳 | 保存内容 |
| --- | --- |
| プロジェクト計画 | 案件ID、予算工数（分）、責任者、見積ID、受注情報、概要、旧名JSON、revision・更新者・送信識別子 |
| プロジェクト作業 | 案件ID、担当、開始/期限、予定分、進捗、状態、メモ、revision・更新者・送信識別子 |
| プロジェクト資料 | 案件ID、種別、本文、HTTPSリンク、共有/非表示、revision・更新者・送信識別子 |
| プロジェクト共有 | 案件ID、種別、本文、投稿者名・ID・日時・送信識別子 |

`getProjectHubWorkspace(token,force)`は案件一覧と集計・社員表示名・閲覧可能な発行済み見積を返す。一覧では資料本文と共有メモを読まない。詳細では案件ID列を先に読み、資料本文・共有メモは該当案件の連続行だけ取得する。`getProjectHubDetail(token,projectId,force)`は対象案件の作業・資料・共有と許可された工数明細を返す。未移行はsetupRequired、列不一致はエラー。工数の削除行を除外し、共通生データをScriptCacheに20秒保持する。saveWorklog/deleteWorklogはこのキャッシュを削除する。キャッシュ後にセッション権限を適用する。

進捗 = Σ（作業予定分 × 作業進捗率）/ Σ作業予定分。日程目安は開始日から期限までの暦日直線補間を同じ重みで平均する。休日・実作業順序を含む工程予測ではない。予算工数未設定なら作業予定分合計を使い、計画がなければnullを返す。工数消化率 = 実績分 / 予算分。案件名・旧名はtrim/lowercaseで照合し、類似顧客名は照合しない。

`saveProjectHubRecord(token,kind,payload)`はScriptLock内で認証・案件・編集権限を再検証する。予定時間は分に変換する。既存revision相違は拒否し、完全に同じ内容の再試行だけ成功扱いにする。新規保存のrequestKeyは作成者・案件・内容が一致する場合だけ重複扱いにする。記録保存後の監査失敗はauditRecorded=falseとして保存済みを明示する。task/resourceの非表示は通常のrevision付き保存を経由し、完了作業の100%を非表示に戻さない。案件管理者のみ作業を、作成者または案件管理者のみ資料を非表示にできる。新しい見積を選択すると、閲覧可能な選択先に応じて受注金額欄を切り替える。資料本文はシート式注入を抑止し、HTMLはescapeHtmlで描画する。リンクはcompanyDocsUrl_でHTTPS検証する。

案件名更新はProjects.gsから旧名を計画台帳に記録してからマスタを書き込む。未移行時の名称変更は連携を失わないため拒否する。旧名の他案件への再使用も拒否する。全社員の集約値は共有するが、個人明細は本人/直属メンバー/ADMIN、受注金額・見積は元見積の閲覧権限に従う。

クライアントはセッション内Mapに一覧と案件詳細を5分保持する。タブ・検索・モバイル案件選択の開閉はRPCなし。700px以下では選択欄を折りたたみ、最初の画面内に案件内容の先頭が見えることを検証する。保存後無効化とforce更新で再読込し、serial・ユーザー識別・stateオブジェクトで遅延応答と別ログインの混入を防ぐ。メニュー移動と同一ページ再描画前にフォームを退避する。再読込/ログアウトで下書きは消去し、変更済みフォームのbeforeunloadを検知する。業務データをlocalStorageへ保存しない。

検証：scripts/test_project_hub.mjs（実集約、保存/権限/重複/競合、クライアント通信・入力）とscripts/test_project_hub_viewport.mjs（PC/スマートフォン・明暗テーマ）をCIに追加する。DB移行は既存のバックアップ付きmigrateDatabaseToCurrentの明示操作に限定する。ライブ環境の対象DB設定と認証を確認できるまでは本番CRUD検証を完了としない。


## 2026-10-10 通常台帳への確認データ投入 v0.19.1

- 対象はソース既定IDの既存FM WORKS DB。添付画面の管理者表示名と社員マスタを照合し、既存シートのメタデータとスキーマ見出しを確認した。
- 作業前にDriveで全体コピーを作成。バックアップID: `1-8Nvs3si4pKdKJ-EgpxqF6wjuxD519QNVgpOZB0aD48`。
- DB_SCHEMA_SPECSどおりの総務7台帳とプロジェクト4台帳を追加し、26スキーマ対象の見出し一致を確認。既存シートは追加行以外を書き換えず、全投入行の読み戻し後に設定A6:D6のDB_VERSIONを12から15へ更新した。
- 72件: プロジェクト3／計画3／作業9／資料6／共有9／工数9、総務備品3／貸出3／購買5／書類3／契約3／設備3／依頼3、経費記録3／精算申請4／出張報告3。
- プロジェクトIDは `PRJ-CHECK-20261010-001`〜`003`、子レコードIDと送信識別子はCHECK接頭辞で識別。工数は案件名を一致させ、同じ社員・日付の時間帯を重複させていない。予定分・実績分・進捗率は数値セル、日付は既存アプリと同じISO日付文字列。
- 資料は通常の本文欄へ要件・技術設計のMarkdownを保存。存在しない資料URLや請求書番号を作らず、総務の原本URLは未登録とした。
- AppSomu/AppSomuGrowthの埋め込み架空レコード、demo状態、切替関数と保存禁止分岐を削除。総務はDB取得結果だけを表示し、概要と7台帳の既存ナビゲーション・保存・権限制御を維持する。
- 確認データは本作業で接続済みSheetsへ追加済み。起動時に投入する処理やデモ専用シートは追加しない。再投入は既存IDを確認し、登録済みの同一レコードを重複作成しないこと。
- 実DBの追加行72件・新規11シートの見出し・DB_VERSIONはコネクタから読み戻して確認。GAS認証付きブラウザーでの実保存・返却・承認は本作業環境で認証できないため、別の確認項目として残す。


## Project experience UI v0.19.2 (2026-10-10)

- `AppProjectHub.html` extends the current session-local workspace with `view=list|detail|dashboard`, query, filter, sort and 20-row display limit. `getProjectHubWorkspace` and `getProjectHubDetail` contracts are unchanged; no DB migration, permission expansion, new server API or sample data writes.
- The landing portfolio reuses the workspace aggregate and separates work completion (%) from effort consumption (planned/actual minutes). Sorting and filtering are client-only; zero planning is rendered as "計画未設定" rather than zero completed.
- Detail layout replaces the persistent left picker with a breadcrumb and top facts. Existing five functional tabs, optimistic read cache, conflict/retry identity, draft retention, and server-authorized edit actions are preserved.
- Management overview is restricted by `state.data.permissions.adminConsole`. It displays only real project aggregates (count, overdue tasks, total hours, existing planned hours) and links to detail. Project-level figures do not imply permission to access restricted personal worklogs or order values.
- `StylesProjectHub.html` provides desktop/tablet/mobile rules for portfolio rows, management tables, hero facts, and filters. The existing detail viewport test explicitly selects detail view. `test_project_hub.mjs` checks portfolio entry, sort, navigation, escape and manager access.
- Known gap: the illustrated designs include future concepts that are outside existing APIs (uploading binary files, auto-generated risk predictions, financial profitability analytics, comprehensive member assignment). Those remain unimplemented. Production authenticated browser CRUD/performance measurement is a separate acceptance gate.

- 320px小画面は案件ヘッダ/基本情報帯を圧縮し、基本情報を横スワイプ表示に切り替えて作業タブの先頭が初期スクロール位置で見えるようにする。


## v0.19.3 Project tabs and registration usability (2026-10-10)

- AppProjectHub.html adds local state view handlers for taskView=board|timeline|list, resourceFilter, resourceQuery, updateFilter, and updateQuery. Existing session-scoped caches, optimistic snapshots, draft protection and server APIs are unchanged. Client filters never fetch extra data.
- Board stages reuse ProjectHub.gs task status values; cards are read-only except existing authorized edit action. Timeline computes a linear UTC date axis from valid ISO start/due dates and renders scheduled bars with completion ratio. Unscheduled tasks remain visible in a separate list, with no invented dependency/holiday/forecast calculations.
- Effort view uses getProjectHubDetail metrics, valid existing logs and worklogScope, retaining server filtering of byPerson and individual rows. Usage percentage is rendered only with a positive known plan. Frontend must not derive hidden per-person records from total aggregate.
- Project resources remain ProjectHub resource documents: virtual filtering by existing kind, local title/body search, expandable escaped text, server-validated HTTPS source link, and template shortcuts. No binary upload, new Sheets, or persistent folders.
- Shared updates remain newest 60 records, append-only. Local kind/search filtering and recent decisions use kind=決定事項, not computed AI priority or server-side notifications.
- AppAdmin.html keeps saveProject(sessionToken,payload) and ADMIN checks while reducing first-create visible fields. Original IDs remain prjName, prjClient, prjStatus, prjStart, prjEnd, prjNote; optional inputs use details[data-form-section] and are still submitted when collapsed. Client validates name/date order, disables duplicate submission, restores control on errors, and enters the new project detail after success.
- StylesProjectHub.html adds responsive tab boards, scroll-contained schedule, file categories, memo feed, and compact modal styling. Regression tests in scripts/test_project_hub.mjs exercise local routing/filtering, XSS escaping, modal validation and failure recovery. scripts/test_project_hub_viewport.mjs tests further 320/390/1440 widths and light/dark pages.
- Production authentication, real GAS save behavior and user observation remain separate acceptance checks. No DB migration, live data writes, third-party synchronization or new OAuth scope is performed in this change.

- Timeline guards ISO date roundtrips and rejects invalid imported dates without throwing; project master save failures preserve the common AUTH_REQUIRED / SESSION_EXPIRED handling route.


## v0.19.4 Lazy details, linear workspace aggregation, task-to-worklog intent

- AppProjectHub.loadProjectHub obtains the cached project workspace but no longer issues getProjectHubDetail while view=list or dashboard. Navigation into view=detail triggers the existing detail fetch; projectHubTab_ also ensures the detail request for deep links. No prefetch of document bodies on portfolio load.
- ProjectHub.getProjectHubWorkspace indexes first plan per project, tasks by projectId, resource counts and worklog buckets by normalized project/alias names. Aliases can map to a set of project IDs, preserving historical semantics when legacy names overlap. Unlinked worklogs are counted once and employee/quote permissions remain applied at the original server boundaries.
- projectHubMetrics_ checks ISO dates with a UTC roundtrip before deriving scheduled progress or expired-task counts. Malformed imported dates do not produce NaN percentages.
- AppProjectHub.projectHubRecordWork_ records optional task title with queueProjectWorklogIntent, switches only to active projects and navigates to the existing worklog route. Task title is copied to the normal worklog description, not treated as a durable task ID relation; hours do not automatically become a task-level actual-hours metric.
- AppOperations stores one in-memory, identity-bound project worklog intent. restoreWorklogQuickDraft applies it once the real quick-input form appears. When another worklog draft exists, the form is protected until the user explicitly applies only project/description, preserving dates/times/category. clearWorklogQuickDrafts removes it on logout. UI labels distinguish the handoff from a saved entry.
- Project overview shows most recently updated existing project docs and latest shared notes with escaped titles/snippets. It does not introduce uploads, AI analysis, or new server calls.
- Regression covers portfolio one-RPC loading, selected detail lazy fetch, inherited worklog draft protection, late rendering, session isolation, malformed schedule, and 90 synthetic projects with 1080 synthetic log rows. Full Chromium/CI and live GAS deployment are gates; authenticated production CRUD and measured cold-start latency remain separate.


## v0.19.5 User task filters and admin planning allocation

- ProjectHub.getProjectHubWorkspace extends existing per-project aggregation with myOpenTasks, myOverdueTasks and nextTaskDueDate. Only authenticated user's ownerId is matched for my* fields. Dates use validated ISO strings, incomplete tasks use status and progress consistently with existing calculation rules.
- The administrator-only employeeWorkload field is calculated from existing task records for projects with status=進行中. It groups by ownerId (including an explicit unassigned bucket) and includes openTasks, overdueTasks, plannedMinutes. No employee worklog rows, personal attendance records, financial amounts or actual overtime are included. The server omits the field for non-admin users entirely.
- AppProjectHub adds a local '自分の作業' filter and per-project own task chip, plus a management planning-assignment table. The table is not an availability/overload calculation and must not be described as an actual effort load.
- The existing project/worklog data cache, date validation, active project checks, name-alias grouping, and permission checks remain in force. No DB migration or new API endpoint.


## v0.19.6 Compact assignee task editor

- AppProjectHub.projectHubEditor_ branches by existing canManage scope. Assignees see a read-only task summary plus progress/status/note; managers retain all original planning fields, with start/due dates grouped under details[data-form-section].
- The existing editor form object retains title, ownerId, plannedHours, startDate, dueDate and revision for secure server-side equality checks even when fields are not rendered for a contributor. projectHubRememberDraft_ updates only controls that actually exist in the DOM.
- projectHubTaskCompletion_ writes status=完了 and progress=100 into the client draft and rerenders. It makes zero write RPCs; projectHubSave_ remains the only explicit persistence action and retains requestKey, conflict handling and retry identity.
- Browser tests cover an additional mobile new-task form. VM integration tests verify contributor input reduction, that immutable fields reach saveProjectHubRecord unchanged, no premature save and failed-save recovery. Existing projectHub and worklog schemas stay unchanged.


## Project extensions, v16 (2026-10-10)

- Schema.gs version 16 adds **プロジェクト工数対応**, **プロジェクト依存**, **プロジェクト添付**, **プロジェクト既読**, **プロジェクト原価**, **プロジェクト予算**; existing worklog/master/plan sheets are preserved. The administrator-only migration verifies a full backup before altering sheets; deployment does not migrate DB. A setupRequired banner is shown until migrated.
- ProjectAdvanced.gs owns optional validated sheet access, per-project membership by current plan owner/task owners, cycle detection on adjacency lists, revision checks, worklog linking with request keys, Drive-backed private files, per-user notification receipts, manual expenses and budgets. Only ADMIN sees financial fields. File storage uses the Apps Script deployment owner's private Drive folder; downloads use session-checked RPC rather than publishing sharing links. Allowed MIME/extension pairs: PDF, PNG, JPEG, TXT, DOCX, XLSX, max 1.5MiB, magic header checks for PDF/images/Office ZIP header, not full malware scanning.
- Worklog.gs accepts optional taskId and requestKey and maps existing data via a separate sheet; existing worklog table remains 15 columns with existing time overlap, permissions, monthly close checks and audit. The task ID must belong to the selected project. No backfill guesses on historical worklogs. On lost responses, requestKey + payload equality is the idempotency gate.
- AppProjectHub.html invokes resetProjectAdvancedUi_() on session teardown. In-flight advanced RPC responses are discarded using the identity and UI-instance guard; admin-only budget and attachment metadata are not retained across logins.
- AppOperations.html adds task selector to quick and modal worklog forms, safely stores pending task ID and preserves unsaved time/date/category details, keeping attempt keys between retries. AppProjectHub.html adds detailed management tab mounted through AppProjectAdvanced.html, which loads data only when selected.
- Notifications.gs appends authorized deadline/memo alerts into the normal bell. AppShell.html routes user into the relevant project and marks the chosen notification read. Notifications list never returns Drive IDs, cost data or per-person worklogs.
- Limits: DB must be explicitly migrated in an authenticated admin session; no browsing of the authenticated live GAS app from GitHub CI; user-specific browser proof, cross-browser testing on Windows/Mac, automated virus scanning, exact accounting profit/expense auto-match and critical-path scheduling are not established by this release. These stay open in Issue #72.

## v0.20.1 Migration affordance and passive timing diagnostics

- ProjectHub.getProjectHubWorkspace returns advancedMissing to ADMIN only, calculated by six cheap getSheetByName existence checks. Full column verification and verified backup remain the responsibility of the authenticated admin-only migrateDatabaseToCurrent procedure. No schema mutation is performed by the project page.
- AppProjectHub adds a role-gated migration banner and a direct link to the existing admin operation tab. AppProjectAdvanced shows the same link when v16 storage is unavailable.
- Browser-local projectHubTimingSamples stores {label, ms, ok} with a rolling maximum of 500 entries and only four predeclared labels. Latency is timed between sending the existing RPC and receiving its success/failure handler; no additional RPC, PII, files, or local storage. Timer state is cleared by resetProjectHubUi on logout.
- Admin-only projectHubTimingPanel computes nearest-rank P50 for any nonempty sample set, and P95 for 20+ samples only. The values reflect client/network/GAS round trips, not GAS function execution alone. Cache hits, splash screen start-up, and cold/warm network classification are out of scope of this passive panel.
- Tests cover six missing v16 sheet names, admin/staff UI separation, cache/session clearing, initial P95 suppression, failed-RPC counts, and absence of extra network activity. Chromium viewport checks remain the release gate.

## v0.20.2 Guarded migration regression and audit recovery

- The migrateDatabaseToCurrent function remains the sole admin-authorized schema update path. It preflights all nonempty existing schema headers, creates and verifies a backup before modifications, upgrades missing sheets non-destructively, then moves DB_VERSION to 16 and flushes.
- If audit append fails after successful schema verification, the function returns {ok:true,changed:true,auditRecorded:false} and records a server warning. The ADMIN screen explicitly requests an audit-log check rather than suggesting the schema failed or inviting repeated migration.
- scripts/test_schema_migration.mjs uses isolated fake sheets with no private records. It verifies unauthorized rejection, corrupt headers/backup failure with zero mutations, exact six-sheet creation, data preservation, audit ordering, repeat idempotence, audit failure signal, and safe recovery from a synthetic partial failure.
- The CI workflow and the production deployment workflow both execute this contract test before allowing code publication. The live authenticated GAS execution and verified backend spreadsheet update remain separate acceptance evidence.

## v0.20.3 工数の曖昧一致を保留
- `projectHubWorklogOwners_` は現在名と旧名称から案件IDのSetを引く。
- 1案件一致だけを計上し、0件を `unlinkedWorklogCount`、複数一致を `ambiguousWorklogCount` とする。
- 案件詳細の実績と一覧の実績を同じ一意一致規則で集計する。
- 一覧の警告に保留件数を表示。DB、古い工数、名前、アクセス権限を変更しない。
- `scripts/test_project_hub.mjs` は競合する架空の旧名称で一覧・詳細・警告をテスト。

## v0.21.0 年間資金繰りの保存・計算
- DB v17 追加シートは「資金繰り年間」。1行＝決算年度、期首現預金残高、12か月分のJSON、改訂番号、日時、更新者、送信識別子。既存台帳は変更せず、認証済ADMINによるバックアップ付きSchema移行で追加する。
- CashFlow.gsの公開API getCashFlowYear / saveCashFlowYear はいずれも requireAdminSession_ を先頭に配置。financeWorkspaceとは独立して機密アクセスを制御。
- 月別のplanIn/planOut/actualIn/actualOut はnull=未入力、0=入力済0円。各系列の入金と出金が**両方入力済み**の月だけ同系列の月末残高を算出。片側のみ入力の月は0円と推測せず未確定にする（0円のときは明示入力が必要）。未確定月以降の残高は不明とする。見込みは実績が両方入力された月のみ実績を優先、それ以外は計画が両方入力済みなら計画を使用する。
- 計画・実績・実績優先見込みを期首から累積し、最初の赤字見込み月を検出する。別期の期首残高は自動入力しない。
- 1年分を単一シート行に保存、ScriptLock・改訂番号確認・送信識別子の再送厳密照合・書込み後の読み戻し・監査エラー通知を実施。テスト scripts/test_cashflow.mjs。

### v0.21.0 UI接続と一時状態
- AppCashFlow.html / StylesCashFlow.htmlをIndexへ追加し、AppFinance.htmlからcashFlowWorkspace権限に限って遷移する。serverのrequireAdminSession_は独立して必須。
- resetFinanceUiによりlogout時に資金繰りのメモリ内草稿を破棄。API応答はセッション/年度/要求通番が一致するときだけ利用。
- 画面でcashFlowCalc_を用い、計画/実績/実績優先見込みの12か月累積を表示し、SVGグラフを即時更新する。備考はescapeHtmlでエスケープ。
- FMRotaryRPCの保存は同じrequestKeyで安全に再試行し、成功後は再読込で確認。失敗時は草稿を保持する。
- 年度切替・戻る・再読み込みの入力破棄確認はFM WORKS共通の確認ダイアログを使用する。未保存の場合、キャンセルで入力を保持する。
- `financeUi.demo===true` では資金繰り表への入口を無効化し、サーバー呼出を開始しない。サンプル画面と実データの誤混同を避ける。


## v0.22.0 金融機関明細・定期予定
- DB v18 追加シート: 資金口座、資金予定、資金取引、資金月次確定（既存の年間資金繰りは保存）。管理者によるヘッダー検査→自動バックアップ→追加シート作成→監査の順に移行する。
- CashFlowBank.gs: saveCashFlowBankAccount、saveCashFlowScheduledItem、importCashFlowBankRows、setCashFlowTransfer、saveCashFlowClosedThrough、getCashFlowBankWorkspace。すべて requireAdminSession_ で守る。
- 取引は銀行口座・日付・金額・摘要・銀行識別子/残高・同一取引内連番からSHA-256を算出し、再取込を排除。実績確定月までは明細、以降は入出金予定を見込み計算に採用する。

- 取引CSVを最大200件の小分けで、SheetsのsetValuesによるまとめ書きとして実装。最大行数を超えるときはinsertRowsAfterで拡張し、1行ごとappendRowによる待ち時間を避ける。

## v0.22.1 デモ資金繰り・Webページ貼付
- `AppCashFlowSandbox.html` が `cfbDemoCreate_` の固定的な架空データを生成し、既存 `cfbForecast_` を使って年次/月次見込みを表示する。独立したスプレッドシート複製なしで操作できる。
- `cfbUi.demo` が真の間は `cashFlowLoad_` / `cfbLoad_` がサーバーRPCしない。 `cfbRpc_` 自体もfail closed。保存ボタン・入金予定・銀行明細・振替・確定月・期首残高は画面内の一時状態だけを更新する。
- `cfbParseBankPaste_` はタブ・空白・CSVの銀行Webコピーを行配列へ変換し、 `cfbPastePreview_` が既存のCSV列対応・取込前プレビューに接続。バリデーションと明示取込のAPI規則は従来どおり。
- 重要な財務情報はブラウザの永続保存・ログ出力をしない。初回DB移行は既存の管理者バックアップ付き操作が必要。

## v0.22.2 ワークスペース取得処理の共通化（2026-10-11）

- `databaseCacheKey_`で共通JSONキャッシュをDB IDで分離。`utf8Bytes_`は日本語・サロゲートペアをUTF-8バイトで計算する。単一エントリーは90 KB以下。
- `cacheJsonPutLarge_`/`cacheJsonGetLarge_`は大きな工数スナップショットを60 KB以下の断片へ分割し、putAll/getAllでまとめる。最大80断片／4.8 MB。生成ごとにUUIDを変え、全断片の保存後にmanifestを公開する。一部欠損・不正manifest・上限超過・キャッシュ障害では元シートへフォールバックする。旧断片は20秒TTLで消滅する。
- `projectHubWorklogRows_`を一覧・案件詳細・作業別実績で共有する（工数15列、20秒TTL）。書込みは共通manifestを削除し、明示更新はキャッシュを迂回する。作業別集計は案件ID・有効な作業ID・現案件名／旧案件名・工数状態を照合し、他案件リンクを除外する。
- 同一RPC内で検証済みシートハンドルを渡す。プロジェクト計画／作業の取得に使うstorageと拡張6シート、銀行4シートの重複ヘッダー検証・getLastRowを削減。検証済みハンドルを別RPCへ保持しない。セッション・社員認証レコードは従来どおり毎回読み直す。
- 案件詳細管理はUIオブジェクト・ログインidentity・案件ID・serialを照合する。別案件への切替で新しいUIを作り、旧成功／失敗を破棄する。保存後の無効化や読み込み中のforceはまとめた再取得へつなぐ。
- 資金繰りの年間入力・銀行ワークスペースはログイン中のメモリーへ5分保持する。通常の閉じる操作は保存済みsnapshotを保持し、編集draft・入力フォーム・取込プレビューを破棄する。年度変更とログアウトは対象snapshotを初期化し、seqで旧応答を除外する。架空表示を閉じる際はsnapshotを保持しない。明示更新は年間／銀行の両方を更新する。保存・取込中の年度変更／閉じる／別メニュー移動を防ぐ。
- キャッシュ保持期間内の他利用者・直接Sheets編集は明示更新またはTTLで反映。保存の権限・競合チェックはキャッシュに依存しない。既存のDB18と権限・12月〜11月年度・銀行Web貼付・会計と参考原価の区別を維持する。

### 再現可能な取得比較

`scripts/test_workspace_loading.mjs`の架空1500工数（日本語／絵文字）による操作を使用。旧main 50ed0c8と修正版の同一fixtureを比較した。これはAPI呼出回数であり、GAS実測秒数ではない。

| 取得 | 旧main | 修正後 |
|---|---:|---:|
| 案件詳細管理のヘッダー読込 | 19 | 10 |
| 一覧取得後の詳細管理で工数全件読込 | 1 | 0 |
| 続けて一覧取得する際の工数全件読込 | 1 | 0 |
| 銀行ワークスペースのヘッダー読込 | 9 | 5 |
| 資金繰りを5分以内に開き直すRPC | 2 | 0 |

回帰では断片の退去、DB切替、権限不一致、不正な別案件リンク、工数保存後の無効化、案件／年度の切替、読み込み中の再更新、入力破棄、サンプルから実データへの復帰、ログアウトを確認する。


## v0.23.0 Financial reporting system (code integrated; operational acceptance pending)
- Storage: DB_SCHEMA_VERSION=19, additive `資金明細注記`, `資金分類ルール`, `資金シナリオ`, `資金月次照合`. Migrations require ADMIN session, header verification and an approved backup. No automatic DB writes on page load.
- Services: `CashFlowAnalysis.gs` provides secured classification, rules, bank reconciliation and what-if assumption CRUD. `CashFlowReport.gs` derives forecast from authenticated source records, applies conditions to actual scheduled occurrences, and exposes per-month baseline-vs-scenario differences.
- Financial invariant: unreconciled closed months must not be silently adopted; changes/imports in a closed month require reopening the close. All active bank accounts must be reconciled to certify a month; zero-transaction months require an explanation.
- Web: `AppCashFlowAnalysis.html` and `StylesCashFlowAnalysis.html`, mounted in Index, provide classification, monthly reconciliation, scenario editing, report preview and downloads. Cache is cleared on logout and fiscal-year switch.
- Export: ADMIN-only `exportCashFlowReport` recomputes server-side, generates a transient Google spreadsheet with 6 worksheets (annual, categorized bank transactions, categorized plans, 12-month category matrix, bank reconciliation, assumptions), uses authenticated Google Sheets PDF/XLSX export, validates HTTP status, magic bytes and size (max 5 MiB), returns base64 via GAS, and deletes the transient spreadsheet in finally. Never creates a publicly shareable output URL.
- Acceptance: GitHub unit/integration and client contract tests, complete deployment CI, original workbook reconciliation and actual authorized GAS operations must be distinguished. Mock file signatures do NOT prove live Drive authorization or pixel-perfect PDF/Excel compatibility.


## v0.23.1 Resumable bank import
- Bank web/CSV import UI stores `importPending` frozen rows, account ID and filename plus `importIndex`, `importChunkKey` and accepted counts only in per-session memory. A lost RPC reply leaves its chunk eligible for idempotent replay, not a full 3000-row restart.
- The client validates `ok===true`, integer added/skipped and their sum against the sent rows before advancing. An explicit new preview drops the previous pending job. Ordinary data refresh preserves it. Logout clears it.
- No DB schema changes; on replay, the server's existing bank transaction fingerprint provides duplicate suppression. Live GAS import retry must still be validated by the administrator.


## v0.23.2 Financial anti-assumption safeguards
- In `cfrMonthTotals_`, `hasPlan` is true only when the bank workspace reports a scheduled occurrence for that month, the active scenario introduces an amount, or the user explicitly entered both manual inflow and outflow amounts (including 0). Existence of a plan in another month must not initialize unknown periods.
- Keep `cfbForecast_` preview consistent with the server for ordinary schedules and manual values. Warn explicitly about overlapping scheduled and manual amounts; validate annual sums and scenario differences against safe integer limits.
- Previously published reports and source records are not mutated; app release requires all financial and UI regressions in CI.


## v0.23.3 Loss-of-ack financial save recovery
- The transient annotation, rule and scenario drafts retain their request key after a failed or ambiguous RPC, clearing only on user changes. Success handlers require `ok===true` before dismissing forms.
- Reconciliation keeps a keyed pending payload and restores its amount and note in the rendered form after failure. Server idempotency rejects the same reconciliation key with changed note, bank fingerprint or balance.
- No persistent browser storage, DB migration or source workbook modification.


## v0.23.4 Bank reconciliation gross/net separation
- `cfaBankMonth_` sums gross transaction inflows and outflows, including transfers, to reconcile actual bank statement amounts with the bank closing balance. The company-wide `CashFlowBank.gs:getCashFlowBankWorkspace` still excludes transfers from actualIn/actualOut and separately tracks transferIn/transferOut. All bank sums use safe-integer checks.

- The bank reconciliation UI and the sixth exported worksheet both explain the bank-gross/company-net difference so financial report readers do not flag a correct difference as an unexplained discrepancy.


## v0.23.5 Bank statement and external cashflow display
- Extend bankSummaries[] with `statementIn`, `statementOut`, `transferIn`, and `transferOut` while retaining existing net fields `incoming/outgoing`. Bank reconciliation shows account gross totals and company-wide cashflow continues to exclude internal transfers. The standalone sample model uses the same distinctions.

## v0.23.6 Report export session boundary
### Cashflow report stale-callback guard
- `cfaDownloadReport_` retains the requesting session token, fiscal year, scenario and workspace sequence, rejecting completion and failure callbacks after context changes. This prevents cross-user/period report disclosure via delayed browser download callbacks.
- `scripts/test_cashflow_report_session.mjs` tests stale token, fiscal year and scenario responses; CI and Deploy must run it.

- Failed client-side anchor downloads revoke the generated Blob URL synchronously to avoid holding sensitive financial PDF/XLSX data in browser memory.

- `cfaScenarioSelect_` clears the export-in-progress flag because the stale callback is rejected by the captured scenario ID.

## v0.23.7 Transfer counterpart hints without bank data mutation
- `src/CashFlowBank.gs:cfpTransferPairReview_` runs after reading bank transactions in the existing ADMIN-gated `getCashFlowBankWorkspace` call. It uses amount+calendar-day indexes and scans a fixed seven-day (±3 days) window rather than all transaction pairs.
- A candidate is proposed only if an OUT row in account A matches exactly one IN row in a different account and the IN row also has exactly one reciprocal OUT candidate. Other cases are marked missing/ambiguous/invalid; the matching result is `confirmed:false`. The routine never updates `資金取引` or any other sheet.
- It considers all accessible source transaction rows so that a movement spanning the end of a fiscal year can still be recognized; only the selected fiscal-year side contributes to that year's transfer review counts.
- Workspace response adds `transferReview={total,candidateCount,missingCount,ambiguousCount,invalidCount,attentionCount,candidates,attention,confirmed:false,windowDays:3}`. Lists are each limited to 12 rows; counts are never truncated.
- `src/AppCashFlowBank.html` shows a brief alert on the annual overview and a separate read-only, HTML-escaped candidate review table on the bank tab. No extra network call, data mutation, or persistent linked-transfer assertion is added.
- Tests: `scripts/test_cashflow_bank.mjs` exercises unique reciprocal, duplicate-amount ambiguity, same-account, more-than-3-day gap, invalid row, and fiscal-year crossing. `scripts/test_cashflow_bank_client.mjs` checks warning visibility and HTML escaping.
- Manual bilateral confirmation and its audit history remain an explicit future scope; neither the hints nor an absence of warning is a substitute for the existing per-bank monthly reconciliation.

### v0.23.7 Synthetic transfer-review fixture
- `cfbDemoCreate_` seeds one two-bank reciprocal transfer and one one-sided transfer. `cfbDemoTransferReview_` calculates unique matching hints and missing or ambiguous entries from local in-memory transactions during `cfbDemoRebuild_`; it does not call `cfpTransferPairReview_` through GAS.
- The synthetic section is recalculated after transfer flag changes and remains `confirmed:false`. `scripts/test_cashflow_sandbox.mjs` checks the initial panel, review counts, reclassification and zero production RPCs.

## v0.23.8 Ambiguous finance-save response gates
- `AppCashFlowBank.html` checks `result && result.ok===true` before dismissing bank-account and scheduled-item edit forms, clearing the fiscal-close request key, or showing transfer classification success.
- `cfbUnconfirmedReply_(label,retryWithSameKey)` releases the loading flag, renders an error, and preserves the existing draft and idempotency key. The transfer classification path does not offer a blind retry because that RPC is guarded by revision but has no request key.
- `cfbFormValue_` and `cfbCloseMonth_` reject changes while a write is in flight. The session-aware RPC wrapper and existing server ACL are unchanged.
- `scripts/test_cashflow_bank_client.mjs` covers simulated `ok:false`, null responses, preserved keys, blocked pending edits, and regular network failures for account/plan/close/transfer.


## v0.23.9 経理ワークスペースと表貼付の一括保存（2026-10-11）

- 経理: 概要／申請・精算／経費台帳／支出分析／資金繰り／提出資料の導線。申請・報告の既存社員向け画面は維持。
- Excel/Sheets TSVまたはCSV貼付（500行まで）、ヘッダー対応・Excel旧台帳の経費種別の年月混入防止・表でのセル修正・検証、既存類似記録注意、一括登録（API20件/回）。
- GAS `saveFinanceReceiptsBulk` は経理・総務・ADMINのみ。全行を保存前に検査しScriptLock・行別識別子による再送時重複防止。監査ログ未確認を明示。
- 保存前はメモリ内のみ。銀行Webのコピー貼付と資金繰りは既存APIを使い、本番DB／旧Excel／銀行明細は開発時に変更しない。
- 同じデータを再送する場合は送信識別子を維持。実データ書込の受入、口座照合、月次資金繰り帳票の実機確認は別途必要。

- `resetFinanceUi()` は `financeWorkspaceReset_()` を呼び、ブラウザメモリの経費貼付表・再送キー・進捗・監査メッセージをセッション破棄時に消去する。

- `AppFinance.html`の既存 `financePage` は `financeWorkspacePage_` へ委譲。旧描画を `financeLegacyPage` に退避し、ルート表との互換を保つ。

- `scripts/test_client_contract.mjs` のVMソース一覧に `AppFinanceWorkspace.html` を追加し、既存の `financePage()` から画面を生成するテストに参加させる。

- 経理トップの `navigate` 属性はHTML実体参照でクォートを区別し、JS文字列を中断させない。


## Cashflow export: whitespace-prefixed formula injection guard
- `cfrExportCell_` prefixes a single quote for user strings beginning with ASCII whitespace/control characters followed by `=`, `+`, `-`, `@`; formulas generated by the exporter are intentionally authored separately. Regression coverage is included in `test_cashflow_analysis.mjs`.

- 経理優先カードの証憑要確認は `receiptMatches` が未一致／未登録の読込済み `expenses` の件数を表示。タイル操作は従来 `financeJumpTo` の照合フィルターへ委譲。一覧に明示的なキャッシュ強制再取得ボタンを備える。

- `StylesFinanceWorkspace.html` は経理6業務ナビゲーションを狭い表示で2段/3段のグリッドに変更し、`test_finance_workspaces_viewport.mjs` が320px・390pxの表示列数を検証する。


## Release gate for existing Apps Script Web App
- `.github/workflows/deploy.yml` validates the target ID with `clasp list-deployments` **before** `clasp push`. `DEPLOYMENT_ID` secret / `FM_WORKS_DEPLOYMENT_ID` repo variable takes precedence over the project-known published URL's ID. A missing or mismatched ID fails the workflow.
- Only after a matching deployment is confirmed does the pipeline run `clasp push --force`, then `clasp create-deployment --deploymentId ... --description "GitHub ${GITHUB_SHA}"`; a second deployment listing must contain both the ID and SHA description. No silent success when only source push completed.
- CI static gate `scripts/test_deploy_gate.mjs` rejects regression to `DEPLOYMENT_ID is not configured` success and checks that preflight precedes push.

## Plan-to-bank-transaction suggestion contract (2026-10-11)
- `cfaPlanOccurrences_` expands adjacent calendar months using the existing `cfpPlannedMonth_` recurrence policy; requested days 29–31 are capped to the actual month end using UTC.
- `cfaPlanMatch_` compares exact safe-integer amount, IN/OUT direction, optional account, and +/-3 UTC days. Description/title only sorts candidates, not a proof of identity. Result statuses: NONE, POSSIBLE, AMBIGUOUS, TRANSFER, INVALID_DATE. Return max 3 suggestions plus the total count.
- ADMIN-only `getCashFlowAnalysisMonth` reads the schedule when there are bank rows and enriches the paginated response. The client renders escaped native `details/summary` with no extra RPC and no persistent writes. The match is never treated as an accounting reconciliation or approved link.
- Server and client regression tests must cover ambiguity, malicious titles, direction/account/amount mismatch, February month end, adjacent-month entries and no source mutation. DB schema, calculations, and source Excel are unchanged.

- Candidate table adds an escaped active-account label (or inactive-account fallback) and distinguishes scoped versus unscoped scheduled plans. The analysis table remains horizontally scrollable on small screens.

- Mobile QA keeps the existing 760px cashflow table minimum rather than widening the embedded edit form; `test_cashflow_analysis_viewport.mjs` checks 320/390px input bounds.


## v0.24.0 Finance direct-entry grid
- `src/AppFinanceGrid.html` は `FINANCE_GRID_COLUMNS` で表示順を統一したメモリ内編集テーブル。`src/StylesFinanceGrid.html` はライト/ダークの高密度表、行番号・列ヘッダー固定、PC/スマートフォンで表のみ横スクロールを定義する。`Index.html` で既存経理UIの後に両者をinclude。
- `financeGridApplyPaste_()` はTSVの行・列の上限を保存前に検査し、一括メモリ更新。列並びが異なる場合は既存 `financeBulkParseMatrix_` + 列対応UIに委譲。初期12行の空行を `financeGridHasRecord_` で除外し、登録時に詰めた `rows` と行別 `requestKey` の組を固定して既存 `financeBulkNext_` へ渡す。
- 登録は既存 `saveFinanceReceiptsBulk` → `FINANCE_MODELS.receipt.sheet='経費記録'` に分離し、サーバー側 `requireFinanceOperator_`・入力検証・ScriptLock・監査ログを変えない。通信失敗時は同一送信キーで再試行する。実DBや元Excel・銀行明細の移行は含まない。
- QAは `test_finance_grid.mjs` と既存 `test_finance_workspace.mjs` および `test_finance_workspaces_viewport.mjs` で直入力・TSV貼り付け・空行除外・権限・重複・デスクトップ/スマートフォンの視認性を検査する。

## Cashflow statement coverage disclosure (2026-10-11)
- `cfbActualCell_` formats imported-but-unreconciled movement as partial, zero unimported rows as unknown, and verified fiscal-closed zero as an actual zero. The financial numerical projection remains unchanged; this is presentation-only. Client regression checks test all three cases.


## clasp 3.x deployment proof improvement (2026-10-11)
- `clasp list-deployments` may omit or reformat the deployment's `description` despite a successful `create-deployment`. To prevent a false negative, capture the CLI acknowledgment `Deployed ID @version`, verify the exact protected deployment ID, and poll `list-deployments` up to three times for the same `ID @version`. If either ID/version cannot be confirmed, the workflow fails rather than reports publication success. The GitHub commit description is submitted as metadata but its presence in `list-deployments` is not used as a mandatory verification field.

## Tax advisor CSV export (2026-10-11)
- ADMIN-only `src/CashFlowTaxExport.gs` reads fiscal-year `資金取引` and `資金明細注記` without mutations; it does not claim accountant approval. Quoted CSV, escaped embedded quotes, UTF-8 BOM, `cfrExportCell_` formula guard, checked nonnegative integer amounts, limits 2500 rows/3MiB; `includeMemo` strictly boolean and false by default.
- Reports tab downloads using Blob and guards late GAS callbacks against session/year/sequence changes; server/client VM regressions cover ACL, note redaction, opt-in, CSV safety, and download.

## Unreviewed bank transaction queue (2026-10-11)
- `getCashFlowAnalysisMonth` accepts strict boolean `onlyUnreviewed`. It builds the existing annotation Map before filtering and paginating statement rows, excluding transfers and annotated entries from the optional queue without suppressing unconfirmed rule suggestions. Invalid filter types fail closed; ADMIN ACL unchanged.
- `cfaToggleReviewOnly_` resets page/editor, bumps `monthSeq`, invalidates old callbacks, and reloads the month. The default unfiltered view remains authoritative and source statements stay immutable. VM server/client regression tests assert all-row and filtered counts, argument typing, zero-page reset and toggle behavior.

## v0.24.1 Bank staging-grid architecture (2026-10-11)
- AppCashFlowBankGrid.html: preview page size 25, editing/paste/copy/exclude, cfbBankGridNormalize_ and cfbBankGridErrors_. StylesCashFlowBankGrid.html: spreadsheet styles with sticky header and table-only horizontal scrolling. Index.html includes both after the bank module.
- AppCashFlowBank.html retains the parser and server contract. Recompute per-fingerprint occurrence after edits. Before first import RPC, validate all rows, normalize and freeze a snapshot containing accountId, fileName and row values; retries must use this snapshot and the same importChunkKey.
- If cfbUi.importPending or importing is true, refuse file replacement, remapping, paste reparse, row edits and exclusions. A refresh must not silently discard a paused import.
- Reparse after a user edit requires explicit confirmation. Original bank site data and FM WORKS historic bank rows remain unmodified until the existing admin-only import API is called.
- test_cashflow_bank_grid.mjs verifies date/amount/length validation, TSV bounds, occurrence reindex, interrupted import retry protection, HTML escaping and pagination; existing bank client regression tests continue to run.

- Additional loss-prevention gate: cashFlowClose_ blocks navigation when cfbUi.importPending is set and asks for confirmation if a bank preview exists; cfbReload_, cfbChooseFile_, cfbPastePreview_ and cfbBankGridSetAccount_ require explicit discard confirmation for edited staging data.
- The permitted flow is staged preview -> all-row validation -> immutable importPending -> resume same requestKey until confirmation. Neither navigation nor remapping may destroy an uncertain import batch.

- `cashFlowChangeYear_` checks `cfbUi.importPending` before resetting the bank UI, including the legacy cashflow view and paused imports.

## Bank-to-planned-cashflow approval records, schema v20
- Add only `資金予定照合` (11 columns) without modifying `資金取引` or `資金予定`, using the existing backup-first administrator-only additive `migrateDatabaseToCurrent` routine.
- `src/CashFlowPlanLink.gs` defines `cfmlRows_`, `cfmlReadLink_` and `saveCashFlowPlanLink`: reads both immutable sources, checks the exact occurrence with `cfaPlanOccurrences_`/`cfaPlanMatch_`, rejects reusing the same `(planId, plannedDate)`, requires admin, exact revision and 12–100-character idempotency key, and uses ScriptLock for a serialized append/update.
- Immutable `cfmlTxFingerprint_`/`cfmlPlanFingerprint_` hashes detect stale confirmations; link state can be NONE, APPROVED, STALE or UNLINKED (stored). The audit append is separately monitored; failure is disclosed. Approval neither updates cash balances nor marks tax accounting done. Migration and service tests must cover unauthorized, mismatched values, duplicates, expired schedules, stale fingerprints, concurrent saves, closed months, rollback and schema preservation.

- `getCashFlowAnalysisMonth` enriches each paged item with read-only `planLink` state and `linkReady` without forcing all financial APIs to require v20. `cfaPlanMatchHtml_` renders native disclosure with accessible explicit buttons; `cfaPlanAction_` uses the existing confirmation dialog, stale-callback/session checks and stable retry idempotency keys. Deleted/changed plans produce STALE and can be unlinked; all financial totals remain unchanged.

- New contract tests extend `scripts/test_cashflow_analysis.mjs` to exercise linked-plan v20 fallback, approval, duplicate schedule occurrence, stale hashes, cancellation, retry idempotency, ACL and source invariance; the browser harness covers the confirm dialog, idempotent retry and accessible state labels. `test_schema_migration.mjs` expects the new sheet and v20 while preserving all preexisting headers.

- Update the two static schema-version markers in `scripts/validate.mjs` from 19 to 20, so the full release validation guards the target schema version consistently with `Schema.gs` and `test_schema_migration.mjs`.

- `scripts/test_cashflow.mjs` must assert `DB_SCHEMA_VERSION === 20`, while still validating unchanged annual cashflow calculations and administrator ACL.

- `scripts/test_cashflow_bank.mjs` and `scripts/test_project_advanced.mjs` verify `DB_SCHEMA_VERSION` 20 while keeping previous balances, import deduplication and project records tests unchanged.


## 2026-10-11 Sample-mode navigation cleanup (phase 1)
- `AppFinanceWorkspace.html` and `AppFinance.html`: remove end-user buttons for synthetic finance mode and cashflow sandbox mode, while keeping normal workflow entrypoints intact.
- Keep sample datasets and all test fixtures unchanged; do not alter FM WORKS DB, authorization rules, RPC interfaces, bank parser, or cashflow calculations.
- Legacy demo-mode implementations remain in source as test dependencies until a separate integration-safe deletion pass following PR #105/#106. No measured GAS speed improvement is claimed for this UI-only change.


### 2026-10-11 Training-only annual leave modal extraction
- Remove `AppLeaveDemo` from `src/Index.html`, user-facing requests/admin buttons, and session reset hook. Relocate unchanged synthetic scenario from `src/AppLeaveDemo.html` to `scripts/fixtures/AppLeaveDemo.html` for Node VM test coverage; leave real accrual and request backends unchanged.
- Strip its unused responsive CSS and keep the small `.leave-auto-actions` control style. Update `scripts/validate.mjs` to reject production inclusion while preserving isolated synthetic calculations.
- Initial payload becomes smaller, but do not infer shorter RPC or Sheets I/O latency without production measurements.

- Remove unused annual-leave demo cleanup from `AppCore.clearLocalSession`; normal logout/session cache clearing remains unchanged.


## v0.24.2 Cashflow spreadsheet-entry architecture (2026-10-11)
- `AppCashFlowGrid.html` defines `CF_GRID_FIELDS`, 5x12 `cashFlowGridHtml_` and `cashFlowGridApplyMatrix_`, which validates a full TSV rectangle before mutating the live `cashFlowUi.draft.months` array. Blank amount means null (unknown), numeric zero means confirmed 0. Notes are 300 chars max. No localStorage/sessionStorage.
- `StylesCashFlowGrid.html` uses a fixed left row-label column, sticky month headers and scrolling of the table element only; old vertical entry remains under a native details disclosure. Index mounts the CSS/JS after the original annual cashflow module.
- The original cashFlowSave_ RPC remains the only persistence path (`saveCashFlowYear`, `資金繰り年間`). On unresolved response or RPC failure `cashFlowUi.uncertain=true` disables all client edits, preserves `requestKey`, input snapshot and revision. Retry with identical payload until confirmed; success resets uncertain, invalidates cache and refreshes. Existing server ACL/revision/ScriptLock/monitoring unchanged.
- QA `test_cashflow_grid.mjs` verifies 5x12 editing, paste atomicity, null vs zero, formula rejection, copying, recomputed balances, exact retry key after failed RPC and logout clearance. `test_cashflow_grid_viewport.mjs` uses Chromium to test 1440/1024/768/390/320 widths and two color schemes; existing cashflow, UI contract and whole-app CI tests also run.
- Bank statements remain separately classified, partially imported transactions must not be shown as confirmed zero. DB schema v20 separate manual plan linking feature is preserved; the source Excel or bank data is not changed by manual-year edits.


### 2026-10-11 Bank pasted-text parser separated from finance demo
- Move synthetic `cfbDemo...` controller from GAS runtime `src/AppCashFlowSandbox.html` into `scripts/fixtures/AppCashFlowDemo.html` (VM testing only), and keep actual `cfbParseBankPaste_`, `cfbPasteSample_`, `cfbPastePreview_`, `cfbPastePanel_` in `src/AppCashFlowPaste.html`.
- Replace `StylesCashFlowSandbox.html` with `StylesCashFlowPaste.html` and drop obsolete sample-mode banner styles. GAS `Index.html` excludes the synthetic controller.
- Update bank-grid, sandbox, workspace, contract, rotary and static validation suites to load the synthetic fixture only during tests. Preserve the PR #105 editable-preview/uncertain-import safeguards and PR #106 annual grid unchanged.
- No production database write, schema migration, authentication or financial payload change. Delivery-byte reduction does not prove actual GAS/Sheets speed improvement.


### 2026-10-11 Initial HTML source-size regression budget
- `scripts/test_initial_payload.mjs` scans `src/Index.html` includes and reports UTF-8 source bytes of entry HTML and each CSS/JS module. Reject duplicate/missing includes and historical test-only `AppLeaveDemo`/`AppCashFlowSandbox` in production.
- Budgets are 1,360,000 total, 950,000 JS and 420,000 CSS source bytes. GitHub CI and production deploy run this before other tests; the eight heaviest modules are shown in logs.
- These values are not compressed transfer size, actual render time or a GAS/Sheets RPC p50/p95 measurement.

- `AppRotaryIntegration.html` の `FMRotaryRPC` 実行時に `performance.now()` を記録し、完了/失敗時のブラウザ観測時間だけを固定上限80件×API名で集計する。`FMWorksPerformance.report()` はメソッド名/件数/失敗件数/P50/P95/直近msのみ返す。`FMRotaryActivity.reset()` で消去し、既存のRPCハンドラー・ロータリー演出・権限/保存契約を変更しない。


## v0.24.3 Scoped worklog/task link lookup
- `projectAdvancedWorklogIds_(items)` returns immediately for no visible worklogs (zero linked-sheet I/O). It retains schema header checks when rows exist and retrieves only visible worklog IDs using `readRowsByColumnValues_` for sparse date windows and large tables.
- It uses the existing TextFinder / regular-expression escaping / contiguous blocks / full read fallback, with no global per-user cache. Small tables and more than 24 visible worklogs retain the old full read behavior.
- The new `scripts/test_worklog_link_index.mjs` regression validates indexed vs full-width read counts, empty dates, missing/duplicate IDs, invalid headers, legacy optional sheet, synthetic authorization-scoped outputs, and no DB writes.


## v0.24.4 Global search scoped reads and stale callback isolation
- src/Search.gs/searchApp reuses cached active employee directory getEmployees_(), short-circuits once 30 results are collected, and reads matching request records via readRowsByColumnValues_(sheet,3,19,allowedIds). It keeps the existing per-schedule visibility and per-requester authorization checks and original employee/schedule/request ordering.
- src/AppShell.html increments globalSearchEpoch on query change/dismiss/new request and checks epoch, session token, active route, and current query before handling success/failure. The hidden panel clears both DOM and in-memory item references.
- src/AppCore.html clears search state on logout before the session object is released. Late old-session RPC results cannot restore another user's search results.
- scripts/test_global_search.mjs uses synthetic server and browser VM data to enforce the 30-item cap, scoped IDs, ACL, callback ordering, dismissal, route changes, failure handling and logout purge. CI/deployment both run the test.
- Static read reductions are distinct from authenticated real-world latency, which remains an E2E measurement task.


## v0.24.5 Sparse global schedule search
- `searchScheduleRows_` in `src/Search.gs`: for more than 300 data rows and short single-token queries, use `sheet.getRange(2,7,lastRow-1,5).createTextFinder(query).useRegularExpression(false).matchCase(false).findAll()` to find G:K cells. Deduplicate + sort hit rows via existing `contiguousRowBlocks_` and fetch `A:R` full records only for matching contiguous blocks.
- Preserve source row order and continue `canViewScheduleRow_` authorization before any schedule entry is returned. For whitespace/cross-column terms, long terms, small sheets, over 48 disjoint row blocks, or an index exception, read 18 columns as the previous implementation did.
- `scripts/test_search_schedule_index.mjs` has 1,000 synthetic scheduled rows and verifies 54 compared with 18,000 18-column cells in the sparse example, hidden events omitted, source order, duplicate cell matches, user strings as literals, 30-result cap and safe fallback conditions. Both CI and deployment run it.
- This reduces transfer of unused cells for sparse lookups and is not a claim of corresponding GAS elapsed-time reduction. Read-only change; DB v20 and finance/attendance write contracts unchanged.


## v0.24.6 Scoped punch-history retrieval
- `getActivePunchRows_(employeeId,startDate,endDate)` keeps the existing date-range indexed path unchanged. For history requests without a date range and over 250 physical rows, call `readRowsByColumnValues_(sheet,2,12,[employeeId])` to fetch only matching employee rows using escaped regular-expression TextFinder and bounded range blocks.
- Preserve the full same-employee history before applying the deleted flag and `supersededBy`/original-punch-ID map. Avoid a last-N-row shortcut because late corrections may replace older punches. Keep a one-shot 12-column read on small sheets and the helper's 48-block fallback.
- `scripts/test_punch_history_index.mjs` must compare indexed results to legacy all-column scan on synthetic large and sparse data, ensure no cross-user history leakage, preserve corrections, deleted punches, special-character IDs, timestamp order/limit and small-table fallback.
- No Sheet writes, authentication or DB schema migration. This is a read-volume optimization, not verified production p50/p95 reduction.


## v0.24.7 Project Hub worklog read projection
- `projectHubWorklogRows_` keeps its existing 20-second large-cache semantics but reduces `工数` table `getRange` from A:O (15 columns) to A:M (13 columns). The callers `projectHubRead_` and `projectAdvancedTaskEffort_` only dereference indices 0–12, including original worklog ID, project name, minutes and tombstone status.
- Indexes 13 and 14 (save-only auxiliary identity and last update timestamp) are not read for the project cockpit; the `Worklog.gs` save/load formats remain full-width as previously defined.
- The existing backend project regression and project-advanced authorization suite verify task-hour linking, aggregate totals, deleted/ambiguous worklogs, visibility rules and safe save retries. Add an explicit source-range assertion for 13 columns on 1,000+ synthetic rows.
- No database mutation or protocol change; this is 13.3% fewer loaded columns for the project hub's full-table aggregate, not proof of equivalent reduction in elapsed time.


## v0.24.8 Indexed verified lookup for General Affairs records
- `src/Somu.gs:somuFind_` and `somuByRequestKey_` now call the existing `findVerifiedSheetRow_` in `src/DataAccess.gs` with an exact-column TextFinder. Only the matched row of the model's full width is transferred, rather than all IDs or request keys.
- Scopes are `somu:<kind>:id` and `somu:<kind>:requestKey`, isolated per model and spreadsheet. The common cache stores a row-number hint, never the record contents. Each lookup verifies the live target cell; a changed, moved or deleted row falls back to exact TextFinder or returns not found.
- The calling mutation continues to use `somuSheet_` header verification, ScriptLock, latest record revision/status, role and requester authorization, and audit logging. No row is written during lookup, and duplicate retries cannot be accepted from a stale cached payload.
- `scripts/test_somu_integration.mjs` runs all create/return/approval/duplicate and unauthorized-access flows, plus synthetic tables larger than 3,000 rows and zero full-ID-column reads on targeted lookup. `scripts/test_somu_growth.mjs` covers the three optional models; `scripts/test_data_access_performance.mjs` covers real helper row movement, revocation and DB switching.
- This reduces transferred cells for point lookups but does not claim an elapsed-time improvement until authenticated production GAS P50/P95 measurements. Existing asset listing, 2,500-loan safety bound, database schema and demo data are unchanged.


## v0.24.9 Safe General Affairs integrity on large ledgers
- `somuOpenLoans_` uses `readRowsByColumnValues_` against column B of the entire loan sheet to read all rows matching an asset ID; it then validates the physical loan ID and `貸出中` status. This replaces the prior refusal once 2,500 history rows existed, which could not safely distinguish old active loans from closed ones.
- `saveSomuAsset` uses the same shared indexed reader against asset management code (column B), and `saveSomuGrowthRecord` checks facility code (column B) using the schema-verified optional sheet. Duplicate protection spans all history, ignores `廃止` rows, and excludes the target ID during revisioned updates.
- The shared helper searches exact escaped regex matches and batches nearby row reads; a fragmented match set falls back to complete row scanning rather than an unsafe last-N cutoff. All callers preserve authenticated ScriptLock transactions, verification against latest state and audit records.
- `scripts/test_somu_integration.mjs` and `scripts/test_somu_growth.mjs` cover old active loans, rejected overborrowing, return state, duplicate codes and legitimate records with >3,000 synthetic rows. List APIs still limit display rows, so full list pagination and P50/P95 measurements remain Q-SOMU-03.


### v0.24.9 partial-list UX safeguard
- `getSomuWorkspace` retains `truncated` and adds `truncatedKinds:{assets,loans,purchases,documents}` based on the source-sheet last row versus display caps. Shared snapshot key v4 prevents mixing old cache payloads that lack per-kind completeness flags.
- `somuTruncated_` and `somuCountText_` display lower bounds or unknown values instead of treating incomplete client-side arrays as complete. `somuAvailable_` returns null when the loan ledger was truncated; `somuSummary_`, `somuHome_` and `somuGrowthHome_` show undetermined stock/overdue totals rather than a false zero.
- The server still validates **all** matching live loans/asset codes under ScriptLock before mutations. The UI flag is for presentation, never an authorization or integrity input. The 60-row in-memory UI paging contract remains unchanged.
- `scripts/test_somu_client.mjs` asserts unknown stock and overdue count for synthetic incomplete loan histories; `scripts/test_somu_integration.mjs` verifies per-kind flags from >3,000 physical records.

- The record-list header and in-place refresh counter share `somuCountText_` so truncated search and display counts do not imply complete results.


## v0.25.0 Progressive General Affairs workspace loading
- `src/AppSomu.html:somuLoad` calls `getSomuWorkspace(token,force,false)`, so the first RPC only accesses the four core ledgers and returns before the three growth sheets are read.
- `somuScheduleGrowth_` calls the existing independent `somuGrowthLoad(force)` after first render for the home dashboard, or after core response when a growth tab is active. It respects the shared background-task scheduler and falls back to an immediate call if unavailable.
- `somuScheduleGrowth_` rechecks session identity, current page and tab at execution time; stale tasks after logout, session switch or page navigation cannot issue another RPC. Fresh in-memory base data on re-entry also schedules missing growth information without reading the core data again.
- Explicit refresh propagates the force flag to the separately loaded growth data. Existing backend `getSomuWorkspace` keeps its optional `includeGrowth` argument for backwards compatibility; cache, DB v20, role authorization and data contracts are unchanged.
- `scripts/test_somu_client.mjs` asserts first-RPC argument, delayed growth sequencing, cached reentry, stale task rejection and no unnecessary prefetch from the asset tab. True GAS cold/warm performance remains to be measured.

- The shared `scripts/test_business_workflows.mjs` contract now asserts the staged two-RPC sequence and zero-RPC tab switches after growth fetch, instead of the superseded combined seven-ledger RPC contract.

## v0.25.1 Actionsを使わない検証と取得処理の改善（2026-10-12）

### 開発運用
PR122で旧CI/Deployを `.github/workflows-disabled/` へ移動し、root AGENTS.mdを新しい必須指示にした。新規PR・mergeには `[skip ci]` を指定する。GitHubの無料実行枠も使わない。`scripts/local-checks.json`を検査計画とし、GPT環境の`run_local_checks.mjs`がNodeで実行する。旧YAMLは履歴であり実行しない。

ローカル結果にはsrc・文書・検査スクリプトのSHA-256、各検査の成功/失敗/未実行を記録する。`--functional`で除外したChrome検査を成功に含めない。出力は`artifacts/local-verification/`、gitignore対象。GitHubの成果物ストレージへアップロードしない。文書同期はコミット差分と作業中差分を確認し、Git呼出しを`execFileSync`の引数配列に変更してシェル文字列の連結を避けた。

### 総務の非同期制御
- 基本UIと追加台帳UIを別のリクエスト所有者とする。base読込の開始／完了でgrowthのloadingを変更しない。
- `growthRefreshNeeded`は基本台帳読込中の追加台帳更新を保持する。`forceOnNextLoad`は非表示タブの更新要求を次の表示まで保持し、不要な先読みと更新要求の破棄を防ぐ。
- 成功／失敗にはログインidentityとUIオブジェクト同一性、追加台帳にはserialも確認する。予約処理もbase UIの同一性を確認し、同じトークンでのreset後の古い応答を除外する。

### 閲覧範囲と索引
`getManagedEmployeeIds_`はMANAGERの場合に実シートの直属承認者列を索引取得し、在籍者だけを返す。USERは空の管理範囲。ADMINの表示ディレクトリ再利用は全員閲覧権限の範囲で維持する。`getActiveDirectReports_`は全員24列取得をやめ、一致行だけを取得する。直属承認者IDの従来の大文字/小文字非区別を維持するため、共通索引ヘルパーへ任意のcase-insensitive照合を追加した（他の呼出しは従来の完全一致）。

案件の個人工数／個人別集計は同じ管理対象ID集合を使い、表示キャッシュから所属を判定しない。既存の5分表示キャッシュは取得済み情報の表示用であり、新しいサーバー取得時の権限とは区別する。

### 通知の転送削減
`projectAdvancedAlertRows_`はread-onlyのplan先頭3列／task先頭9列を取得し、書込み用_rowを持たない。共有メモは現在の担当案件IDによる`readRowsByColumnValues_`で選択し、無関係・停止済み案件の本文を転送しない。6拡張シートの検証済みハンドルを既読読込に再利用し、同一RPCの既読ヘッダー再検証を削除する。

`scripts/test_operational_refresh.mjs`は同じログインでのreset、旧成功/失敗、独立RPC、更新の待ち合わせ、非表示タブの更新保持、通信障害、表示用ディレクトリの古い所属、直属変更、退職者、本人/案件共有範囲を確認する。600件の他案件メモを混在させても担当案件の本文だけを取得する。`test_local_docs_sync.mjs`は浅いGit履歴・未コミット/新規ソース・文書片方欠落を確認する。これらのI/O確認はGAS実測秒数を意味しない。


## v0.25.2 経理・見積・関連書類の非同期所有権と共通索引（2026-10-13）

- `AppQuotes`、`AppFinance`、`AppFinanceAdvisor`、`AppDocuments` の通信開始時にUIオブジェクトを捕捉し、各成功/失敗で現在のオブジェクトと本人の識別を照合する。状態初期化でシリアル値が再利用されても旧応答を採用しない。既存保存/発行/ダウンロード応答にも適用し、新しいUIのbusy解除・入力上書き・不要な再取得を防ぐ。
- 経費の一括保存は`financeBulkUi`の所有権も照合し、以前のチャンク完了が新しい未保存表の次チャンク保存を開始しない。保存結果不明時の同じキーによる再試行は維持する。
- 経理overview/mineは通信開始時に保留フラグを消費し、応答時には改訂番号変更または取得中の更新要求を、応答形式検証・キャッシュ更新より先に処理する。既存表示を維持して再取得1回へまとめる。以前の後置チェックを削除し、判定の重複を減らす。
- 支出分析は`insightRefreshNeeded`で取得中のforceを保持する。年度変更で保留をリセットし、UI所有権・年度・serialを照合する。同じ年度は有効なキャッシュを維持する。
- `quoteOpen`は未保存editorがあれば現在の編集を再開し別見積RPCを開始しない。保存済み/正式発行後の詳細取得には影響しない。
- 書類選択はUI所有権・requestSeq・selectedIdを照合する。取得開始時の一覧`updatedAt`と完了時の値が変われば再取得し、`selectedRevision`と上限12件の詳細キャッシュへ同じ版を記録する。見積workspace更新後は`documentReconcileList_`で表示済み詳細の版を照合し、必要時だけ再取得する。再発行後は該当キャッシュを消去する。一覧に存在しないだけで削除済みとは判断しない（一覧件数上限があるため）。
- `Finance.gs:financeRows_`は100行超の本人履歴に`readRowsByColumnValues_(sheet,3,width,[employeeId])`を使う。TextFinder結果の連続行をRangeListでまとめ、読み取った行を実際の社員IDで再照合する。48ブロック超は共通ヘルパーの従来フォールバックを維持する。全体経理一覧の集計・証憑照合は全件を必要とするため対象外。
- `test_finance_quote_refresh.mjs`で実クライアントコードに応答順序を制御したRPCを与え、同じセッションのreset、旧成功/失敗、キャッシュ再利用、更新連打、不正応答、通信障害、年度変更、書類版変更・保存前入力の保持を検証する。`test_finance_integration.mjs`は実DataAccess/Financeの索引を実行し、32件の連続本人記録と無一致時の転送量・返却範囲・差戻し優先を検証する。
- ローカル検証計画へ追加テストを登録する。生成文書はローカル生成し、GAS公開は認証済み直接操作の別工程とする。ChromeとGAS公開認証がない現環境では実画面・公開版・P50/P95を合格扱いにしない。


## v0.25.3 テーマの配色契約と実ワークスペースの下書き（2026-10-13）

- A1/R1: `StylesAccessibility.html`をIndexのCSS最終includeにする。`text/muted`、状態ごとの`*-ink/*-bg`、白文字用の`fill-*`、`control-line`を両テーマで定義する。既存CSSの固定文字色と明るい背景をこれらへ統合し、背景中の`blue/green/...`を塗り専用ロールへ分離する。rgba背景の透明度はcolor-mixで維持する。境界線・データ色・レイアウト・動作・APIは維持する。
- A2/R2: 月次のopen/closed帯・バッジ・状態色・入力/placeholder/optionを最終共通ルールで明示。休日、他担当の予定、補足文字はopacityで文字を薄くしない。無効コントロールは淡い背景と読める文字にし、disabled自体は維持する。元のCSSの色優先度が高い無効化入力にもopacity:1を適用する。
- A3/R3: `qb-paper`の固定紙色を移行対象から外し、両テーマで白背景・濃い文字を維持。細いフッター/空行文字は画面プレビューのみ濃くする。発行済みテンプレートのサーバー処理・保存ファイルは無変更。
- A4/R4: `attendanceDisplayPreview()`は受信済みの`attendancePreviewData()`だけを返す。`buildAttendanceSamplePreview/openAttendanceSampleDay/buildWorklogSampleData`と自動サンプル分岐を本番ソースから撤去。未取得/エラー時は`attendanceAlerts`で問題なしと断定しない。勤怠・工数のDB/確認用レコードには書込みしない。
- A5/R5: `worklogQuickForm`は進行中の実案件だけを選択肢にする。0件なら空の選択肢と登録不可・管理者への案内を表示する。
- A6/R6: `restoreWorklogQuickDraft`の案件復元直後に`refreshWorklogTaskChoices_`を実行し、その後に保存済みのtask IDを設定する。消えた案件はselect.valueを空にし、最初の別案件を保存先として選ばない。消えた作業はネイティブselectの不一致処理で空にする。セッション・日付別のMapと送信キー方式は維持する。
- A7/R7: `test_theme_contrast.mjs`は実Index順の17 CSSと最終rootトークンから両テーマの90組を計算し、4.5/3の閾値を確認する。固定文字色の残留と社員アバターも検査する。DOM実描画・全状態のcomputedStyleを検査したとは扱わない。`test_live_workspaces.mjs`は空工数の390分自動表示と作業選択の脱落を修正前に再現し、selectの実際の値設定仕様をモデル化して下書き復元・削除・社員分離を検証する。
- 画面検証12本のCSS fixtureを`theme_styles.mjs:appStyles()`へ共通化し、GASと同じinclude順にする。ローカルrunnerはこのヘルパーもハッシュ対象へ追加する。Chrome未実行の状態は維持し、CSSだけ古いfixtureで確認済みとは表現しない。
- 公開制約: ローカルChromeとGAS直接公開の認証は利用できない。クラウドブラウザーもfile://の確認用HTMLを安全設定で拒否した（http/httpsのみ許可）。迂回して同じHTMLを開かず、数値・コード・機能の検証で進める。GAS実表示・公開版・速度の実測は未確認として残す。

- 追加検証修正: セッション削除のfixtureで日本の絶対時刻と環境ローカル時刻を混在させていたため、同じローカル基準の日時へ統一する。ローカルrunnerはGAS manifestのtimeZone（Asia/Tokyo）を各検証へ渡し、環境依存を除く。時刻ロジックそのものは変更しない。

## v0.25.4 Account ledger and repository financial demonstration

- `src/CashFlowLedger.gs` adds admin-only `getCashFlowLedgerRows(token,{year,accountId,kind,offset})` and `saveCashFlowLedgerRows(token,{accountId,rows})`. Reads join CFP bank transactions and CFA notes, expand active plans into fiscal month occurrences, return 50 rows plus full-period totals and an optional latest known balance anchor. Kind and offset are validated.
- Writes normalize all 1–20 input rows before mutation; each stable request key becomes the actual bank external ID `LEDGER-<key>` and annotation key `<key>-NOTE`, or the scheduled-item request key. Existing account/transaction/plan/annotation methods retain their ScriptLock, revision, fiscal close, idempotency and audit handling. Reusing an actual key as a plan (or vice versa) is rejected.
- The multi-row operation is **not an atomic database transaction**. A later failure can leave completed rows, or a transaction awaiting annotation. The client retains all exact input keys and resumes safely by retrying; tests inject this partial-save failure. A confirmed response must contain the expected count, kind and IDs. Saved bank source amounts remain immutable.
- `src/AppCashFlowLedger.html` holds drafts in memory, uses the original Excel column order (date, description, OUT, IN, balance, category, note) plus kind, accepts rectangular TSV, and chunks writes into 20. Actual running balance calculation uses only a known saved anchor and rows dated at/after that anchor; planned balances and unknown anchors are not invented. Requests coalesce by year/account/kind/page, reuse a five-minute cache, and check UI object, serial, session identity and current query key. Save/manual refresh invalidate the cache. Unknown-save inputs are frozen and route/account/year changes blocked until same-key retry.
- The bank workspace includes the vertical ledger and a fiscal-year horizontal aggregation. Actual months without imported records or a verified empty reconciliation are shown as unknown; annual actual totals explicitly cover only imported data. Existing detailed projections and reconciliation remain below.
- `demo/server.mjs` is a loopback-only Node HTTP server with same-origin checks, bounded JSON input, an explicit RPC allowlist, and HttpOnly/SameSite browser session cookies. It assembles the real `src/Index.html` includes and injects an isolated `google.script.run` HTTP bridge. `demo/runtime.mjs` executes existing GAS business functions in a VM with in-memory Sheet/Range adapters. Finance spending reads the in-memory ledger rather than an external legacy workbook; live documentation reads the repository Markdown.
- Each demo browser session gets a cloned `demo/data/financial.json`; writes stay in server memory and are lost on restart. The deterministic generator never reads Excel/Sheets/secrets. No original workbook values or real identifiers are imported. Production `Auth.gs` and database configuration are unchanged; demo authentication is a fake admin confined to this process. Google/Drive/HTTP service calls and unsupported RPCs fail explicitly.
- Local demo coverage is finance/cashflow, not every business module or real exports/deployment. Full operational rollout still requires a shared persistence adapter, transaction/concurrency design, authorization, audits, backup/restore and file storage decisions with the CTO. README documents one-command startup and scope.
- GPT-only checks add `test_repository_demo.mjs` (real GAS finance/ledger/annual calculation, idempotent/partial retry, isolated data, auth, HTTP and no external access) and `test_cashflow_ledger_client.mjs` (TSV, balances, cached/coalesced reads, stale responses, chunks, immutable retries and unknown months). Verification hashes include demo runtime, server, JSON, startup and generator. Browser rendering and authenticated GAS operations remain separate release evidence.


## v0.25.5 共通配色の誤置換修正と品質契約（2026-10-13）

- v0.25.3の一括トークン化時、以前の白/半透明白が `var(--fill-danger)` に、淡い青/緑/灰が濃い `var(--fill-info)` / `var(--fill-success)` に誤変換され、ログイン・サイドバーやカードの背景が異常色になった。さらに一部の強い青色アクションが淡い `--info-bg` となっていた。
- `src/Styles.html` のCSS宣言を変更前のソース（v0.25.2の既知版）と同一セレクター順・宣言位置で照合し、以前の配色の意味を復元。中立面→`--surface`/`--surface2`、淡色の状態面→`--info-bg`/`--success-bg`、実際の危険マーカー→`--fill-danger` とし、ロゴ/ログイン送信/進捗の青いグラデーションを復元する。
- `src/StylesAccessibility.html` による可読性補強、Indexの読み込み順、DOM、GASの業務処理、v0.25.4金融機関別台帳とメモリー保存のデモ、DB/Sheetsは変更しない。
- `scripts/test_theme_contrast.mjs` に背景の意味チェックを追加。主要な中立面で危険・強調色を使用しないこと、ログイン送信とロゴが淡すぎないこと、危険通知が赤色を維持することをCSSソース上で確認する。ブラウザーのcomputed style判定ではない。
- GitHub Actionsを使わない。GitHubコード統合とGAS公開版更新を区別し、GAS v192はGitHubだけ変更しても更新されない。実機画面・認証付き操作・速度測定は未検証として残す。


### v0.25.5 APP.version同期と静的回帰（2026-10-13）
- `src/Code.gs` の `APP.version` を `0.25.5` へ更新。これは `getInitialData` の `app.version` とIndexテンプレートの `appVersion` に伝わる識別子であり、DB_SCHEMA・公開範囲・GASエンドポイントは変更しない。
- `src/GeneratedDocs.gs` は最新版の要件定義書・技術設計書から `scripts/generate_docs.mjs` と同じ形式で再生成する。文書と実行コードの版の一致を専用の `scripts/test_app_version_contract.mjs` で検査する。
- 実GASは引き続き公開版192（v0.25.4）。GitHub mainへv0.25.5を統合しても自動公開しない。次回の認証済み直接操作で `Styles.html`・`Code.gs`・`GeneratedDocs.gs` を照合してGAS版を更新する。ユーザー実操作は公開後に別途確認する。


## 2026-10-14 v0.25.6 実装・性能方針

Google公式のサービス呼び出し削減・キャッシュ利用・非同期応答の扱いを根拠とする。DB移行、別サービスへの移設、全ページの一括先読み、TTLの単純な引き延ばしは今回採用しない。

- `getApplicationShell_`: 静的Indexの評価結果をAPP.version別のScriptCacheへ保存。UTF-8で60KB以内の分割、最大40分割、TTL6時間。UUID世代を生成し、全分割の保存後にmanifestを発行する。暖機後はテンプレート・全HTML include再評価を省き、manifest get + chunks getAllで再構成する。内容は静的ソースのみで、DB接続・認証結果は含まない。GAS独自手修正でもAPP.versionを必ず上げる。公開版ごとにキーが分離する。
- `FMRotaryRPC`: 最大32組の進行中読み取りのみ、メソッド＋引数＋ログイン世代＋書込み世代で共有する。返却オブジェクトは消費者ごとに複製。書込みはまとめず、書込み開始時に共有索引を解除する。reset後の旧成功・旧AUTH_REQUIREDを破棄する。認証・権限はサーバーの実行ごとに従来通り実行する。引数や結果をログ・localStorageへ出さない。
- `readRowsByColumnValues_` の6番目オプションは `{rowNumber, values}` を返す。連続ブロックと大量一致fallbackで実シート行番号を保持。既存呼び出しの配列契約を維持する。ProjectHub詳細のtask/resource/updateで共用し、plan全件の別名衝突判定は残す。
- 通知・全体更新はtokenとdata参照を捕捉。全体更新で軽量initialDataの空projectsに既存選択肢を上書きしない。
- `applicationUnsavedItems_` / `applicationWritePending_`: メモリー下書きのみを判定し、beforeunloadと明示破棄付きlogoutに適用。保存処理や結果未確認のlogoutは拒否する。
- 金融台帳はキーが同じ時だけ前のデータを保持して更新し、別口座・年度・ページの旧データを表示しない。ページキャッシュ40件上限。

根拠: https://developers.google.com/apps-script/guides/support/best-practices 、https://developers.google.com/apps-script/guides/html/communication 、https://developers.google.com/apps-script/reference/cache/cache 。初回のGAS起動・Google通信・認証Sheets読取は残り、常に瞬時という保証はしない。機構上の削減件数と実環境のP50/P95を別に記録する。


## 2026-10-14 v0.25.7 対象行取得・共通ローダー

- `readRowsByDateRange_` の任意6・7引数は社員列と社員ID集合。日付列と社員列のTextFinder行位置を交差し、RangeListで連続ブロックだけ読む。返却直前にも日付・社員IDを再確認する。索引が使えない／長期間／多数分断なら、両条件付きで安全な読取へ戻す。既存の共有予定・会社カレンダーの非限定取得契約は維持。
- Codeの本日／月集計、Worklogの取得／重複時刻検証、Monthlyの改訂確認／移行勤怠／工数、Requestsの勤怠修正確認へ適用。
- `loadPageData_` がmountAuthenticatedAppとnavigateの重複処理を共通化。復帰時も同じ入口を使う。資金繰りが開いていれば年次・銀行APIだけで更新し、経費一覧は呼ばない。
- `refreshOnResume_` はvisibilitychange／onlineのみで発火。ログイン・5分TTL・JST日付・保存状態・進行中の取得を確認し、1回のgetInitialDataへまとめる。無限ポーリングなし。`refreshAppData` の日付更新は入力中の工数と明示的な過去日選択を保持する。
- `getPublicAuthConfig` は1回の設定マップをgetAuthConfig_／getSupportConfig_へ渡す。PRODUCTIONの試作PIN禁止・PIN設定済み判定は維持。初期接続失敗の再試行とappVersionを公開ログイン画面へ表示。
- 個人データ・認証結果の長期サーバーキャッシュは追加しない。Google起動／ネットワークの遅延は残り、実測速度は認証付き確認の別証拠とする。


## 2026-10-14 v0.25.8 適応的な本文取得と分析ライフサイクル

- readRowsByColumnValues_／readRowsByDateRange_は少量台帳（本文250行かつ10,000セル以内）を単一取得し、同じ条件でフィルタする。大規模側は既存TextFinderの索引を維持。
- indexedRowWindows_は一致行を連続区間へ整理し、8区間を超えた場合は最大7個の行間だけを残して区間をまとめる。同じ最大8読取の条件で追加取得セル数を最小化する。窓内に含まれる非対象行を返却直前に除外し、物理行番号は窓の開始位置を使う。索引不可・長期の安全なfallbackは維持。
- cfaLoad_の通常重複ではforceAfterを立てない。workspaceAt／monthAt／projectionAtによる5分TTL。cfaInvalidateReads_が世代番号と読取状態を無効化し、入力下書きは保持する。cfaReadError_は保存・出力フラグを解除しない。
- 初回失敗時のcfaPage_はエラーと接続再試行を描画し、描画によるRPCループを止める。取得済み分析のエラーにも再試行を表示する。
- cfbLoadActiveSection_をキャッシュhitと銀行取得成功の双方で実行。銀行集計と分析／台帳のTTLを独立に扱う。銀行書込後と手動更新で分析の旧応答を遮断。
- 注釈／分類／シナリオ保存後の子取得をworkspace成功後へ一本化。金融台帳保存は銀行集計更新後の子取得へ一本化。cashFlowClose_で経理ローダーを呼び、未期限切れなら通信しない。
- 共通未保存・処理中ガードに分析・条件・口座・予定を含める。年度切替／終了／銀行更新／セクション切替で分析の保存・出力中を検査する。
- Google公式のサービス呼び出し削減・一括読取方針を適用する。合成のサービス回数を受入指標とし、実GASのP50/P95は別測定。公式根拠: https://developers.google.com/apps-script/guides/support/best-practices 。


## v0.25.9 総務キャッシュ・通信速度の診断（2026-10-14）

- Somu.gs: 共有キャッシュキーをv5にし、cacheJsonGetLarge_/cacheJsonPutLarge_を使用。既存のUTF-8 60KB分割・不変世代・最後にmanifest公開という実装を利用する。20秒TTL、最大4.8MB、断片欠損またはCacheService異常時はcache missとして正本へ戻る。更新後のmanifest削除を維持する。
- getSomuWorkspaceは共有結果を読む前にsomuOperator_で社員セッションとofficeWorkspace権限を再確認。canApproveとtodayは利用者ごとに計算して付加する。個別の閲覧権限を共有しない。
- AppAdmin.html: performanceセクションで既存FMWorksPerformance.report()のブラウザー往復P50/P95を表示。FMRotaryRPCからの計測値のみを使い、GASの通信を追加しない。clipboardには引数/結果のない統計JSONだけを渡す。ADMIN権限なしでは表示・コピー・消去を拒否する。
- テスト: 大容量の分割整合性、断片紛失、更新時の無効化、社員別承認、管理者の統計表示とHTML無害化を追加。GASの公開と実機計測はこのGitHubコミットの対象外。


### 2026-10-14 v0.25.9 段階的マスタと分散検索の改良
- AppOperations.htmlのworklogCatalogState_はログイン識別子と取得日時のみ。正常な空配列も取得済み、最大5分再利用。画面日付の変更に影響せず、プロジェクトの書込/DB移行/再ログインで失効。別月の先行応答からもマスタを同じセッションへ反映する。
- ProjectAdvanced.gsは1～80件の工数対応IDをreadRowsByColumnValues_によるライブ行照合付き索引で取得。81件以上または250行以下は一括読取。
- Search.gsはindexedRowWindows_で最大8窓、取得予定の全行に対する比率が75%超なら全件取得。TextFinder障害やスペース入り複合検索時は安全なフォールバック。searchAppは取得後にACLと原文を再検査する。
- 新規test_worklog_catalog.mjsと既存インデックス試験で、空配列、日付移動、ログイン分離、25/81件、60分散ヒットを検証する。実GASのミリ秒測定ではない。


### v0.25.9 検索結果の安全な移動（2026-10-14）
- Search.gsは検索した社員のemployeeIdを返し、ADMINならpeople、他ロールならscheduleをルートにする。管理情報は管理者画面でしか提供しない。
- AppShell.htmlのopenSearchResultは管理者向け選択対象を設定する前に過去の社員検索/ロール/状態フィルターを解除。非管理者向け予定表では対象社員で絞る。予定そのものを開く際は旧社員/カテゴリ絞込をALLに戻し、日付・予定IDとモバイル詳細状態を引き継ぐ。
- test_global_search.mjsはサーバー側ルート分離とクライアント側3遷移を合成回帰対象に追加。新規API/RPCやSheets書き込みなし。


### v0.25.9 検索のサービス呼出しコスト（2026-10-14）
- indexedRowWindows_(rows, minGapRows=0)に任意の最小分離行数を追加。既存呼出しは0で従来の8窓・最小セル数を維持。Search.gsは24行以上の大きなギャップのみ切り、24行未満はまとめて読む。窓内の無関係な行はsearchAppが全文・閲覧権限で除外する。
- 合成1000行の予定60ヒット（10行おき）は1窓591行で10,638セルを読取（元の全件18,000セル、以前の8窓9,504セル）。遠い8ヒットは8窓・144セル。Google Sheets往復の実時間は未計測。


### v0.25.9 認証ホットパスの設定取得省略（2026-10-14）
- Auth.gs \`requireSession_\`: hashToken_、findVerifiedSheetRow_(session)、実社員行検証、絶対/無操作期限・ログイン状態は毎回実行。\`getAuthConfig_\`のみ\`sessionTouchMinutes\`経過後の延長処理ブロック内へ移動。設定値変更の適用タイミングと認証拒否の契約は不変。CacheServiceの余計なgetを毎RPCで発生させない。
- scripts/test_data_access_performance.mjs に通常認証で設定参照を省く回帰試験を追加。実GASのセッション失効・役割変更・延長の実操作はWork1側の受入に残す。

### v0.25.10 初回ホームの業務読み取り統合（2026-10-14）
- Requests.gs getHomeRequestSnapshot_: 社員本人と担当者のID集合をreadRowsByColumnValues_(申請,3,19)で一度だけ読取。休暇例外は本人の承認済/取消申請中で月間重複した行のみ。承認待ち件数は権限有りなら担当者集合、無しなら本人集合で計算。返却前に社員IDを再照合。
- Code.gs getHomeMonthStats_: 第3引数が配列なら既読の休暇行を利用し、それ以外は既存の月次申請取得を維持。getHomeOverviewは重複した申請シート検索を行わない。
- AnnualLeaveAutomation.gs maybeReconcileLeave_: requireSession_が検証した同一社員レコードを第3引数で任意に受け、異なる社員のレコードは再取得する。年休付与・台帳修復が起きたら呼出側は再読取。
- getApplicationShell_は版番号付き静的HTMLを21600秒保持する。アプリ更新時に版を変えないと古いHTMLが続くおそれがあるためv0.25.10に改版。

### v0.25.10 工数マスタの非同期世代制御（2026-10-14）
- AppOperations.html の worklogCatalogEpoch_ を保存・ログインで加算、全期間キャッシュに同梱されたマスタ配列を無効化。API発行時の epoch と ticket を取得し、最新世代かつ最新順序の応答だけを worklogCatalogState_ と state.data.projects に反映する。
- worklogShowCachedDay は日付行のみ適用し、過去の範囲からグローバルな案件・作業選択肢をコピーしない。既存の空案件取得済み判断と1～2並列範囲、社員単位のID照合は維持する。
- 工数変更後の画面再表示では、範囲キャッシュが新しくても案件マスタが失効していれば強制更新不要の通常取得でマスタを取り直す。旧通信で個人情報が別セッションに渡らないよう、identity/epochで防止する。

### v0.25.10 読取RPCのウォッチドッグ（2026-10-14）
- AppRotaryIntegration.htmlはget/list/search/findと、特定の冪等なresumeSession/previewRequest/healthCheckだけを45秒で時間切れにする。failure handlerは1回だけ実行、sharedReadsと表示を清掃、遅延した元のRPC成功・失敗はendedフラグで無視する。P95集計には失敗通信として1回記録する。
- save/submit/approve/delete等の状態変更RPCはタイマーを使わず、二重書込みを防ぐ。ログアウト時は既存rpcCallbackGenerationによる旧応答破棄を維持する。
- StylesRotaryLoader.htmlは失敗状態だけ閉じる操作を復活。表示と実際の読込み時間は別々に計測し、45秒を超える正常読取がないかGAS公開後に確認する。

### v0.25.10 社員ディレクトリの送信範囲（2026-10-14）
- Code.gs employeeDirectoryForViewer_(employees,viewer): ADMINは社内管理に必要な完全なgetEmployees_結果を返す。MANAGER/USER等は表示用社員ID、名前、部署、役職、roleを返す。管理者以外のhireDate、leaveBasisDate、payrollIncludedは送信禁止。MANAGERのmanagerIdはviewer自身への直属関係のみ、それ以外は空文字。
- buildInitialDataForEmployee_とgetScheduleBundleForViewer_の両方に同一のサニタイザーを使用。getEmployees_のサーバー内キャッシュやcanManageEmployeeRecord_のライブ権限判定は変更しない。

### v0.25.10 ホーム申請のデータ規模適応（2026-10-14）
- Requests.gs `getHomeRequestSnapshot_` は managed.size>80 かつ sheet.getLastRow()>250 で2パス分離。自身の19列を1社員ID索引で取得し承認済休暇を算出。対象部署の10列を別途取得し承認待ち件数を算出。小規模では両方を1度の19列取得。どちらでも管理対象IDと本人IDの再判定を通す。
- 既存readRowsByColumnValues_の80 ID上限超過時は大きなテーブルを全列読むため、承認人数が増えた場合に自動で幅10へ抑制。性能を推測で秒数化せず、GAS P50/P95で測定する。

### v0.25.10 申請メニューの優先度制御（2026-10-14）
- AppCore.html loadPageData_: requests初回はloadRequestsのみ。既存のrequestsキャッシュが有効な場合に限りqueueRequestFinanceHistory_を予約する。AppOperations.html loadRequests の成功/失敗後にqueueRequestFinanceHistory_を呼び、scheduleIdleTask(450ms)後に社員ID/セッション/表示ページを再照合してからloadMyFinanceItems({silent:true})を実行する。
- 従来の同時2 GAS取得を、画面上部の申請処理→画面下部の経費履歴の順序へ変更し、Google script.runの同時通信枠競合を減らす。キャッシュとfinanceUi.ownLoadingの既存ガードは維持する。

### v0.25.10 最初の表示とGAS往復の測定区別（2026-10-14）
- AppRotaryIntegration.html: PerformanceNavigationTiming.responseEndとdomContentLoadedEventEndのナビゲーション開始からの経過時間を返し、AppShell.mountAuthenticatedAppではrenderNav/renderPageまでのブラウザー同期処理時間を記録。外部に送信しない。Google iframe/API非対応はnull。
- AppAdmin.html: これら3指標を通信速度タブに表示し、別の意味の累積時刻と描画時間を混同しない。コピー可能なJSONは処理名と時間のみ。

### v0.25.10 HTML元データ量の回帰テスト（2026-10-14）
- scripts/test_shell_payload_budget.mjs はIndex.htmlからinclude_を抽出し、必須ファイル存在・重複なし、Buffer.byteLengthに基づく総ソースサイズ1,638,400bytes（1600KiB）以下、生成文書は埋め込まない契約、静的CacheService最大40分割/60000bytesキー制限を確認。
- 2026-10-14監査時のmainは44部品・およそ1.33MBのUTF-8ソース（合成見積）。通信時のgzip転送サイズ、サーバー温/冷起動、HTMLのスクリプト実行時間はこの単体チェックでは保証しない。Work1公開後、ブラウザーNavigation TimingとRPC P50/P95で切り分ける。

### v0.25.11 日付＋社員の二重TextFinderを適応化（2026-10-14）
- DataAccess.gs readRowsByDateRange_: まず既存のdateColumn TextFinderで実候補を見つける。その行をindexedRowWindows_（最大8窓）にまとめ、件数<=180かつ `窓内行数 × 取得列数 <= 3600` の場合は2回目の社員TextFinderを使わず候補だけを読み込み、select()で社員IDと期間を確実に再検証する。
- それ以外の大きな検索では以前のowner列TextFinderで共通部分に限定して読む。owner条件が80以上または正規表現5000文字超でフォールバックする判断は大規模経路だけに適用。ゼロ件・TextFinder失敗・スモールバッチを維持する。
- 具体例（架空の1000行以上のデータ）: 当月42ヒット/対象21件で日付・社員列Finderは2回→1回、630セル読取。大量マッチはFinder2回に留める。実GASの時間短縮率はWork1公開後のP50/P95測定で判断する。

### v0.25.12 予定表クライアント通信のcleanup（2026-10-14）
- AppOperations.html loadSchedule: scheduleWindowRequestsの管理情報にticketを保存。invalidateScheduleWindowCacheでgeneration更新後、全pending requestにendPageLoad(ticket)を実行してからmap.clear。古いcallbackはgeneration条件で結果破棄、後着finalizeの二度目endPageLoadはSet.deleteの冪等性で安全。
- 予定表キャッシュ・イベント再利用と認証/社員IDの確認は維持。リクエストをクライアント側で解除してもGASのサーバー処理が中断されたとは見なさない。

### v0.25.13 工数案件マスタの同一RPC内再利用（2026-10-14）
- Worklog.gs getWorklogs はincludeProjects=trueのときだけgetProjectsInternal_(false)を1回取得し、projectAdvancedTaskOptions_(employee,projects)に渡す。データ行0件/通常時の両方で同じ配列を返す。includeProjects=falseはどちらも空配列。
- ProjectAdvanced.gs projectAdvancedTaskOptions_(user,knownProjects)は配列を受け取るとその最新取得済み内容を再利用し、引数なしの従来呼出元はgetProjectsInternal_(false)を引き続き実行。権限・ステータス判定と業務DB読み取りの仕様は変更しない。

### v0.25.14 予定編集の共通ACL（2026-10-14）
- Code.gs canEditScheduleRow_(viewer,row)はADMIN、登録者の社員ID完全一致を優先。source==='予定表(仮)' なら参加者ID一致も許可。その他の旧データでownerが社員名の場合は参加者が1名かつ本人ID一致だけ許可する（同姓同名の共有予定は拒否）。
- getScheduleBundleForViewer_のcanEdit表示、saveSchedule、deleteScheduleを共通ACLへ統一。実書込は従来どおりセッション認証+ScriptLock後に直近行を読み、その行で権限を検査する。ダミー社員でID一致、同姓同名、共有予定、旧予定、管理者を単体検証。

### v0.25.15 案件コックピットの工数I/O削減（2026-10-14）
- ProjectHub.gs `projectHubRead_(force,detail)` で一覧用と詳細用を区別。詳細では従来のA:M (13列)、一覧ではE:M (9列)だけを1回getDisplayValuesで取得。E=案件、J=分数、M=削除状態を元の配列位置w[3]/w[8]/w[11]へ詰め直し、projectHubMetrics_/aliases/未紐付け判定の互換性を維持。
- `projectHubWorklogRows_(force,summaryOnly)` は `fm:projectHub:worklog:summary:v3` と従来 `fm:projectHub:worklog:v2` を別20秒CacheServiceへ保持。`projectHubInvalidateWorklogs_` は両キーを無効化。CacheServiceは不確実なためmiss時は正本再読込。
- 単体回帰は架空の削除済み/ゼロ工数/重複プロジェクト/一覧・詳細で読取列数と数値が一致することを検証。実GASの秒数はWork1公開後にP50/P95で測る。

### v0.25.16 初回PIN有無のSheets側検出（2026-10-14）
- Auth.gs hasAnyPinConfigured_: 社員マスタ15列の `Range.createTextFinder('.+').useRegularExpression(true).matchEntireCell(true).findNext()` でPINハッシュの存在のみ検査。代替として旧 `getDisplayValues().some` をtry/catchに保持。未設定の空列はfalse。
- 結果はあえてCacheService等へ保存しない（ログイン時に初期設定の正確な有無が必要）。initializeFirstAdminはScriptLock取得後に同じライブチェックを実行し、既存の検査条件/監査を変更しない。

### v0.25.17 hover RPCの負荷制限（2026-10-14）
- AppCore.html prefetchRouteOnIntent/queueRoutePrefetch: requests/officeを先読み対象から外し、schedule/worklogだけ450msの滞在後に実行する。画面を実際に開くloadPageData_の経路は変更しない。クリック時の主RPCと申請・総務の大きなRPCが競合するのを防ぐ。

### Work1統合時の修復（v0.25.16）
- readRowsByDateRange_のownerRegexの文字列終端と完全一致アンカーを復旧。元PRの45blob一致確認後に構文不正を再現し、統合前に修正する。
- validateの契約は案件マスタ1回・employeeDirectoryForViewer_・verifiedEmployee引数・画面と保存／削除の共通canEditScheduleRow_を検査。元のACLと個人情報最小化の条件を緩めない。
- 一覧E:Mと詳細A:Mは独立20秒cache。総務の小規模fixtureと大規模実装試験を区別し、通常日付移動でマスタを再取得しないAPI応答形をクライアント契約で検証する。

### v0.25.18 総務検索と登録行カーソル（2026-10-14）

`getSomuRecordsPage(token,{kind,query,filter,before})` は4基幹台帳だけを許可し、毎回セッション・officeWorkspace権限・シートヘッダーを確認する。queryは120文字以内の部分一致文字列、filterはall/open/closedおよび貸出専用overdue、beforeは非負の安全な整数で検証する。

TextFinderは大文字小文字を区別しないリテラル検索とし、requestKey列を除く範囲だけを検索する。購買のrequestKeyは中間列なので前後を別検索する。候補行を登録行の降順で処理し、状態候補は状態列のTextFinderで絞る。読取り後にも公開レコードの検索文字・状態・期限を再判定する。内部キーを応答へ含めない。

本文の読取りは1回120行以下、1要求8回以下。疎な候補を広い一範囲へまとめない。60件に加え1件を先読みした場合は60件目の登録行をnextBeforeとし、61件目を次ページへ残す。読取り予算が先に尽きた場合は処理済みの最下行をカーソルとして続行できるため、1ページは60件未満になることもある。queryなしでは検索インデックスを作らず末尾から読む。追加登録によるページずれを防ぐが、外部で物理行を削除・並べ替えした際は「更新」で検索をやり直す。

基幹台帳の行数が従来上限を超えた場合、somuRows_は最新60件のみを基本スナップショットに含める。truncatedと総行数は維持し、キャッシュキーをv6へ変更して旧形状を流用しない。成長台帳にはこの縮小を適用しない。

クライアントはtruncatedKindsで必要な台帳だけを段階取得に切り替える。cache keyはセッション・台帳・検索・状態・beforeで構成し、5分/最大20ページのメモリーに限定する。450ms入力待ち、要求epochとUI/セッション同一性、現在キーで非同期応答を検証し、旧応答を適用しない。renderから失敗の再送を行わず明示的な再試行にする。フォームは現在ページ→基本スナップショットの順でレコードを探し、基本取得上限外の備品も貸出選択肢に含める。

`test_somu_pagination.mjs` は2,000行の全ページ走査・途中追加・文字列中の正規表現記号・内部キー除外・権限拒否・1.8万行の疎な候補に対する最大8×120行・通信抑制・ページ戻り・過去記録の編集/貸出・旧応答/ログアウト/失敗再試行を検証する。GAS実測・ブラウザー受入は実行できる環境で別途確認する。

### v0.25.19 選択案件の工数行と要求チケット（2026-10-14）

`projectHubRead_(force,detail)` の詳細経路は `projectHubDetailWorklogRows_(force,projectId,projects,plans)` を利用する。全案件と全計画から現名/過去名の所有者Mapを構成し、所有者が対象案件だけの正規化名を採用する。既存の詳細A:M全件キャッシュが有効なら再利用し、250行以下も従来の単一取得を維持する。

大規模時は工数E列のTextFinderに、名前を正規表現エスケープした大小文字を区別しない完全一致（前後空白許可）を設定する。長すぎる式（5,000字超/81名称以上）や未対応のアダプターではE列だけを読んで位置を絞る。候補位置を最大8窓へまとめ、A:Mを取得して正本の名前を再確認する。窓が台帳の70%を超える場合は全件の単一取得と既存20秒キャッシュを利用する。候補なしなら本文を読まない。案件ごとのサーバーキャッシュを増やさず、既存の2キー無効化・DB分離を維持する。カテゴリ/月/総工数、本人/直属部下/管理者の個人明細範囲はgetProjectHubDetailの既存判定を使う。

クライアントpendingを案件ID→要求チケットのMapへ変更する。チケットはserialとforceを保持し、応答時にUI・セッション・serial・現在チケットの同一性をすべて検証する。更新/無効化時はpendingを解放し、旧要求の応答では新しいチケットを削除できない。通常要求中の明示forceは一度置き換え、force要求中の重複はまとめる。応答の案件ID・metrics・配列を検証し、無効な結果を5分キャッシュへ入れない。別の選択案件から来た失敗で現在のエラーを上書きしない。再試行は対象詳細だけを取得し、描画からの自動再送は追加しない。

`projectHubPublic_` は返却コピーからrequestKey/_rowを除き、`financeTransportRow_` はrequestKeyを除く。保存と重複判定は元の正本レコードを参照するため、保存APIの認可・競合・監査・冪等性を変更しない。

受入: R1選択案件のみ→6,000行中8行の取得セル数検査、R2旧名/同名/削除/空白→一覧と詳細の集計検証、R3即時再取得→旧要求と置換要求を任意順で完了、R4復旧→不正形式/別案件/失敗/ログアウト、R5内部情報削減→実API応答の検査。`test_project_detail_loading.mjs` と既存の案件/経理回帰を使用する。広く散在する場合の一括取得や高度管理の全件工数取得、経理の全件集計取得は残る。GASの実時間をセル数から推測しない。

調査根拠: Google公式 https://developers.google.com/apps-script/guides/support/best-practices （通信削減・まとめ取得・キャッシュ）、https://developers.google.com/apps-script/reference/spreadsheet/text-finder （大小文字/正規表現/完全一致）。

### v0.25.20 経理スナップショット世代と作業別工数ID（2026-10-14）

経理の受入契約: A1 warm/追加表示では本文0回、A2権限・ヘッダーは毎回実判定、A3明示force/期限/欠損/DB切替は正本へ復旧、A4全書込経路は保存後無効化、A5旧読み取り/失敗監査でも保存世代を維持、A6全件総数と証憑照合を保持、A7工数ID取得は案件/作業/削除を再検証する。既存の新規登録/再送/承認/精算/API権限試験と新規 `test_finance_snapshot.mjs`、`test_project_detail_loading.mjs`、`test_workspace_loading.mjs` で検証する。

`financeOverviewSnapshot_(force)` はexpenses/travels/receiptsの全件を既存のfinanceRows_で作成し、共通cacheJsonPutLarge_の20秒UTF-8分割キャッシュに保存する。取得前にgetFinanceOverviewのrequireFinanceOperator_とfinanceStorageStatus_を必ず実行する。自分の申請、承認/精算、重複チェックの正本はこの共有表示キャッシュを使わない。全データから件数/優先順/照合を計算し、指定された最大1,000件だけを画面へ送る。

世代キーは `fm:finance:overview-generation:v1`、スナップショットは `fm:finance:overview:v1`。共通DataAccessがDB IDで分離する。世代はUUIDをCacheServiceに最大6時間保持し、未設定/欠損時は新しく作成する。読取結果に世代を付け、保存時は世代変更とスナップショット削除を行う。保存中に読取が終了しても、その旧世代を現在世代のキャッシュとして受け入れない。保存前後の非原子的なサービス境界は残るため、承認/精算/在庫等の最終判断をキャッシュへ移さない。CacheServiceの存在・期間・書込み成功は保証せず、完全な配列・世代一致がなければ正本を読む。

新規financeWriteNew_、再申請resubmitFinanceRequest、financeReview_、settleFinanceRequest、一括saveFinanceReceiptsBulkの書込み直後、監査前にfinanceInvalidateOverview_を呼ぶ。経費/出張/経費記録の新規登録を含む全書込経路が対象。既存同内容の重複再送は正本を変更しないので無効化を増やさない。UIはoptions.forceをparams.forceFreshへ渡す。「さらに表示」はoptions.reuseSnapshot=trueでサーバーの20秒保持を使い、保存後・明示更新はforceFresh=trueとする。

新規登録の送信識別子確認はfindVerifiedSheetRow_（表示値・live検査）に集約。一括入力は共通readRowsByColumnValues_に、検証済みの最大20キーとwithRowNumbers=trueを渡す。全キー列→個別本文の読み取りを減らし、一致本文から社員/送信内容を正本で検査する。入力キー重複を事前拒否するため、未保存の新規行を既存Mapへ仮登録する処理は不要となった。

`projectHubWorklogRowsByIds_(ids)` はIDを重複除去し、有効な全件13列キャッシュがある場合はIDを選択する。なければ工数A列の共通IDインデックスから必要なA:Mだけを取得する。部分データを全件キャッシュへ入れず、既存2キーの無効化とDB分離を維持する。projectAdvancedTaskEffort_ではその後に作業リンク、案件名/旧名、削除、正の分数を再検証。一般社員/管理者の認可は先行するprojectAdvancedNeed_を維持する。小規模・長いキー集合・索引未対応等は共通readerの適応一括経路を使う。

残る読込み: 冷えた経理の初回は正確な総数と照合のため全件を読み、分析/旧経費Excel集計は本変更対象外。大きな工数ID集合・散在は共通readerの一括フォールバックがある。短期間のキャッシュと読取セル数の削減をGAS実時間の測定済みと混同しない。

公式仕様: https://developers.google.com/apps-script/guides/support/best-practices 、https://developers.google.com/apps-script/reference/cache/cache 。CacheServiceは早期破棄もあるため欠損試験を実施する。

ID/送信キーの単一行finderはmatchCase(true)を設定し、既存の正本一致検査と検索条件を合わせる。大小文字だけ違う先行行で検索が止まり、既存の正しいキーを見落として二重保存する問題を回避する。検索表示用の部分一致・案件名正規化は変更しない。新規試験ではcase-keyとCASE-keyを別行に置き、正しいキーの再送がduplicateとなることを確認する。

## v0.25.21｜監査と回帰：API限界値・PIN UI同期・架空日付テスト（2026-10-15）

- `Code.gs`の`getPunchHistory(sessionToken,limit)`は`Number.isFinite`、`Math.floor`、`Math.max(1)`、`Math.min(100)`を通して最大100件に抑える。タイムスタンプ降順・本人認証・削除／修正の既存判定は変更しない。
- `AppShell.html`の`openChangePinModal`および`AppAdmin.html`の`openTempPinModal`は、公開ログイン設定`state.publicConfig.pinLength`から`maxlength`と表示文言を組み立てる。検証側では桁数8および既定6でUIを実行確認する。
- `FinanceAdvisor.gs`の`financeSpendingDigest_`は取得年と月・日から`Date.UTC(year,month,0)`で実在する月末日を求め、不存在日を破棄する。変更するのは旧台帳の読取専用集計だけで、原本シート・金額・取引データを更新しない。
- 回帰検証：`scripts/test_punch_history_index.mjs`、`scripts/test_pin_presence_search.mjs`、`scripts/test_finance_integration.mjs`。69件の機能試験と12件の未実施ブラウザー試験の区別は継続。GitHub Actionsを使わず、既存v3手動公開バッチを継続使用する。

## v0.25.22｜第2次監査：認証・期間制限の設計（2026-10-15）

- `Auth.gs` の `requireSession_(token, allowTemporaryPinChange)` は、セッショントークン・期限・社員の有効状態を検証した後、`employee.mustChangePin` かつ本番モードの場合、既定で `PIN_CHANGE_REQUIRED` を返す。これにより全従来 `requireSession_` 通常RPCを改修不要で保護。特例引数は `resumeSession` と `changeOwnPin` のみ。公開APIの `requireAdminSession_` 経由でもバイパスさせない。
- 仮PINでの `login` ・ `resumeSession` レスポンスに `initialData` を含めない。フロントの `acceptLogin` / 起動時セッション復帰は `showRequiredPinChange_` を経由してログイン画面上の必須PIN変更モーダルを表示する。復帰時は `getPublicAuthConfig()` からPIN桁数を取得する。PIN変更成功後、`getInitialData` から通常の画面を構築。
- `Code.gs` の `assertReadWindow_(start,end,400)` は日付正規化後のUTC日数差で最大400暦日を判定。`getScheduleBundleForViewer_` と `Worklog.gs/getWorklogs` の冒頭でDBアクセス前に呼ぶ。巨大範囲によるGAS実行時間超過やSheets全件走査を避ける。
- 新しい回帰テストはNode VM/架空の社員・Sheetで実行し、本番DB、Google API、Actionsを操作しない。仮PINの通常RPC拒否・PIN変更許可・復帰・初期情報非送出と、400日境界・閏年・過大範囲のDB未アクセスを検証する。GAS実機のブラウザー・運用データ受入は別工程。

## v0.25.23｜第3次監査：通信世代と文書再送キー整合性（2026-10-15）

- `AppShell.html` / `loadAuthenticatedApp` はリクエスト開始時の `state.sessionToken` をキャプチャし、RPC成功/失敗ハンドラで現在トークンと一致する場合のみ画面をマウントまたはセッションを消去する。起動時 `bootstrap` / `resumeSession` にも独立した `resumeToken` ガードを適用し、旧RPCがログアウト後や別ログイン後のUIを上書きしない。
- `AppShell.html` / `openChangePinModal(true)` は必須PINダイアログに `data-pin-change-required` を付与し、`initGlobalKeyboardShortcuts` のEsc分岐で閉じる操作のみを阻止する。通常ダイアログと従来の経理保存中Escブロックを維持する。
- `CompanyDocs.gs` / `companyDocsMatchesPayload_` は保存済みのタイトル、分類、概要、施行日、公開状態、URL、本文、フォルダー、タグを正規化済みフォームと照合。更新同一キーは最終編集者も、作成同一キーは作成者と初版revision=1も検証する。差異があれば例外で終了しDBへの書き込みを行わない。
- `scripts/test_auth_session_callback_guard.mjs` に古い成功/失敗応答の破棄、正常復帰、PIN変更Esc制限を登録し、既存 `scripts/test_company_documents.mjs` に作成/改訂時の同一・異内容・別担当者の再送ケースを追加。`scripts/local-checks.json` に新規テストを加え、GitHub Actionsは有効にしない。

## v0.25.24｜日付インデックスの400日境界とフォールバック（2026-10-15）

- `DataAccess.gs/readRowsByDateRange_` のインデックス探索範囲を370から400暦日に変更し、`Code.gs` の予定と `Worklog.gs` の工数の最大表示期間と一致させる。
- `dateRangeRegex_` で生成した最後の日付が要求終了日と一致しない場合、途中で切れたregexを返さず空文字を返す。これにより `LONG_RANGE_FALLBACK` で実Sheetの全行を読み、指定期間・社員IDの両方で絞る。
- `test_scoped_date_index.mjs` に架空1200行での400日完走、最終月と別社員の境界、401日での完全フォールバックを追加。インデックス経路の利用回数も検査。
- 実データ・GAS公開の検証、P50/P95実測、ブラウザーテストは別ゲート。

### v0.25.24補足｜FinanceAdvisorの任意キャッシュをfail-openにする

- `getFinanceSpendingInsights`は `CacheService.getScriptCache()` / `get` のエラーを非致命的として記録し、従来のSpreadsheetApp読み取りへ続行する。キャッシュ`put`の例外は取得済みの有効なreportを破棄させない。
- 失敗時の `ok:false` レスポンスは実際の元台帳読み取り・列検証の失敗時のみに返す。正しいキャッシュヒットと閲覧権限の判定は従来どおり。
- `test_finance_integration.mjs`で、キャッシュ接続失敗・get失敗・put失敗・キャッシュヒットの4つをNode VMの架空台帳で確認。

## v0.25.25｜任意キャッシュの耐障害性（2026-10-16）

- `FinanceAdvisor.gs/getFinanceSpendingInsights` のキャッシュ戻り値を `ok===true`、`source==='LEGACY_ONLY'`、要求年との一致、有限な数値 `total` で検証し、合致しない場合は原本から再集計する。`JSON.parse('null')` が成功してしまうケースも無効値として扱う。
- GAS `CacheService` の1項目サイズはバイト単位のため、共有 `DataAccess.gs/utf8Bytes_` でシリアライズ後のUTF-8サイズを計測し、90,000バイト以下のみキャッシュする。保存に失敗しても業務レポートは返す。
- `scripts/test_finance_integration.mjs` に、不正なキャッシュ内容・年度不一致・容量超過の日本語集計・正常なキャッシュ保存・キャッシュ障害時のフォールバックを追加。実データへの変更は行わない。
- 最新の原本とGitHub Actions禁止運用を維持。アプリの全機能72件とブラウザー12件の受入は公開前後に別途確認する。

## v0.25.26｜総務の送信識別子（idempotency key）整合性（2026-10-16）

- `Somu.gs/somuMatchesSubmittedFields_` は、シートから読み出した保存済レコードと正規化済みフォームの全主要フィールドを照合する。整数の表示値は桁区切りカンマを除去して数値一致を判定し、文字列・日付・URL・状態は厳密一致とする。
- `createSomuLoan`、`createSomuPurchase`、`saveSomuDocument` は、ロック内でキー検索→登録者検証→フォーム一致検証→同一再送の返却の順で処理する。
- `saveSomuGrowthRecord` の新規登録では、契約・設備・依頼フォームを正規化した後にキー衝突先の保存内容と比較する。依頼の自動計算項目（完了日・依頼者）は保存済レコードを基準に再構成し、日付変更時の誤判定を避ける。
- `resubmitSomuPurchase` は差戻し理由を保持する備考以外のフォーム項目を検証してから再送成功を返す。送信識別子はレスポンスへ公開しない。データ原本やDB列を変更せず、`test_somu_integration.mjs` と `test_somu_growth.mjs` で回帰する。
- 既存の `FM-WORKS_GAS_Update_SAFE_v3.bat` で全機能テストと配信照合が成功するまではGAS公開しない。GitHub Actionsは使わない。
- 数値項目の比較では、整形後の文字列を `/^\d+$/` で検証し、`Number(...)` の指数表現・不正文字吸収を許さない。

## v0.25.27｜ProjectAdvanced/Monthlyの実装修正（2026-10-16）

- `ProjectAdvanced.gs/projectAdvancedProjectRows_(name,projectId,column,checkedSheet,optional)` は `readRowsByColumnValues_` を呼び、シート上の案件IDと取得結果の案件IDを完全一致で再検査する。依存/添付/工数対応/原価は2列目、予算は1列目を使う。
- `getProjectAdvanced` と `projectAdvancedTaskEffort_` の読み取り経路を限定取得へ置き換える。`projectAdvancedRows_` は書き込みに必要な `_row` を維持するため変更しない。認可・管理者限定の予算・Drive保管・監査内容は変更しない。
- `Monthly.gs/getMonthlySummary` と `createTeamMonthlyExport` は既存 `normalizeYearMonth_` を呼び、形式は合うが存在しない月をDBアクセスより前に拒否する。
- `test_project_advanced.mjs` で予算列1・他台帳列2の索引利用と別案件の行非公開を検証。`test_monthly_input_guard.mjs` で無効月のDB未アクセスを確認する。全機能バッチ・本番速度実測・ブラウザー確認は別工程。

## v0.25.28｜銀行重複IDの内容整合性・工数Tombstone ACL（2026-10-16）

- `CashFlowBank.gs/cfpTxValidate_` の重複識別値は既存互換を維持する。取引番号がある場合、旧方式では残高と連番がfingerprintに含まれないため、`importCashFlowBankRows` のロック内で、既存行と今回の行のfingerprintが同じとき `cfpSameImportedFingerprint_` を実行する。
- 比較対象は残高（Sheetsの桁区切り表記を正規化）と、外部取引番号が存在する場合の連番。衝突した場合は`setValues`より前にエラーとし、同じfingerprintでも取引が異なる可能性を黙って消さない。通常の完全同一再送と内部振替区分の手動修正は従来どおり。元データのfingerprint再計算やDB移行はしない。
- `Worklog.gs/deleteWorklog` はID検索後に従来の社員本人・ADMIN権限判定を先に行い、その後に月次締めと削除済み状態を検査する。権限のない利用者への成功応答・既存状態の漏洩を防止。
- 機能テストの既存取込3件と重複再取込に加え、保存済み衝突・同一バッチ内衝突・無権限の削除済み工数を回帰対象とする。GAS/DB実操作とブラウザー表示の確認は別ゲート。
- 数値残高の桁区切りや空白は `/,|，|\s|￥|¥/g` 相当で正規化し、十進整数表現だけを検証する。指数表現等を任意に数値化しない。

## v0.25.29｜Schedule tombstone ACLと月次スナップショットの索引化（2026-10-16）

- `Code.gs/saveSchedule` は `canEditScheduleRow_` による認可のあと、既存予定の状態列13（配列のindex12）が `削除` なら更新を拒否する。意図しないソフト削除データの復活を防ぐ。 `deleteSchedule` も状態確認より先に同じACLを検査する。元の所有者の重複削除は既存の冪等性を維持する。
- `MonthlySnapshot.gs/getMonthlySnapshotSummaries_` の2シート（確定要約・確定日次）は `readRowsByColumnValues_(sheet,1,24,[snapshotId])` に切り替える。データアクセス共通関数の小規模一括・大規模索引・失敗時フォールバックを利用し、取得後もスナップショットID、対象年月、社員集合を正確に再検証する。
- 同関数で月次締め状態 `getMonthlyCloseStatusInternal_(ym)` は要約レコードがあるときに1回だけ呼び、全社員の返却用レコードに共有する。単一社員エクスポート、全社員一括エクスポートの双方に適用する。
- 新規Node回帰テスト `test_schedule_mutation_integrity.mjs` は削除済みACL・編集復活拒否・本人削除再送・正常な新規作成を、`test_monthly_snapshot_index.mjs` は両シートの索引・年月/社員の再検証・月次締め状態読込回数を確認する。本番GASブラウザーと処理時間は公開後に別途確認する。

## v0.25.30｜MonthlySnapshot確定データ完全性検証（2026-10-16）

- `getMonthlySnapshotSummaries_` は `readRowsByColumnValues_` によるsnapshotId限定検索のあと、選択された要約行に対して `employeeId` の一意性を確認する。要約がない場合は `[]` を直ちに返して日次台帳を取得しない。
- 復元した日次明細を社員ごとに昇順で並べ、`new Date(year,month,0).getDate()` の月末日数と、`YYYY-MM-01` から末日までの連続した文字列を厳密比較する。日付欠落・二重日付・日付不整合はすべて中断し、給与出力を行わない。元のスナップショットに変更は加えない。
- 取得後の月・社員の完全一致、管理者による給与一括出力と本人/権限者の個別出力、月次締め状態の応答内1回共有は保持する。
- 追加回帰は従来の `scripts/test_monthly_snapshot_index.mjs` を拡張（テスト本数75のまま）。Node全75件、ブラウザー12件とGAS実操作は別ゲートで確認する。

## v0.25.31｜CashFlowLedgerの手入力キーとCashFlowBank書込みロック（2026-10-16）

- `CashFlowLedger.gs/saveCashFlowLedgerRows` は手入力行の `externalId` （`LEDGER-` + `requestKey`）を全口座の資金取引台帳から検索する。既存行が2行以上、または別口座の行、同じ口座でもfingerprint・残高・連番に差異がある場合は全チャンクの保存前に拒否する。元口座への完全一致再送は許可する。
- `CashFlowBank.gs/importCashFlowBankRows` は既存 `withScriptLock_` 内で手入力識別子を全取引からMap化する。保存前に衝突を検査し、同時送信および同じバッチ内の異内容重複を拒否する。Map更新は書込み前なので、一件でも衝突すれば該当バッチは書き込まない。既存のfingerprint照合と残高照合を維持する。
- 通常の銀行側取引番号（`BANK-` 等）は口座別のまま。利用者が変更する内部振替の区分フラグは、再送識別子の不変項目に含めない。DB移行と公開バッチの改変は不要。
- 新規回帰テスト `scripts/test_cashflow_ledger_key_scope.mjs` と `scripts/test_cashflow_bank_ledger_namespace.mjs` は架空2口座を使って、正常再送・銀行口座間衝突・内容改変・同一チャンク内衝突・通常銀行IDの口座別取込を確認する。本番GASとブラウザーテストは独立して判定する。

## v0.25.32｜Finance再申請のidempotency key衝突検知（2026-10-16）

- `Finance.gs/resubmitFinanceRequest` は従来の `withScriptLock_` 内で所有者を確認したあと、`FINANCE_MODELS[kind].keys` から`requestKey`の列位置を取得する。 `readRowsByColumnValues_(sheet,keyColumn,width,[key])` で該当キーだけを抽出し、検索後も文字列で完全一致を再確認する。
- 対象の申請以外に同じキーを持つ行がある、または同じキーに該当する行が2件以上ある場合は、`setValues`実行前に停止する。既存申請の承認待ち状態での同一再送は、キーが当該申請固有であり、保存項目が全一致する場合に限り従来どおり冪等成功とする。
- この修正は経理の再申請APIに限定する。新規登録`financeWriteNew_`の既存VerifiedFinderと、DBのid・requestKey・revision列、および既存の承認者チェックに変更を加えない。実機のデータベース読取速度は公開後に別途測定する。
- `scripts/test_finance_resubmit_key_scope.mjs` を公開前のNode機能検証一覧に登録し、同じ社員の別申請、他社員、既存の不正重複、正常再申請、同一再送、差分再送を検証する。GitHub Actionsは実行しない。

## v0.25.33｜Historical payroll roster from immutable monthly-close snapshot（2026-10-16）

- `Monthly.gs/createTeamMonthlyExport` は `requireAdminSession_` と `normalizeYearMonth_` の後、従来どおり `getMonthlyCloseStatusInternal_` の `CLOSED` と `snapshotId` を検査する。 `getPayrollEmployees_` による現在の社員マスタ取得と現在IDによるフィルタは行わず、`getMonthlySnapshotSummaries_(ym,snapshotId,[])` により、当該IDへ確定した全社員の記録を復元する。
- `getMonthlySnapshotSummaries_` は `employeeIds=[]` の場合、スナップショットの全社員を取得する既存仕様を保持し、ID・年月・社員要約重複・社員ごとの28/29/30/31日の完全性を検証する。要約が空なら保存ファイル作成前にエラーで停止する。
- 既存の一括Excel構築・税理士向けメール文・一時Driveファイルの後片付けは変更しない。 `getPayrollEmployees_` は `closeMonthlyPeriod` の給与確定時には引き続き使用する。
- `scripts/test_monthly_input_guard.mjs` は有効な月で未締め状態照合に進む仕様へ更新し、`scripts/test_closed_month_roster.mjs` は現在の社員一覧と確定時の社員が異なること、認証、欠損、正常Excel組立、削除処理を独立検証する。全機能79件・ブラウザー12件の一括確認は別ゲート。

## v0.25.34｜CashFlowPlanLink保存時のスナップショット指紋・識別子一意性検証（2026-10-16）

- `CashFlowPlanLink.gs/saveCashFlowPlanLink` の既存行検索では、ロック内で `transactionId` と `requestKey` のそれぞれに完全一致する行集合を作る。同一取引の照合行が複数、または同じ送信キーを持つ行が複数なら、最初の1行を任意採用せずエラーにする。
- `APPROVE` の再送でID・予定日・理由・状態が一致した場合も、承認時に保存した `txFingerprint` および `planFingerprint` と、現在の銀行明細・予定内容から計算した指紋を比較し、不一致を再確認要求として拒否する。 `cfmlReadLink_` の `STALE` 判定と再送時の成功応答の不整合を解消する。
- `UNLINK` は解除時点の指紋を保持しており、正常な解除の再送に変更後の取引・予定が必ずしも必要ではないため、従来の理由一致に基づく冪等性を維持する。ただし重複取引行・重複送信キーが見つかれば解除再送も拒否する。
- `scripts/test_cashflow_analysis.mjs` の既存リンク統合シナリオを拡張。権限・revision・金額/口座/予定日・承認重複・正常再送を維持し、指紋変更・保存履歴重複と書込不変性を検証する。正式機能テスト79件/ブラウザー12件は変えない。GAS実運用・UI受入・実処理速度は別途検証。

## v0.25.35｜資金繰り台帳読取と照合履歴の監査（2026-10-16）

- `CashFlowLedger.gs/getCashFlowLedgerRows`: 既存の `readRowsByColumnValues_` から口座ID一致の `CFP.tx` と `CFP.plan`、選択取引IDだけの `CFA.note` を取得し、DBモデルのkeysで元の返却形式に復元する。読取APIはADMIN認証を維持。データの密度次第で索引不使用時に全件読取に切り替わるため、実測の改善は未判定。
- `AppCashFlowLedger.html/cflBalances_`: 残高起点の金額を整数確認した後、同日以前の明細が含まれれば書込を開始せず拒否する。翌日以降の行は安全な整数範囲内で自動計算する。
- `CashFlowPlanLink.gs/cfmlLinksByTransaction_`: 照合履歴の取引ID/送信キーの重複をMapとSetで検出し、関係する取引を `CONFLICT` にする。`cfmlReadLink_` は矛盾状態を画面へ伝える。`CashFlowAnalysis.gs/getCashFlowAnalysisMonth` は重複上書きMapを使わない。`AppCashFlowAnalysis.html` は警告を表示して承認・解除操作を提供しない。
- DB変更、外部データ操作、GitHub Actionsは行わない。SAFE v3更新バッチによる全テスト合格・認証付きGAS検証・読み込み速度の実測は別途必要。

### v0.25.35 追加保護：入出金予定の承認一意性と台帳の行識別子

- `cfmlLinksByTransaction_` は `APPROVED` のレコードのみ `JSON.stringify([planId,plannedDate])` をキーとして承認済み予定の一意性も検証する。2つ以上の取引が同一予定日・予定IDへ承認されていれば、両方の取引IDを `CONFLICT` とする。解除済み行は対象外とする。
- `getCashFlowLedgerRows` は口座・年度で絞り込んだ取引IDと口座の予定IDの重複、および取引IDで限定検索した注記行の重複を検出し、安全停止する。Mapの後勝ち採用と同じ予定の二重集計を避ける。
- `test_cashflow_analysis.mjs` および `test_cashflow_ledger_scoped_read.mjs` に架空の重複行テストを追加。正常な別日予定と解除済みの過去記録は既存表示を保持する。手動公開バッチの品質ゲート・権限・DB書込み処理に変更なし。
