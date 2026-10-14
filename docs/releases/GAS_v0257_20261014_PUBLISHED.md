# GAS v0.25.7 公開記録（2026-10-14）

## 反映結果

- GitHub実装: PR #136、head `eb8151cd1d1c32ac71489d4b19d55af7d87bbca9`、統合main `b7eaf72dfc5ed1a3fdd949b0db02f307a0314257`。
- GAS: 既存デプロイを直接更新。管理画面で「デプロイを更新しました。」と **バージョン195（2026/10/14 9:23 JST）** を確認。
- 既存公開URL・実行所有者・アクセス「自分のみ」を維持。新しい公開先や権限は作成しない。
- 83ファイルの一覧を確認。今回変更10件を直前のv0.25.6と照合して保存し、エディター再読込み後に10件すべてをGitHub統合コードと全文一致確認。
- 保存対象: AppCore.html / AppPeopleMonthly.html / AppShell.html / Auth.gs / Code.gs / DataAccess.gs / GeneratedDocs.gs / Monthly.gs / Requests.gs / Worklog.gs。
- 実DBの初期化・移行・試験レコード書込みは実施しない。管理URL・アカウント・Script ID・デプロイID・管理画像はこの記録へ含めない。

## 機能検証

`node scripts/run_local_checks.mjs --functional`: **49 PASS / 0 FAIL / 12 SKIP**。開始2026-10-14T00:14:46.625Z、終了00:14:58.761Z。ローカルレポートSHA256 `60d2d445c68bedb7fd05e799b6f52814cc9110cd7da8b3973130bd7b3f6d1512`。対象ソースと検証入力のハッシュを実行結果と照合し、GitHub変更16件のblob一致と無変更174件を確認後に統合。

合成2,000行の3列fixtureから対象2行（6セル）の本文だけを取得。空スコープが全社員取得にならず、索引後の社員変更と長期間fallbackも条件で絞る。資金繰り再訪は年次・銀行取得のみ。年末日付更新、前日の未保存工数保持、短時間復帰の通信0回、長時間復帰の1回集約、ログイン接続再試行、PRODUCTIONの試作認証禁止を検証。

Chromium実行ファイルがないため12画面試験はSKIP。機能検証の合格は実GASの全画面・認証付き保存・速度実測の合格を意味しない。GitHub Actions、Codespaces、ランナー、Copilot自動レビュー等は使用しない。

## 各チェック

- `scripts/check_docs_sync.mjs`: PASS
- `scripts/generate_docs.mjs`: PASS
- `scripts/validate.mjs`: PASS
- `scripts/test_repository_policy.mjs`: PASS
- `scripts/test_deploy_gate.mjs`: PASS
- `scripts/test_initial_payload.mjs`: PASS
- `scripts/test_data_access_performance.mjs`: PASS
- `scripts/test_worklog_link_index.mjs`: PASS
- `scripts/test_punch_history_index.mjs`: PASS
- `scripts/test_workspace_loading.mjs`: PASS
- `scripts/test_logic.mjs`: PASS
- `scripts/test_client_contract.mjs`: PASS
- `scripts/test_global_search.mjs`: PASS
- `scripts/test_search_schedule_index.mjs`: PASS
- `scripts/test_finance_integration.mjs`: PASS
- `scripts/test_cashflow.mjs`: PASS
- `scripts/test_cashflow_client.mjs`: PASS
- `scripts/test_cashflow_grid.mjs`: PASS
- `scripts/test_cashflow_bank.mjs`: PASS
- `scripts/test_cashflow_analysis.mjs`: PASS
- `scripts/test_cashflow_analysis_client.mjs`: PASS
- `scripts/test_cashflow_report_session.mjs`: PASS
- `scripts/test_cashflow_bank_client.mjs`: PASS
- `scripts/test_cashflow_bank_grid.mjs`: PASS
- `scripts/test_cashflow_sandbox.mjs`: PASS
- `scripts/test_finance_workspace.mjs`: PASS
- `scripts/test_finance_grid.mjs`: PASS
- `scripts/test_quote_integration.mjs`: PASS
- `scripts/test_rotary_integration.mjs`: PASS
- `scripts/test_company_documents.mjs`: PASS
- `scripts/test_company_documents_client.mjs`: PASS
- `scripts/test_somu_integration.mjs`: PASS
- `scripts/test_somu_growth.mjs`: PASS
- `scripts/test_somu_client.mjs`: PASS
- `scripts/test_project_hub.mjs`: PASS
- `scripts/test_schema_migration.mjs`: PASS
- `scripts/test_project_advanced.mjs`: PASS
- `scripts/test_business_workflows.mjs`: PASS
- `scripts/test_worklog_integrity.mjs`: PASS
- `scripts/test_operational_refresh.mjs`: PASS
- `scripts/test_local_docs_sync.mjs`: PASS
- `scripts/test_finance_quote_refresh.mjs`: PASS
- `scripts/test_theme_contrast.mjs`: PASS
- `scripts/test_app_version_contract.mjs`: PASS
- `scripts/test_gas_local_bridge.mjs`: PASS
- `scripts/test_live_workspaces.mjs`: PASS
- `scripts/test_repository_demo.mjs`: PASS
- `scripts/test_cashflow_ledger_client.mjs`: PASS
- `scripts/test_operational_performance.mjs`: PASS
- `scripts/test_cashflow_grid_viewport.mjs`: SKIPPED
- `scripts/test_cashflow_analysis_viewport.mjs`: SKIPPED
- `scripts/test_finance_workspaces_viewport.mjs`: SKIPPED
- `scripts/test_project_hub_viewport.mjs`: SKIPPED
- `scripts/test_rotary_viewport.mjs`: SKIPPED
- `scripts/test_company_documents_viewport.mjs`: SKIPPED
- `scripts/test_somu_viewport.mjs`: SKIPPED
- `scripts/test_modal_theme.mjs`: SKIPPED
- `scripts/test_quote_viewport.mjs`: SKIPPED
- `scripts/test_workflow_viewport_v15.mjs`: SKIPPED
- `scripts/test_home_viewport.mjs`: SKIPPED
- `scripts/test_office_viewport.mjs`: SKIPPED

## 公開URLの読込み確認と限界

既存公開URLを再読み込みし、試作版ログイン、通常のログインボタン、アプリ版 **v0.25.7** を確認。公開HTMLのDOM上のscriptにloadPageData_、refreshOnResume_、接続再試行が含まれることを確認。ログイン画面は従来の淡青色・白背景を保持する。

業務PINの安全な認証フォームは前回locator_invalidで完了せず、認証後の主要操作・全ページの表示・実データ保存・P50/P95は未確認。認証を推測入力・迂回しない。公開版反映を実運用受入完了とは扱わない。本番認証・社内アクセス範囲・会社固有ルール・バックアップ復元等の課題は品質バックログに継続する。
