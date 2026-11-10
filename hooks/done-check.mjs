#!/usr/bin/env node
// Done Gate：Worker が終わるときの検査。worker の指示文の Stop フック（Claude Code が SubagentStop に変える）として動く。
// プロジェクトの .claude/harness.json の checks を Worktree で流し、通らなければ終わらせない（decision: block）。
// - Worktree（.claude/worktrees/ の中）でなければ、何もしない
// - 変更がない（コミットも、コミットしていない変更もない）ときは流さない
// - 本体の team/handoffs/ の Handoff に、この Worktree で「result: 止まった」とあるときは流さない（聞きたいことがあって止まるとき）
// - 検査の決まり（.claude/harness.json）を変えていたら、終わらせない
// - コミットしていない変更があれば、検査の前に止める（検査を2回流さないため）
// - 通ったら、本体の team/logs/checks.jsonl にコミットを記録する（Reviewer と Merge の確かめに使う。検査はこの1回を正とする）
// - この検査そのものが落ちたら、終わらせない（安全な方へ）
// - 続けさせるのは Claude Code の決まりで 8 回まで。そのあとは終わる（Orchestrator は失敗として数える）

import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const run = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const tail = (s, n = 30) => String(s ?? '').trim().split('\n').slice(-n).join('\n');
const normPath = (p) => resolve(String(p).trim().replace(/^\/([a-zA-Z])\//, '$1:/')).replace(/\\/g, '/').toLowerCase();

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `【Done Gate】${reason}` }));
}

/** 本体の記録のHandoffに、この Worktree で「result: 止まった」と書いてあるか */
function stoppedWithQuestion(root, records) {
  const dir = join(records, 'handoffs');
  if (!existsSync(dir)) return false;
  const want = normPath(root);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const worktree = text.match(/^worktree:\s*(.+?)\s*(#.*)?$/m)?.[1];
    const result = text.match(/^result:\s*(\S+)/m)?.[1] ?? '';
    if (worktree && normPath(worktree) === want && result.startsWith('止まった')) return true;
  }
  return false;
}

function check(input) {
  const cwd = input.cwd ?? process.cwd();
  let root;
  try {
    root = run('git rev-parse --show-toplevel', cwd).trim();
  } catch {
    return; // git の外なら何もしない
  }
  if (!/[\\/]\.claude[\\/]worktrees[\\/]/.test(root)) return;
  const main = root.replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, '');
  const configFile = join(main, '.claude', 'harness.json');
  if (!existsSync(configFile)) return;
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const base = config.base ?? 'main';
  const records = join(main, config.records ?? 'team');

  const dirty = run('git status --porcelain', root).trim() !== '';
  const ahead = Number(run(`git rev-list --count ${base}..HEAD`, root).trim() || '0');
  if (!dirty && ahead === 0) return;
  if (stoppedWithQuestion(root, records)) return;

  const changed = run(`git diff --name-only ${base}...HEAD`, root) + run('git diff --name-only HEAD', root);
  if (/(^|\n)\.claude\/harness\.json(\n|$)/.test(changed)) {
    block('検査の決まり（.claude/harness.json）を変えている。Worker は変えない。元に戻すか、Handoffの「聞きたいこと」に書いて止まる');
    return;
  }
  // 先にコミットさせる（検査を流してから止めると、コミットのあとにもう一度流すことになるため）
  if (dirty) {
    block('コミットしていない変更がある。自分のブランチにコミットしてから終わる（検査はそのあと Done Gate が1回流す）');
    return;
  }
  if (!existsSync(join(root, 'node_modules'))) {
    block('依存が入っていない。アプリの決まりのコマンド（例：pnpm install）で入れてから、終わろうとする');
    return;
  }
  const commit = run('git rev-parse HEAD', root).trim();
  const logFile = join(records, 'logs', 'checks.jsonl');
  if (existsSync(logFile) && readFileSync(logFile, 'utf8').split('\n').some((l) => l.includes(`"commit":"${commit}"`) && l.includes('"ok":true'))) return; // このコミットはもう通っている
  for (const c of config.checks ?? []) {
    try {
      run(c, root);
    } catch (e) {
      block(`「${c}」が通らない。直してコミットしてから終わる。直せないときは、Handoffを result: 止まった で書いて止まる。\n${tail(e.stdout)}\n${tail(e.stderr, 10)}`);
      return;
    }
  }
  // 通ったコミットを記録する。Reviewer はこれを確かめ、Guard は Merge のときにこれを求める（Guard は AI がここへ書くのを止める）
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile,`${JSON.stringify({ at: new Date().toISOString(), commit, branch: run('git branch --show-current', root).trim(), checks: config.checks ?? [], ok: true })}\n`);
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    block('入力が読めなかった。もう一度終わろうとしてみる（続くならHandoffに書いて止まる）');
    return;
  }
  try {
    check(input);
  } catch (e) {
    block(`検査そのものが落ちた：${e instanceof Error ? e.message : String(e)}。Handoffに書いて止まる`);
  }
}

main();
