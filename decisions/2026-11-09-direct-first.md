# 2026-11-09 Direct を標準にし、Review は工程の区切りにまとめる

[2026-11-08-light-path.md](2026-11-08-light-path.md)（軽い進め方）と、[2026-11-08-efficiency.md](2026-11-08-efficiency.md) の Spec Review の決まりを置きかえます。

## 背景（運用中のアプリの I-003 で測った結果）

- Worker 1件は 7〜26 分。同じ種類を Orchestrator が直接やると 2.5〜14 分（Worker は毎回ゼロから読み直すため）。
- 小さい Task でも Spec Review＋Review で 6〜10 分かかった。
- いちばん重いのは、Orchestrator の会話が長くなったことによる読み直し（1日で約 2 億トークン）。
- 公式の資料も「小さく狙いのはっきりした変更は本体の会話で。サブエージェントは並列・長い出力・独立した要約のときだけ」。

## Boss の言葉（要約）

> 直接やるのを基準にしてよい。直接やる進め方に名前をつけてほしい。自分でやるか Worker に渡すかは、トークンの使用量と時間を元に Orchestrator が判断してよい。途中で Boss が作業を足したときの判断基準もほしい（Orchestrator が都度判断できるならそれでもよい）。
> Spec Review はやめてよい。Task ごとの Review はその場では行わず、main に入れる前・工程の区切りに Reviewer がまとめて1回行う。関所は「GitHub に出す前で止める」案（A）でよい。
> 分かれ目の表もよい。会話を新しくする目安は、都度「新しい会話にしてください」と言ってほしい。

## 決めたこと

1. **名前**：Orchestrator が直接作るのは **Direct**、Worker に渡すのは **Delegate**。「軽い進め方」はなくす。
2. **Direct が標準**。Delegate にするかは、トークンと時間で Orchestrator が毎回決める（Boss に聞かない）。迷ったら Direct。
   - Delegate：独立した仕事が2つ以上で並列にできる／まだ読んでいない広い所を読む／長い調べ物
   - 途中で Boss が作業を足したとき：同じ表で決める。Worker が動いている間は、触るファイルが重ならなければ Orchestrator が Direct で並行して進め、重なるなら Worker の終わりを待つ。
3. **Spec Review はやめる**。Task は Orchestrator が「書いたら点検」で自分で点検する。
4. **Review は2つの場面だけ**：
   - 工程の区切り（GitHub の main に push する前）に、区切りまでの差分（`origin/main..HEAD`）をまとめて1回
   - データ・課金・ログイン・サーバー・時刻に触れた変更は、その場で毎回
   - 指示は「仕様と照らして正しさだけ」
5. **関所を移す（案 A）**：
   - 手元の main への Merge：Guard は Done Gate の検査の記録だけを求める（Review は求めない）
   - GitHub の main への push：Guard が区切りの Review の合格（`verdict: 合格` と `commit:`）を求める。合格のあとで `team/` だけを変えたコミットは通す
   - 別の名前のブランチへの控えの push（`git push origin HEAD:wip`）は、いつでも通す
   - 案 B（工程用のブランチ）は、ブランチの出し入れが増えるので見送った
6. **会話の区切りの合図**：作業のまとまりが終わったとき・2〜3 時間たったとき・関係のない作業に移るときに、Orchestrator が STATUS を書いてから「区切りです。新しい会話にしてください」と Boss に伝える。
7. **分かれ目の表**を地図（`CLAUDE.md`）に置く。

## 三原則への効き方

| 原則 | 効き方 |
|---|---|
| ① 関与 | 進め方を Boss に聞かない。Review の結果を読むのも区切りごとに1回 |
| ② トークン | Worker の読み直しと、小さい Task の Review が減る。会話の区切りで読み直しが減る |
| ③ 時間 | 同じ仕事で 2〜4 倍速い見込み。小さい Task の Review の 6〜10 分がなくなる |
| 引きかえ | 小さい不具合は、区切りの Review まで気づきにくい。手元の main に Review 前のものが一時的に入る（外に出る前に止まる） |

## 変えたファイル

- `hooks/guard.mjs`・`hooks/guard.test.mjs`（テスト 33 件。push の関所、Merge は検査の記録だけ）
- `CLAUDE.md`（分かれ目の表・会話の区切りの合図・ワークフロー）・`departments/dev.md`・`agents/reviewer.md`（`~/.claude/agents/` にも入れた）
- `templates/review.md`・`templates/task.md`・`rules/defense.md`・`rules/permissions.md`・`README.md`
