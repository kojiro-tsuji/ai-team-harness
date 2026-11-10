#!/usr/bin/env node
// ハーネスがこの PC に正しく入っているかを確かめる。ハーネスのフォルダで node hooks/check-install.mjs
// - ユーザー全体の設定（~/.claude/settings.json）がGuardを呼び、落ちたら止める設定と PowerShell を止める設定があるか
// - ユーザー全体の役（~/.claude/agents/）が、ハーネスの agents/ と同じか（{{HARNESS}} を住所に置きかえて比べる）
// - projects.md のプロジェクトに .claude/harness.json があり、checks と pushNeedsConfirm が書いてあるか
// - Guardが本当に止めるか（PowerShell を渡して deny が返るか）
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const H = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = H.replace(/\\/g, '/');
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const problems = [];
const ok = [];
const check = (cond, good, bad) => (cond ? ok.push(good) : problems.push(bad));

// 1. ユーザー全体の設定
const settingsFile = join(homedir(), '.claude', 'settings.json');
if (existsSync(settingsFile)) {
  const s = JSON.parse(read(settingsFile));
  const hooks = JSON.stringify(s.hooks?.PreToolUse ?? []);
  check(hooks.includes('hooks/guard.mjs'), 'Guardのつなぎがある', '~/.claude/settings.json の PreToolUse に hooks/guard.mjs がない');
  check(/"onFailure":"block"/.test(hooks), 'Guardが落ちたら止める', 'Guardの onFailure: "block" がない');
  check(s.permissions?.deny?.includes('PowerShell'), 'PowerShell を止めている', 'deny に PowerShell がない');
  check(JSON.stringify(s.hooks?.PermissionRequest ?? []).includes('hooks/prompt-log.mjs'), '確認画面を記録している', '~/.claude/settings.json の PermissionRequest に hooks/prompt-log.mjs がない');
} else {
  problems.push('~/.claude/settings.json がない');
}

// 2. ユーザー全体の役
for (const f of readdirSync(join(H, 'agents')).filter((n) => n.endsWith('.md'))) {
  const installed = join(homedir(), '.claude', 'agents', f);
  const want = read(join(H, 'agents', f)).replaceAll('{{HARNESS}}', HARNESS);
  check(existsSync(installed) && read(installed) === want, `役 ${f} が同じ`, `~/.claude/agents/${f} がない、またはハーネスの agents/${f} と違う`);
}

// 3. プロジェクト
// 台帳 projects.md は PC ごとのもので git に入れない（ひな形は templates/projects.md）。なければ飛ばす
const ledger = join(H, 'projects.md');
const rows = existsSync(ledger) ? read(ledger).split('\n').filter((l) => /^\|\s*[^|-]/.test(l)) : [];
for (const c of rows.map((l) => l.split('|').map((x) => x.trim()))) {
  const dir = c[3]?.match(/`([A-Za-z]:\\[^`]+)`/)?.[1];
  if (!dir || !existsSync(dir)) continue;
  const file = join(dir, '.claude', 'harness.json');
  if (!existsSync(file)) {
    problems.push(`${c[1]}：.claude/harness.json がない`);
    continue;
  }
  const config = JSON.parse(read(file));
  check(Array.isArray(config.checks), `${c[1]}：検査の欄がある`, `${c[1]}：harness.json に checks がない（開発以外なら空の [] でよい）`);
  check(typeof config.pushNeedsConfirm === 'boolean', `${c[1]}：push の決まりがある`, `${c[1]}：harness.json に pushNeedsConfirm がない`);
}

// 4. Guardが本当に止めるか
try {
  const out = execFileSync('node', [join(H, 'hooks', 'guard.mjs')], { input: JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: 'ls' } }), encoding: 'utf8' });
  check(/"permissionDecision":"deny"/.test(out), 'Guardが動いて止める', 'Guardが PowerShell を止めなかった');
} catch (e) {
  problems.push(`Guardが動かなかった：${e.message}`);
}

for (const m of ok) console.log(`✔ ${m}`);
for (const m of problems) console.log(`✖ ${m}`);
process.exit(problems.length ? 1 : 0);
