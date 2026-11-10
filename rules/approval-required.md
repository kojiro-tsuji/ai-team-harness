# Approve 区分の操作

下の操作は、**Boss が Approval Gate（画面の確認）で許可してから**実行します。

2026-11-09 に、本当に Boss の確認が要るもの 7 つに絞りました（[decisions/2026-11-09-boss-only-for-danger.md](../decisions/2026-11-09-boss-only-for-danger.md)）。基本は全部許可で、止めるのは Deny 区分（[prohibited.md](prohibited.md)）、聞くのはこの 7 つだけです。

## 一覧

| # | 種類（Approval Record の「種類」に使う） | 例 |
|---|---|---|
| 1 | お金 | 有料プランの契約・変更、購入、広告、従量課金の操作（`stripe` など） |
| 2 | 本番への反映・本番データの変更 | 本番への deploy（`wrangler deploy`・`pnpm deploy`・`eas update`）、本番データベースの更新・移行（`--remote`）、main への push で本番に出るプロジェクトの push |
| 3 | 公開・ストア申請 | App Store・Google Play への申請（`eas submit`）、パッケージの公開（`npm publish`）、リポジトリの公開・削除（`gh repo edit` など） |
| 4 | SNS の操作 | 投稿・返信・DM・フォロー・いいね・リポスト・プロフィールの変更 |
| 5 | アカウント作成・鍵の発行 | SNS・クラウド・ストアなどのアカウント作成、API キー・トークンの発行・登録（`wrangler secret`・`gh secret`） |
| 6 | 外への送信 | 個人情報・内部文書の外部送信、共有リンクの発行、外のサーバーへの送信（`curl -d`・`ssh`。手元の `localhost` は対象外）、メール・チャット・予定の招待（MCP の send・post・event など） |
| 7 | 守りの要の変更 | Guard（Harness の `hooks/`）、User scope の設定（`~/.claude/settings.json`・`~/.claude/hooks/`・`~/.claude.json`）、フックを足す・止める設定、git のフック。AI が自分の止め役を外せないようにするため |

迷ったら Approve 区分として扱います。確認をやめたもの（決まりの文書・パッケージの追加・開発用サーバー・EAS のビルドなど）は、[permissions.md](permissions.md) の Report 区分です。

## 聞き方：用件ごとにまとめて1回

Boss には、コマンドを1つずつではなく、**用件1つにつき1回**で聞きます。

1. Orchestrator が Approval Record を1枚作り、**理由と、その用件に要るコマンドをすべて**書きます（`- 実行するコマンド:` の行をいくつでも書けます）
2. 最初のコマンドで確認画面が出ます。画面には、要約・理由・コマンドの一覧が全部出ます
3. Boss が許可すると、**同じ記録に書いたコマンドは、その日のうちは確認なしで通ります**
4. 記録に書いていないコマンド、日が変わったとき、許可のあとで一覧を書きかえたときは、また聞きます

通すかどうかは、Guard が「確認画面のあとで実際に実行された」ことを記録して決めます（`~/.claude/harness-logs/approved.jsonl`。AI は書けません）。Approval Record の「結果：承認」の文字では通りません。

## 関所は Approval Gate

- 本当の関所は、**Claude Code の確認画面（許可・拒否のボタン）**です。Guard が確認を出し、その中に Approval Record の中身を表示します。
- エージェントが伝えてきた「Boss が許可した」という話や、チャットでの返事は、関所になりません（エージェントが書けてしまうため）。
- 確認に慣れて読まずに押してしまわないよう、確認を出すのは上の 7 つだけにします。

## Approval Record

確認の前に、Orchestrator が Approval Record を1枚作ります。あとから「誰が・いつ・何を許可したか」を追えるようにするためです。

1. 場所：プロジェクトの `team/approvals/YYYY-MM-DD-<連番2桁>-<短い名前>.md`（書式 [templates/approval.md](../templates/approval.md)）。Guard が確認画面に表示するのは、この場所の記録だけです。Harness そのものへの操作は `team/` がないため作らず、必要なら Harness の ADR（`decisions/`）に記録します
2. 作成時の結果は「保留」です。「実行するコマンド」には、実行するコマンドをそのまま1行ずつ書きます
3. Boss が許可・拒否したら、結果を書きます。Boss が言葉で答えた場合は、要点をまとめて書きます
4. 実行したら「実行記録」を書きます

## Approval Record のない外部操作

- Guard は、Approval Record がなくても確認は出します（「Approval Record：なし（この1回だけの許可です）」と表示します）。Boss は、記録のないものを拒否してかまいません。
- Reviewer は、実行された外部操作（Guard Log・git の記録）と Approval Record を突き合わせ、記録のないものを報告します。
