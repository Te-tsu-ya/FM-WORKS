# FM WORKS

Fusion Mind社内向けの統合ワークポータルです。

## 目的

PC・スマートフォンの両方から、次の業務を1つのWebアプリで扱える状態を目指します。

- ホーム
- 勤怠
- 工数
- カレンダー
- 申請
- 社員
- 月次
- 管理

## 技術構成

- Frontend: HTML / CSS / JavaScript
- Backend: Google Apps Script (V8)
- Data: Google Sheets（接続は次フェーズ）
- Storage: Google Drive（接続は次フェーズ）
- Source control: GitHub
- Deployment: clasp + GitHub Actions

## 現在の状態

初期UIシェルを実装済みです。8メニューをPC/スマホで切り替えられます。データは現時点ではデモ表示で、Google Sheetsへの本接続はまだ行っていません。

## 重要

`.clasprc.json` / `.clasp.json` / OAuthトークン / PIN / APIキー等の秘密情報はコミットしません。

初期接続手順は [docs/SETUP.md](docs/SETUP.md) を参照してください。
