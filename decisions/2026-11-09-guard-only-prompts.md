# 2026-11-09 確認画面を出すのは Guard だけにする

## 背景

`2026-11-09-fewer-prompts.md` で、Claude Code の許可の一覧に読むだけのコマンドや git などを足した。次の会話（T-010 を作った会話）で調べると：

- Guard の「聞く」は 0 回だった。確認画面はすべて Claude Code の許可の一覧から出ていた。
- 一覧はコマンドの頭の形で合わせるので、`cd … &&` で始まるもの、`sed -i`・`cat >>`・`taskkill`・`netstat`・`node -e` を含むものが毎回聞かれた。`&&` でつなぐと、つないだ全部が一覧に合わないと聞かれる。Worker・Reviewer も同じ。
- 「危ない操作か」ではなく「一覧にある形か」で聞いていたので、一覧に足しつづけても減りきらない。

## Boss の言葉

> 基本的にはなんだろうな、本当にコアになるようなところの俺の許可を取って、他は君の方で進めてほしい
> OK、じゃあ A の通りで、直そうか。

## 決めたこと

- **確認画面を出すかどうかは Guard だけが決める。** Harness で動くプロジェクトの `.claude/settings.json` は `"allow": ["Bash"]`（Bash をすべて許可）と `defaultMode: acceptEdits`。運用中のアプリから始めた。
- **Boss に聞く「コア」**（Guard の ASK）：
  1. 守りの設定を変える（Harness の決まり・権限・CLAUDE.md・`.claude/`）。今までどおり
  2. 外へ出る操作：本番・ストア・外のサービスへ書く（今までどおり）に加え、**開発用サーバーへの反映**（`wrangler deploy --env dev`・`--remote --env dev`）と **EAS**（見るだけの `whoami`・`build:list` などを除く）
  3. **パッケージの追加**（`pnpm add`・`npm install <名前>`・`npx expo install <名前>`。`pnpm install` の入れ直しは対象外）
  4. 禁止のもの（そもそも実行しない。User scope の `deny` と Guard）
- 聞かないもの：ファイルの読み書き、テストと検査、git のコミット・Merge・push（`pushNeedsConfirm: false` のとき）、Worktree の片付け、開発サーバー（Metro）の立ち上げと止め直し、`curl` で読むだけのもの。
- `rules/permissions.md`（区分の表と「設定・Guard との対応」）、`rules/approval-required.md`（12・13 番）、`rules/defense.md`（Guard の判定の表）を合わせた。Guard のテストを足した（29件）。

## 変えなかった守り

User scope の `deny`（秘密・強制 push・`rm -rf`・`git reset --hard` など）は許可より強く、今までどおり効く。Guard の DENY（役ごとの書き込み先・Worktree の中の `team/`・Review のない Merge・プロジェクトの外への `cd`）も今までどおり。

## 気をつけること

Guard が知らない危ない操作は、確認なしで通る。見つけたら Guard に判定とテストを足す（一覧に足すのではなく）。

## 追加（同じ日）：作業場所の外への書き込みの確認

Bash をすべて許可にしたあとも、Boss から「確認画面がめちゃくちゃ多い」。Guard の「聞く」は 0 回だったので、Claude Code 自身の確認。考えられる原因（推測）：Worker が自分の Worktree の外（本体の `team/handoffs/`・`proposals/`）へ書く、Orchestrator がメモ（`~/.claude/projects/…/memory/`）へ書く。どちらも Claude Code から見ると「作業場所の外」。

- 運用中のアプリの `.claude/settings.json` に `additionalDirectories`（本体のフォルダ全体・メモのフォルダ）と、その2か所の `Edit(…)` の許可を足した。
- どこへ書けるかは今までどおり Guard が役ごとに決める（Worker は本体の `team/handoffs/`・`proposals/`・`investigations/` だけ）。守りは弱くならない。
- まだ確認画面が出たら、出た道具とファイルの場所を記録して足す（一覧に足しつづけるのではなく、原因の種類ごとに直す）。

## 確かめたこと

- 許可の設定は、書きかえた会話の中ですぐ効いた（前の一覧になかった `netstat` で確認画面が出なかった。Boss が確認）。`2026-11-09-fewer-prompts.md` の「新しい会話から効く」は確かめずに書いたもので、誤り。
