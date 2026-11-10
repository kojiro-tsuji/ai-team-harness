#!/usr/bin/env node
// ハーネスのGuard。Claude Code の PreToolUse フックとして、道具を使う直前に動く。
// ユーザー全体の設定（~/.claude/settings.json）から呼ぶので、どのフォルダで開いても効く。
// 決まりは rules/defense.md。
//
//   1. PowerShell を止める（道具も、Bash から呼ぶのも）
//   2. 禁止のこと（rules/prohibited.md）を止める。Worktreeの片付けの例外だけ通す
//   3. 役ごとに書いてよい場所を守らせる（役は agent_type。知らない役は、いちばん弱い権限）
//   4. 守りの要（Guard 自身・User scope の設定・フックを足す設定）への書き込みは、Orchestratorのファイルの道具なら確認、シェルからは止める。
//      ほかの守りの設定（rules・CLAUDE.md・プロジェクトの .claude/ など）は、Orchestratorは確認なし、Worker・Reviewer・ほかの役は止める（2026-11-09）
//   5. 本当に危ない外に出る操作（お金・本番・公開・SNS・鍵・外への送信）は、Approval Gate（ask）を出し、Approval Record の中身を表示する。
//      Approval Record の文字では通さない。Boss が1回許可すると、同じ記録に書いたコマンドはその日のうちは確認なしで通す（まとめて許可。--post で記録する）
//   6. Orchestrator が Worker のブランチを手元の main に Merge するときは、Done Gate の検査の記録（logs/checks.jsonl）を確かめる。
//      GitHub の main に push するときは、工程の区切りの Review の合格記録（verdict と commit）を確かめる（2026-11-09。Review は区切りにまとめて1回）
//   （Worktree の片付け scripts/clean-worktrees.mjs は Orchestrator だけ。Reviewer は本体で読むだけで、checkout は Worktree の中だけ）
//   7. 落ちたとき・入力が読めないときは止める
//
// プロジェクト：.claude/harness.json があるフォルダ。記録はその中の team/（harness.json の records で変えられる）。
// Windows ではサンドボックスが動かず、シェルの書き方をすべては読めない。すり抜けた分はReviewerが見つける（Defense in Depth）。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 住所 ----------

/** Git Bash の書き方（/c/...）を Windows の書き方（c:/...）にする。~ はホームにする */
function toWin(p, home = homedir()) {
  let s = String(p).replace(/\\/g, '/');
  if (s === '~' || s.startsWith('~/')) s = home.replace(/\\/g, '/') + s.slice(1);
  const m = /^\/([a-zA-Z])\/(.*)$/.exec(s);
  return m ? `${m[1]}:/${m[2]}` : s;
}

/** 比べやすい形にする：区切りは /、小文字（Windows は大文字・小文字を区別しない） */
export function norm(p) {
  return resolve(toWin(p)).replace(/\\/g, '/').toLowerCase();
}

const full = (cwd, target) => norm(resolve(toWin(cwd), toWin(target)));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WT = /\/\.claude\/worktrees\/[^/]+/;
const under = (path, dir) => path === dir || path.startsWith(`${dir}/`);

/** Worktreeの中の住所なら、本体の住所（.claude/worktrees より前）を返す */
const mainOf = (path) => {
  const m = path.match(new RegExp(`^(.*?)${WT.source}`));
  return m ? m[1] : path;
};
/** Worktreeの根（なければ null） */
const worktreeOf = (path) => path.match(new RegExp(`^.*?${WT.source}`))?.[0] ?? null;

// ---------- 役 ----------

const ROLES = { worker: 'worker', reviewer: 'reviewer' };
/** agent_type がなければOrchestrator。知っている名前はその役。知らない名前は guest（いちばん弱い） */
export const roleOf = (agentType) => (agentType ? (ROLES[agentType] ?? 'guest') : 'orchestrator');

// ---------- プロジェクト ----------

