# 2026-11-09 確認画面と Worktree の手間を減らす

## 背景

運用中のアプリで1日動かして測った（軽い進め方 2件、通常の進め方 1件、見本 2件）。

- 確認画面：Guard の確認は、Orchestrator が Harness の説明の文書（README など）を直すたびに出ていた（README だけで12回）。Claude Code 自身の確認は、`settings.local.json` に「次から聞かない」で1回きりのコマンドが 521 件たまり、それでも毎回出ていた（PowerShell の古い許可 43 件、広すぎる許可も混ざっていた）。
- Worktree：見本だけの Task でも、Worker が依存を入れ直していた（約50秒・約670MB）。
- Guard の止めすぎ：Worker が本体の `team/proposals` フォルダを `mkdir -p` したとき、引用符の中の `>`（`sed -n '/<script>/,/<\/script>/p'`）をリダイレクトと読んだとき。

## Boss の言葉

> お礼（俺）の表示する確認画面みたいなところ、なくせるところはなくしたい（中略）一定こうルールというか、セキュリティみたいなところは守りながら
> 1 と 2 は、まとめて進めてよい

## 決めたこと

- **Guard の確認の範囲**：Harness で確認するのは、動きを変える所（`hooks/`・`agents/`・`rules/`・`departments/`・`CLAUDE.md`・`.claude/`・配る設定の `templates/user/`）だけ。`README.md`・`projects.md`・`ROADMAP.md`・`decisions/`・ほかの `templates/` は確認しない。Worker・Reviewer は今までどおり Harness を書けない。
- **Guard の読み方**：書いてよいフォルダそのもの（`mkdir -p …/proposals`）も中に入れる。引用符の中の `>` はリダイレクトと読まない（`> "書く先"` の引用符は今までどおり見る）。テストを3件足した（28件）。
- **Worker の定義**：依存を入れるのはコードを触る Task だけ。見本・調べ物の Task は入れず、コミットもしない。
- **プロジェクトの許可**（運用中のアプリの `.claude/settings.json`）：ファイルの書きかえは確認なし（`defaultMode: acceptEdits`）。読むだけのコマンド（grep・cat・sed -n など）、テスト（jest・vitest・node --test）、git（push・merge・-C を含む）、片付けの手順をまとめて許可。`settings.local.json` は Web を読む3件だけに片付けた。

## 変えなかった守り

Guard は Claude Code の許可より先に判定する。秘密の値・禁止のこと（強制 push・一括削除など）・守りの設定の確認・外へ出る操作の Approval Gate・Review と検査の記録がない Merge の拒否は、許可を広げても今までどおり止まる。curl・wget・eas は確認のまま。

## まだ確かめていないこと

- 許可の設定は新しい会話から効く。次の会話で、Boss が見る確認画面の数を数える。
