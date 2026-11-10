#!/usr/bin/env node
// Worktree の片付け。Orchestrator だけが使う（Guard が Worker・Reviewer を止める）。
//
//   node <Harness>/scripts/clean-worktrees.mjs                 何を消すかを見せるだけ
//   node <Harness>/scripts/clean-worktrees.mjs --yes           Git から外れて残ったフォルダを消す
//   node <Harness>/scripts/clean-worktrees.mjs --yes agent-x   登録中の Worktree agent-x も外して消す（取り込み済みのときだけ）
//
// 消してよいもの：
//   - <本体>/.claude/worktrees/agent-* のフォルダで、Git に登録されていないもの（git worktree remove の残り）
//   - 名前を指定した登録中の Worktree で、未保存の変更がなく、HEAD が main に取り込み済みのもの
//   - 上で外した Worktree のブランチ（worktree-<名前>）で、main に取り込み済みのもの（git branch -d）
// Windows では node_modules の中のパスが 260 文字を超え、git worktree remove が消しきれない。
// Node の fs は長いパスも扱えるので、ここで消す。中のリンク（pnpm のジャンクション）はたどらずに外す。

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const named = args.filter((a) => !a.startsWith('-'));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (cwd, ...a) => {
  try {
    return git(cwd, ...a);
  } catch {
    return null;
  }
};
const same = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/** 本体（.claude/harness.json があるフォルダ）を探す。Worktree の中から呼ばれたら止める */
function findRoot(dir) {
  if (/[\\/]\.claude[\\/]worktrees[\\/]/.test(dir)) throw new Error('Worktree の中からは動かさない。本体で動かす');
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, '.claude', 'harness.json'))) return d;
    if (dirname(d) === d) throw new Error('.claude/harness.json のあるプロジェクトの中で動かす');
  }
}

const root = findRoot(process.cwd());
const config = JSON.parse(readFileSync(join(root, '.claude', 'harness.json'), 'utf8'));
const base = config.base ?? 'main';
const wtDir = join(root, '.claude', 'worktrees');
if (!existsSync(wtDir)) {
  console.log('片付けるものはない（.claude/worktrees がない）');
  process.exit(0);
}

git(root, 'worktree', 'prune');
const registered = git(root, 'worktree', 'list', '--porcelain')
  .split('\n')
  .filter((l) => l.startsWith('worktree '))
  .map((l) => l.slice('worktree '.length));
const isRegistered = (p) => registered.some((r) => same(r, p));
const merged = (rev) => tryGit(root, 'merge-base', '--is-ancestor', rev, base) !== null;

const plan = []; // { name, path, how, branch? }
const notes = [];
for (const name of readdirSync(wtDir)) {
  const path = join(wtDir, name);
  if (!/^agent-[0-9a-z]+$/i.test(name)) {
    notes.push(`${name}：agent-* ではないので触らない`);
    continue;
  }
  const st = lstatSync(path);
  if (!st.isDirectory() || st.isSymbolicLink()) {
    notes.push(`${name}：ふつうのフォルダではないので触らない`);
    continue;
  }
  const branch = `worktree-${name}`;
  if (!isRegistered(path)) {
    plan.push({ name, path, how: 'Git から外れた残り', branch });
    continue;
  }
  if (!named.includes(name)) {
    notes.push(`${name}：登録中（使っているかもしれない）。消すなら名前を指定する`);
    continue;
  }
  if (tryGit(path, 'status', '--porcelain') !== '') {
    notes.push(`${name}：未保存の変更があるので消さない`);
    continue;
  }
  const head = tryGit(path, 'rev-parse', 'HEAD');
  if (!head || !merged(head)) {
    notes.push(`${name}：${base} に取り込んでいないコミットがあるので消さない`);
    continue;
  }
  plan.push({ name, path, how: '登録中・取り込み済み', branch, registered: true });
}
for (const n of named) if (!plan.some((p) => p.name === n) && !notes.some((x) => x.startsWith(`${n}：`))) notes.push(`${n}：見つからない`);

for (const n of notes) console.log(`- ${n}`);
if (plan.length === 0) {
  console.log('消すものはない');
  process.exit(0);
}
for (const p of plan) console.log(`${yes ? '消す' : '消せる'}：${p.name}（${p.how}）`);
if (!yes) {
  console.log('消すときは --yes を付ける');
  process.exit(0);
}

let failed = 0;
for (const p of plan) {
  try {
    if (p.registered) tryGit(root, 'worktree', 'remove', '--force', p.path); // 登録を外す。中身が残っても下で消す
    if (existsSync(p.path)) rmSync(p.path, { recursive: true, force: true, maxRetries: 3 });
    git(root, 'worktree', 'prune');
    let b = '';
    if (tryGit(root, 'rev-parse', '--verify', `refs/heads/${p.branch}`)) {
      b = merged(p.branch) && tryGit(root, 'branch', '-d', p.branch) !== null
        ? `、ブランチ ${p.branch} も消した`
        : `、ブランチ ${p.branch} は取り込んでいないので残した`;
    }
    console.log(`消した：${p.name}${b}`);
  } catch (e) {
    failed++;
    console.log(`消せなかった：${p.name}（${e instanceof Error ? e.message : String(e)}）`);
  }
}
process.exit(failed ? 1 : 0);