/** dir から上へたどって .claude/harness.json を探す。{root, config} か null */
function findProject(dir) {
  let d = resolve(toWin(mainOf(norm(dir))));
  for (;;) {
    const file = join(d, '.claude', 'harness.json');
    if (existsSync(file)) {
      let config = {};
      try {
        config = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        config = { broken: true };
      }
      return { root: norm(d), config };
    }
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

const recordsOf = (project) => (project ? `${project.root}/${(project.config.records ?? 'team').toLowerCase()}` : null);

// ---------- 守りの設定 ----------

/** 守りの設定（変えるには確認が要る場所）か */
export function isProtected(path, ctx) {
  const home = ctx.home;
  if (path === `${home}/.claude.json`) return true;
  if (under(path, `${home}/.claude`)) {
    const rest = path.slice(home.length + '/.claude/'.length);
    return /^(settings(\.local)?\.json|claude\.md|agents\/|hooks\/|commands\/|skills\/|plugins\/)/.test(rest);
  }
  const h = ctx.harness;
  // Harness の説明の文書（README・記録・Task などの書式）は動きを変えないので確認しない。
  // 動きを変える所（hooks・agents・rules・departments・CLAUDE.md・.claude・配る設定の templates/user）は確認する
  if (under(path, h)) {
    const doc = under(path, `${h}/decisions`) || [`${h}/roadmap.md`, `${h}/readme.md`, `${h}/projects.md`].includes(path)
      || (under(path, `${h}/templates`) && !under(path, `${h}/templates/user`));
    return !doc;
  }
  // Worktreeの中は、Worktreeの根から見る
  const inner = path.replace(new RegExp(`^.*?${WT.source}`), '');
  if (/\/\.claude\//.test(inner) && !/\/\.claude\/worktrees\//.test(inner)) return true;
  if (/\/\.git\/(hooks\/|config$)/.test(inner) || /\/\.mcp\.json$/.test(inner)) return true;
  const project = ctx.projectOf(path);
  if (project && path === `${project.root}/claude.md`) return true;
  const wt = worktreeOf(path);
  if (wt && path === `${wt}/claude.md`) return true;
  return false;
}

/**
 * 守りの要（Orchestratorでも Boss の確認が要る場所）か。AI が自分の止め役を外せないようにするため（2026-11-09）。
 * Guard と Done Gate（Harness の hooks/。テストは除く）、User scope の設定とフック、.claude.json（MCP の設定）、git のフック
 */
export function isLocked(path, ctx) {
  const home = ctx.home;
  if (path === `${home}/.claude.json`) return true;
  if (under(path, `${home}/.claude`)) {
    const rest = path.slice(home.length + '/.claude/'.length);
    return /^(settings(\.local)?\.json$|hooks\/|plugins\/)/.test(rest);
  }
  if (under(path, `${ctx.harness}/hooks`)) return !/\.test\.mjs$/.test(path);
  return /\/\.git\/hooks(\/|$)/.test(path);
}

const SETTINGS = /\/\.claude\/settings(\.local)?\.json$/;
/** フックを足す・止める設定の書きかえ（プロジェクトの設定から Guard を止められないようにする） */
const HOOK_SETTING = /disableAllHooks|"hooks"\s*:/;

/** ファイルへの書き込みの判断。{decision, reason} か null。content は書く中身（分かるときだけ） */
function judgeWrite(role, path, cwd, ctx, viaShell, content = '') {
  const tmp = ctx.tmp;
  if (role !== 'orchestrator' && under(path, tmp)) return null;
  if (/\/team\/logs\//.test(path) || under(path, `${ctx.home}/.claude/harness-logs`)) {
    return { decision: 'deny', reason: 'Guardの記録（logs/）はGuardだけが書く' };
  }
  const locked = isLocked(path, ctx) || (SETTINGS.test(path) && HOOK_SETTING.test(content));
  if (role === 'orchestrator') {
    if (viaShell && (locked || SETTINGS.test(path))) {
      return { decision: 'deny', reason: '守りの要（Guard・設定ファイル）はシェルから変えない。ファイルの道具で、中身を見せて確認を取る' };
    }
    if (locked) {
      return { decision: 'ask', reason: `守りの要（${path}）を変えます。Guard や設定の止め役に関わるので、中身を見て、よければ許してください` };
    }
  } else if (locked || isProtected(path, ctx)) {
    return { decision: 'deny', reason: 'Worker・Reviewer・ほかの役は守りの設定を変えない' };
  }
  const wt = worktreeOf(path);
  if (wt) {
    const project = ctx.projectOf(path);
    const rec = project ? (project.config.records ?? 'team').toLowerCase() : 'team';
    if (under(path, `${wt}/${rec}`)) {
      return { decision: 'deny', reason: `Worktreeの中の ${rec}/ は写し。記録は本体の ${rec}/ に、住所を指定して書く` };
    }
  }
  const project = ctx.projectOf(path);
  const records = recordsOf(project);
  // フォルダそのもの（mkdir -p …/proposals）も中に入れる
  const inRec = (parts) => records && new RegExp(`^${escape(records)}/(${parts})(/|$)`).test(path);

  if (role === 'orchestrator') {
    if (inRec('reviews')) return { decision: 'deny', reason: 'Review は Reviewer だけが書く（作る人と確かめる人を分ける）' };
    if (inRec('handoffs')) return { decision: 'deny', reason: 'Handoff は Worker だけが書く' };
    return null;
  }
  if (role === 'worker') {
    if (inRec('handoffs|proposals|investigations')) return null;
    const mine = worktreeOf(cwd);
    if (mine && under(path, mine)) return null;
    return { decision: 'deny', reason: 'Worker が書けるのは、自分の Worktree と、本体の team/ の handoffs/・proposals/・investigations/ だけ' };
  }
  if (role === 'reviewer') {
    if (inRec('reviews')) return null;
    return { decision: 'deny', reason: 'Reviewer が書けるのは、本体の team/reviews/ だけ。コードは直さず、指摘を書く' };
  }
  return { decision: 'deny', reason: '名前のない役（調べ物など）はファイルを書かない。書く仕事は worker に振る' };
}

// ---------- シェルの読み取り ----------

/**
 * ヒアドキュメントの中身と、git commit・tag のメッセージを外す（中の言葉で止めないため）。<<EOF の行は残す。
 * ただし中身をシェルやプログラムに流すとき（| sh、bash <<EOF など）は、中身も命令として残す
 */
export function stripText(command) {
  const RUNS = /(^|[|;&]\s*|\s)(sh|bash|zsh|source|\.|node|python3?|perl|ruby|eval|xargs)(\s|$)/;
  return command
    .replace(/(<<-?\s*(['"]?)(\w+)\2[^\n]*)\n([\s\S]*?)\n\s*\3(?=\s|$)/g, (_all, line, _q, _tag, body) =>
      RUNS.test(line) ? `${line}\n${body}` : line)
    .replace(/(\bgit\b[^\n;&|]*\b(?:commit|tag)\b[^\n;&|]*?\s(?:-m|--message)(?:=|\s+))("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1MSG');
}

/** bash -c "…"・sh -c '…'・eval "…" の中身も、命令として足す */
function expand(text) {
  const inner = [];
  for (const m of text.matchAll(/\b(?:bash|sh|zsh|eval)\b(?:\s+-\w+)*\s+("(?:[^"\\]|\\.)*"|'[^']*')/g)) {
    inner.push(m[1].slice(1, -1));
  }
  // $( … ) と ` … ` の中の命令
  for (const m of text.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) inner.push(m[1] ?? m[2]);
  return [text, ...inner].join('\n');
}

/**
 * 命令ごとに区切る。引用符の中（メッセージ・node -e の式など）の改行や ; | では区切らない。
 * 引用符の数が合わないときは、安全な方へ倒して、引用符を見ずに区切る（前の読み方）
 */
export function segmentsOf(command) {
  const clean = (parts) => parts.map((s) => s.trim().replace(/^\(\s*/, '').replace(/\s*\)$/, '')).filter(Boolean);
  const parts = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === '\\' && quote === '"' && i + 1 < command.length) {
        cur += c + command[++i];
        continue;
      }
      if (c === quote) quote = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (c === ';' || c === '|' || c === '\n') {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (quote) return clean(command.split(/&&|\|\||;|\||\n/));
  parts.push(cur);
  return clean(parts);
}
const wordsOf = (segment) => segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
const unquote = (t) => t.replace(/^["']|["']$/g, '');

/** Worktreeの片付けの例外：rmdir /s で、住所を文字で書き、本体の .claude\worktrees\<名前> を消す */
function isWorktreeCleanup(segment, ctx) {
  if (!/\b(rmdir|rd)\b/i.test(segment)) return false;
  if (/[$*%`]|\.\./.test(segment)) return false;
  const paths = segment.match(/[a-zA-Z]:[\\/][^"']+/g) ?? [];
  if (paths.length === 0) return false;
  return paths.every((p) => {
    const n = norm(p.trim());
    const wt = worktreeOf(n);
    return wt === n && ctx.projectOf(n) !== null;
  });
}

const SECRET = /(^|[\s"'/\\=])(\.env(?!\.example)(\.[\w.-]+)?|\.dev\.vars|\.git-credentials|hosts\.yml|id_(rsa|ed25519|ecdsa)\w*)(?=$|[\s"'])|[\\/]\.ssh[\\/]|\.wrangler[\\/]config|\.expo[\\/]state/i;

/** 禁止のこと。当たったら理由を返す */
export function prohibited(command, role, ctx) {
  const text = expand(stripText(command));
  for (const seg of segmentsOf(text)) {
    const words = wordsOf(seg).map(unquote);
    const lower = words.map((w) => w.toLowerCase());
    // rm で中身ごと消す（xargs・find -exec・command の後ろも見る）
    for (let i = 0; i < lower.length; i++) {
      if (lower[i] !== 'rm' && !lower[i].endsWith('/rm')) continue;
      if (lower[i - 1] === 'git') continue; // git rm は git の履歴から戻せる
      const flags = words.slice(i + 1).filter((w) => w.startsWith('-'));
      if (flags.some((f) => /^-[a-zA-Z]*[rR]/.test(f) || f === '--recursive')) return 'rm で中身ごと消すのは禁止（一括削除）';
    }
    if (/\b(rmdir|rd)\b[^\n]*\s\/s\b/i.test(seg)) {
      if (role === 'orchestrator' && isWorktreeCleanup(seg, ctx)) continue;
      return 'rmdir /s は禁止（一括削除）。例外は、本体のWorktree（.claude\\worktrees\\<名前>）を住所を文字で書いて消すときだけ';
    }
    if (/\b(del|erase)\b[^\n]*\s\/s\b/i.test(seg)) return 'del /s は禁止（一括削除）';
    if (/\bRemove-Item\b[^\n]*-Recurse/i.test(seg)) return 'Remove-Item -Recurse は禁止（一括削除）';
    if (/\bfind\b[^\n]*\s-delete\b/.test(seg)) return 'find -delete は禁止（一括削除）';
    if (/\b(rmSync|rmdirSync)\b[^\n]*recursive/.test(seg) || /\bshutil\.rmtree\b/.test(seg)) return 'プログラムで中身ごと消すのは禁止（一括削除）';
    const gi = lower.indexOf('git');
    if (gi >= 0) {
      const g = lower.slice(gi + 1);
      const sub = g.find((w, k) => !w.startsWith('-') && !(k > 0 && ['-c', '-C'.toLowerCase()].includes(g[k - 1])));
      const has = (re) => g.some((w) => re.test(w));
      if (sub === 'push') {
        if (has(/^(--force(-with-lease)?(=.*)?|-[a-z]*f[a-z]*)$/) || g.some((w) => /^\+/.test(w))) return '強制 push は禁止';
        if (has(/^(--delete|-d|--mirror|--prune)$/) || g.some((w, k) => k > 0 && /^:/.test(w))) return 'push でブランチを消す・まるごと写すのは禁止';
      }
      if (sub === 'clean') return 'git clean は禁止（一括削除）';
      if (sub === 'reset' && has(/^--hard$/)) return 'git reset --hard は禁止（作業中の変更を捨てる）';
      if (sub === 'checkout' && (has(/^(-f|--force)$/) || g.includes('--') || g.includes('.'))) return 'git checkout で変更を捨てるのは禁止';
      if (sub === 'switch' && has(/^(-f|--force|--discard-changes)$/)) return 'git switch で変更を捨てるのは禁止';
      if (sub === 'restore' && !(g.includes('--staged') && !g.includes('--worktree') && !g.includes('-w'))) return 'git restore は禁止（作業中の変更を捨てる）。取り消しだけなら git restore --staged';
      if (sub === 'branch' && (g.includes('-d') && g.includes('-f') || words.slice(gi + 1).includes('-D') || g.includes('--delete') && g.includes('--force'))) {
        return 'git branch -D は禁止（Merge していないブランチを消す）。Merge 済みなら -d。必要なら Boss が自分のターミナルで実行する';
      }
      if (sub === 'stash' && has(/^(clear|drop)$/)) return 'git stash clear・drop は禁止（変更を捨てる）';
    }
    if (/\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE(\s+TABLE)?)\b/i.test(seg)) return 'データベースの一括削除は禁止';
    if (/\bDELETE\s+FROM\s+\S+\s*(;|$|["'])/i.test(seg)) return '条件のない DELETE は禁止';
    if (/\bprisma\s+migrate\s+reset\b/.test(seg)) return 'データベースの初期化は禁止';
    if (/^(env|printenv|set|export\s+-p|declare\s+-x)$/.test(seg) || /^printenv\b/.test(seg)) return '環境変数を書き出すのは禁止（秘密が入っていることがある）';
    if (SECRET.test(seg)) {
      const okCmd = lower[0] === 'ls' || (lower[0] === 'git' && /^(status|check-ignore|ls-files|add|rm)$/.test(lower[1] ?? ''));
      if (!okCmd) return '秘密のファイル（.env・.dev.vars・鍵・ログインの情報）を読む・写すのは禁止';
    }
  }
  if (callsPowerShell(text)) return 'PowerShell は使わない（Guardを1組にするため）。Bash で書く';
  return null;
}

/** PowerShell をコマンドとして呼んでいるか（文字列の中の言葉では止めない） */
function callsPowerShell(text) {
  const PS = /^(powershell|pwsh)(\.exe)?$/i;
  for (const seg of segmentsOf(text)) {
    const words = wordsOf(seg).map(unquote);
    let i = 0;
    while (i < words.length && (/^[A-Za-z_]\w*=/.test(words[i]) || ['env', 'timeout', 'command', 'exec'].includes(words[i]) || /^\d+[smh]?$/.test(words[i]))) i++;
    const cmd = (words[i] ?? '').replace(/^.*[\\/]/, '');
    if (PS.test(cmd)) return true;
    if (/\b(cmd(\.exe)?\s+\/{1,2}[ck]|start)\s+["']?\s*(powershell|pwsh)(\.exe)?\b/i.test(seg)) return true;
  }
  return false;
}

/** 1つの命令から、書き込み先を拾う（よくある書き方だけ） */
function writeTargets(segment) {
  const targets = [];
  // node -e '…' などのプログラムの中身は、リダイレクトとして読まない（=> や a > b を書き込みと見ないため）
  segment = segment.replace(/\b(node|python3?|py|perl|ruby|deno|bun)\b([^"'\n]*?)\s(-e|--eval|-p|--print|-c|-E)\s+("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1$2 $3 CODE');
  // 引用符の中の > （sed '/<a>/p'・grep "<b>" など）は、リダイレクトとして読まない。> の直後の引用符（> "書く先"）は残す
  const scan = segment.replace(/(>>?\s*)?("(?:[^"\\]|\\.)*"|'[^']*')/g, (all, redirect) => (redirect ? all : 'Q'));
  for (const m of scan.matchAll(/(?<![0-9&<=\-])>>?\s*("[^"]+"|'[^']+'|[^\s;|&]+)/g)) targets.push(unquote(m[1]));
  const words = wordsOf(segment);
  const cmd = words[0];
  const args = words.slice(1).filter((w) => !w.startsWith('-')).map(unquote);
  if (['tee', 'rm', 'rmdir', 'touch', 'mkdir', 'truncate'].includes(cmd)) targets.push(...args);
  if (['cp', 'mv', 'ln', 'install'].includes(cmd)) {
    const t = words.findIndex((w) => w === '-t' || w.startsWith('--target-directory'));
    if (t >= 0) targets.push(unquote(words[t].includes('=') ? words[t].split('=')[1] : words[t + 1] ?? ''));
    else if (args.length >= 2) targets.push(args[args.length - 1]);
  }
  if (['sed', 'perl'].includes(cmd) && words.some((w) => /^-[a-zA-Z]*i/.test(w)) && args.length) targets.push(args[args.length - 1]);
  return targets.filter((t) => t && !/^\/dev\/null$/i.test(t) && !/^&\d$/.test(t) && !/^nul$/i.test(t));
}

/** プログラムの1行で、ファイルを書く・消すか（Worker・Reviewer・ほかの役には使わせない） */
const INLINE_WRITE = /\b(node|python3?|py|perl|ruby|deno|bun)\b[^\n]*\s(-e|--eval|-p|--print|-c|-E)\s[\s\S]*(writeFile|appendFile|rmSync|rmdirSync|unlink|rename|copyFile|cpSync|createWriteStream|mkdirSync|truncate|open\([^)]*['"][wax+]|shutil|os\.remove|write_text|write_bytes)/;

/** 役ごとに止める git の操作 */
function gitForbidden(role, seg, cwd) {
  const words = wordsOf(seg).map(unquote);
  const gi = words.findIndex((w) => w.toLowerCase() === 'git');
  if (gi < 0) return null;
  const g = words.slice(gi + 1);
  const opts = [];
  let k = 0;
  while (k < g.length && g[k].startsWith('-')) {
    opts.push(g[k]);
    if (['-C', '-c', '--git-dir', '--work-tree'].includes(g[k])) opts.push(g[++k]);
    k++;
  }
  const sub = (g[k] ?? '').toLowerCase();
  const rest = g.slice(k + 1).map((w) => w.toLowerCase());
  if (opts.some((o) => o === '-c' || o.startsWith('--git-dir') || o.startsWith('--work-tree'))) {
    return 'git の設定を一時的に変える書き方（-c・--git-dir・--work-tree）は使わない';
  }
  const ci = opts.indexOf('-C');
  if (ci >= 0) {
    const target = full(cwd, opts[ci + 1] ?? '.');
    const mine = worktreeOf(norm(cwd));
    if (role === 'worker' && !(mine && under(target, mine))) return 'Workerは自分のWorktreeの外の git を触らない';
  }
  const always = ['push', 'merge', 'rebase', 'worktree', 'update-ref', 'config', 'symbolic-ref', 'filter-branch', 'replace', 'gc', 'prune', 'reflog'];
  if (role === 'worker') {
    if (always.includes(sub)) return `Workerは git ${sub} をしない（Orchestratorの仕事）`;
    if (sub === 'branch' && rest.some((w) => /^(-d|-m|-M|--delete|--move|-f|--force)$/.test(w))) return 'Workerはブランチを消す・名前を変えない';
    if ((sub === 'checkout' || sub === 'switch') && rest.some((w) => /^(main|master)$/.test(w))) return 'Workerは main に切りかえない';
    return null;
  }
  // Reviewer・ほかの役：読むだけ
  const readOnly = ['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'grep', 'describe', 'cat-file', 'shortlog', 'merge-base', 'rev-list', 'name-rev', 'for-each-ref', 'show-ref', 'version', 'help'];
  if (readOnly.includes(sub)) return null;
  if (sub === 'branch' && rest.every((w) => /^(-a|-r|-v|-vv|--list|--show-current|--contains|--merged|--no-merged)$/.test(w))) return null;
  // Reviewer は本体で動く（Worktree を作らない）。本体で checkout すると Boss の作業中のフォルダが切りかわるので、Worktree の中だけ許す
  if (role === 'reviewer' && sub === 'checkout' && rest[0] === '--detach' && worktreeOf(norm(cwd))) return null;
  return role === 'reviewer'
    ? 'Reviewerは git で記録を変えない（読むだけ。コミットの中身は git show・git diff で読む）'
    : '名前のない役は git で記録を変えない';
}

// ---------- 外に出る操作 ----------

/**
 * 本当に危ない外に出る操作。当たったら種類を返す（2026-11-09 に絞った。rules/approval-required.md）。
 * 聞かなくなったもの：開発用サーバー、パッケージの追加、EAS のビルド、PR の作成・Merge、手元のサーバーへの送信
 */
export function outbound(seg, project, where = null, harness = null) {
  const LOCAL = /\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])\b/;
  const rules = [
    [/\bgh\s+(release\s+create|repo\s+(create|delete|edit|rename|archive)|api\b[^\n]*-X\s*(POST|PUT|PATCH|DELETE))/i, '公開・外への書き込み（GitHub）'],
    [/\bgh\s+secret\b/, '鍵の発行・登録'],
    [/\b(npm|pnpm|yarn|bun)\s+publish\b/, '公開'],
    [/\b(npm|pnpm|yarn|bun)\s+(login|adduser)\b/, 'アカウント・鍵'],
    [/\b(npm|pnpm|yarn|bun)\b[^\n]*\b(run\s+)?(deploy|release|publish|upload[\w:-]*|ship)\b(?![\w:-]*dev\b)(?![^\n]*--env[ =]dev(\s|$))/, '本番への反映（スクリプトの中身が本番の操作のことがある）'],
    [/\bvercel\b[^\n]*--prod\b/, '本番への反映'],
    [/\bnetlify\s+deploy\b[^\n]*--prod\b/, '本番への反映'],
    [/\bfirebase\s+deploy\b/, '本番への反映'],
    [/\bwrangler\s+deploy\b(?![^\n]*--env[ =]dev(\s|$))/, '本番への反映'],
    [/\bwrangler\s+(d1|r2|kv)\b[^\n]*--remote\b(?![^\n]*--env[ =]dev(\s|$))/, '本番データの変更'],
    [/\bwrangler\s+secret\b/, '鍵の発行・登録'],
    [/\beas\s+submit\b/, '公開・ストア申請'],
    [/\beas\s+update\b/, '本番への反映（アプリの更新を配る）'],
    [/\bsupabase\s+(db\s+push|link|login)\b/, '本番データの変更'],
    [/\bprisma\s+(migrate\s+deploy|db\s+push)\b/, '本番データの変更'],
    [/\bstripe\b(?!\s+(listen|logs|login|--help|-h|version)\b)/, 'お金'],
  ];
  for (const [re, kind] of rules) if (re.test(seg)) return kind;
  // 外への送信（手元のサーバーへの送信は通す）
  if (/\bcurl\b[^\n]*(\s-X\s*(POST|PUT|PATCH|DELETE)\b|\s(-d|--data\S*|-F|--form|-T|--upload-file)\s)/i.test(seg) && !LOCAL.test(seg)) return '外への送信';
  if (/\bwget\b[^\n]*--post/i.test(seg) && !LOCAL.test(seg)) return '外への送信';
  if (/\b(ssh|scp|rsync|sftp)\b/.test(seg)) return '外への送信・サーバーの操作';
  if (/\bgit\b[^\n]*\bpush\b/.test(seg)) {
    if (project?.config.pushNeedsConfirm === false) return null;
    // Harness 自身は本番がないので、push は報告だけにする（2026-11-09）
    if (!project && where && harness && under(where, harness)) return null;
    return 'push（このフォルダの決まりで確認が要る）';
  }
  return null;
}

/** 今日の日付（手元の時刻。YYYY-MM-DD） */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** まとめて許可した記録の置き場所（AI は書けない。judgeWrite が harness-logs を止める） */
const approvedFile = (home) => join(toWin(home), '.claude', 'harness-logs', 'approved.jsonl');

/** Approval Record の鍵：場所とコマンドの一覧から作る。許可のあとで一覧を書きかえると、鍵が変わって通らない */
export const ticketKey = (t) => createHash('sha256').update(`${norm(t.path)}\n${t.commands.join('\n')}`).digest('hex').slice(0, 16);

/** この Approval Record を、Boss が今日まとめて許可したか */
export function approvedToday(t, file, date = today()) {
  if (!t || !existsSync(file)) return false;
  const key = ticketKey(t);
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.key === key && r.date === date) return true;
    } catch {
      // 読めない行は数えない
    }
  }
  return false;
}

/**
 * Approval Record から、このコマンドを含むものを探す。「- 実行するコマンド:」の行はいくつ書いてもよい（用件1つにコマンドをまとめる）。
 * 結果の文字では通さない。通すかどうかは、Boss が確認画面で許可した記録（approved.jsonl）で決める
 */
export function findTicket(command, dirs) {
  const want = command.trim();
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md') || name.startsWith('_')) continue;
      const text = readFileSync(join(dir, name), 'utf8');
      const field = (label) => text.match(new RegExp(`^[-*]\\s*${label}\\s*[:：]\\s*(.+)$`, 'm'))?.[1].trim() ?? '';
      const commands = [...text.matchAll(/^[-*]\s*実行するコマンド\s*[:：]\s*(.+)$/gm)]
        .map((m) => m[1].trim().replace(/^`+|`+$/g, '').trim())
        .filter((c) => c && c !== 'なし');
      if (commands.includes(want)) {
        return { name, path: join(dir, name), summary: field('要約'), why: field('理由'), result: field('結果'), done: field('実行済み'), commands };
      }
    }
  }
  return null;
}

// ---------- Merge と push の前の確かめ ----------

/** team/reviews/ の、verdict: 合格 の Review の commit: 欄（新しいファイルから順） */
export function passedCommits(records) {
  const dir = records && join(records, 'reviews');
  if (!dir || !existsSync(dir)) return [];
  const rows = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const file = join(dir, name);
    const text = readFileSync(file, 'utf8');
    if (!/^verdict:\s*合格/m.test(text)) continue;
    const commit = (text.match(/^commit:\s*([0-9a-f]{7,40})\b/im)?.[1] ?? '').toLowerCase();
    if (commit) rows.push({ commit, mtime: statSync(file).mtimeMs });
  }
  return rows.sort((a, b) => b.mtime - a.mtime).map((r) => r.commit);
}

/** team/reviews/ に、verdict: 合格 で、commit: 欄がこのコミットを指す Review があるか */
export function reviewPassed(sha, records) {
  if (!sha) return false;
  const full = sha.toLowerCase();
  return passedCommits(records).some((c) => full.startsWith(c));
}

/**
 * このコミットまでが Review 済みか：合格したコミットそのものか、合格したコミットのあとに記録（team/）だけを変えたコミット
 * （Review のあとで STATUS などを書いても、もう一度 Review しなくてよいように）
 */
function reviewCovers(sha, project, cwd) {
  const records = recordsOf(project);
  if (reviewPassed(sha, records)) return true;
  const rec = `${(project.config.records ?? 'team').toLowerCase()}/`;
  const git = (args) => execFileSync('git', args, { cwd: toWin(cwd), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  for (const c of passedCommits(records).slice(0, 10)) {
    try {
      git(['merge-base', '--is-ancestor', c, sha]);
      const files = git(['diff', '--name-only', c, sha]).split('\n').map((f) => f.trim().toLowerCase()).filter(Boolean);
      if (files.every((f) => f.startsWith(rec))) return true;
    } catch {
      // 祖先でない・見つからない
    }
  }
  return false;
}

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd: toWin(cwd), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** team/logs/checks.jsonl に、Done Gate がこのコミットで検査を通した記録（ok: true）があるか。書くのは Done Gate だけ */
export function checksPassed(sha, records) {
  const file = records && join(records, 'logs', 'checks.jsonl');
  if (!sha || !file || !existsSync(file)) return false;
  const want = sha.toLowerCase();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.ok === true && String(r.commit ?? '').toLowerCase() === want) return true;
    } catch {
      // 読めない行は数えない
    }
  }
  return false;
}

function revParse(ref, cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: toWin(cwd), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** 命令の言葉から、リダイレクト（2>&1・> out.txt）を外す */
function wordsNoRedirect(seg) {
  const raw = wordsOf(seg).map(unquote);
  const words = [];
  for (let i = 0; i < raw.length; i++) {
    if (/^\d*(>>?|<)/.test(raw[i])) {
      if (/^\d*(>>?|<)$/.test(raw[i])) i++; // 「> 書く先」の書く先も外す
      continue;
    }
    words.push(raw[i]);
  }
  return words;
}

/**
 * Orchestratorの git push：GitHub の main（harness.json の base）に出すときだけ、工程の区切りの Review に合格しているかを確かめる。
 * ほかのブランチへの控えの push（git push origin HEAD:wip など）は止めない（2026-11-09）
 */
function pushGate(seg, cwd, ctx) {
  const words = wordsNoRedirect(seg);
  const gi = words.indexOf('git');
  if (gi < 0 || words[gi + 1] !== 'push') return null;
  const project = ctx.projectOf(cwd);
  if (!project) return null;
  const base = project.config.base ?? 'main';
  const rest = words.slice(gi + 2);
  const args = rest.filter((w) => !w.startsWith('-'));
  const onBase = () => ctx.currentBranch(cwd) === base;
  const srcs = [];
  if (rest.includes('--all')) srcs.push(base);
  else if (args.length <= 1) {
    if (onBase()) srcs.push('HEAD');
  } else {
    for (const spec of args.slice(1)) {
      const [src, dst] = spec.replace(/^\+/, '').split(':');
      const name = (dst ?? src).replace(/^refs\/heads\//, '');
      if (name === base || (dst === undefined && src === 'HEAD' && onBase())) srcs.push(src || 'HEAD');
    }
  }
  for (const src of srcs) {
    const sha = ctx.revParse(src, cwd);
    if (!sha) return `push するもの（${src}）が見つからない`;
    if (!ctx.reviewCovers(sha, project, cwd)) {
      return `GitHub の ${base} に出す前に、工程の区切りの Review が要る。${recordsOf(project)}/reviews/ に、verdict: 合格 と commit: ${sha.slice(0, 7)}（または、そのあと ${project.config.records ?? 'team'}/ だけを変えたコミット）がない。`
        + `Reviewer に区切りの Review を頼む。控えだけなら、git push origin HEAD:wip のように別のブランチへ出す`;
    }
  }
  return null;
}

/** Orchestratorの git merge：作業のブランチなら、Done Gate の検査に通ったコミットかを確かめる（Review は区切りにまとめて行う） */
function mergeGate(seg, cwd, ctx) {
  // リダイレクト（2>&1・> out.txt）は Merge するものではないので外す
  const words = wordsNoRedirect(seg);
  const gi = words.indexOf('git');
  if (gi < 0 || words[gi + 1] !== 'merge') return null;
  const args = words.slice(gi + 2);
  if (args.some((w) => /^--(abort|continue|quit)$/.test(w))) return null;
  const project = ctx.projectOf(cwd);
  if (!project) return null;
  const refs = args.filter((w, i) => !w.startsWith('-') && !['-m', '-F'].includes(args[i - 1]));
  for (const ref of refs) {
    if (/^(origin|upstream)\//.test(ref)) continue;
    const sha = ctx.revParse(ref, cwd);
    if (!sha) return `Merge するもの（${ref}）が見つからない`;
    if (!ctx.checksPassed(sha, recordsOf(project))) {
      return `${ref}（${sha.slice(0, 7)}）は、Done Gate の検査に通った記録（${recordsOf(project)}/logs/checks.jsonl）がない。Worker の最後のコミットで Done Gate を通してから Merge する`;
    }
  }
  return null;
}

// ---------- MCP ----------

const MCP_READ = /(^|_)(get|list|read|search|query|describe|fetch|find|view|whoami|profiles|usage|guide|suggest|export)(_|$)/i;
const MCP_WRITE = /(create|publish|update|delete|send|post|write|edit|upload|respond|reply|copy|share|insert|remove|batch|pin|put|replace|resolve|declare|watch|set|execute|run)/i;
/** Orchestratorでも Boss に聞く MCP の操作：人へ送る・公開する・消す・お金・予定（招待が飛ぶ）・データベースを動かす（2026-11-09） */
const MCP_ASK = /(send|post|publish|share|reply|respond|invite|delete|remove|purchase|pay|event|execute|run)/i;

// ---------- まとめ ----------

/** フックの入力（JSON）を見て、{decision, reason} か null（ふだんの流れに任せる）を返す */
export function judge(input, opts = {}) {
  const role = roleOf(input.agent_type);
  const rawCwd = input.cwd ?? process.cwd();
  const cwd = norm(rawCwd);
  const cache = new Map();
  const ctx = {
    harness: norm(opts.harness ?? HARNESS_DIR),
    home: norm(opts.home ?? homedir()),
    tmp: norm(opts.tmp ?? tmpdir()),
    projectOf: opts.projectOf ?? ((p) => {
      const key = mainOf(norm(p));
      if (!cache.has(key)) cache.set(key, findProject(key));
      return cache.get(key);
    }),
    revParse: opts.revParse ?? revParse,
    reviewCovers: opts.reviewCovers ?? reviewCovers,
    currentBranch: opts.currentBranch ?? currentBranch,
    checksPassed: opts.checksPassed ?? checksPassed,
    approved: opts.approved ?? ((t) => approvedToday(t, approvedFile(opts.home ?? homedir()))),
  };
  const tool = input.tool_name ?? '';

  if (tool === 'PowerShell') return { decision: 'deny', reason: 'PowerShell は使わない（Guardを1組にするため）。Bash（Git Bash）で書く' };

  if (tool.startsWith('mcp__')) {
    const action = tool.split('__').pop();
    const reads = MCP_READ.test(action) && !MCP_WRITE.test(action);
    if (role !== 'orchestrator') return reads && role === 'guest' ? null : { decision: 'deny', reason: 'Worker・Reviewerは外部サービスの道具を使わない' };
    if (!reads && MCP_ASK.test(action)) return { decision: 'ask', reason: `外部サービスで、人へ送る・公開する・消すなどの操作です（${tool}）。中身を見て、よければ許してください` };
    return null;
  }

  if (tool === 'WebFetch') {
    if (role === 'worker' || role === 'reviewer') return { decision: 'deny', reason: 'Worker・Reviewerは Web を読まない（コードと外の文章を同じ役に持たせないため）' };
    return null;
  }

  if (tool === 'Bash') {
    const command = String(input.tool_input?.command ?? '');
    const bad = prohibited(command, role, ctx);
    if (bad) return { decision: 'deny', reason: `禁止：${bad}（rules/prohibited.md）` };
    const text = expand(stripText(command));
    if (role !== 'orchestrator' && /clean-worktrees\.mjs/.test(text)) {
      return { decision: 'deny', reason: 'Worktree の片付け（scripts/clean-worktrees.mjs）は Orchestrator だけが行う' };
    }
    if (role !== 'orchestrator' && INLINE_WRITE.test(text)) {
      return { decision: 'deny', reason: 'プログラムの1行（node -e など）でファイルを書かない。ファイルの道具を使う' };
    }
    let here = rawCwd;
    let asked = null;
    const home = ctx.projectOf(rawCwd);
    for (const seg of segmentsOf(text)) {
      const w = wordsOf(seg).map(unquote);
      if ((w[0] === 'cd' || w[0] === 'pushd') && w[1]) {
        here = resolve(toWin(here), toWin(w[1]));
        // 括弧で囲んだ cd（( cd 先 && … )）は、会話の居場所を変えない。cd の1つ1つについて、直前に ( があるかを見る
        const rawArg = wordsOf(seg)[1];
        const inSubshell = new RegExp(`\\(\\s*${w[0]}\\s+${escape(rawArg)}`).test(text);
        // Orchestratorが会話の居場所ごとプロジェクトの外へ移ると、WorkerのWorktreeが別のリポジトリに作られる
        if (role === 'orchestrator' && home && !inSubshell && !under(norm(here), home.root)) {
          return { decision: 'deny', reason: `会話の居場所（${home.root}）の外へ cd しない（WorkerのWorktreeが別のリポジトリに作られるため）。( cd 先 && … ) のように括弧で囲むか、git -C を使う` };
        }
        continue;
      }
      if (role !== 'orchestrator') {
        const g = gitForbidden(role, seg, here);
        if (g) return { decision: 'deny', reason: g };
      }
      if (!(role === 'orchestrator' && isWorktreeCleanup(seg, ctx))) {
        for (const target of writeTargets(seg)) {
          const r = judgeWrite(role, full(here, target), cwd, ctx, true);
          if (r?.decision === 'deny') return { decision: 'deny', reason: `${r.reason}（シェルからの書き込み：${target}）` };
        }
      }
      if (role === 'orchestrator') {
        const gate = mergeGate(seg, here, ctx) ?? pushGate(seg, here, ctx);
        if (gate) return { decision: 'deny', reason: gate };
      }
      const kind = outbound(seg, ctx.projectOf(here), norm(here), ctx.harness);
      if (kind) {
        if (role !== 'orchestrator') return { decision: 'deny', reason: `Worker・Reviewer・ほかの役は外に出る操作をしない（${kind}）` };
        asked ??= kind;
      }
    }
    if (asked) {
      const project = ctx.projectOf(here);
      const t = findTicket(command, [project && join(recordsOf(project), 'approvals')]);
      if (t && ctx.approved(t)) {
        // Boss が今日、この記録をまとめて許可した。記録に書いたコマンドなので、確認なしで通す
        return { decision: 'pass', reason: `まとめて許可済み（Approval Record：${t.name}）` };
      }
      if (!t) {
        return { decision: 'ask', reason: `外に出る操作です（${asked}）。Approval Record：なし（この1回だけの許可です）。中身を見て、よければ許してください` };
      }
      const list = t.commands.map((c, i) => `  ${i + 1}) ${c}`).join('\n');
      return {
        decision: 'ask',
        ticket: t,
        reason: `外に出る操作です（${asked}）。Approval Record：${t.name}\n要約：${t.summary || 'なし'}\n理由：${t.why || 'なし'}\n`
          + `許可すると、この記録のコマンド ${t.commands.length} つは、今日のうちは確認なしで通ります：\n${list}`,
      };
    }
    return null;
  }

  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(tool)) {
    const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!target) return null;
    const ti = input.tool_input ?? {};
    const content = [ti.content, ti.new_string, ...(ti.edits ?? []).map((e) => e?.new_string)].filter(Boolean).join('\n');
    return judgeWrite(role, full(rawCwd, target), cwd, ctx, false, content);
  }
  return null;
}

// ---------- 動かす ----------

/** 記録する場所：プロジェクトの中なら その records/logs、外なら ~/.claude/harness-logs */
function logFile(input) {
  try {
    const project = findProject(input?.cwd ?? process.cwd());
    if (project) return join(toWin(recordsOf(project)), 'logs', 'guard.jsonl');
  } catch {
    // 下へ
  }
  return join(homedir(), '.claude', 'harness-logs', 'guard.jsonl');
}

/** 記録に残すコマンド：ヒアドキュメントの中身は残さず、「どこへ書いたか」の行だけを残す（ReviewerがWorkerの言い分を先に読まないため） */
export function logText(command) {
  return String(command).replace(/(<<-?\s*(['"]?)(\w+)\2[^\n]*)\n[\s\S]*?\n\s*\3(?=\s|$)/g, '$1 …（中身は記録しない）');
}

function record(input, result) {
  try {
    const file = logFile(input);
    mkdirSync(dirname(file), { recursive: true });
    const line = JSON.stringify({
      at: new Date().toISOString(),
      decision: result?.decision ?? 'pass',
      role: roleOf(input?.agent_type),
      agent: input?.agent_type ?? null,
      tool: input?.tool_name ?? null,
      target: input?.tool_input?.file_path
        ?? (input?.tool_input?.command != null ? logText(input.tool_input.command) : null)
        ?? input?.tool_input?.url ?? null,
      cwd: input?.cwd ?? null,
      reason: result?.reason ?? null,
    });
    appendFileSync(file, `${line}\n`);
  } catch {
    // 残せなくても、判断は続ける
  }
}

function answer(result) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
      permissionDecisionReason: `【Harness Guard】${result.reason}`,
    },
  }));
}

/**
 * 道具を使ったあと（PostToolUse）：確認画面を出したコマンドが実行された＝Boss が許可した、なので、その Approval Record を
 * 「今日まとめて許可」として記録する。判断は出さない（失敗しても何も止めない）
 */
export function afterUse(input, opts = {}) {
  if (input?.tool_name !== 'Bash' || roleOf(input.agent_type) !== 'orchestrator') return null;
  const r = judge({ ...input, hook_event_name: 'PreToolUse' }, opts);
  if (r?.decision !== 'ask' || !r.ticket) return null;
  return { at: new Date().toISOString(), date: today(), key: ticketKey(r.ticket), ticket: r.ticket.path, commands: r.ticket.commands.length };
}

function mainAfter() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const row = afterUse(input);
    if (!row) return;
    const file = approvedFile(homedir());
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(row)}\n`);
  } catch {
    // 記録できなくても、操作は止めない（次のコマンドでもう一度確認が出るだけ）
  }
}

function main() {
  if (process.argv.includes('--post')) {
    mainAfter();
    return;
  }
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    const r = { decision: 'deny', reason: '入力が読めなかったので止めた（安全な方へ）' };
    record(null, r);
    answer(r);
    return;
  }
  let result;
  try {
    result = judge(input);
  } catch (e) {
    result = { decision: 'deny', reason: `Guardが判断できなかったので止めた：${e instanceof Error ? e.message : String(e)}。直すのはBossが手で（hooks/guard.mjs）` };
  }
  // Orchestratorの止めた・確認した操作と、Worker・Reviewer・ほかの役のすべての操作を残す（Reviewerが読む）
  if (result || roleOf(input.agent_type) !== 'orchestrator') record(input, result);
  if (result && result.decision !== 'pass') answer(result);
}

if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) main();
