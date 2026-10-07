# FM WORKS 技術設計書

**文書版:** 0.8.1  
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

`APP.version = 0.8.1`

DBスキーマ目安: 4。  
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

## 8. 初期データ

`getInitialData(sessionToken)` は以下を返す。

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
- monthlyReview
- month
- tasks

`monthlyReview` は全画面コーション表示に使う。

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
| worklog | 90秒 |
| schedule | 90秒 |
| requests | 90秒 |
| monthly | 120秒 |
| company | 300秒 |
| authAdmin | 120秒 |
| maintenance | 60秒 |
| documents | 600秒 |

`pendingLoads` で同一キーの重複通信を抑止。

`startMenuPrefetch` でログイン直後に段階的に先読み。

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
