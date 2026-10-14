# FM WORKS｜Windowsバッチから既存GASへ手動反映

**2026-10-14：GitHubの実装は完了。所有者Dell上でのGoogle初回認証・本番GASの実行・実ブラウザー受入は未実施。**

既存の [Windows自動公開ブリッジ](GAS_WINDOWS_DELL_SETUP.md) を使い、**GitHubの最新 `main` → バッチ実行 → 現行GAS `/exec` URL更新** を手動で行えます。GitHub Actionsは使いません。

## 使用するファイル

| ファイル | 目的 |
| --- | --- |
| `FM-WORKS-GAS-SETUP.bat` | 初回だけ。GitHubの取得、Googleの本人認証、既存Script ID設定、現在公開済みのソース照合 |
| `FM-WORKS-GAS-PUBLISH.bat` | 毎回共通。最新main取得→事前チェック→Yで既存GASへ公開 |
| `scripts/gas_local_bridge.mjs` | 本体。GASの事前照合、ローカル機能テスト、既存URLへの更新、公開後のコード再取得と確認 |

バッチはGitHub更新のたびに再生成する必要がありません。Windowsのデスクトップ等に保存して使い回せます。バッチは `%USERPROFILE%\FM-WORKS-PUBLISHER` に専用のGit cloneを作ります。認証情報と既存データはGitHubにアップロードしません。

## 初回設定（1回だけ）

1. WindowsへGit for Windows、Node.js 20以上をインストールします。
2. コマンドプロンプトで `npm install -g @google/clasp` を実行します。
3. [Apps Script API設定](https://script.google.com/home/usersettings) でGoogle Apps Script APIを有効化します。
4. `FM-WORKS-GAS-SETUP.bat` を起動し、GitHubのプライベートリポジトリへのアクセスを許可します。Google所有者の認証画面で `clasp login` を完了します。
5. 既存FM WORKS GASプロジェクトの「プロジェクトの設定」にある**Script ID**を入力します。**WebアプリURL内のデプロイIDと混同しないでください。**
6. Work1などが**最後に既存GASの公開版へ実際に反映したGitHubの40文字コミットSHA**を用意し、セットアップの質問に入力します。バッチは `clasp pull --versionNumber <現在の版>` で**既存公開版の不変ソース**とGAS編集ソースを読み取り、該当GitHubソースと**両方完全一致する場合だけ**ローカルの初期記録を作成します。

**GitHubと現在のGAS内容が一致していないときは停止**します。コミットSHAを推測したり、古い`@192`などを勝手に指定してはいけません。まずWork1で現行GAS公開版と変更内容を照合してください。以前に設定したブリッジの`state.json`が残っている場合は既存状態を再利用します。

## 2回目以降：バッチ1本

1. ChatGPTで修正したコードをGitHubの`main`へ統合します。PRを作っただけでは対象になりません。
2. `FM-WORKS-GAS-PUBLISH.bat`をダブルクリックします。
3. GitHubリポジトリが正しいこと、ローカルに未コミット変更がないことを確認し、`git fetch` + `git merge --ff-only origin/main` で最新コードへ安全に更新します。
4. **既存GASを変更する前に**、現在のデプロイ版、リモートソース、前回記録、公開対象コミットを照合します。
5. 表示されたSHAを確認し、`Y`を押した場合だけローカルの機能テストを実行します。再照合後に`clasp push --force`し、`clasp create-deployment --deploymentId <既存ID>`で**同じURLを更新**します。
6. 新しいGAS版番号と再取得したソースが一致した場合、`deploy/gas-published`へ通常のGit pushでSHAを記録します。GASブラウザーでログインと主要操作を実際に確認してください。

## 設計上の重要な安全対策

- バッチから`git push --force`、GitHub Actions、Codespacesを実行しません。GASの`clasp push --force`は、リモートファイルの事前・直前照合と承認済みコミットのテスト後にだけ実行します。
- **同じGitHubコミットを繰り返し実行しても、新しいGAS版を増やしません。** GASソース変更のない文書更新だけならソースのpushを省略します。
- 事前確認時と`Y`承認後のGitHub `main` SHAが異なれば停止します。勝手に新しいコミットを公開しません。
- リモートGASにGitHubにないファイル、別作業による変更、知らない既存デプロイ版、保留中`pending.json`が見つかれば停止します。途中で失敗した場合はGASを確認するまで自動再送しません。
- GASのアクセス権、DBスキーマ、社員・勤怠・財務情報を変更しません。Script IDとOAuth情報はPCローカルだけに保持します。
- 手動バッチと5分間隔タスクスケジューラ公開は**どちらか一方を選択**してください。排他ロックはありますが同時使用は推奨しません。
- 既存`/exec` URLを更新するためDeployment IDを指定します。IDを省略して新しいWebアプリURLを作ることはありません。

## 失敗時の意味

| 表示 | 処置 |
| --- | --- |
| `Git / Node.js / clasp missing` | 先にソフトをインストール |
| `Missing .clasp.json` | SETUPバッチで既存Script IDに接続 |
| `GAS source differs` / `Initial GAS version` | Work1で現在のGAS公開コミット・版番号と手動変更を確認。強制上書き禁止 |
| `pending.json` | 部分反映のおそれ。GASデプロイと内容確認まで削除禁止 |
| `main changed since manual preflight` | 新しいコミットが追加された。バッチを最初から実行 |
| `functional suite failed` | GitHubの該当修正をテストで通すまで公開しない |
| `already running` | 自動タスクと二重に実行していないか確認 |

## 料金と確認範囲

**GitHub Actionsの実行クレジットは0分。** GitHubの通常のGit通信・Google Apps Script API・PCの通信やChatGPTのクレジットには別の条件・上限があります。

**バッチが成功しても実際の認証・DB動作が正常とは限りません。** コード公開後に既存URLを開いて利用者としての操作確認を行い、問題があればWork1の担当へ引き継いでください。

参考：[Google clasp](https://github.com/google/clasp)／[Google公式ガイド](https://developers.google.com/apps-script/guides/clasp)。
