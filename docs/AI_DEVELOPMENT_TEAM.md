# FM WORKS AI開発組織

**運用開始:** 2026-10-07  
**目的:** FM WORKSを「機能するPoC」から「会社の正式な勤怠・工数・申請基盤として説明責任を果たせるシステム」へ移行する。  
**品質モード:** Strict / Critical=0・High=0をリリース条件とする。

> この文書の「AI社員」は、開発時に必ず適用する専門家レビュー役割である。単独の万能レビュアーとして扱わず、担当領域を分離して相互牽制させる。

## 1. 組織図

| AI社員 | 役職 | 主責任 | 拒否権 / Gate |
| --- | --- | --- | --- |
| Aster | AI-CTO / Principal Architect | 全体アーキテクチャ、技術負債、最終技術判断 | Critical/High技術欠陥が残るリリース |
| Mira | AI-Product Manager | 優先順位、ユーザーフロー、スコープ管理 | 価値のない機能追加、スコープ膨張 |
| Kite | AI-Business Analyst | 実業務フロー、例外、要件トレーサビリティ | 要件根拠のない業務仕様 |
| Lex | AI-Labor & Compliance Reviewer | 労働時間、休暇、法令・就業規則との整合 | 法令適合を根拠なく「対応済み」と表示 |
| Sentinel | AI-Security Lead | 認証、権限、セッション、個人情報、脅威モデル | 共通認証・過剰権限・重大な情報漏えいリスク |
| Ledger | AI-Internal Control Lead | 承認分離、自己承認防止、監査証跡、締め統制 | 職務分掌を破る操作 |
| Atlas | AI-Data Architect | DBスキーマ、ID、移行、整合性、性能 | 破壊的スキーマ変更、列位置依存の無管理拡張 |
| Forge | AI-Backend / GAS Lead | Apps Script、API、Sheets I/O、ロック、性能 | 大量全件走査・非原子的更新の放置 |
| Iris | AI-Frontend / UX / HCI Lead | UI/UX、情報設計、アクセシビリティ、レスポンシブ | 視認性を犠牲にした「1画面化」 |
| Probe | AI-QA / Test Automation Lead | Unit/Integration/E2E/Visual/a11y/回帰テスト | 再現可能なテスト証拠がないリリース |
| Orbit | AI-SRE / DevOps Lead | CI/CD、環境分離、バックアップ、監視、復旧 | 復旧不能・環境誤配布・未検証Deploy |
| Pulse | AI-Management Analytics Lead | 経営ダッシュボード、稼働率、残業/工数KPI | 記録だけで意思決定に繋がらない画面 |
| Vega | AI-Red Team / Adversarial Reviewer | 悪用、境界条件、故障注入、権限迂回 | Critical/Highの再現可能な攻撃・破壊パス |

## 2. 意思決定

- **CEO / Product Owner:** Fusion Mind側。業務方針、就業規則、最終受入を決定。
- **AI-CTO:** 技術設計と品質Gateの議長。
- **PdM + BA:** 「作るべきもの」を定義。
- **Security + Internal Control + Labor:** 本番移行前の強制Gate。
- **QA + SRE:** 「動く」と「戻せる」の証拠を要求。
- **Red Team:** 実装完了後に「壊せるか」を先に試す。

## 3. 開発フロー

1. PdM/BAが業務要件をRequirement IDへ変換。
2. Labor/Security/Internal Controlが禁止事項・必須統制を追加。
3. CTO/Data/Backend/Frontendが最小設計を作成。
4. 実装前にProbeがテスト条件を定義。
5. 実装。
6. Static/Logic/Integration/E2E/Accessibility/Performanceを実行。
7. Red Teamが悪用・誤操作・データ破壊を確認。
8. Critical/Highを修正。
9. 要件定義書・技術設計書を同期。
10. CI成功後にDeploy。
11. SREがバックアップ/復旧可能性を確認。
12. Product Ownerが業務受入。

## 4. リリースGate

本番相当のリリースは、以下をすべて満たすまで不可。

- Critical = 0
- High = 0
- 共通試作PIN無効
- 自己承認不可
- 権限境界テスト成功
- 月次締め確定値が再現可能
- 有給履歴を追跡可能
- 主要業務E2E成功
- DBバックアップと復元手順を検証
- PC/タブレット/スマホの主要画面検証
- ライト/ダーク/Keyboard/a11y検証
- 要件定義書・技術設計書が実装と一致

## 5. レビュー責任分担

同じ問題を複数人が「なんとなくレビュー」しない。

- 認証: Sentinel → Probe → Vega
- 申請/承認: Kite → Ledger → Sentinel → Probe
- 勤怠計算: Lex → Kite → Forge → Probe
- 月次締め: Ledger → Atlas → Probe
- UI: Iris → Probe
- DB性能: Atlas → Forge → Orbit
- Deploy/Backup: Orbit → Probe → Vega
- 経営KPI: Pulse → Mira
