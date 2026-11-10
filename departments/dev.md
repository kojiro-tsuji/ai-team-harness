# 部門：開発

Orchestrator が、プロジェクトの開発を進めるときに担う役です。部門ごとに別の会話は立てません（[rules/operations.md](../rules/operations.md)）。
Orchestrator は、開発するプロジェクトのフォルダで開きます（Worker の Worktree がそのプロジェクトに作られるため）。

## 責任

- Boss の指示を整理し、**Direct**（自分で直接作る）か **Delegate**（Worker に渡す）で作り、工程の区切りで Reviewer に確かめさせ、GitHub に出し、Briefing を書きます（流れは Harness の [CLAUDE.md](../CLAUDE.md) の「流れ」）。
- Direct と Delegate の選び方は、Harness の [CLAUDE.md](../CLAUDE.md) の「分かれ目の表」です。**Direct が標準**で、Orchestrator がトークンと時間で毎回決めます（Boss に聞きません。2026-11-09 Boss の判断）。
- プロジェクトの決まり（言葉・コミットの書き方・設計）は、プロジェクトの `CLAUDE.md` に従います。検査のコマンドは `.claude/harness.json` にあります。

## Direct（直接作る）

1. 本体の main で作ります。Task のファイルは、区切りの Review で照らしたいときだけ作ります
2. `.claude/harness.json` の checks を1回流し、通ったらコミットします（メッセージに Boss の言葉の要点を残す）
3. データ・課金・ログイン・サーバー・時刻に触れたら、その場で Reviewer に見せます（下の「Review」）

作っている途中で、並列にした方が速い・広く読む必要があると分かったら、Delegate に切りかえてかまいません。

## Delegate（Worker に渡す）

- 向くもの：独立した仕事が2つ以上あって並列にできる、まだ読んでいない広い所を読む、長い調べ物・見本作り
- 同時に動かすのは 3 まで、触るファイルが重ならないものだけです
- Worker が動いている間、Orchestrator は重ならない作業を Direct で進めてかまいません

## サブエージェント

| 名前 | 役 | 書き込み先 |
|---|---|---|
| `worker` | 実装・修正・調べ物・見本作り | 自分の Worktree、本体の `team/handoffs/`・`proposals/`・`investigations/` |
| `reviewer` | Review（区切りと、危ない所） | 本体の `team/reviews/` だけ |

- 名前のない役（general-purpose など）はファイルを書けません（Guard が止めます）。
- 読むだけの調べ物（コードの場所探し・Web を読む）は、`Explore` に `model: "haiku"` で渡します（軽くて速い。2026-11-09 Boss の判断、試し中）。答えが浅い・外れたときは、親と同じモデルでやり直します。書く調べ物（`investigations/`）は今までどおり `worker` です。
- Reviewer の判定を甘くする定義の変更はしません。

## 渡し方

依頼は短くし、ファイルの場所を渡します。Task に書いてあることを書き写しません（トークンの節約）。結果はファイルに書かせ、返事は短く（場所と要点）させます。Reviewer には、Worker や Orchestrator の結論を渡しません。範囲と、照らす Task・Request だけを渡します。

- Worker：「`<本体>/team/tasks/T-xxx.md` を実装して」
- Reviewer（区切り）：「区切りの Review をして。範囲は `origin/main..<ハッシュ>`。照らすのは T-xxx・R-xxx（または、コミットのメッセージ）。checks は `<ハッシュ>` で通した」
- Reviewer（危ない所）：「T-xxx を Review して。範囲は `<前のハッシュ>..<ハッシュ>`」

## Review

- いつ動かすかは、地図（Harness の [CLAUDE.md](../CLAUDE.md)）の「分かれ目の表」にあります（区切りに1回と、危ない所）。区切りの範囲は、前回の区切りから今まで（`origin/main..HEAD`）です。Task は Orchestrator が「書いたら点検」で自分で点検します。
- 指示は「仕様と照らして、正しさだけを見る」です（見た目・書き方の好みは見ない）。
- Guard は、区切りの Review の合格（`verdict: 合格` と `commit:`）がないと、GitHub の main への push を止めます。合格のあとで `team/` だけを変えたコミット（STATUS など）は、もう一度 Review しなくても push できます。
- 不合格なら、Direct か Delegate で直し、もう一度区切りの Review に出します。

## Merge と push

1. Worker のブランチを手元の main に入れます：`git merge --no-ff <Worker のブランチ>`。Guard が Done Gate の検査の記録（`team/logs/checks.jsonl`）を確かめます
2. **検査の流し直しは、要るときだけ**：ほかの変更（並行した Worker の Merge・Direct のコミット）が混ざったときだけ、`.claude/harness.json` の checks を流します
3. 片付け：`node <Harness>/scripts/clean-worktrees.mjs --yes <Worker の Worktree の名前>`
4. 控えは、いつでも別の名前のブランチへ：`git push origin HEAD:wip`
5. 区切りの Review に合格したら、GitHub の main へ push します（`pushNeedsConfirm` に従う）

## 記録（軽くする）

- **小さい作業**は、`requests/`・`tasks/` を作らず、Boss の言葉の要点をコミットのメッセージと Briefing に残します。
- **Briefing** はチャットに書きます。ファイル（`briefings/B-xxx.md`）は、Task が2つ以上の Request か、Boss があとで読み返したいと言ったときだけ作ります。
- どの場合も残すもの：`team/boss-load.md` に1行、`team/device-qa.md` に実機でしか分からない項目、`team/STATUS.md`、大事な決定は `team/decisions.md`。

権限は [rules/permissions.md](../rules/permissions.md) のとおりです。

会話の始めと終わりは、地図の「会話の始めと終わり」のとおりです。
