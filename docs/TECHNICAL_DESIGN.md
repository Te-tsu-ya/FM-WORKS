# FM WORKS 技術設計書

**文書版:** 0.10.0  
**更新日:** 2026-10-07  
**正本:** GitHub `docs/TECHNICAL_DESIGN.md`

## 1. アーキテクチャ

FM WORKSはGoogle Apps Script HTML Serviceを実行基盤とするSPAである。

```
Browser
  ├─ Index.html
  ├─ Styles.html
  └─ App.html
       │ google.script.run
       ▼
Google Apps Script (V8)
  ├─ Code.gs
  ├─ Auth.gs
  ├─ Worklog.gs
  ├─ Requests.gs
  ├─ Monthly.gs
  ├─ Employees.gs
  ├─ Projects.gs
  ├─ Notifications.gs
  ├─ Maintenance.gs
  ├─ Holidays.gs
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
| `src/App.html` | SPA状態、描画、イベント、キャッシュ |
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

`APP.version = 0.10.0`

DBスキーマ: 9。  
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

## 11. 設定画面

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
- 通知・バックアップ確認・先読みは初回描画後に段階実行する。
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
| `approveRequest(token,id,decision,comment)` | ADMIN | 申請ID | ok |
| `getMonthlySummary(token,ym,employeeId)` | Session | 年月,社員 | daily,totals,reviewStatus,closeStatus |
| `confirmMonthlyReview(token,ym,note)` | Session | 年月 | reviewStatus |
| `closeMonthlyPeriod(token,ym)` | ADMIN | 年月 | closeStatus |
| `getAuthAdminData(token)` | ADMIN | なし | employees,resetRequests,support |
| `getSystemStatus(token)` | ADMIN | なし | readiness,backup,sheets |
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
5. DriveへDB copy
6. 監査ログ
7. 90日超Backup cleanup

公開UIから呼べる `installDailyBackupTrigger(sessionToken)` はADMIN認証必須。Trigger handler自体は末尾underscoreのprivate functionとし、client APIとして公開しない。


## 38. 労務ルールエンジン

`Labor.gs` に法定区分計算を分離する。純粋関数 `dailyStatutoryOvertimeMinutes_`、`lateNightOverlapMinutes_`、`laborWeekKey_`、`applyWeeklyStatutoryOvertimeToFacts_` をロジックテスト対象とする。

設定は `LABOR_RULE_PROFILE`、`LABOR_WEEK_START_DAY`、`LABOR_STATUTORY_HOLIDAY_SOURCE`、確認者・確認日時・メモを保持する。

`getMonthlySummary` は各日の深夜実働を算出後、`applyLaborModelToMonthlyDaily_` で法定日次/週次時間外、法定休日労働を付与する。週次計算は月初・月末の週について `laborBoundaryFacts_` で月外日を補う。

月次確定/日次確定は24列へ拡張し、法定時間外、深夜、法定休日、労務ルール状態を締め時点で固定する。

`getProductionReadiness_` と `closeMonthlyPeriod` は労務ルール未確定をブロッカーとする。給与額や割増賃金額は本エンジンで算出しない。


## 39. 構造化監査ログ

`auditJson_` は監査対象の業務状態をJSON化し、Spreadsheet式注入を防止した上で最大4000文字へ正規化する。

予定・工数・プロジェクト・社員の更新では、更新前の行から業務フィールドを抽出して `before` に保存し、書込後の業務状態を `after` に保存する。

社員のPINソルト、PINハッシュ、セッショントークン等は監査状態JSONへ含めない。申請承認/取消、月次締め等の状態遷移は既存の明示的before/afterを継続する。


## 40. Schema Contract / Migration

`Schema.gs` に `DB_SCHEMA_VERSION=9` と `DB_SCHEMA_SPECS` を保持する。

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
