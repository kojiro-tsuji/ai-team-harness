# 2026-11-09 基本は全部許可し、Boss に聞くのは本当に危ないものだけにする

## 背景

- 運用中のアプリを1日動かしたとき、Boss が「確認画面が多い」と感じた。多くは Claude Code 自身の確認画面だった。
- 原因：許可をプロジェクトの設定（Project scope）に書いていたため、そのフォルダで開いた会話にしか効かず、Harness のフォルダやプロジェクトの外では確認画面が出つづけた。
- Boss は確認画面にほぼすべて Yes と答えており、聞く意味が薄かった。
- 三原則（[2026-11-09-three-principles.md](2026-11-09-three-principles.md)）の1つ目「Boss の関与を少なく、まとめて」に反していた。

## Boss の言葉（要約）

> Harness のフォルダも含め、コマンドは基本的に許可し、本当に危ないものだけ確認を出す形にしたい。確認画面には基本的に全部 Yes と答えているので、聞く意味があまりない。
> 確認を出すときは、用件に要るコマンドをまとめて、「これを許可していいですか」と1回で聞いてほしい。
> User scope は GitHub に上げないので、Harness の方を更新して push してほしい。README では、どこまでが Claude Code の機能で、どこからが Harness の自作かと、User scope と Harness を分けている理由を分かるようにしてほしい。

## 決めたこと

1. **許可は User scope に書く**：`~/.claude/settings.json` に `allow`（Bash・Read・Edit・Write・NotebookEdit・WebFetch・WebSearch・よく使う MCP）と `defaultMode: acceptEdits` を書く。この PC のどのフォルダで開いた会話にも効く。Harness の `.claude/settings.json` の許可の一覧は不要になったので外した。
2. **禁止は今の4つのまま**：秘密・強制 push・一括削除・PowerShell。
3. **確認を出すのは 7 つ**（13 から絞った）：お金／本番への反映・本番データ／公開・ストア申請／SNS／アカウント作成・鍵の発行／外への送信／守りの要（Guard・User scope の設定）の変更。
4. **確認をやめたもの**：決まりの文書・プロジェクトの設定の変更、パッケージの追加、開発用サーバーへの反映、外部サービスとの連携（EAS のビルド・PR など）、Harness の push、手元のサーバー（localhost）への送信。作業の終わりにチャットでまとめて報告する。
5. **守りの要だけは確認を残す**：AI が Guard や設定を書きかえて、自分の止め役を外せないようにするため。直す頻度が低いので、Boss の関与はほぼ増えない。
6. **まとめて聞く**：Approval Record 1枚に、用件に要るコマンドをすべて書く。最初の確認画面に要約・理由・一覧を出し、Boss が許可したら、同じ記録のコマンドはその日のうちは確認なしで通す。日が変わったとき、一覧を書きかえたとき、記録にないコマンドは、また聞く。
   - 仕組み：PostToolUse のフック（`guard.mjs --post`）が、確認画面のあとで実行されたコマンドの記録を `~/.claude/harness-logs/approved.jsonl` に書く。AI はこのファイルを書けない（Guard が止める）。チャットの返事や記録の文字では通らない。
7. **Boss の言葉は要約してよい**：意味を変えずに、読みやすく整えて残す。原文が要るときだけ原文。
8. **Guard の不具合を直した**：`git merge … 2>&1` の `2>&1` を Merge するものと読み違えていた。

## 三原則への効き方

| 原則 | 効き方 |
|---|---|
| ① 関与 | Claude Code 自身の確認画面がほぼなくなる。Guard の確認は 13 種類 → 7 種類、用件ごとに1回 |
| ② トークン | 確認待ちでの中断・やり直しが減る |
| ③ 時間 | Boss の返事を待つ時間が減る |
| 引きかえ | 決まりの文書やパッケージの追加は、事前に止まらない。事後の報告と Reviewer で見る |

## 変えたファイル

- `hooks/guard.mjs`・`hooks/guard.test.mjs`（テスト 31 件）
- `~/.claude/settings.json`（GitHub の外）・`templates/user/settings.json`・`.claude/settings.json`
- `rules/approval-required.md`・`rules/permissions.md`・`rules/prohibited.md`・`rules/defense.md`・`rules/README.md`
- `CLAUDE.md`・`README.md`・`templates/approval.md`・`templates/request.md`・`templates/task.md`
