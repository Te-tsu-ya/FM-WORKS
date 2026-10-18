# FM WORKS｜Sites SQL開発版

GPT Sitesで公開し、Sites内蔵SQL/D1へ架空データのみを保存する試作アプリです。
Googleスプレッドシート・GAS公開・Windowsバッチは使用しません。

開発者は最初に [AGENTS.md](AGENTS.md)、[要件定義書](docs/REQUIREMENTS.md)、[技術設計書](docs/TECHNICAL_DESIGN.md)、[移行状態](docs/MIGRATION_STATUS.md)を確認してください。

- `node scripts/prepare-app.mjs`：画面・API・初期データを生成
- `node --test tests/*.test.mjs`：実SQLiteでSQL/API検証
- Sites標準のbuild → source workflow → private公開

SQLは`db/schema.ts`と`drizzle/`、ダミーデータは`db/seeds/`、列の対応は`db/table-mapping.json`です。
既存の試作DBを更新のたびに初期化しません。PDF/Excel正式発行と添付ファイルは移行中です。
