# FM WORKS 技術設計書

対象：v0.0.0（Sites開発初版） / 更新：2026-10-18

## 1. 実行構成

ブラウザー → 同一オリジンRPC API → 業務関数 → SQLリポジトリ → Sites内蔵D1。
公開はGPT Sites。Vinext/ViteでCloudflare Workers向けにビルドする。`sites()`のビルド統合と`nodejs_compat`を維持する。Google OAuth・Sheets API・GAS公開は使用しない。

| 層 | 実装 | 責任 |
|---|---|---|
| HTTP入口 | `app/route.ts`、`app/api/rpc/[method]/route.ts` | HTML応答、D1 bindingの受渡し |
| UI | `src/ui/Index.html`、`src/ui/{modules,styles,components}/*.html` | 画面・スタイル・操作・ローディング |
| ブラウザー連携 | `src/browser/bridge.js`、`overrides.js` | 同一オリジン通信、開発用担当者選択、Sites設定 |
| API | `src/server/api.mjs` | 入力形式、Origin、セッション、業務実行、SQL確定 |
| 業務 | `src/domain/{core,people,time,projects,finance,office}/*.js` | 勤怠・申請・月次・見積・経理等の検証と権限 |
| SQL | `src/server/sql-repository.mjs` | 初期投入、読取、変更検出、改訂競合、原子的保存 |
| 実行補助 | `src/server/table-adapter.mjs`、`runtime-services.mjs` | 要求内の表、時刻・ハッシュ・キャッシュ、Google接続拒否 |
| DB定義 | `db/schema.ts`、`db/table-mapping.json` | SQL列と業務名・列の対応 |
| マイグレーション | `drizzle/` | 適用順とスキーマ履歴。Sites標準ビルドが成果物へ収録 |
| 生成 | `scripts/prepare-app.mjs`、`seed-builder.mjs` | 業務関数・HTML・文書・初期データの組立て |

`src/domain/`は現行の業務ソースでありGAS配布物ではない。表形式の関数名やサービス互換名は内部互換性のため残る。業務ファイルは保存フォルダーに関係なくファイル名順で読み込み、従来の実行順を維持する。`.js`をビルド時に組み立て、Workerへ関数として含める。WorkerでevalやNode VMを実行しない。Node VMはダミーデータを作るビルド時だけ使用する。

## 2. 生成と正本

| 入力・出力 | 管理方法 |
|---|---|
| `src/ui/`, `src/domain/`, `src/browser/`, `src/server/` | 編集するソース |
| `docs/REQUIREMENTS.md`, `TECHNICAL_DESIGN.md`, `RULES.md` | 仕様・ルール。別の進捗文書を作らない |
| `db/seeds/fixtures.json`＋生成スクリプト | 架空レコードの編集元 |
| `db/schema.ts`, `db/table-mapping.json` | 現行列定義を生成してGit管理。マイグレーションと整合させる |
| `src/generated/` | engine、shell、schema-meta、API契約。自動生成・Git対象外 |
| `db/seeds/workspace.json` | 初期データの確認用投影。自動生成・Git対象外 |
| `dist/`とツール実行状態 | ビルド成果物・一時状態。Git対象外 |

要件定義書・技術設計書は生成時にAPIへ組み込み、管理画面から参照する。入力文書の欠落を古い代替文書で成功扱いしない。

## 3. SQLモデル

54業務表と3管理表を使用する。物理名・列は`db/schema.ts`と`db/table-mapping.json`が正本。勤怠、申請、有給、社員、見積、経理、資金、総務、案件、文書、監査・設定に分かれる。

| 管理表 | 用途 |
|---|---|
| `workspace_state` | 共有改訂番号と初期seed適用状態 |
| `transaction_guard` | 保存時の改訂一致CHECK。トランザクション内で作成・削除 |
| `site_sessions` | トークンのハッシュ、架空担当者ID、訪問者ID、期限 |

業務表は`row_no`をINTEGER主キー、業務列をTEXTとして、現行の入力検証と表形式の業務関数を利用する。金額の数値型、領域IDの一意制約、外部キー、業務索引を十分に整えた正規化DBではない。空の互換表もあるため、物理表の存在を機能完成の証拠としない。

初回は管理状態と1,864行の架空レコードをD1 batchで投入する。競合時は別要求による初期化完了を確認する。以後はseedを再投入しない。マイグレーションに実データや初期レコードを埋め込まない。

## 4. 読取・更新・競合

1. 状態と54業務表を一つのD1 batchで読む。各表は単純SELECTとしcompound SELECTを使用しない。
2. `row_no`順で要求専用の表へ復元する。表アダプターはメモリー上の構造であり、Google Sheets接続ではない。
3. 業務関数が入力・権限・締め・残数・改訂を検証し、要求内の表を変更する。
4. 変更された表だけを保存する。共有改訂の一致CHECK、対象表置換、改訂加算、ガード削除を同じD1 batchで確定する。
5. 改訂不一致や途中のSQL失敗では全体をロールバックする。競合は409とし、再読込後に利用者が再操作する。

