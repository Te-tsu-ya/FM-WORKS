# FM WORKS Quality Backlog

**基準:** 2026-10-07 v0.8.4酷評結果を、修正可能な品質バックログへ変換したもの。  
**完了条件:** Critical=0 / High=0。その後Mediumを費用対効果順に処理する。

## P0 / 本番前必須

| ID | 問題 | Severity | 主担当 | 受入条件 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-001 | 試作共通PIN 000000 / Prototype Mode | Critical | Sentinel / Orbit | Production Gateで共通PINを禁止し、個別認証のみ許可 | DONE v0.10.0（PRODUCTIONでは設定値に関係なく共通PINを無効化。ブラウザへPINを返さず、設定がTRUEのままならREADYを拒否） |
| Q-002 | ADMINが自分の申請を承認可能 | Critical | Ledger / Forge | 申請者=承認者をAPIレベルで拒否しテスト | DONE v0.9.0 |
| Q-003 | 上司・承認者という組織概念がない | High | Kite / Ledger / Atlas | MANAGERと直属承認者を定義し、自分の部下のみ承認可能 | DONE v0.9.0 |
| Q-004 | 有給が残日数だけで台帳がない | High | Lex / Atlas | 基準日・付与・取得・失効・調整・関連申請を履歴化 | IN PROGRESS v0.10.4（台帳UI、GRANT/EXPIRE/ADJUST、最新100件表示、10日以上付与記録を根拠とする年5日監視と期限通知を実装。分割付与/基準日統一など会社固有運用は要確認） |
| Q-005 | 承認済申請の取消/変更が弱い | High | Kite / Ledger | 取消理由、取消承認、休暇残数の補償トランザクションを記録 | DONE v0.9.2 |
| Q-006 | 月次締めが状態フラグのみ | Critical | Ledger / Atlas | 締め時点の月次/日次スナップショットを保存し再現可能 | DONE v0.9.1 |
| Q-007 | 労務計算モデルが単純 | High | Lex / Forge | 深夜・法定休日・法定時間外等を区分可能なデータモデルを実装。会社固有ルール未設定時は「法令対応済み」と表示しない | IN PROGRESS v0.10.3（1日8h/週40h/深夜22-5/法定休日/月45h・60h・単月100hに加え、36協定起算月・特別条項設定、年360h/720h、45h超6か月、2〜6か月平均80hを監視。変形/フレックス/業種特例・会社固有条項詳細は未実装） |
| Q-008 | Browser E2Eがない | High | Probe | ログイン/打刻/申請/承認/月次/テーマの自動E2Eまたは同等の実行可能テスト | IN PROGRESS v0.10.4（Node VM Client ContractをCI/Deploy双方で実行し、主要フロー・予定HTMLエスケープも検査。実デプロイBrowser E2EはMYSELF制限のため未実施） |
| Q-009 | 開発/検証/本番の境界が弱い | High | Orbit / Sentinel | ENVを明示し、Production Gateで危険設定を拒否 | IN PROGRESS v0.9.4（Runtime ENVとProduction DB guard実装。専用Production Script/DBの実配置は未実施） |
| Q-010 | DBバックアップが管理者利用依存 | High | Orbit | 時間トリガー + 最終成功時刻 + 失敗可視化 + 復元手順 | IN PROGRESS v0.10.4（時間トリガー・重複防止・監査に加え、コピー後の全シート形状照合とverified Gateを実装。実環境でのTrigger認可と実復元試験は残る） |

## P1 / 早期改善

