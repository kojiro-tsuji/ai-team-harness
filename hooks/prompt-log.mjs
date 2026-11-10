#!/usr/bin/env node
// Claude Code 自身の確認画面が出たときに、時刻・道具・中身を ~/.claude/harness-logs/prompts.jsonl に残す（2026-11-09 論点 1）。
// PermissionRequest のフック。記録するだけで、許可・拒否は決めない（何も出力しない）。失敗しても確認画面はそのまま出る。
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX = 300; // 中身は先頭だけ（長いコマンドや秘密が丸ごと残らないように）

export function entry(input, now = new Date()) {
  const raw = input.tool_input ?? {};
  const what = raw.command ?? raw.file_path ?? raw.url ?? JSON.stringify(raw);
  return {
    time: now.toISOString(),
    tool: input.tool_name ?? '',
    what: String(what).slice(0, MAX),
    cwd: input.cwd ?? '',
    session: input.session_id ?? '',
  };
}

async function main() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const dir = join(homedir(), '.claude', 'harness-logs');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'prompts.jsonl'), JSON.stringify(entry(JSON.parse(text))) + '\n');
}

if (/prompt-log\.mjs$/.test(process.argv[1] ?? '')) {
  main().catch(() => {}).finally(() => process.exit(0));
}
