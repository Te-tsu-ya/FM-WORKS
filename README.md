# FM WORKS

Fusion Mind社内向けの統合ワークポータルです。

## 主な機能

- 社員番号 + PINログイン / セッション管理
- 出勤 / 退勤 / 休憩 / 勤務場所
- 工数入力・編集・削除 / プロジェクトマスタ
- 共有予定表（月 / 週 / 日 / 一覧）
- 会社カレンダー（一般社員は閲覧、権限者のみ編集）
- 有給 / 半休 / 1/4日有給 / 欠勤 / 打刻修正 / 在宅 / 残業 / 休日出勤の申請・承認
- 社員マスター / 権限管理 / 仮PIN再発行
- 月次勤怠集計 / 給与対象者一括Excel出力 / 税理士提出用文面
- PIN再発行依頼 / サポート連絡先
- 監査ログ
- 本番運用チェック（PIN・会社カレンダー・バックアップ・試作モード）
- 月次の休憩不足 / 工数差異チェック
- 月初の先月勤怠本人確認 / 変更後の再確認アラート
- 月次カレンダー確認 / 日別修正導線
- ライト / ダークテーマ
- ADMIN向け要件定義書 / 技術設計書ビュー
- ソース変更時の設計文書同期CI

## 技術構成

- Frontend: HTML / CSS / JavaScript
- Backend: Google Apps Script (V8)
- Data: Google Sheets「FM WORKS DB」
- Export / Storage: Google Drive
- Source control: GitHub
- Deployment: clasp + GitHub Actions

## 認証・セキュリティ

- PINは平文保存せず、社員別Salt + Script Properties上のPepperを使ったHMAC-SHA256で保存
- セッショントークンもハッシュ化して保存
- セッション絶対期限 / アイドル期限
- ログイン失敗回数制限 / 一時ロック
- 仮PINは初回変更必須
- 権限チェックはUIだけでなくApps Script側でも実施
- 打刻・ログイン・PIN変更・申請・主要管理操作を監査ログへ記録
- GitHubへPIN / OAuthトークン等の秘密情報をコミットしない

## 権限

- `ADMIN`: 管理機能を含む全機能
- `CALENDAR_EDITOR`: 通常社員機能 + 会社カレンダー編集
- `USER`: 自分の勤怠・工数・申請、共有予定表、会社カレンダー閲覧

## 初期データ

- 旧「予定表(仮)」を正規化して共有予定表へ移行
- 2026年会社カレンダーを登録済み
- 初期社員マスターを登録済み

## 本番公開前の必須手順

1. アプリを `MYSELF` のまま開き、初期ADMINのPINを設定
2. 設定画面で「PINを忘れた場合」の連絡先を設定
3. 各社員へ仮PINを発行
4. 認証後にWebアプリ公開範囲を社内運用向けへ変更
5. PC / スマホでログイン・打刻・申請・月次のE2E確認

詳細は [docs/SETUP.md](docs/SETUP.md) を参照してください。

設計正本:
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)


## デモ・検証データ

現在のFM WORKS DBに登録している社員名・顧客名・プロジェクト名・予定詳細は、画面検証用の架空データです。
旧勤怠ファイル自体は変更せず、FM WORKSへ取り込んだスナップショットだけを匿名化しています。

- 架空社員: `FM0001 青木 悠真 / FM0002 森川 彩乃 / FM0003 神谷 直人 / FM0004 小林 美月 / FM0005 中村 健太`
- 架空プロジェクト: `Project Atlas / Project Nova / Project Orion / Project Bloom / Project Vega / Project Aurora / Internal Works`
- 顧客表示: `顧客A / 顧客B / 顧客C`
- 実際の社員名・顧客名・案件名をGitHubへハードコードしない
- 画面・テスト・サンプルデータに表示する人物名と案件名は、上記の架空データだけを使用する
