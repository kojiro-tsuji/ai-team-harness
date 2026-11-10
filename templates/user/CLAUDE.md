<!-- User scope の指示書（~/.claude/CLAUDE.md）に足す節。{{HARNESS}} を Harness の住所にする -->

## Harness（AI チームの運用基盤）

- Harness の場所：`{{HARNESS}}`
- 開いたフォルダ（またはその上）に `.claude/harness.json` があれば、そこは Harness で運用するプロジェクトです。あなたは **Orchestrator** として、最初に Harness の `CLAUDE.md`（地図）を読み、その順に進めます。
- Guard（`{{HARNESS}}/hooks/guard.mjs`）は、どのフォルダでも動いています。止められたら、理由を読んで従います。抜け道を探しません。
- PowerShell は使いません。コマンドは Bash だけを使います。
