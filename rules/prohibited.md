# Deny 区分（禁止）

**誰に頼まれても実行しません。** Boss の依頼であっても、まず Orchestrator が理由を確かめ、Boss が決まりを変えるまでは実行しません。
Guard（`hooks/guard.mjs`）が止めます。止められたら、抜け道を探しません。

| # | 禁止の操作 | 例 |
|---|---|---|
| 1 | 秘密の値を読む・書き出す | `.env`・`.dev.vars`・鍵・`~/.ssh`・ログイン情報の中身を、読む・写す・チャットやファイルやコミットに出す。`env`・`printenv` の出力を残す。鍵をコードに直接書く |
| 2 | main への強制 push・削除 | `git push --force`・`-f`・`--force-with-lease`・`+main`・`--delete`・`:main`・`--mirror` |
| 3 | データの一括削除・変更の破棄 | `rm -r`（`-rf`・`--recursive`、`xargs`・`find -exec`・`bash -c` の中も）、`rmdir /s`、`del /s`、`find -delete`、`git clean`、`git reset --hard`、`git checkout -- .`・`-f`、`git switch --discard-changes`、`git restore`、`git branch -D`、`git stash clear・drop`、データベースの `DROP`・`TRUNCATE`・条件のない `DELETE` |
| 4 | PowerShell の使用 | 道具としても、Bash からの呼び出しとしても（Guard の判定を1系統にするため） |

## 例外：Worktree の片付け

Windows では `git worktree remove` が `node_modules` を消しきれずに止まることがあります。そのときだけ、次の形を Orchestrator が使えます。

```
cmd //c 'rmdir /s /q "\\?\C:\...\<プロジェクト>\.claude\worktrees\<名前>"'
```

- 住所は**文字で全部書きます**（変数・`*`・`..` を使わない。空のときに別の場所を消す危険があるため）
- プロジェクト本体の `.claude\worktrees\<名前>` そのものだけが対象です。ほかの場所には使えません（Guard が止めます）
- 消す前に、その Worktree に Merge していない変更がないことを確かめます
- 消したら `git worktree prune` を実行します

`git branch -D` が必要な場合（Merge しないブランチの削除）は、Boss が自分のターミナルで実行します。

## あわせて守ること

- 秘密はリポジトリに入れません。
- Reviewer の判定を甘くする変更はしません。
- 禁止に当たりそうな依頼は、実行せずに理由を返し、Briefing に書きます。
