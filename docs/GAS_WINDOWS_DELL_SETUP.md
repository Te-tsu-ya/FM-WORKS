# FM WORKS｜Windows（Dell 第11世代Core i7）GAS公開設定

**状態（2026-10-13）:** Windows対応コードをGitHubへ追加。**Dell本体への初回設定・Google認証・GAS実公開は未実施。** GitHubだけ更新しても公開版は変わりません。

目的：通常チャットから「GitHubとGASへ公開」を指示し、Windowsの専用タスクが5分おきに公開依頼を確認、ローカルテスト後に**既存GASデプロイ**を更新する。GitHub Actionsは使用しません。Windows 10/11で実行する構成です。

## 2026-10-15：手動更新バッチのWindows起動修正

- Dellから `clasp.cmd list-deployments` で既存公開版 `@196` を取得済み。Google認証・スクリプトID接続は成功しているが、GitHub最新コードのGAS公開完了は未確認。
- 手動バッチのNode.js → `cmd.exe /S /C` → `clasp.cmd` 呼び出しで、Nodeが外側の引用符を二重エスケープし終了コード1になる。`windowsVerbatimArguments: true` を適用し、安全な引数の許可文字チェックは継続。
- Windowsの回帰確認は `node scripts/test_gas_local_bridge.mjs` で、**偽のローカル clasp.cmd** を `cmd.exe` から起動する。GoogleやGitHubの内容は変更しない。更新バッチは公開依頼ブランチ更新前にこの自己診断を実行する。
- `.clasp.json` が存在するなら、通常のバッチでは再ログイン・スクリプトID入力を省略する。認証の期限切れ等が起きたときだけ再ログインする。
- 手動バッチは既存GAS `@196` と公開時点の正本 `600b99213a3de50234f09de673337d8a7cfe86ea` を照合し、読取専用 `--preflight` を通過して初めて `--once` で既存デプロイを更新する。新規URL発行、DB初期化、認証後画面検証は行わない。

## 2026-10-15：公開前の模擬テストが@196と@192で衝突した問題

- Windowsの修正版バッチで `PASS Windows cmd.exe /S /C + clasp.cmd` と `PASS local GAS bridge core` を確認した後、`test_gas_local_bridge.mjs` の模擬E2Eが失敗した。
- **原因:** バッチが実GAS用に設定した `FM_WORKS_INITIAL_GAS_VERSION=196` を模擬E2Eへ引き継いだ一方、模擬GASは `@192` から開始した。これは実GASのバージョン誤りではなく、模擬試験側の環境分離漏れ。
- **修正:** 模擬E2Eに `FM_WORKS_INITIAL_GAS_VERSION=192` を明示し、親環境が `196` であっても模擬環境は `192` であることを回帰検証する。配布用バッチでは、本番用基準値の設定を自己テストの後へ移す。
- 初回公開の実GAS比較は従来通り `@196` と正本コミット `600b99213a3de50234f09de673337d8a7cfe86ea` を使用し、ソース比較・手動改変検出・公開対象IDの照合を省略しない。**今回の修正はGASの更新やバックアップ操作を行わない。**
- エラー発生時点では模擬テスト終了前のため、その回の公開依頼ポインターは更新されず、GAS公開も実施していない。以降の `--preflight` と `--once` は本物のGoogle環境での安全確認が必要。

## 2026-10-15：clasp pullの拡張子変換による公開前停止

- Windowsで自己テスト3件（Windows `clasp.cmd`、ブリッジコア、模擬E2E）はPASS。実GASの`--preflight`では `Required Apps Script sources are absent from release.` と表示され、`clasp push` の前に停止。
- GitHubの `src/`には`Code.gs`、`Styles.html`、`appsscript.json`など83ファイルが存在する。現行 `clasp` は Scriptファイルを取得するとき、既定の拡張子順 `['.js','.gs']` の先頭を使うため、`Code.gs` が `Code.js` として保存され得る。
- リモートの読取専用一時ディレクトリで使用する `.clasp.json` に `scriptExtensions:['.gs','.js']` を明示し、`htmlExtensions:['.html']` を固定した。ソースを自動削除したり、拡張子を一方的に書き換えてGASへ押し付けたりしない。
- 模擬 `clasp pull` でも既定なら `.js` を生成する挙動を再現し、明示設定が必要な回帰テストに変更した。必須ファイルが欠けた場合は、欠落ファイルと取得したファイル名のサンプルを表示し、**GASへ書き込まず停止**する。
- この修正はスクリプト・試験・運用文書だけ。公開リクエスト用ブランチは既に`main`と一致するが、**実GAS公開版は最後の確認で @196**。実Google環境の再実行・認証画面・業務DBについて成功確認をしていない。

