# FM WORKS 技術設計書

**文書版:** 0.8.0  
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

`APP.version = 0.8.0`

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

`getLatestMonthlyDataUpdate_` は対象月の以下を走査する。

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

`settingsTabs()` と左ナビのサブメニューを同期。

### 11.1 文書

`loadSystemDocument(type)` でADMIN APIを呼ぶ。

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

`:focus-visible` は青系3pxアウトライン。

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