| ID | 問題 | Severity | 主担当 | 受入条件 | 状態 |
| --- | --- | --- | --- | --- | --- |
| Q-011 | Sheets全件走査 | High | Atlas / Forge | 対象期間/対象社員のI/O削減、計測ログ、性能予算 | DONE v0.10.5（日付索引に加え社員ID索引、予定期間限定取得、会社カレンダー/社員/案件/設定キャッシュ、月次・年休・申請の対象社員限定読込まで拡張） |
| Q-012 | App.html 1,600行超の巨大フロント | High | Aster / Iris | UIモジュール分割、責務境界、回帰テスト | DONE v0.10.1（5モジュールへ責務分割、旧App.htmlはスタブ化、CIは連結構文/既存UI契約を検証） |
| Q-013 | 列番号依存・Migration不足 | High | Atlas | スキーマ版、ヘッダ検証、Migrationを自動化 | DONE v0.9.8 |
| Q-014 | 監査before/after不足 | High | Ledger | 重要更新は変更前後を再現可能 | DONE v0.9.7 |
| Q-015 | 予定の公開範囲が実質社内固定 | High | Sentinel / Kite | ALL / PARTICIPANTS / ADMIN等をAPIで強制 | DONE v0.9.3 |
| Q-016 | 7〜10px文字が多い | Medium | Iris | 業務本文/重要状態は原則11〜12px以上。1画面化より可読性優先 | DONE v0.10.2（CSSの11px未満を廃止しCIで再発防止） |
| Q-017 | Nested scroll | Medium | Iris | 内部スクロールは明示的な長一覧に限定 | DONE v0.10.2（1画面固定はホームだけに限定。設定・年間カレンダーはページスクロールへ戻し、内部スクロールは長一覧中心に限定） |
| Q-018 | 実働表示で30秒ごと全画面再描画 | Medium | Iris / Forge | 数値ノードだけ更新し、フォーカス/スクロールを保持 | DONE v0.10.2（data-live-workedノードのみ更新） |
| Q-019 | Visual/a11y/performance回帰試験なし | High | Probe | axe相当、visual snapshot、性能計測をCI化 | IN PROGRESS v0.10.4（既存静的Gateにモーダル閉じるボタンのアクセシブルネーム、Client ContractのHTMLエスケープ検査を追加。実ブラウザaxe/visual snapshotは未実装） |
| Q-020 | セッションクリーンアップが行削除ループ | Medium | Atlas / Forge | 定期GC化または一括処理、ログインパスから重処理を外す | DONE v0.10.2（ログイン時GCを廃止し、日次メンテナンスで連続行をdeleteRows一括削除） |
| Q-024 | 予定表の一部操作がマウス依存 | High | Access / Journey / Forge | 日付・予定詳細へキーボードだけで到達し実行可能 | DONE v0.10.2（日付オープンボタン追加、日表示予定をbutton化、focus-visible強化） |
| Q-025 | モーダルのフォーカス管理不足 | High | Access / Journey / Forge | 初期フォーカス、Tab閉じ込め、Escape、閉じた後のフォーカス復帰 | DONE v0.10.2（共通モーダルfocus trap/restore実装） |

| Q-026 | 1/4日有給の法的区分が未確定 | High | Lex / Kite / Product Owner | 半日単位か時間単位年休かを会社規程・労使協定で確定し、単位時間・年5日義務への算入可否・対象者を実装 | BLOCKED — 会社ルール確認待ち |
| Q-027 | MANAGERに部下の承認通知が届かない | High | Kite / Ledger / Probe | requestApprove権限を持つMANAGER/ADMINへ管理対象の承認待ちを通知 | DONE v0.10.4 |
| Q-028 | 承認者の降格/退職で承認経路が壊れる | High | Ledger / Sentinel | 直属部下を残した降格・無効化を拒否し、承認者循環も拒否 | DONE v0.10.4 |
| Q-029 | 法定休日未指定でもREADYになれる | High | Lex / Orbit | 会社カレンダーの法定休日明示を本番Gateで検査 | DONE v0.10.4 |
| Q-030 | 起動直後の通信集中と画面遷移待ち | High | Iris / Forge / Atlas / Probe | 起動往復削減、未表示画面の自動先読み廃止、SWR、サーバーI/O削減、性能回帰Gate | DONE v0.10.5 |

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

## 総務ワークスペース残課題（2026-10-10検証）

| ID | 内容 | Severity | 受入条件 | 状態 |
| --- | --- | --- | --- | --- |
| Q-SOMU-01 | 総務4シートがFM WORKS DBに未作成 | High | 管理者がアクセス先DBを特定しバックアップ付き migrateDatabaseToCurrent を一度実行。DB_VERSION=13、4シート見出し一致、総務UIの保存可を確認 | BLOCKED — 実DBはv12で4シート未作成（2026-10-10時点）。既存15スキーマシートのヘッダーに不整合は検出されず |
| Q-SOMU-02 | GAS認証付き本番操作検証 | High | 管理者ログインで備品1件登録・編集、貸出・返却、購買差戻し・再申請・承認、書類登録を確認。テスト記録を削除でなく識別して管理 | BLOCKED — この開発環境にはGAS認証付きブラウザー操作がない。CIモックテストは別途実施済み |
| Q-SOMU-03 | 大量台帳時の応答速度 | Medium | 登録件数が増えた際の表示上限・速度を実測し、サーバー全件走査が体感に影響するなら期間/カテゴリ別取得とページ送りを導入 | READY |
