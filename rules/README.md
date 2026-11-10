# rules/：Harness 全体の決まり

Harness とすべてのプロジェクトで有効な決まりです。Orchestrator・Worker・Reviewer のすべてが従います。必要なときに、関係するものだけを開きます。

| ファイル | 内容 |
|---|---|
| [permissions.md](permissions.md) | 操作の4区分（Allow・Report・Approve・Deny） |
| [approval-required.md](approval-required.md) | Approve 区分の操作の一覧と、Approval Record の書き方 |
| [prohibited.md](prohibited.md) | Deny 区分（禁止）の操作 |
| [defense.md](defense.md) | Defense in Depth（Guard・Done Gate・Reviewer・GitHub への push） |
| [limits.md](limits.md) | 上限（並行数・止まる条件・予算） |
| [operations.md](operations.md) | 置き場所（scope）、指揮系統、Worktree、記録 |
## このフォルダを変えるとき

- `rules/` は Orchestrator が確認なしで直せます。直したら、作業の終わりに差分をまとめて Boss に報告します（2026-11-09）。Worker・Reviewer は変えられません。
- 守りの要（Guard の `hooks/`、User scope の `~/.claude/settings.json` など）の変更だけは **Approve 区分**です。Approval Gate が出るので、Boss が中身を見て許可します。Bash からは変えられません（Guard が止めます）。
