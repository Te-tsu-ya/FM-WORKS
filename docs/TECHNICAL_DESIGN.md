# FM WORKS 技術設計書

**文書版:** 0.26.2
**更新日:** 2026-10-18

## 構成

ブラウザーの既存画面 → 同一SitesのPOST `/api/rpc/:method` → 業務ルール → SQLリポジトリ → D1。公開はSites標準のVinext/Cloudflare Workers。`.openai/hosting.json`のd1=`DB`を使用する。Google OAuth、Apps Script、Google Sheets APIは使わない。

## ソースの役割

| パス | 内容 |
|---|---|
| legacy/ | レビュー済みの画面・業務ルール。ビルド時にWorkerで使える関数へ変換 |
| scripts/prepare-app.mjs | 業務関数、HTML、SQL列対応、初期ダミーを生成 |
| lib/browser-bridge.js | コールバック形式を維持し同一オリジンHTTPへ送信 |
| lib/browser-overrides.js | 架空担当者選択、Sites設定、移行中機能の案内 |
| lib/api.mjs | HTTP検証、セッション、業務実行、SQL確定 |
| lib/runtime-services.mjs | 日付・ハッシュ・リクエスト内キャッシュ。Googleサービスは拒否 |
| lib/table-adapter.mjs | 既存業務ルールが読む表のリクエスト内互換アダプター |
| lib/sql-repository.mjs | SQL取得、初期投入、改訂チェック、原子的確定 |
| db/schema.ts / drizzle/ | Drizzleのテーブル宣言とスキーマ専用マイグレーション |
| db/seeds/ | 全件架空の初期データ。マイグレーションへ埋め込まない |
| db/table-mapping.json | 業務名・SQL名・列名の対応 |

## SQLと整合性

54業務テーブルには明示した列を持たせる。互換性維持のため現在の業務列はTEXT、並び順のrow_noはINTEGER主キー。初期段階では既存の入力・金額検証を業務ルール側で行う。将来のドメイン別SQLへ移行するときに、金額INTEGER、関係ID、外部キー・一意制約・索引を順に導入する。現段階でそれらを実装済みとしない。

workspace_stateは共有改訂番号。SQLから状態と表をD1 batchで同時に読み、業務関数へリクエスト専用の表を渡す。変更された表だけを確定する。transaction_guardのCHECK(expected_revision = actual_revision)で、古いスナップショットの保存をSQLトランザクション内で拒否する。改訂不一致ならすべてロールバックしHTTP409。エラー時はSQLに部分書込みを残さない。

SQL読取はテーブルごとの単純SELECTとし、状態取得と同じD1 batchで実行する。compound SELECTを使用しない。現状は試作規模の基盤であり、今後データが増える前に領域別SELECTと行単位UPDATEへ切り替える。全表の読み書きを長期の性能解決としない。

## 初期データ

初回にworkspace_stateと架空レコードをD1 batchで一括投入する。初回要求が競合しても二重投入しない。マイグレーションはDDLのみ。公開のたびにseedを再投入しない。既存の実スプレッドシートやExcelを読む経路は存在しない。

## セッションと公開範囲

開発用の担当者を選ぶと乱数セッションを発行する。cookieはHttpOnly/SameSite=Strict/HTTPS時Secure。SQLにはセッショントークンのSHA-256のみ保存し、Sitesの認証済み訪問者IDがあれば関連付ける。所有者限定Siteのサービスアクセスは訪問者IDを持たないため、private共有の開発セッションとして扱う。Sites自体の入場制限を維持する。業務APIではcookieと送信トークンの一致、期限、現在の社員・権限を確認する。別オリジンのPOSTは拒否する。

これは架空データの開発用アクセスであり、実業務向けの認証・権限設計は改めて行う。

## 検証と公開

Nodeの実SQLiteでD1と同じSQLを実行し、初期投入・再読込・同時更新の拒否・業務API・ログイン/ログアウトを確認する。Sites標準buildを実行し、同一project_idへソース同期・バージョン保存・private公開する。画面検証用のcontrol-browserがない環境では代替ブラウザーを勝手に導入せず、未実施を明記する。

Google依存の正式帳票・添付は501を返す。旧GAS公開バッチやSQLの初期化を使って回避しない。


## 公開先で判明したD1上限の修正

初版公開後にcompound SELECTの上限エラーを確認し、20テーブル単位の結合でも公開先では解消しなかった。上限値の推定に依存せず、各テーブルの単純SELECTへ変更した。同じD1 batchで改訂と全テーブルを読む。テストではcompound SELECTを一切受け付けない条件でも取得を確認する。実環境の制約をローカルSQLiteだけで網羅したとは扱わない。スキーマと既存のダミーデータは変更しない。
