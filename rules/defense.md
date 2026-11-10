# Defense in Depth（多層防御）

## 考え方

Windows では Claude Code のサンドボックス（エージェントを閉じこめる仕組み）が動きません。そのため、Bash やプログラムからの書き込み・送信を、仕組みで完全には止められません。Guard はコマンドを文字で読むので、うっかりした操作は防げますが、意図的に回避しようとする操作のすべての抜け道はふさげません。そこで、次の層を重ねます。

1. **Guard**（`hooks/guard.mjs`）：道具を使う直前に判定し、よくある危険な形を止める
2. **Reviewer**：すり抜けたものを見つける（Worktree の外を触っていないか、検査をごまかしていないか、Guard Log）
3. **GitHub への push**：コードと記録をこまめに push し、控えを兼ねます。push する前の作業中の変更は守られません

Branch Protection と Backup は入れません（2026-11-08 Boss の判断。非公開のリポジトリでは無料プランで使えないことがあるため）。強制 push と main の削除は、設定の `deny` と Guard で止めます。

## 層の一覧

| 層 | 内容 | 確実さ |
|---|---|---|
| 決まり（`rules/`・CLAUDE.md・エージェント定義） | エージェントが読んで従う | 多くの場合は守られるが、必ずではない |
| 権限の設定（User scope の `~/.claude/settings.json`） | `allow`（基本は全部許可）・`deny`（秘密・強制 push など） | 必ず効く。ただし Claude Code 自身の道具に対してだけ |
| Guard（`hooks/guard.mjs`） | 役ごとの書き込み先、Deny 区分、Approval Gate、Merge 前の検査の記録の確認、GitHub の main への push 前の区切りの Review の確認 | 必ず動く。落ちたら止める。Bash の書き方をすべては読めない |
| Done Gate（`hooks/done-check.mjs`） | Worker が終わる前に、プロジェクトの検査を流す。通ったコミットを `team/logs/checks.jsonl` に記録する（AI は書けない）。検査はこの1回を正とし、Reviewer と Merge はこの記録で確かめる | 必ず動く。落ちたら終わらせない |
| Reviewer | 作る側から独立して確かめる（工程の区切りにまとめて1回と、危ない所） | すり抜けを見つける |
| GitHub への push | コードと記録の控え | push したものだけ守られる |

**必ず守らせたいことは、決まりの文章ではなく、設定か Guard に入れます。** 文章だけの決まりは、会話が長くなって要約されると落ちることがあります。

## Guard の判定

