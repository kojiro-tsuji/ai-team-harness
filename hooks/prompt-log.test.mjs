import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entry } from './prompt-log.mjs';

const now = new Date('2026-11-09T00:00:00Z');

test('Bash はコマンドを残す', () => {
  const e = entry({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: 'C:/p', session_id: 's1' }, now);
  assert.deepEqual(e, { time: '2026-11-09T00:00:00.000Z', tool: 'Bash', what: 'git status', cwd: 'C:/p', session: 's1' });
});

test('Write はファイルの場所だけを残す（中身は残さない）', () => {
  const e = entry({ tool_name: 'Write', tool_input: { file_path: 'C:/p/a.md', content: 'secret' } }, now);
  assert.equal(e.what, 'C:/p/a.md');
});

test('長い中身は 300 文字で切る', () => {
  const e = entry({ tool_name: 'Bash', tool_input: { command: 'x'.repeat(1000) } }, now);
  assert.equal(e.what.length, 300);
});
