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

Google Sheets「FM WORKS DB」へ接続済みです。勤怠打刻は実データ保存、予定表は旧「予定表(仮)」から移行済み、会社カレンダーは2026年の年間カレンダーを登録済みです。

### 実装済み
- 勤怠: 出勤 / 休憩開始 / 休憩終了 / 退勤を打刻ログへ保存
- 予定表: 月 / 週 / 日 / 一覧表示、社員・カテゴリ絞り込み、登録・編集・削除
- 会社カレンダー: 予定表と分離、2026年365日、年間稼働240日 / 休日125日、日別編集
- 社員マスタ: 初期5名を登録
- 監査ログ: 打刻・予定・会社カレンダー変更を記録
- Fusion MindロゴをUIへ反映

### まだ段階実装のもの
- 工数の実保存
- 申請・承認フロー
- 月次集計・税理士提出
- 複数社員向けログイン / PIN認証

## 重要

`.clasprc.json` / `.clasp.json` / OAuthトークン / PIN / APIキー等の秘密情報はコミットしません。

初期接続手順は [docs/SETUP.md](docs/SETUP.md) を参照してください。
