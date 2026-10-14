# GitHub v0.25.16 機能検証・統合記録（2026-10-14）

対象: PR #139、元HEAD `2e945f6373b9e3a88b2b47882fdafc55588821c5`、統合前main `f6db2a9cbb8d45afdd229133a972ec42cae5b674`。

受取45ファイルをGitHub blobと照合後、DataAccess.gsの社員regexの構文エラーを再現・修復。共通ACL・案件マスタ1回・社員一覧最小化・8管理タブ・新API応答形・総務分割cache・9列一覧/13列詳細の独立cacheに合わせて既存の回帰契約を更新した。元の社員権限、下書き、0追加通信、キャッシュ失効の検査を削除しない。

最新mainとの文書競合は両方の内容を保持して解決し、v0.25.8公開版196の証拠を保持。統合状態で `node scripts/run_local_checks.mjs --functional` **66 PASS / 0 FAIL / browser12 SKIP**。実行開始2026-10-14T05:22:39.849Z、終了05:22:57.128Z。レポートSHA256 `482c21aa6f22c98d1af8e481233b386b6ed318b4e0001dff2dcae3c024debb41`。レポートの全対象ソースと検証入力のSHA256をローカルの最終内容に照合。

GitHub実装の統合はGAS公開とは別。GASはv0.25.8／公開版196までソース全文一致・公開更新成功を確認。v0.25.16のGAS追加反映、公開後表示、認証後の保存→再表示、全ページ/実機表示、P50/P95は未確認。ブラウザー自動承認レビューが作業環境クレジット不足で停止したため、迂回しない。コード側には管理者向け速度診断を追加したが、診断値を実際に測定したという記録ではない。

GitHub Actions、Codespaces、ランナー、Copilot自動レビュー等を使用しない。既存公開URL・権限・業務DB・確認用データを保持。管理URL・Googleアカウント・認証情報を記録に含めない。

## 実行したチェック

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
- `scripts/test_adaptive_loading.mjs`: PASS
- `scripts/test_work1_large_cache.mjs`: PASS
- `scripts/test_work1_rpc_admin.mjs`: PASS
- `scripts/test_worklog_catalog.mjs`: PASS
- `scripts/test_home_request_snapshot.mjs`: PASS
- `scripts/test_rpc_read_timeout.mjs`: PASS
- `scripts/test_employee_directory_privacy.mjs`: PASS
- `scripts/test_request_secondary_loading.mjs`: PASS
- `scripts/test_startup_metrics.mjs`: PASS
- `scripts/test_shell_payload_budget.mjs`: PASS
- `scripts/test_scoped_date_index.mjs`: PASS
- `scripts/test_schedule_pending_cleanup.mjs`: PASS
- `scripts/test_worklog_catalog_reuse.mjs`: PASS
- `scripts/test_schedule_acl.mjs`: PASS
- `scripts/test_project_cockpit_effort_width.mjs`: PASS
- `scripts/test_pin_presence_search.mjs`: PASS
- `scripts/test_prefetch_priority.mjs`: PASS
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
