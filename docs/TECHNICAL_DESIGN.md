# FM WORKS 技術設計書

**文書版:** 0.23.9
**更新日:** 2026-10-10  
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

`APP.version = 0.23.8`

DBスキーマ: 18。  
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
