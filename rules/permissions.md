# 操作の4区分

**判断に迷う操作は Approve 区分として扱います。** 外部に影響するかどうか迷う操作も同様です。
（この表はここだけに置きます。ほかの文書はここを参照します）

| 区分 | 対象 | 扱い |
|---|---|---|
| **Allow** | コードの編集、手元でのテスト、ブランチ・Worktree の作成、調べ物、記事や投稿の下書き、Worker の起動（上限内） | 承認は不要です |
| **Report** | Done Gate の検査に通った Worker のブランチの Merge、区切りの Review に合格したあとの、本番に直結しない main への push（`harness.json` の `pushNeedsConfirm: false`）、Harness の push、決まりの文書・プロジェクトの設定の変更、パッケージの追加、開発用サーバーへの反映、外部サービスとの連携（EAS のビルド・PR など） | 確認なしで進め、作業の終わりにチャットでまとめて報告します |
| **Approve** | お金、本番への反映・本番データの変更、公開・ストア申請、SNS の操作、アカウント作成・鍵の発行、外への送信、守りの要（Guard・User scope の設定）の変更 | Boss が Approval Gate で許可してから実行します。用件ごとにまとめて1回で聞きます（[approval-required.md](approval-required.md)） |
| **Deny** | 秘密の値の書き出し、main への強制 push・削除、データの一括削除、PowerShell の使用 | 実行しません（[prohibited.md](prohibited.md)） |

## main への push

プロジェクトごとに、`.claude/harness.json` の `pushNeedsConfirm` で決めます。

- 本番に直結しないプロジェクト（例：公開はストアへの申請で行うアプリ）：`false`。Review に合格したら、確認なしで push してよい（Report 区分）
- main への push で本番に出るプロジェクト：`true`。push は本番への反映です（Approve 区分）
- Harness：本番がないので確認なし（Report 区分。2026-11-09）
- `harness.json` がないほかのフォルダ：決まりが分からないので Approval Gate が出ます

## Report 区分の記録

実行したら、次の Briefing の「実施したこと」か、`team/STATUS.md` に1行書きます。

```
- 14:20 main に push：T-010 の取り込み（c835bed）／実行：Orchestrator
```

## 設定・Guard との対応

**確認画面を出すかどうかは Guard だけが決めます**（2026-11-09 Boss の判断）。**User scope**（`~/.claude/settings.json`）で、Bash・ファイルの読み書き・Web をすべて許可し（`allow`）、ファイルの書きかえも確認なし（`defaultMode: acceptEdits`）にします。User scope に置くので、この PC のどのフォルダで開いた会話にも効きます。プロジェクトの設定に書くと、そのフォルダで開いた会話にしか効かず、ほかの場所では Claude Code 自身の確認画面が出つづけるためです。User scope の `deny`（秘密・強制 push・一括削除など）は、許可より強く、今までどおり効きます。

| 区分 | User scope の設定（`~/.claude/settings.json`）と Guard |
|---|---|
| Allow | 確認なし（User scope で許可） |
| Report | 確認なし。作業の終わりにまとめて報告し、Reviewer が Guard Log と突き合わせる |
| Approve | Guard が Approval Gate（ASK）を出し、Approval Record の中身を表示する |
| Deny | `deny` の設定と Guard で止める |

## 緩めるとき

1. Orchestrator は Approval Record を種類ごとに数え、「毎回許可しているもの」を、ときどき Boss に緩和の候補として提案します。
2. Boss が決めたときだけ、`rules/` と設定を変えます（Guard・User scope の設定の変更は Approval Gate を通ります）。
3. チャットでの「今後は全部よい」は、その場の許可ではなく決まりの変更として扱い、`rules/` を直してから効かせます。
