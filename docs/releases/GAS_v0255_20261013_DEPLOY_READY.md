# FM WORKS v0.25.5 — 既存GAS公開更新・引き継ぎチェックリスト

**状態: 公開準備完了／GASへの反映は未実施。** この文書やGitHubのmain更新だけではGAS公開版は変わらない。

- 作成日: 2026-10-13
- 対象: `Te-tsu-ya/FM-WORKS` 最新main、配色修復PR #128、版整合PR #129
- 確認時main: `c068df539032ef6af6dfa99a9c0ed4964af9b7fa`（後続の文書だけの統合は差分再確認）
- GAS側の最終公開記録: **公開版192／アプリv0.25.4**。出典: `docs/releases/GAS_v0254_20261013.md`
- 期待するアプリ版: **0.25.5**
- 既存GAS公開URL・所有者・アクセス範囲「自分のみ」・実行者・既存DBを変更しない
- GitHub Actions/Codespacesは使用しない。新規GASデプロイや公開範囲拡大をしない

## 1. 今回GASへ反映する3ファイル

PR #128と#129の差分を、最終公開v192の正本と比較した結果、GAS側の変更は**次の3ファイルだけ**。それ以外のGASファイルとManifestは同一blobで変更不要。

| GASエディター内の名前 | GitHubパス | v0.25.5 Git blob SHA-1 |
| --- | --- | --- |
| Styles.html | `src/Styles.html` | `841140f0611ddda932f897d6841146789db0d38d` |
| Code.gs | `src/Code.gs` | `da34dd3c7c5ef0451860b6bab3988c7cb2cfd6c0` |
| GeneratedDocs.gs | `src/GeneratedDocs.gs` | `20098627b8559f95623e671f5cd7896ee7d6de2e` |

検証に使える未変更ファイル: `src/Index.html`、`src/AppCashFlowLedger.html`、`src/CashFlowLedger.gs`、`src/appsscript.json`。特に経理・資金繰り・勤怠・ログインAPI・権限・Sheetsデータは触らない。

## 2. 認証済みGASエディターで既存プロジェクトを更新

1. 所有者Googleアカウントで、既存「FM WORKS」のApps Scriptプロジェクトを開く。**新しいプロジェクトを作らない。**
2. `デプロイ > デプロイを管理` で、現在の既存Webアプリ公開版が192か、公開ID/URLとアクセス範囲が既存のままかを確認する。違う場合は作業停止し、別チャットによる後続デプロイを調べる。
3. Apps Scriptエディターで `Styles.html`、`Code.gs`、`GeneratedDocs.gs` の3ファイルのみ、GitHubの**その時点の最新main**と完全一致するように更新する。前後にGAS固有の独自修正があれば上書き前に差分を確認する。
4. 保存してエディターを再読み込みする。3ファイルの全文一致と `Code.gs` の `APP.version='0.25.5'` を確認する。
5. `デプロイ > デプロイを管理` から**元の既存デプロイ**を選ぶ。編集（鉛筆）→バージョン欄「新しいバージョン」→デプロイする。**新しいデプロイを作らない。**
6. デプロイID・URLが変わらず、新しい版番号に進み、アクセス範囲「自分のみ」と実行者が維持されていることを確認する。版番号は実際の画面で読み取り、推測で「193」などと記録しない。
7. 同じ公開URLを新しいタブで開き、必要ならハードリロード。ライト・ダーク双方でログイン・サイドバー・トップバー・ホーム・スマホメニューを確認する。サイドバー／トップバーに赤い背景が出ないこと。赤は本当の警告・エラーに限定する。
8. 管理者でログイン後、ホーム・勤怠・工数・プロジェクト・経理→金融機関別入力台帳→年間資金繰りを操作確認する。未保存データや実業務レコードは編集しない。後続の新機能・同時更新・DB移行を今回の配色修正に混ぜない。
9. 結果を `docs/releases/` に追記。**GASソース同期、既存版更新、公開URL表示、ログイン後の操作検証**を独立して「成功/失敗/未実施」と記録する。画面の正常表示を確認するまで「公開完了」「修正完了」と報告しない。

## 3. claspを利用する場合の別経路

GitHub Actionsは厳禁。認証済みローカルPC／Work環境で**本当に** `clasp login` が済んでいる場合だけ利用する。
必ず先に既存Script ID・Deployment ID・rootDir `src` を確認し、`clasp list-deployments` で対象デプロイの存在と現在版を確認する。ローカル`node scripts/generate_docs.mjs`と検証を終えてから`clasp push --force`し、`clasp create-deployment --deploymentId <既存デプロイID> --description "FM WORKS v0.25.5"`で既存版だけを更新する。ソース全件pushはリモート差分を取得・検証し、想定外ファイル変更がない場合に限る。認証情報やIDをGitHubやチャットに貼らない。

Google公式: https://developers.google.com/apps-script/concepts/deployments
clasp: https://github.com/google/clasp

## 4. 今回のブロッカーと引き継ぎ

本チャットのツールはGitHubへ変更・確認可能だが、**認証済みGASエディター操作／Apps Script Projects APIデプロイ操作が利用できない**。コンテナーでは`clasp`もGoogle OAuth認証情報もない。Google DriveコネクターでApps Scriptプロジェクトの直接編集は行えない。

したがって、この文書は「デプロイ実施の証拠」ではない。**公開版192に留まっている扱いを維持**し、認証済みCloud Browserを利用できるChatGPT Workや、所有者のローカルclasp環境で上記9手順を実行する。ログイン後の見た目まで実測してから完了扱いとする。
