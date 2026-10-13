# FM WORKS｜Windows（Dell 第11世代Core i7）GAS公開設定

**状態（2026-10-13）:** Windows対応コードをGitHubへ追加。**Dell本体への初回設定・Google認証・GAS実公開は未実施。** GitHubだけ更新しても公開版は変わりません。

目的：通常チャットから「GitHubとGASへ公開」を指示し、Windowsの専用タスクが5分おきに公開依頼を確認、ローカルテスト後に**既存GASデプロイ**を更新する。GitHub Actionsは使用しません。Windows 10/11で実行する構成です。

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