全業務表のスナップショットと変更表の置換を使う開発版の方式。メモリー・読取量・競合頻度に制約がある。領域別取得・行単位更新へ変更する際も、部分保存・二重処理・残高不整合を防ぐ条件を維持する。要求内キャッシュを永続キャッシュと扱わない。

## 5. API契約

`POST /api/rpc/:method`へ`{"args":[...]}`をJSONで送る。応答は`{"result":...}`、失敗は`{"error":"理由"}`。`FMApi.run`が成功・失敗コールバックへ渡す。同一Sitesへcookieを同送する。

業務公開メソッドは生成した`src/generated/api-contract.json`に列挙し、実行前には生成済み`apiMethods`の一覧と照合する。末尾`_`の内部関数は公開しない。ログイン・ログアウト・復帰・公開ログイン設定はAPI側で扱う。Google依存の発行・添付・バックアップ等は拒否する。外部サービスへ到達した場合も実行補助層が拒否する。

| HTTP | 現行APIでの意味 |
|---|---|
| 200 | 成功。保存操作はSQL確定後に応答 |
| 400 | 不正JSON・入力条件・業務条件等の失敗。一部内部エラーも現在ここへ集約 |
| 401 | セッション不成立・失効・トークン不一致 |
| 403 | Origin不一致。業務権限違反は現在400の場合もある |
| 405 / 415 / 413 | POST以外 / JSON以外 / 本文上限超過 |
| 409 | SQL改訂競合 |
| 501 | Sites方式へ未対応の操作 |

引数は配列・最大10件、本文は読取後の文字列長で2Mi文字以下。Originがある場合に同一Originを確認する。受信後の上限検査でありストリーミング制限ではない。

## 6. セッションと境界

Sitesの入場制限を第一の境界とする。アプリ内で乱数トークンを発行し、SQLへSHA-256ハッシュのみ保存する。期限は7日。cookieはHttpOnly・SameSite=Strict・Path=/・HTTPSでSecure。

ブラウザー側はRPC引数用の同じトークンをlocalStorageまたはsessionStorageへ保持するため、HttpOnly cookieだけの認証ではない。テーマ・文字サイズ・選択担当者もブラウザーへ保持する。業務レコードは保持しない。

認証済み訪問者IDが渡された場合はセッションと関連付ける。所有者限定Siteのサービスアクセスは訪問者IDを持たないため開発用共有境界とする。APIはcookie・送信トークン・期限を全表読み込み前に検証し、対象外・未対応メソッドとログアウトは全表を読み込まずに処理する。認証済み処理は現在の社員状態と業務権限を確認する。単一の`H`・`m`書式を含む時刻変換はAsia/Tokyoに従う。

架空担当者選択は本人認証ではない。公開範囲拡大や実データ利用前に、本人紐付け・トークン保持・失効・監査を見直す。

## 7. 検証と公開

生成 → SQL/API・業務テスト → TypeScript確認 → Sites標準build → ソース同期・バージョン保存 → 現在の範囲で公開 → 公開後確認。

`tests/sql-fixture.mjs`はNodeの実SQLiteでD1互換APIを動かす。改訂競合・原子性・業務保存の根拠とするが、D1固有制限をすべて再現したものではない。公開先のSQL保存再取得も確認する。マイグレーションの元ファイル・タグ・適用順を維持する。

Sitesビルド用の`build/sites-vite-plugin.ts`とライセンス、Worker入口、実行プロファイル・インストール補助を残す。未使用のUI集・外部コネクターのサンプルは含めない。ライブラリ削除後はlockfileとインストールの整合を確認する。

同じSite IDへ更新し、認証情報はメモリーとstdinだけで扱う。GitHub Actions等は使用しない。ブラウザーQAが利用できなければ未実施と明記しHTTP確認と区別する。未対応事項は[要件定義書](REQUIREMENTS.md)へ集約する。

## Sites初版の旧機能整理

GAS専用HTML入口、Google Driveバックアップ、時間トリガーによる年休・バックアップ処理、Sheetsスキーマ更新のコードは削除した。SitesのDBバックアップ・復旧や自動ジョブは別途実装・検証する。監査ログと業務上の勤怠・申請・有給履歴、適用済みD1マイグレーションは保存する。これらはアプリの表示版 `0.0.0` と別管理する。

社内文書のSheets列追加・Drive退避ボタンも撤去し、未準備時はサイト管理側のSQLスキーマ確認を案内する。業務レコードの初期化は行わない。

UIは`FMApi.run`経由で同一オリジンのSites APIへ接続し、GAS式`google.script.run`をビルド時に文字置換する処理は使用しない。

管理文書の小規模な読み取り関数は`core/Maintenance.js`に、資金取引貼付け用CSSは`styles/StylesCashFlowBankGrid.html`に統合し、不要な単独ファイルを削除した。
