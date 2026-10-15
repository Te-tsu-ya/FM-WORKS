# FM WORKS｜GitHub Actionsを使わないGAS自動公開

**ステータス（2026-10-13）：** ローカル公開ブリッジのコードと模擬統合試験は完成。**所有者PCのGoogle初回認証・既存GASへの実公開は未実施。** このファイルをGitHubへ保存するだけでGASの公開版は変わらない。

## 目的

「通常チャットで改修・GitHub統合 → チャットからGAS公開を指示 → Mac/Windowsで自動的に既存URLを更新」という運用にする。GitHub Actions、Codespaces、GitHub課金ランナーは**一切使用しない**。

`ChatGPT → feature PR → main → deploy/gas-production（公開依頼）→ 所有者PCが5分ごとに確認 → ローカルテスト → clasp → 既存GAS更新 → deploy/gas-published（反映済みSHA）`

公開依頼と反映済みSHAをGitHubの**通常のブランチポインター**で受け渡す。GitHub Actionsの実行時間は**0分**。ただし、Google APIの割当、Git通信、所有者PCの電力・ネットワーク、ChatGPTの利用上限は別であり、あらゆるサービスが無制限無料になるわけではない。PC停止・スリープ・オフライン中は公開待ちとなる。

## 一度だけ必要な初期設定（Mac）

