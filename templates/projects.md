# プロジェクト一覧

<!-- 台帳のひな形。Harness のフォルダの根に projects.md として写して使う。PC ごとの情報なので git には入れない（.gitignore 済み） -->

Harness で運用するプロジェクトです。各プロジェクトの記録は、それぞれのフォルダの `team/` にあります（ここには置きません）。
**場所が空欄のものは、推測せず Boss に確認します。**

| プロジェクト | 略称 | ローカルの場所 | GitHub | 本番公開の方法 | 状態 |
|---|---|---|---|---|---|
| Sample App | sample | `C:\Users\<名前>\projects\sample-app` | <owner>/sample-app | ストアへの申請。main への push では公開されない | 開発中 |

## プロジェクトを追加するとき

1. プロジェクトのフォルダに `templates/app/.claude/harness.json` を写し、略称・検査・push の決まりを書きます（開発以外の作業なら、検査は空でかまいません）
2. プロジェクトの `CLAUDE.md` に `templates/app/CLAUDE.md` の節（入口の2行）を足します
3. 記録のフォルダ `team/` を作ります（`team/logs/` は git に入れません）
4. lint の設定から `.claude/` を除外します
5. この表に1行足し、Harness のフォルダで `node hooks/check-install.mjs` を実行します

## Harness とプロジェクトの分担

AI の働き方と守りは Harness が持ち、どのフォルダからも User scope を通して参照されます。プロジェクトが持つのは、そのプロダクトにしかないことだけです。

| プロジェクトが持つもの | 中身 |
|---|---|
| `.claude/harness.json` | Harness で運用するスイッチ。`project`（略称）、`checks`（流す検査のコマンド）、`pushNeedsConfirm`（main への push で本番に出るなら `true`）、`base`（main のブランチ名）、`records`（記録のフォルダ。ふつうは `team`） |
| `CLAUDE.md` | そのプロダクトの説明と決まり（何を作っているか・技術・コードの書き方・コマンド・設計）。Harness については入口の2行だけ |
| `team/` | STATUS・Task・Review などの記録 |
