# FM WORKS 初期接続手順

## 1. Apps Scriptプロジェクトを用意

Google Apps ScriptでFM WORKS用のスタンドアロンプロジェクトを1つ作成します。

## 2. Apps Script APIを有効化

`https://script.google.com/home/usersettings` で Apps Script API をONにします。

## 3. claspで一度だけログイン

ローカルPCでNode.js 20以上を用意し、以下を実行します。

```bash
npm install -g @google/clasp
clasp login
```

## 4. `.clasp.json` を作成

このリポジトリ直下で、Apps ScriptのScript IDを使って次の内容を `.clasp.json` として作成します。

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "src"
}
```

`.clasp.json` はGitHubへコミットしません。

## 5. GitHub Secretsを設定

リポジトリの `Settings > Secrets and variables > Actions` に以下を登録します。

- `CLASPRC_JSON`: `~/.clasprc.json` の内容
- `CLASP_JSON`: `.clasp.json` の内容
- `DEPLOYMENT_ID`: Apps Script Webアプリの既存Deployment ID（同じURLを更新するため）

## 6. 初回デプロイ

初回だけApps Script側でWebアプリの実行者・アクセス範囲を慎重に設定してデプロイし、Deployment IDを取得します。

勤怠・社員情報を扱うため、公開範囲は本番要件を確認してから決めます。PINログインを使う場合でも、推測耐性・レート制限・監査ログを実装してから本番公開します。

## 7. GitHub Actions

Secrets設定後、GitHubの `Actions > Deploy Apps Script > Run workflow` から手動デプロイできます。

本番運用で十分にテストできた後、`main` へのpushで自動デプロイする設定へ切り替えます。

## ブランチ運用

- `main`: 本番候補
- `staging`: 検証用
- `develop`: 開発統合
- `feature/*`: 個別修正

直接Apps Scriptエディタだけを編集せず、原則GitHubを正本にします。