1. 所有者Macへ Git、Node.js 20以上、`@google/clasp` を用意する（`npm install --global @google/clasp`）。
2. GitHubの認証済みGitでプライベートリポジトリ `Te-tsu-ya/FM-WORKS` を専用フォルダーにcloneする。普段の開発編集はこの専用フォルダーで行わない。GitHub Actionsは有効化しない。
3. Googleの [Apps Script API設定](https://script.google.com/home/usersettings) を確認し、Macで一度だけ `clasp login` を実行する。認証トークン・PIN・秘密鍵はチャットへ貼らない。
4. 既存のFM WORKS Apps Scriptエディターの「プロジェクトの設定」から**Script ID**を取得する。WebアプリURLのDeployment IDとは別のIDである。
5. cloneしたフォルダーで `node scripts/setup_gas_local_bridge.mjs --connect` を実行し、案内に従ってScript IDを入力する。追跡対象外の `.clasp.json`（rootDir=src）が生成される。
6. `node scripts/gas_local_bridge.mjs --preflight` を実行する。GitHubの承認済みSHA、既存GAS公開版、ファイル一覧、Google認証、公開先を**読取のみ**で確認する。初回は前回のGAS公開記録にあるGitHubソース（`067b070d...`）とGoogle上の全ソースが一致するかも確認し、手動改変を発見したら中止する。
7. 初回のみ、`node scripts/gas_local_bridge.mjs --once` を実行し、既存GASデプロイへ公開する。成功後に同じ既存URLで実際のログイン画面を表示し、赤色が消えたことを確認する。配色の実機検証はブリッジのソース検証とは別工程である。
8. 自動化の有効化には `node scripts/setup_gas_local_bridge.mjs --install-macos` を実行。表示された `launchctl bootstrap ...` コマンドでLaunchAgentを登録する。Macにログインして稼働中は5分ごとに差分を確認する。

**公開を担当するPCはWindowsのDellノート（第11世代Core i7）に確定。** Windows専用の初回設定・5分間隔タスク登録・状態確認・停止方法は [`GAS_WINDOWS_DELL_SETUP.md`](GAS_WINDOWS_DELL_SETUP.md) を参照。`clasp.cmd` のWindows起動を実装し、`node scripts/setup_gas_local_bridge.mjs --install-windows` でタスクスケジューラへ登録可能。最初のGoogle認証と `--preflight` が必要で、PC未設定の状態ではGAS公開済みと報告しない。

**初回照合基準について:** 2026-10-14の[正式公開記録](releases/GAS_v0258_20261014_PUBLISHED.md)でGAS@196（v0.25.8）・統合main `600b99213a3de50234f09de673337d8a7cfe86ea` を確認済み。手動・他チャットからそれ以降に更新されている場合は初回照合を停止する。確認できない公開版に合わせて基準値を推測変更せず、GASの全ファイル・Script ID・Deployment IDを照合してから安全に引き継ぐ。

**Windowsでの手動公開：** リポジトリ直下の `FM-WORKS_GAS_Update.bat` を一度保存して使用する。毎回GitHubからmainを取得し、`--preflight-main` で実GASの安全確認を先に行い、担当者の確認を得てから公開依頼ポインターを進め、`clasp update-deployment` で既存URLへ公開する。スケジュール登録は不要。GASの公開成功とブラウザーでの業務動作確認は区別する。

## 普段のチャットから公開する仕組み

1. ChatGPTがGitHubでコード修正・ローカル検証・PR統合を行う。公開の指示または承認があったときだけ次へ進む。
2. GitHubの `deploy/gas-production` ブランチを**最新mainと同じコミットSHA**へfast-forward更新する（並行更新確認とexpected SHA保護）。これがクレジット消費なしの「公開依頼」。
3. Mac側が公開依頼を受信し、所有者のGit・Google認証で対象SHA、GAS既存Deployment ID、GAS側ファイル一覧、前回のリモート内容を照合し、`node scripts/run_local_checks.mjs --functional` をローカル実行する。
4. 問題なければ `clasp push --force` 後、**必ず既存のDeployment IDを指定**して `clasp update-deployment <既存ID> --description FM_WORKS_<SHA>` を実行。新しいWebアプリURLは作らない。公開版番号とGASコード内容の一致を再取得して検証する。
5. 成功したときにのみ `deploy/gas-published` ブランチを同じ対象SHAに更新する。ChatGPTはGitHubの「公開依頼SHA」と「反映済みSHA」を比較して公開進捗を判定できる。
6. **重要：受領ブランチの一致はソース配信確認であり、ブラウザー実画面・全機能・権限の実操作成功とは別。** GASの公開URLを実際に開き、ユーザー操作を確認するまではUI検証完了と報告しない。

## 公開時の安全制約

- Apps Script側にGitHubに存在しないファイルがあれば、削除事故を防ぐため公開しない。前回公開後にGoogleのエディターで手動変更されたファイルも上書きせず停止する。
- 検証実行中のGAS側変更も再取得して停止する。途中失敗は `artifacts/gas-local-bridge/pending.json` に残し、GAS状態を確認するまで自動再試行しない。
- 本番の勤怠・財務・社員データの移行、スプレッドシート初期化、アクセス権変更は実施しない。ブリッジはGASソースと既存版の公開だけを行う。
- 同一SHAを繰り返してもGAS版を増やさない。ドキュメントだけ変更された場合もソース版を増やさない。
- Script IDはPCローカルの `.clasp.json`、Google OAuth情報はclaspのローカル認証領域にのみ置く。GitHubやチャットへコピーしない。
- 詳細ログ・公開済みSHA・GAS版はローカルの `artifacts/gas-local-bridge/` に保存される（Git追跡対象外）。
- 公開元Macが動いていない間は**公開予約**のまま。通常チャット自体がGoogle認証やPC起動を代行するわけではない。

## 検証

`node scripts/test_gas_local_bridge.mjs` はGoogle/GitHubへの通信なしで、模擬リポジトリと模擬claspを使い、事前照合・既存デプロイへの1回限りの公開・再実行の重複防止・GAS手動変更検出・文書のみ更新時の公開スキップをテストする。`scripts/local-checks.json` のGPTローカル機能検証にも登録する。

参考：[Google公式clasp](https://github.com/google/clasp)／[Apps Script Projects API](https://developers.google.com/apps-script/api/how-tos/manage-projects)／[GitHub Actions課金](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。
