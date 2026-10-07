# FM WORKS Quality Backlog

**基準:** 2026-10-07 v0.8.4酷評結果を、修正可能な品質バックログへ変換したもの。  
**完了条件:** Critical=0 / High=0。その後Mediumを費用対効果順に処理する。

## P0 / 本番前必須

| ID | 問題 | Severity | 主担当 | 受入条件 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-001 | 試作共通PIN 000000 / Prototype Mode | Critical | Sentinel / Orbit | Production Gateで共通PINを禁止し、個別認証のみ許可 | DONE v0.10.0（PRODUCTIONでは設定値に関係なく共通PINを無効化。ブラウザへPINを返さず、設定がTRUEのままならREADYを拒否） |
| Q-002 | ADMINが自分の申請を承認可能 | Critical | Ledger / Forge | 申請者=承認者をAPIレベルで拒否しテスト | DONE v0.9.0 |
| Q-003 | 上司・承認者という組織概念がない | High | Kite / Ledger / Atlas | MANAGERと直属承認者を定義し、自分の部下のみ承認可能 | DONE v0.9.0 |
| Q-004 | 有給が残日数だけで台帳がない | High | Lex / Atlas | 基準日・付与・取得・失効・調整・関連申請を履歴化 | IN PROGRESS v0.9.2（台帳/基準日/付与・失効API/取得・復元履歴まで実装。年5日監視はQ-007へ） |
| Q-005 | 承認済申請の取消/変更が弱い | High | Kite / Ledger | 取消理由、取消承認、休暇残数の補償トランザクションを記録 | DONE v0.9.2 |
| Q-006 | 月次締めが状態フラグのみ | Critical | Ledger / Atlas | 締め時点の月次/日次スナップショットを保存し再現可能 | DONE v0.9.1 |
| Q-007 | 労務計算モデルが単純 | High | Lex / Forge | 深夜・法定休日・法定時間外等を区分可能なデータモデルを実装。会社固有ルール未設定時は「法令対応済み」と表示しない | IN PROGRESS v0.9.6（1日8h/週40h/深夜22-5/明示法定休日/月45h・60h・単月100h注意まで実装。年360h・複数月80h・変形/フレックス/会社固有特別条項は未実装） |
| Q-008 | Browser E2Eがない | High | Probe | ログイン/打刻/申請/承認/月次/テーマの自動E2Eまたは同等の実行可能テスト | READY |
| Q-009 | 開発/検証/本番の境界が弱い | High | Orbit / Sentinel | ENVを明示し、Production Gateで危険設定を拒否 | IN PROGRESS v0.9.4（Runtime ENVとProduction DB guard実装。専用Production Script/DBの実配置は未実施） |
| Q-010 | DBバックアップが管理者利用依存 | High | Orbit | 時間トリガー + 最終成功時刻 + 失敗可視化 + 復元手順 | IN PROGRESS v0.9.5（時間トリガー・重複防止・監査実装。実環境でのTrigger認可と復元試験待ち） |

## P1 / 早期改善

| ID | 問題 | Severity | 主担当 | 受入条件 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-011 | Sheets全件走査 | High | Atlas / Forge | 対象期間/対象社員のI/O削減、計測ログ、性能予算 | DONE v0.9.9 |
| Q-012 | App.html 1,600行超の巨大フロント | High | Aster / Iris | UIモジュール分割、責務境界、回帰テスト | DONE v0.10.1（5モジュールへ責務分割、旧App.htmlはスタブ化、CIは連結構文/既存UI契約を検証） |
| Q-013 | 列番号依存・Migration不足 | High | Atlas | スキーマ版、ヘッダ検証、Migrationを自動化 | DONE v0.9.8 |
| Q-014 | 監査before/after不足 | High | Ledger | 重要更新は変更前後を再現可能 | DONE v0.9.7 |
| Q-015 | 予定の公開範囲が実質社内固定 | High | Sentinel / Kite | ALL / PARTICIPANTS / ADMIN等をAPIで強制 | DONE v0.9.3 |
| Q-016 | 7〜10px文字が多い | Medium | Iris | 業務本文/重要状態は原則11〜12px以上。1画面化より可読性優先 | READY |
| Q-017 | Nested scroll | Medium | Iris | 内部スクロールは明示的な長一覧に限定 | READY |
| Q-018 | 実働表示で30秒ごと全画面再描画 | Medium | Iris / Forge | 数値ノードだけ更新し、フォーカス/スクロールを保持 | READY |
| Q-019 | Visual/a11y/performance回帰試験なし | High | Probe | axe相当、visual snapshot、性能計測をCI化 | READY |
| Q-020 | セッションクリーンアップが行削除ループ | Medium | Atlas / Forge | 定期GC化または一括処理、ログインパスから重処理を外す | READY |

## P2 / 経営価値

| ID | 問題 | Severity | 主担当 | 受入条件 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-021 | 経営者向けKPIが弱い | Medium | Pulse / Mira | 残業推移、部署負荷、案件投入時間、承認滞留を1画面で確認 | READY |
| Q-022 | 役割ごとのホームが同じ | Medium | Mira / Iris | 一般社員/Manager/Adminで優先カードを最適化 | READY |
| Q-023 | 工数二重入力負荷 | Medium | Kite / Iris | 予定/タイマー/履歴から工数入力を短縮 | READY |

## 法務・労務上の扱い

FM WORKSは法令判定そのものを専門家相談の代替として扱わない。
法令に関係する計算は、法令上の最低要件と会社の就業規則・36協定・勤務制度を分離して設定する。
未設定ルールがある場合は「未設定」を可視化し、推測値を給与確定値として出さない。
