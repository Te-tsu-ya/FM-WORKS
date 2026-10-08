# FM WORKS 作業継続・接続断プロトコル

**適用対象:** FM WORKS AI開発部門 全AI社員
**施行日:** 2026-10-07
**優先度:** Mandatory

## 1. 目的

ChatGPT UI・通信・ツール接続・長時間応答が途中で切断されても、作業状態を失わず、再接続後に最短で安全に継続する。

「接続断が発生したため最初からやり直す」「途中状態を推測して再開する」「未検証の変更を本番へ出す」を禁止する。

## 2. 基本原則

1. 重要変更は小さな原子的commitに分割する。
2. DB変更はスキーマ変更 → コード変更 → テスト → Deployの順で追跡可能にする。
3. 各commit SHAを作業checkpointとする。
4. CI実行中に接続が切れた場合、再接続後は既存runを先に確認する。
5. Deploy前にbranch/head/CI結果を再確認する。
6. 未完了作業は docs/QUALITY_BACKLOG.md の状態へ反映する。

## 3. 再接続後の復旧順序

### Step 1 — Repository
- 対象branchのHEAD SHAを確認する。
- mainとの差分、Draft PR、最後の成功commitを確認する。

### Step 2 — CI
- 最新workflow runを確認する。
- runningなら状態を引き継ぐ。
- failedなら失敗step/logを確認する。
- cancelledなら原因を確認してから必要な場合だけ再実行する。

### Step 3 — Database
- DB変更を伴う場合、対象Sheet、Header、Column count、DB_VERSION、Migration状態を確認する。

### Step 4 — Backlog
- docs/QUALITY_BACKLOG.md と最新commitを照合し、DONE / IN PROGRESS / READY / BLOCKEDを確定する。

### Step 5 — Resume
- 最後に確認できた安全なcheckpointから作業を再開する。
- 推測で「ここまで終わった」と判断しない。

## 4. AI社員別責任

- Nova: 中断点と次アクションを明確化。
- Aster: branch/DB/Deploy不整合状態での再開を禁止。
- Forge / Pixel / Atlas: 実装を小さなcommitへ分割。
- Probe: 再接続後に最新commitのテスト結果を確認。
- Orbit: CI/Deploy/Backupの状態確認。
- Sentinel / Ledger / Lex: 中断でSecurity/Control/Labor要件が抜けていないか確認。
- Vega: 一部だけ反映された状態を異常系として扱う。
- Mira / Kite / Iris / Pulse: 要件・UX・KPIと実装の乖離を確認。

## 5. 禁止事項

- 未確認のままmainへmergeする。
- DB変更済みか不明なまま同じmigrationを重複実行する。
- CI結果を見ずに成功済みと報告する。
- 未commit変更が残っている前提で再開する。
- バックグラウンドで必ず継続すると事実と異なる説明をする。

## 6. 技術的制約

実行セッション自体が完全に終了した場合、AIが無制限にバックグラウンド実行を継続することは保証できない。

そのためFM WORKSでは「止まらない」を、作業を失わない・重複させない・再接続後に最後の安全なcheckpointを確認して継続できること、と定義する。