## 2026-10-15：機能テスト失敗時の診断改善

- GAS `@196` の公開先ID、ファイル一覧・既存ソース照合、`--preflight` は実機で成功した。次の `node scripts/run_local_checks.mjs --functional` が Windows 上で exit 1 となり、公開は未実行。**原因の個別テストは現時点で未特定。**
- 旧 `gas_local_bridge.mjs` はテストの標準出力とエラーを捨て、一時Git worktreeを終了時に削除していたため、テスト失敗の原因が追えなかった。
- 新版は失敗テスト名とチェック件数を表示し、専用Windowsフォルダー `artifacts/gas-local-bridge/last-functional-report.json` と `last-functional-suite.log` に実行結果を残す。これらは `.gitignore` によりGitHubに送られない。
- 本番データは操作しない。いずれかのチェックが失敗した場合は `clasp push`・デプロイ更新に進まず停止する。詳細を確認せずにテストを飛ばすことは禁止。
- 診断専用バッチは `node scripts/gas_local_bridge.mjs --diagnose` を実行し、GASのソースを読取専用で照合してからテストする。GitHubの公開依頼ブランチ、GASのソースやデプロイ、Sheetsのデータは変更しない。既存の手動公開バッチとは別に使用する。
- `node scripts/gas_local_bridge.mjs --diagnose` はGitHubの最新 `main` と実GASの内容を**読み取り専用**で照合し、最新コードの機能テストを一時worktreeで実行する。公開依頼ブランチを移動せず、`clasp push`や新しいGASデプロイも行わない。失敗レポートを `artifacts/gas-local-bridge/` に残す。
- 個別の失敗を確認する際は、手動公開バッチではなく診断専用BATを一度実行する。診断で赤いFAILが出た段階ではGAS公開を再試行せず、失敗したテストの内容を修正してから公開する。


## 2026-10-15：Windows公開診断で検出した3つの機能テスト誤判定

- 2026-10-15のDell診断では **66 PASS / 3 FAIL / 12ブラウザ検査SKIP**。GAS既存公開版 `@196` の読み取り照合はPASS。GAS公開は未実施。
- `test_initial_payload.mjs`: WindowsチェックアウトのCRLFが初期HTML全体のファイルサイズを **16,403バイト**増やし、見かけ上 `1,367,267 > 1,360,000`。GitHub正本のUTF-8 LFバイト数は **1,350,864**で、元の上限内。サイズ上限は変更せず、改行をLF正規化して判定する。CSS **400,021 / 420,000**、JS **940,849 / 950,000**も正本では上限内。
- `test_cashflow_report_session.mjs`: 実際の `cfaDownloadReport_` は存在するが、次の関数との間に1つ空行があるとテストの抽出正規表現が失敗する。LF/CRLF・空行を許容し、既存のセッション・年度・シナリオ変更防止ロジックの実行テストは継続。
- `test_repository_demo.mjs`: `demo/data/financial.json` はGitHub原本では `JSON.stringify(seed,null,2)` と完全一致。Windowsの改行変換で誤判定していたため、改行だけLF正規化した上でデータの全文一致を確認する。失敗時に約64万文字のJSONを標準エラーへ展開しない。
- **業務 `src/`・実DB・本番GASの内容は今回変更しない**。GAS公開を行う前に、Windowsの `node scripts/gas_local_bridge.mjs --diagnose` の最新結果が `0 FAIL` になることを確認する。GitHub Actionsは使わない。

## 初回設定（Dellで一度だけ）

