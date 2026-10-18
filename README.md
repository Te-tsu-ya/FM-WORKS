# FM WORKS

勤怠・工数・案件・予定・申請・経理・総務・社内文書をまとめる、開発中の業務アプリです。
GPT Sitesで公開し、Sites内蔵SQL/D1へ保存します。データはすべて架空です。

[アプリを開く](https://fm-works.fusion-mind-4929.chatgpt.site)（現在は所有者限定）

## 文書

| 文書 | 内容 |
|---|---|
| [要件定義書](docs/REQUIREMENTS.md) | 利用者、機能、受入条件、未対応事項 |
| [技術設計書](docs/TECHNICAL_DESIGN.md) | 構成、API、SQL、認証、ビルド |
| [運用・開発ルール](docs/RULES.md) | データ、業務制御、配置、変更・検証・公開 |
| [開発エージェントへの指示](AGENTS.md) | GPTで作業するときの入口 |

現在の実装を基準に管理します。機能の状態は要件定義書へ集約します。

## 配置

| 場所 | 役割 |
|---|---|
| `app/` | ページとAPIの入口 |
| `src/ui/` | 画面・スタイル・ローディング表示 |
| `src/domain/` | 業務ルール |
| `src/browser/` | ブラウザー通信と開発用ログイン |
| `src/server/` | セッション、SQL、実行環境 |
| `db/` | SQLスキーマ・列対応・ダミーデータの編集元 |
| `drizzle/` | 適用済みSQLマイグレーションと履歴 |
| `docs/` | 上記3文書 |
| `tests/` | SQL・API・業務の回帰検証 |
| `scripts/`, `build/` | 生成、依存関係管理、Sitesのビルド基盤 |
| `public/` | 公開する静的ファイル |

`src/generated/`と`db/seeds/workspace.json`はビルド時に生成し、直接編集・Git登録しません。

## 基本確認

Node.js 22.13以上、pnpm 11.25.0を使用します。GPTのSites環境では標準の依存関係インストーラーを使います。

```sh
pnpm run test
pnpm run typecheck
pnpm run build
```

公開はSites標準のソース同期・ビルド・private公開で行います。GitHub反映とSites公開は別に確認します。手順は[運用・開発ルール](docs/RULES.md)を参照してください。
