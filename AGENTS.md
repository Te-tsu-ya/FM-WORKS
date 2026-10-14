# FM WORKS — GPT開発者への必須指示

## 最優先の運用方針（2026-10-12・ユーザー明示指示）

**GitHub Actionsなど、GitHubの実行時間・クレジット・課金枠を消費する機能は使わない。プログラムの検証はGPTの作業環境で実行する。** 無料枠の復活・残量・課金の有無に関係なく継続する。

- ActionsのCI・Deploy・手動実行・再実行・workflow_dispatch・自動実行を禁止する。過去の文書にある「CI必須」「Actionsで自動公開」は、この方針に置き換える。
- `.github/workflows/` に有効なYAMLを追加・復元しない。旧設定は `.github/workflows-disabled/` に記録だけを残す。参考にしても実行しない。
- GitHub Codespaces、有料ランナー、Copilot自動レビュー等を新たに利用・有効化しない。課金設定・利用上限・支払設定を変更しない。GitHubはコード・文書・コミット・PRの保管と統合に使う。
- 作業開始時はこのファイル、最新main、`docs/WORK_CONTINUITY_PROTOCOL.md`、要件定義書、技術設計書、品質バックログを読む。別チャットの最新変更とユーザー指示を優先する。
- 作業は専用ブランチ＋PRで統合し、書込み前にmain/headを再確認する。mainへのforce pushは禁止。移行期間のコミットには `[skip ci]` を付け、旧ブランチのActionsも発火させない。
- 検証は `node scripts/run_local_checks.mjs` をGPT環境で実行する。ブラウザー実行環境がない場合の `--functional` は機能検証のみであり、画面検証完了と表現しない。
- 実行したテスト名・対象ソース・成功/失敗/未実行をPRへ記録する。過去のCI成功や推測を今回の検証結果として使わない。未確認のGAS実操作・読み込み秒数を成功扱いにしない。
- GAS公開はActionsを経由しない。認証済みの直接操作またはローカルclaspで既存公開URLを更新する。GitHubへの統合、GASソース更新、公開版更新、DB移行、認証付き実操作を別々に確認する。
- 認証情報をログ・チャット・リポジトリに出さない。GitHub Secretsを取り出すためのActionsを作らない。直接公開の認証が使えない場合は、その制約とGitHub側の完了範囲を明記する。
- 既存の業務データと通常DBの確認用データを保持する。ダミー専用の検証画面は本番へ戻さない。DB移行はバックアップとスキーマ確認の後に行う。
- `src/**`を変更するコミットは同時に`docs/REQUIREMENTS.md`と`docs/TECHNICAL_DESIGN.md`を更新する。

## CTO説明用データ（2026-10-13追加指示）

CTOへの説明は `demo/data/financial.json` の架空データと `node scripts/start_demo.mjs` を使う。通常の経理・資金繰り画面を使い、ダミー専用メニューは本番へ追加しない。原本Excelの明細・顧客・金融機関・実金額・秘密情報をGitHubへ移さない。既存実DBを削除・架空データで上書きしない。説明用の変更はセッションごとのメモリーに保持し、本導入の共有DBはCTOと決定する。範囲・制約は `demo/README.md` を読む。

## 改修の重点

見積・経理・総務・プロジェクト・勤怠を社内業務として使いやすくする。不要な再取得と全件取得、古い非同期応答、保存後の表示更新漏れを優先して直す。認証・閲覧範囲・競合防止・監査を省いて高速化しない。


## GASのGitHub Actions枠ゼロ運用（2026-10-13追加）

- 新規 `scripts/gas_local_bridge.mjs` と `docs/GAS_NO_ACTIONS_BRIDGE.md` に、**所有者PC上の認証済みclasp** とGitHub通常ブランチによるクレジット不要の公開依頼を定義する。GitHub Actions・GitHub-hosted runner・self-hosted Actions workflowを有効にしない。
- ユーザーの「GASへ公開」承認があり、PR統合と対象main SHAを確認した場合のみ、`deploy/gas-production` ブランチを最新main SHAへfast-forward更新する。これは**公開依頼**であり、GAS更新成功を意味しない。
- `deploy/gas-published` はローカルブリッジが既存デプロイのバージョンとソース再取得を確認した場合だけ進む**配信受領SHA**。2つのSHAの一致でGASソース反映が確認できるが、ログイン後ブラウザー操作・DB動作の受入は別途必要。
- 初回Google認証とMac/Windowsの起動・登録は所有者側で一度設定する必要がある。公開先を変えず、Script ID・Google OAuthトークン・社員データをGitHubやチャットへ載せない。PC停止中は待機であり、無制限・無料を保証しない。


## Windows Dellを公開ブリッジに指定（2026-10-13）

- ユーザー指定PCは **Windows Dellノート（第11世代Core i7）**。`docs/GAS_WINDOWS_DELL_SETUP.md` に、初回Google認証・既存Script ID接続・公開前の読み取り照合・Windowsタスクスケジューラへの安全な5分間隔登録を記載する。
- WindowsのNode.jsからnpm `clasp.cmd` を起動する修正と、PowerShell ScheduledTasksでの `--install-windows` / `--status-windows` / `--remove-windows` を用いる。Mac専用の `--install-macos` をWindowsで案内しない。
- 所有者Dellの初回接続・タスク登録・実GAS公開・認証付き操作は未実施。実際に完了するまで「自動公開が動作中」と扱わない。


## 2026-10-14 手動バッチによるGitHub Actions枠ゼロ公開
- Windows所有者が `FM-WORKS-GAS-PUBLISH.bat` で明示的にYを選んだときは、`deploy/gas-production` を別途進めず、**最新mainのピン留めしたSHA**を公開対象にできる。既存の自動ブリッジの承認用branch運用とは別モードであり、明示的なユーザー承認・ローカルテスト・公開前のGAS差分照合は省略しない。
- 初回設定は `FM-WORKS-GAS-SETUP.bat` から、Work1が実公開したGitHub SHAと現行GASの**不変公開版**・編集ソース双方の照合後だけローカル状態を採用。既存GAS URLを変更せず、DB・権限・GitHub Actionsには触れない。
- 手動公開の状態は `artifacts/gas-local-bridge` と `deploy/gas-published` の配信受領SHAへ記録する。配信成功はログイン後業務の受入成功と区別する。
