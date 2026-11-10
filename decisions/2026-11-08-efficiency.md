# 2026-11-08 効率に寄せる（検査は1回・Reviewer は Worktree なし・Spec Review は大きい Task だけ）

## 背景

運用中のアプリの R-004（Task 1つ）で、依頼から取り込みまで約25分、サブエージェントのトークンが約33万かかった。
同じコミットに検査を4回流し（Worker・Done Gate・Reviewer・取り込みのあと）、Worktree を4つ作り（1つにつき依存の入れ直し約50秒・約670MB）、Spec Review が2周した。
Windows では `git worktree remove` が長いパス（約350文字）を消しきれず、毎回フォルダが残り、`rm -rf` の禁止のため Boss の手作業になっていた。
Guard は、引用符の中の改行や `;` でもコマンドを区切っていたため、複数行の Merge のメッセージや `node -e` の式を読み違えて止めていた。

## Boss の言葉

> 基本的にハーネスの設計として、効率良いっていうところとトークンを使用しすぎない無駄に使用しすぎないようにはしてほしい（中略）効率のところに寄せても良いかなっていう感じですね。大事なところはセキュリティ守りつつっていう感じにしたいです。

## 決めたこと

- **A 検査は Done Gate の1回を正とする**：Done Gate はコミットしていない変更があれば検査の前に止め、通ったコミットを `team/logs/checks.jsonl` に記録する（同じコミットは流し直さない）。Worker は作業中に関係するテストだけを流す。Reviewer は記録を確かめる。Guard は Merge のときに、Review の合格に加えてこの記録を求める。取り込みのあとの検査は、`team/` の外の変更が混ざったときだけ。
- **B Reviewer は Worktree を作らない**：本体で `git show`・`git diff` で読むだけ。本体での checkout は Guard が止める。
- **C Spec Review は大きい Task だけ、1回**：触るファイルが3つ以上・動きや時刻など条件がぶつかりやすいもの・Orchestrator が迷ったとき。ほかは Task のひな形の「書いたら点検」で Orchestrator が点検する。
- **D 片付けの手順** `scripts/clean-worktrees.mjs`：Git から外れた `agent-*` のフォルダと、名前を指定した取り込み済みの Worktree を消し、取り込み済みのブランチを `-d` で消す。Orchestrator だけ（Guard が止める）。`rm -rf` の禁止はそのまま。
- **E Guard の区切り方**：引用符の中では区切らない。引用符の数が合わないときは前の読み方（安全な方）。
- **F 記録を軽くする**：小さい Request はファイルを作らず Boss の言葉を Task に写す。Briefing はチャットで、ファイルは大きい Request だけ。

## 変えなかった守り

秘密の値、外へ出る操作の Approval Gate、禁止のこと、Review と検査の記録がないと Merge できないこと、Worker が自分の Worktree の外に書けないこと、Reviewer の独立（Handoff を判定の後に読む）、`team/logs/` に AI が書けないこと。

## 確かめたこと

- Guard のテスト 25 件（4件追加：複数行の Merge・検査の記録・引用符の区切り・片付けは Orchestrator だけ）。
- 片付けの手順で、運用中のアプリに残っていた3つのフォルダ（長いパスを含む）を消せた（約50秒）。取り込んでいない T-003 のブランチは残った。
- `hooks/check-install.mjs`：User scope の役の定義が Harness と同じ。

## まだ確かめていないこと

- 新しい流れでの時間とトークン（次の1件で測り、R-004 と比べる）。
- Done Gate の記録と Reviewer の新しい手順は、役の定義が会話の始めに読まれるため、次の会話から効く。
