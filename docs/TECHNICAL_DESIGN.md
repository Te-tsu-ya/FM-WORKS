# FM WORKS 技術設計書

**文書版:** 0.15.0  
**更新日:** 2026-10-08  
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

`APP.version = 0.15.0`

DBスキーマ: 10。  
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
