# FM WORKS 開発指示｜2026-10-18

- ユーザー最新指示を優先する。現在は正式リリース前の試作アプリ。公開先はGPT Sites、保存先はSites内蔵SQL/D1。データは全件架空。Googleスプレッドシート接続・GAS公開・claspバッチは今後の開発手順に使わない。
- 新しいWorkスレッド名は「勤怠集計改善案Work●●」、チャットは「勤怠集計改善案V●●」。前の番号を確認する。ツールからタイトル変更ができない場合は変更したと主張しない。
- 指定GitHubやSitesへの通常の確認・修正・試作公開は今回のユーザー指示の範囲で進め、重複した許可確認を行わない。
- GitHub Actions、Codespaces、有料ランナー等は使わない。検証はGPT環境。Sitesの現在の公開範囲を維持し、新規はprivate。
- このSitesのIDは`.openai/hosting.json`が正本。重複作成しない。認証トークンをファイル・Git・ログに保存しない。
- `docs/REQUIREMENTS.md`、`docs/TECHNICAL_DESIGN.md`、`docs/MIGRATION_STATUS.md`を最初に読む。GitHub最新mainと未統合変更を確認し、旧GASソースの修正も保護する。
- `legacy/`は移行中に再利用する画面・業務ルールのソース。Googleへの接続は`lib/runtime-services.mjs`で拒否する。SQLデータをリクエスト単位の表へ変換するアダプターを使い、変更はD1の一括トランザクションと改訂チェックで確定する。
- `lib/generated/`は`scripts/prepare-app.mjs`で再生成し、直接編集しない。業務レコードはブラウザーlocalStorageへ保存しない。
- SQLマイグレーションはスキーマだけ。初期ダミーデータは`db/seeds/`。既存SQLのレコードを公開のたびに初期化しない。適用済みマイグレーションは変更せず追加する。
- build、SQL/APIテスト、ブラウザー、公開成功、公開後の操作確認を分けて報告する。未対応の帳票・添付を動作済みと扱わない。

基本確認：`node scripts/prepare-app.mjs` → `node --test tests/*.test.mjs` → Sites標準buildと公開フロー。
