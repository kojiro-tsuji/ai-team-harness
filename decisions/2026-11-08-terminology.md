# ADR：用語をエンジニアリングの言葉にそろえる

- 日付：2026-11-08
- 決めた人：Boss
- 記録した人：Orchestrator

## 決めたこと

Harness 全体（README・決まり・エージェント定義・Guard・記録のファイル名）の用語を、実際のソフトウェア開発で使われる言葉にそろえます。文章は、です・ます調の改まった書き方にします。

| 以前 | 現在 | 由来 |
|---|---|---|
| オーナー | **Boss** | 最終決定者（Boss の希望） |
| 参謀長 | **Orchestrator** | Anthropic の「orchestrator-workers」パターン |
| 副参謀長 | **Sub-Orchestrator** | |
| 作業者（`dev-worker`） | **Worker**（`worker`） | 同パターン |
| 監査（`dev-auditor`） | **Reviewer**（`reviewer`） | コードレビュー。maker と checker の分離 |
| 見張り | **Guard** | フック `hooks/guard.mjs` |
| 依頼 | **Request** | |
| タスク | **Task** | |
| 作業の前の点検 | **Spec Review** | |
| 作る | **Implement** | |
| 確かめる | **Review** | |
| 取り込む | **Merge** | |
| 報告 | **Briefing** | |
| 今の状況（`NOW.md`） | **Status**（`STATUS.md`） | |
| 作業報告（`reports/`） | **Handoff**（`handoffs/`） | |
| 監査結果（`audits/`） | **Review**（`reviews/`） | |
| 決定ログ | **ADR**（`decisions.md`） | Architecture Decision Record |
| オーナーの手間の表（`metrics.md`） | **Boss Load**（`boss-load.md`） | |
| 実機で見る一覧（`device-checks.md`） | **Device QA**（`device-qa.md`） | |
| 承認票 | **Approval Record** | |
| 見張りの記録 | **Guard Log** | |
| 画面の確認（関所） | **Approval Gate** | |
| 終わるときの検査 | **Done Gate** | Definition of Done |
| 2段がまえ＋外側 | **Defense in Depth** | 多層防御 |
| 止める・確認・通す | **DENY / ASK / ALLOW** | Claude Code の権限の言葉 |
| 自由・事後報告・事前承認・禁止 | **Allow / Report / Approve / Deny** | |
| 共通の入り口・ハーネス本体・プロジェクト | **User scope / Harness / Project scope** | Claude Code の設定の言葉 |
| 作業場所 | **Worktree** | git の言葉 |
| 外側の守り | **Branch Protection・Backup** | |

## 理由

- Boss は、Harness に愛着が持てる、エンジニアリングに合った名前を望んだ。世界観の言葉（以前の「王・将」、検討した「部隊」）ではなく、開発者がそのまま意味を取れる言葉にした。
- 外部に公開する前提なので、初めて読む開発者にも通じる言葉がよい。

## 影響する範囲

- エージェントの名前が `worker`・`reviewer` に変わった（User scope の `~/.claude/agents/` を入れかえる）。
- 運用中のアプリの `team/` のファイル名を変えた（`STATUS.md`・`handoffs/`・`reviews/`・`boss-load.md`・`device-qa.md`）。
- 2026-11-08 以前の記録（R-001〜R-003、T-001〜T-005、B-001〜B-002 など）の本文は、以前の用語のまま残す。
