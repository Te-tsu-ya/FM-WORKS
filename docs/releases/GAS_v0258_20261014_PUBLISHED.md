# GAS v0.25.8 公開記録（2026-10-14）

## 反映結果

- 実装PR #138、head `a74574ff68015afc905436cfdabb34f04a0eaf35`、統合main `600b99213a3de50234f09de673337d8a7cfe86ea`。
- 既存GASを直接更新し、「デプロイを更新しました。」と **バージョン196（2026/10/14 9:51 JST）** を確認。
- 公開URL・実行所有者・アクセス「自分のみ」を維持。DB初期化・移行・確認用データ書込みなし。
- 83件のファイル一覧を確認。今回変更9件は直前のv0.25.7と照合して保存し、エディター再読込後に統合ソースと全文一致を確認。
- 保存対象: AppCashFlow.html / AppCashFlowAnalysis.html / AppCashFlowBank.html / AppCashFlowLedger.html / AppCore.html / AppShell.html / Code.gs / DataAccess.gs / GeneratedDocs.gs。
- 管理URL・Script ID・デプロイID・Googleアカウント・管理画像を記録へ含めない。

## 検証

`node scripts/run_local_checks.mjs --functional`: **50 PASS / 0 FAIL / browser12 SKIP**。開始2026-10-14T00:42:41.420Z、終了00:42:53.381Z。レポートSHA256 `58751c0751085beffee2bd552e0b43a28da0d5464e2d770b2c3b069fd6345adf`。対象ソースと検証入力のSHA256、GitHub変更18件のblob一致・その他174件不変を確認して統合。

- 合成200行: 値取得1回、索引0回。空社員集合は読取0回。
- 合成2,000行・対象60分断: 本文取得8回、日付／社員フィルタ後60件。8窓の条件で読取セル最小、保存先の物理行番号を維持。
- 通常の重複分析取得は1回。取得済みの概要／選択明細はメモリーを再利用。
- 初回失敗画面を繰り返し描画しても再通信0回。明示的再試行で復帰。
- 5分TTL、銀行更新後の分析無効化、保存前の旧応答の遮断。
- 読取失敗で保存ロックを解除せず、保存中の年度変更／終了を抑止。補助フォームの破棄には確認。

8窓は本文取得回数の上限であり、認証・索引等を含むAPI全体のサービス呼出し数ではない。これらは合成の構造検証であり、実GASの応答秒数・P50/P95ではない。

Chromiumがないためブラウザー12本はSKIP。業務PIN認証は前回の安全な入力フォームがlocator_invalidで未完了。認証を推測・迂回せず、認証後実保存・全画面・実測は継続課題。会社固有ルール・社内共有範囲・本番認証・バックアップ復元も品質バックログを維持。

GitHub Actions、Codespaces、ランナー、Copilot自動レビュー等を使用しない。

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
- `scripts/test_adaptive_loading.mjs`: PASS
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

## 公開画面確認の停止点

公開版196の更新成功後、既存公開URLの再読込みを実行し、ログイン画面の準備中まで観測。続くv0.25.8の表示・改修scriptの確認・スクリーンショット保存は、ブラウザーの自動承認レビューが「作業環境のクレジット不足」で実行できず、操作前に拒否された。ユーザーの拒否でもGitHub Actions枠でもなく、ブラウザー確認の制約。迂回・再試行は行わない。

したがって、GASソース全文一致と公開更新成功は確認済みだが、公開URLでのv0.25.8表示・ログイン後操作・全画面・P50/P95は未確認。クレジット制約の解消後にこの停止点から確認する。旧v0.25.7の画面を今回の表示証拠に流用しない。