WindowsのPowerShellを通常ユーザーとして開きます。

### 1. Git・Node.js・clasp
まだインストールしていない場合のみ：

```powershell
winget install -e --id Git.Git
winget install -e --id OpenJS.NodeJS.LTS
```

PowerShellを閉じて開き直した後：

```powershell
npm install --global @google/clasp
node --version
git --version
clasp --version
```

Node.jsは20以上が必要です。wingetがない場合はGit/Node.jsの公式インストーラーを利用します。会社のPC管理ポリシーがある場合はそれを優先してください。

### 2. 公開専用フォルダー

```powershell
cd $HOME
git clone https://github.com/Te-tsu-ya/FM-WORKS.git FM-WORKS-PUBLISHER
cd .\FM-WORKS-PUBLISHER
```

GitHubの画面で認証します。通常の開発編集とは分離した専用フォルダーとして使います。トークン・PIN・パスワードをチャットへ貼らないでください。

### 3. Google本人認証と既存GASのScript ID

[Google Apps Script APIの設定](https://script.google.com/home/usersettings)を確認し、次を実行します。

```powershell
clasp login
node scripts/setup_gas_local_bridge.mjs --connect
```

後者では、既存「FM WORKS」のApps Scriptエディター → **プロジェクトの設定** → **スクリプトID** を入力します。WebアプリURLの `/exec` に含まれる**デプロイIDとは異なります**。接続情報は追跡対象外のローカル `.clasp.json` に保存します。

### 4. 書き込み前の安全チェック

```powershell
node scripts/gas_local_bridge.mjs --preflight
```

GitHub最新版の公開依頼、既存GASデプロイ、最後に記録された公開版（初期値@192）、元のGASソース内容を**読み取り専用**で照合します。別の作業で公開版・ファイルが変更されていたら停止します。値を推測して強制上書きしないでください。

### 5. 初回の公開を手動で確認

```powershell
node scripts/gas_local_bridge.mjs --once
```

成功後、**これまでと同じアプリURL**を開き、ログイン・サイドメニュー・上部バーが白／青の配色に戻っていることを確認します。コード配信と、ログイン後の全機能検証は別の工程です。業務DBは初期化しません。

### 6. 5分間隔の自動公開を登録

```powershell
node scripts/setup_gas_local_bridge.mjs --install-windows
node scripts/setup_gas_local_bridge.mjs --status-windows
```

タスクスケジューラへ `FM WORKS - GAS Publisher` が登録されます。**Windowsにログイン中で、PCが起動・ネット接続している間**に動きます。スリープ中は停止し、復帰後に再開します。Windows側の登録は通常ユーザー権限で試みますが、管理ポリシーにより制限される場合があります。登録の前に必ず `--preflight` が通るようにしています。

## 確認・停止

```powershell
node scripts/setup_gas_local_bridge.mjs --status-windows
node scripts/gas_local_bridge.mjs --once
node scripts/setup_gas_local_bridge.mjs --remove-windows
```

ローカルの実行ログ・公開済みコミット・エラーは `artifacts/gas-local-bridge/` に記録します。途中失敗時の `pending.json` は、GASの状態を確認するまで削除しないでください。

## 普段の使い方

チャットで「**FM WORKSを改善して、テスト後にGitHubとGASへ公開して。GitHub Actionsは使わない**」と指示します。ChatGPTがGitHubの `main` と `deploy/gas-production` を更新すると、Dell側が差分を検知して既存のデプロイを更新します。成功した配信は `deploy/gas-published` へ記録されます。**公開待ち・GASソース反映済み・公開画面の実操作確認済み**を混同しません。

GitHub Actionsの実行分数を使わない一方、PCの電力・ネットワーク・GitHub Git通信・Google Apps Script API・ChatGPT自体には別の使用条件と上限があります。

参考: [Google clasp](https://github.com/google/clasp)、[Microsoftタスクスケジューラ](https://learn.microsoft.com/powershell/module/scheduledtasks/new-scheduledtasktrigger)、[Node.js child_processのWindows注意](https://nodejs.org/api/child_process.html)。
