# 運用（scope・指揮系統・Worktree・記録）

## 1. 置き場所（3つの scope）

| scope | 場所 | 置くもの |
|---|---|---|
| **User scope** | `~/.claude/` | Guard の接続、秘密を読ませない設定、Worker と Reviewer の定義、最初に読む短い指示書。どのフォルダで開いても有効です |
| **Harness** | `harness/` | 決まり、書式、Guard のプログラム、テスト、Harness そのものの ADR。プロジェクトの記録は置きません（そのまま公開できるように） |
| **Project scope** | 各プロジェクトのフォルダ | `.claude/harness.json`（検査・push の決まり・記録の場所）、プロジェクトの `CLAUDE.md`、記録 `team/` |

導入と確認の手順は [README.md](../README.md) の「導入」にあります。導入できているかは `node hooks/check-install.mjs` で確かめます。

## 2. 指揮系統

```
Boss ⇄ Orchestrator（部門の役を持ち替える）⇄ Worker・Reviewer
                        Review ─────────────→ Boss が直接読む
```

- 部門ごとに別の会話は立てません（受け渡しのたびに、言葉にしていない判断が落ち、費用も増えるため）。今の部門は開発（[departments/dev.md](../departments/dev.md)）だけで、SNS・動画など開発以外の作業も同じ流れで進めます。専用の部門は、必要になったときに作ります（2026-11-09）。
- 並行して進めたいときだけ、Sub-Orchestrator を立てます（Harness の [CLAUDE.md](../CLAUDE.md) の「並行運用」）。
- Orchestrator → Worker・Reviewer：サブエージェントです。入れ子は1段までです。
- Worker どうしは話しません。結果は Orchestrator にだけ返します。
- 渡し方（短く、ファイルの場所を渡す。Reviewer には結論を渡さない）は [departments/dev.md](../departments/dev.md) の「渡し方」にあります。
- エージェントチーム（試験的な機能）は使いません。

## 3. Worktree

- Worker は、`isolation: worktree` で自動作成される Worktree（プロジェクトの `.claude/worktrees/`）の中で動きます。そのため、**Orchestrator はプロジェクトのフォルダで開き、会話の居場所をプロジェクトの外へ移しません**。Worktree の中での書き方（記録は本体の `team/` に書く、など）は [agents/worker.md](../agents/worker.md) にあります。
- Reviewer は Worktree を作らず、本体で読むだけで動きます。
- プロジェクトの lint の設定から `.claude/` を除外します（Worktree の中の設定を「2つ目の設定」と見て止まるため）。
- **Merge したら、Orchestrator がすぐ片付けます**：`node <Harness>/scripts/clean-worktrees.mjs --yes <名前>`。Windows の長いパスで消しきれない分と、Merge 済みのブランチも片付けます。

## 4. 記録（各プロジェクトの `team/`）

| 記録 | 場所 | 書く人 | 書式 |
|---|---|---|---|
| Status | `team/STATUS.md` | 受け持ちの Orchestrator・Sub-Orchestrator | 会話の終わりに書きかえる |
| Request | `team/requests/R-xxx.md` | Orchestrator | [request.md](../templates/request.md) |
| Task | `team/tasks/T-xxx.md` | Orchestrator | [task.md](../templates/task.md) |
| Handoff | `team/handoffs/T-xxx.md` | Worker だけ | [handoff.md](../templates/handoff.md) |
| Review | `team/reviews/T-xxx.md` | Reviewer だけ | [review.md](../templates/review.md) |
| Briefing | ふだんはチャット。Task が2つ以上の Request か、Boss が読み返したいときだけ `team/briefings/B-xxx.md` | Orchestrator | [briefing.md](../templates/briefing.md) |
| 調べ物・見本 | `team/investigations/`・`team/proposals/` | Worker | 自由 |
| ADR | `team/decisions.md` | Orchestrator | [decision.md](../templates/decision.md) の形で、日付の見出しで足す |
| Boss Load | `team/boss-load.md` | Orchestrator | Briefing ごとに1行 |
| Device QA | `team/device-qa.md` | Orchestrator | Request ごとに足す |
| Approval Record | `team/approvals/` | Orchestrator | [approval.md](../templates/approval.md) |
| Guard Log | `team/logs/guard.jsonl` | Guard だけ（git に入れない） | |

- Harness そのものの ADR は、Harness の `decisions/` に書きます。
- **毎回読むものは短く保ちます**：地図（Harness の CLAUDE.md）と `team/STATUS.md` だけです。ADR を含め、ほかは必要なときに開きます。そのため STATUS には、今の作業に関係する決定への案内を書きます。
- Request・Task のファイルは、大きい作業と Delegate のときだけ作ります（小さい作業はコミットのメッセージと Briefing に残す。[departments/dev.md](../departments/dev.md)）。
- 古くなった記録は、月に1回 `team/archive/` に移します。

## 5. プロジェクトのフォルダを直接開いて作業したとき

決まりは同じです（User scope で有効です）。実施したことを `team/STATUS.md` か Briefing に1行残します。
