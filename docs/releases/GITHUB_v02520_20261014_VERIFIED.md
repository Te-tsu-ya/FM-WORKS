# v0.25.20 経理再取得・保存検索・作業工数の検証記録

基準main `4b3e0c2950e815b7e54441c21a22fd8ce857cdc7` / v0.25.19。実コードと要件/設計版をv0.25.20に統一。

## 変更と受入

- 経理の全件スナップショットを20秒、UTF-8分割CacheServiceに保持。権限と3台帳のヘッダーは毎回確認。表示件数が160→320に変わってもwarm時は本文の再読取0回。総数/承認精算待ち/非表示件数/証憑照合は全件から計算。
- 最新更新・保存後はforceFreshで正本へ。書込直後・監査前に世代を変更しsnapshotを削除。新規/再申請/承認差戻し/精算/一括、監査失敗、保存との競合、期限切れ、キャッシュchunk/世代欠損、DB分離を実行検証。
- 新規/一括経費保存の重複確認は、送信キーの索引から一致本文を取得。社員/提出内容/監査/同一キー再送を既存判定で検証。単一行finderは大小文字を区別し、別ケースの先行キーを拾って正しいキーを見落とす問題を修正。
- 作業別工数は紐づいた工数IDで取得。6,000行の試験では2明細/26セル、既存1,501行の統合試験でも26セル。案件名/旧名/作業/削除状態/所属権限を維持し、部分データを全件cacheへ入れない。

## 実行した検証

GPT環境: `node scripts/run_local_checks.mjs --functional`

- 開始 2026-10-14T07:07:35.433Z / 終了 2026-10-14T07:07:50.061Z
- 69 PASS / 0 FAIL / 12 SKIPPED。complete=false（ブラウザー完全受入ではない）。
- report SHA-256 `986b30b6982a5e63520bafaf190abcfa63e81a7cae65393b27875e88d20d9c3c`
- `GITHUB_v02520_20261014_LOCAL_REPORT.json` に全チェック名・対象ソース/検証入力SHA-256を保存。最終ファイルと全ハッシュを照合。
- 新規 test_finance_snapshot.mjs: 実Finance/DataAccess/FinanceBulkと架空Sheets、期限付き分割cache。warm/limit/force/TTL、ACL/見出し、全保存経路、監査失敗、世代競合/欠損/DB切替、保存キー索引/大文字小文字再送を検証。
- 既存 test_finance_integration.mjs（95の実API検査）、test_finance_workspace.mjs（一括入力/重複/監査）、test_finance_quote_refresh.mjs（forceFresh/さらに表示）、test_project_detail_loading.mjs（実IDreader6,000行）、test_workspace_loading.mjs（26セル/所属/別案件/キャッシュ分離）、test_project_advanced.mjs（所属/作業工数/資料/予算/監査）と全回帰。
- テスト用の直接Sheets変更では明示forceFreshを使う。TextFinder/RangeListを使う実経路をmockにも提供し、古い全件13列cache前提の試験は「本文26セル・全表取得0」に置き換えた。権限/集計/復旧の条件は緩めない。

根拠: Google公式の通信削減・まとめ読取・キャッシュ推奨、Cacheの早期破棄/期限/サイズ制約。
- https://developers.google.com/apps-script/guides/support/best-practices
- https://developers.google.com/apps-script/reference/cache/cache
- https://developers.google.com/apps-script/reference/spreadsheet/text-finder

## 未完了

GAS確認済み公開はv0.25.8/既存公開版196（2026-10-14 09:51 JST）。v0.25.20のGASソース保存・公開・ログイン後全画面操作・実P50/P95は未実施。セル数と本文読取回数を実時間と混同しない。

前回のGAS操作は自動承認レビューに「Your workspace is out of credits. Ask your workspace owner to refill in order to continue.」と拒否された。今回の依頼は補充完了の証拠ではないので、別経路や再試行でこの停止を迂回しない。GitHub Actions・有料実行機能を使用せず、DB/認証/実データ/既存URLと公開範囲を変更していない。

残課題: 経理cold全件取得/分析、総務ホームの全件集計・成長台帳上限、広いID集合の一括fallback、初期HTML分割の適否、外部Sheets更新時の明示更新、GAS実測・全画面受入。実運用の全項目が完了したとは表現しない。