| 対象 | 判定 |
|---|---|
| PowerShell | DENY（道具も、Bash からの呼び出しも） |
| Deny 区分（[prohibited.md](prohibited.md)） | DENY。`bash -c`・`$( )`・`xargs`・`find -exec`・シェルに流すヒアドキュメントの中も見る。Worktree の片付けの例外だけ ALLOW |
| 秘密のファイル | DENY（`.env`・`.dev.vars`・`~/.ssh`・ログイン情報の読み取り・写し） |
| 役ごとの書き込み先 | 外れたら DENY（下の表）。`cd` で移った先も見る |
| Worktree の中の `team/`（写し） | DENY。記録は本体の `team/` に書く |
| 守りの要（Harness の `hooks/`（テストを除く）、`~/.claude/settings.json`・`~/.claude/hooks/`・`~/.claude.json`、フックを足す・止める設定の書きかえ、`.git/hooks/`） | Orchestrator のファイルの道具は ASK。Bash からは DENY（設定ファイルはどれも Bash から変えない）。ほかの役は DENY |
| ほかの守りの設定（Harness の `rules/`・`agents/`・`departments/`・`CLAUDE.md`・`templates/user/`、プロジェクトの `.claude/`・CLAUDE.md、`~/.claude/` の CLAUDE.md と agents、`.git/config`・`.mcp.json`） | Orchestrator は確認なし（終わりにまとめて報告）。Worker・Reviewer・ほかの役は DENY（2026-11-09） |
| 外部へ出る操作（[approval-required.md](approval-required.md) の 7 つ） | ASK（Approval Gate）。Approval Record の要約・理由・コマンドの一覧を表示する。Boss が1回許可すると、同じ記録のコマンドはその日のうちは通す（PostToolUse の `guard.mjs --post` が記録する）。`pnpm deploy` のように中身が本番操作のスクリプトも対象 |
| 上のどれにも当たらない操作 | 判定なし。User scope で許可しているので確認画面は出ない（確認画面を出すのは Guard だけ。2026-11-09） |
| Merge（Orchestrator の `git merge`） | Worker のブランチの先端のコミットに、Done Gate の検査の記録（`team/logs/checks.jsonl`）がなければ DENY（Review は区切りにまとめるので、Merge では求めない。2026-11-09） |
| GitHub の main への push（Orchestrator の `git push`） | 送る先端のコミットが、区切りの Review（`team/reviews/` の `verdict: 合格` と `commit:`）で合格していなければ DENY。合格のあとで `team/` だけを変えたコミットは通す。ほかの名前のブランチへの控えの push は通す |
| Orchestrator がプロジェクトの外へ `cd` | DENY（Worker の Worktree が別のリポジトリに作られるため）。括弧で囲んだ `( cd … )` は ALLOW |
| MCP（外部サービス） | 人へ送る・公開する・消す・予定・お金・データベースを動かすもの（send・post・publish・share・delete・event・execute など）は ASK。ほかは ALLOW |
| Guard 自身が落ちた・入力が読めない | DENY（設定の `onFailure: "block"` と、Guard の中の両方で） |

**Guard Log**：DENY・ASK にしたものと、Worker・Reviewer・ほかの役のすべての操作を、`team/logs/guard.jsonl` に残します（プロジェクトの外なら `~/.claude/harness-logs/`）。ヒアドキュメントの中身は残さず、書き込み先の行だけを残します（Reviewer が Worker の言い分を先に読まないため）。

## 役ごとの権限

役は、Guard が受け取る `agent_type` で判別します。

| 役 | 書き込み先 | git | Web・外部サービス |
|---|---|---|---|
| Orchestrator（`agent_type` なし） | どこでも（本体の `team/reviews/`・`team/handoffs/`・`team/logs/` を除く。守りの要は ASK） | Deny 区分は禁止。Merge は検査の記録、GitHub の main への push は区切りの Review の合格が必要 | 人へ送る・公開する・消すものは ASK |
| Worker（`worker`） | 自分の Worktree、本体の `team/handoffs/`・`proposals/`・`investigations/` | push・Merge・main への切りかえ・Worktree の操作・設定（`-c`・`config`・`update-ref`）・Worktree の外（`-C`）は禁止 | 使わない |
| Reviewer（`reviewer`） | 本体の `team/reviews/` だけ | 読むだけ（`git show`・`git diff`。本体での checkout は禁止） | 使わない |
| 名前のない役 | 書けない（一時フォルダだけ） | 読むだけ | Web と、読むだけの外部サービスは使える |

Worker・Reviewer・名前のない役は、`node -e` などの1行のプログラムでファイルを書くことも禁止です。

## Guard 自身を直すとき

Guard は、自分が異常終了すると、すべての操作を止めます（安全な側に倒すため）。直している途中で Guard が壊れた状態になると、Orchestrator は何も操作できなくなり、Boss が手で直すしかなくなります（2026-11-08 に一度起きました）。そのため：

- **1回の書きかえで、壊れた状態を作らない**：関数の名前を変えるときは、呼んでいる所も同じ書きかえの中で直すか、古い名前を残したまま新しい名前を足し、あとで古い名前を消します。
- 書きかえるたびに `node --test hooks/*.test.mjs` を流します。

## 秘密

- 設定の `deny` で、`.env`・`.dev.vars`・鍵・`~/.ssh`・Cloudflare や Expo や GitHub のログイン情報を読ませません。
- Guard で、それらの中身の表示・写しと、`env`・`printenv` を止めます。
- Worktree には秘密を写しません。
