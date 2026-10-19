# FM WORKS

**勤怠・工数・予定・申請・案件・経理・総務を一つにまとめる、開発中の社内アプリです。**

[アプリを開く（許可されたアカウントのみ）](https://fm-works.fusion-mind-4929.chatgpt.site) ｜ [現在のバージョン](package.json) ｜ [できること・未完成のこと](docs/REQUIREMENTS.md)

> このGitHubは**アプリの設計図とプログラムを置く場所**です。社員の勤務記録などの実データは置きません。開発中のため、アプリ内のデータはすべて架空です。

## まず見たいところへ

| 知りたい・確認したいこと | 画面のコード | 計算・保存のルール |
|---|---|---|
| 勤怠・工数・予定・申請 | [日常業務](src/ui/operations.html) | [勤怠・申請](src/domain/attendance.js) |
| 社員・権限・管理設定 | [管理画面](src/ui/admin.html) | [社員情報](src/domain/people.js) |
| プロジェクト | [案件画面](src/ui/projects.html) | [案件管理](src/domain/projects.js) |
| 見積・社内文書 | [書類画面](src/ui/documents.html) | [文書管理](src/domain/documents.js) |
| 経費・出張旅費 | [経理画面](src/ui/finance.html) | [経理処理](src/domain/finance.js) |
| 資金繰り | [資金繰り画面](src/ui/cashflow.html) | [資金管理](src/domain/cashflow.js) |
| 総務・備品 | [総務画面](src/ui/office.html) | [総務処理](src/domain/office.js) |
| 画面全体の色・余白・配置 | [共通デザイン](src/ui/styles.html) | — |

*非エンジニアの方は、上の表と次の3つの資料が分かれば十分です。*

## 正式な設計資料（この3つに集約）

| 資料 | 内容 |
|---|---|
| [要件定義書](docs/REQUIREMENTS.md) | 何を作るか、何が未完成か |
| [技術設計書](docs/TECHNICAL_DESIGN.md) | どう動くか、SQLや認証の構成 |
| [運用・開発ルール](docs/RULES.md) | 変更・テスト・公開・データ保護の約束 |

## フォルダーの意味

| フォルダー | 中身 |
|---|---|
| `src/ui/` | 画面の表示・ボタン・デザイン |
| `src/domain/` | 勤怠や経理などの業務ルール |
| `app/`・`src/server/` | SitesとSQLをつなぐ処理 |
| `db/`・`drizzle/` | SQL定義・架空の初期データ・適用済み変更履歴 |
| `tests/` | 動作を確認するテスト |
| `scripts/`・`build/` | アプリを生成してSites向けにビルドする道具 |
| `docs/` | 上記の正式な3文書 |
| `public/` | アイコンなどの公開素材 |

**削除しない設定ファイル：** [`cloudflare-env.d.ts`](cloudflare-env.d.ts)、[`package.json`](package.json)、[`.openai/hosting.json`](.openai/hosting.json) などはSitesの動作に関係します。[SQL変更履歴](drizzle/0000_fm_works_sites_initial.sql)も復旧のため維持します。GitHubのファイル整理と、Sitesの実際の公開は別工程です。

<details>
<summary>開発担当者向け：検証・公開前の確認</summary>

Node.js 22.13以上、pnpm 11.25.0を使用します。

```sh
pnpm run test
pnpm run typecheck
pnpm run build
```

生成ファイルは直接編集しません。変更は専用ブランチ＋PRで検証し、mainに統合後、既存Sitesの保存・公開版と照合します。詳しくは[開発指示](AGENTS.md)と[運用ルール](docs/RULES.md)を参照してください。

</details>
