---
kind: 区切り         # 区切り（工程の区切りにまとめて）／ 危ない所（データ・課金・ログイン・サーバー・時刻）
range: origin/main..<commit>   # 確かめた範囲
tasks: T-000, R-000  # 照らした Task・Request（ファイルがなければ「コミットのメッセージ」）
by: reviewer
verdict:             # 合格 ／ 不合格（Guard はこれを見て GitHub の main への push を許可する）
commit:              # 範囲の終わりのコミットのハッシュ（Guard はこれを見て push を許可する）
date: YYYY-MM-DD
---

<!-- 場所：team/reviews/S-YYYY-MM-DD-<連番2桁>.md（区切り）か T-xxx.md（危ない所） -->

# Review：<区切りの名前 / T-000>

## 仕様との照らし合わせ（正しさだけ。見た目・書き方の好みは見ない）
| 仕様（Task の完了条件・Request・コミットのメッセージ） | 結果 | 根拠（ファイルと行） |
|---|---|---|

## 触ってよい場所の外を触っていないか（Task があるものだけ）
（Task の「触ってよい場所」と、`git diff --stat <range>` を比べる）

## 検査をごまかしていないか（package.json の scripts・テストの設定・.claude/harness.json・飛ばしたテスト）

## 検査の記録
（Worker のコミット：team/logs/checks.jsonl に "ok":true があるか。Direct のコミット：Orchestrator が依頼に書いた checks を通したハッシュ）

## 流したコマンドと出力（読むためのコマンド・計算だけ）
```
```

## Guard Log（team/logs/guard.jsonl）：範囲の中の、止められた跡と Worker が実行したコマンド

## Approval Record との突き合わせ（Approve 区分の操作があったときだけ）

## 指摘（直すべきこと）

## Handoff との食い違い（判定を書いたあとで読む。判定は変えない）

## Boss へ（Orchestrator を通さずに伝えたいこと。なければ「なし」）
