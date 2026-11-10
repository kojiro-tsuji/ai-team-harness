// Guard（guard.mjs）のテスト。ハーネスのフォルダで node --test hooks/*.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { afterUse, approvedToday, checksPassed, judge, logText, norm, reviewPassed, segmentsOf, ticketKey } from './guard.mjs';

// Harness の住所は、Guard と同じくこのファイルの場所から求める（どこに置いてもテストが通るように）
const H = resolve(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
const HOME = 'C:/Users/user';
const TMP = 'C:/Users/user/AppData/Local/Temp';
const MAIN = 'C:/Users/user/dev/apps/sample-app';
const WT = `${MAIN}/.claude/worktrees/agent-abc`;
const OTHER_WT = `${MAIN}/.claude/worktrees/agent-xyz`;
const TEAM = `${MAIN}/team`;
const AUDIT = `${TEAM}/reviews/T-001.md`;
const REPORT = `${TEAM}/handoffs/T-001.md`;
const TASK = `${TEAM}/tasks/T-001.md`;
const W = 'worker';
const A = 'reviewer';
const G = 'general-purpose';

let config = { pushNeedsConfirm: false };
let head = 'abc1234def'; // 手元の main の先端（abc1234 は Review 済み）
let branch = 'main';
const projectOf = (p) => (norm(p).startsWith(norm(MAIN)) ? { root: norm(MAIN), config } : null);
const opts = {
  harness: H, home: HOME, tmp: TMP, projectOf,
  revParse: (ref) => ({ HEAD: head, main: head, 'worktree-agent-abc': 'abc1234def', 'worktree-agent-bad': 'bad9999000', 'worktree-agent-nochk': 'ccc5555000' })[ref] ?? null,
  reviewCovers: (sha) => sha.startsWith('abc1234'),
  currentBranch: () => branch,
  checksPassed: (sha) => sha.startsWith('abc1234'),
};
const run = (agent, tool, input, cwd = MAIN) => judge({ agent_type: agent, tool_name: tool, cwd, tool_input: input }, opts);
const edit = (agent, file, cwd = MAIN) => run(agent, 'Edit', { file_path: file }, cwd);
const bash = (agent, command, cwd = MAIN) => run(agent, 'Bash', { command }, cwd);

function denied(r, part) {
  assert.equal(r?.decision, 'deny', JSON.stringify(r));
  if (part) assert.match(r.reason, part);
}
function asked(r, part) {
  assert.equal(r?.decision, 'ask', JSON.stringify(r));
  if (part) assert.match(r.reason, part);
}
const passes = (r) => assert.equal(r, null, JSON.stringify(r));

test('PowerShell：道具もシェルからも止める。文字列の中の言葉では止めない', () => {
  denied(run(undefined, 'PowerShell', { command: 'ls' }), /PowerShell/);
  denied(bash(undefined, 'powershell -c "ls"'), /PowerShell/);
  denied(bash(undefined, 'timeout 10 pwsh.exe -c ls'), /PowerShell/);
  denied(bash(undefined, 'cmd //c "powershell -c ls"'), /PowerShell/);
  passes(bash(undefined, 'git commit -m "docs: PowerShell を止める"'));
  passes(bash(undefined, `echo '{"tool_name":"PowerShell"}' | node hooks/guard.mjs`));
});

test('禁止：一括削除・変更を捨てる・強制 push（抜け道も）', () => {
  for (const c of [
    'rm -rf apps', 'rm -r -f apps', 'rm --recursive apps', 'find . -name x -exec rm -rf {} +', 'ls | xargs rm -rf',
    'command rm -rf apps', 'bash -c "rm -rf apps"', "sh -c 'rm -r apps'", 'eval "rm -rf apps"',
    "cat <<EOF | sh\nrm -rf apps\nEOF", 'echo -m "$(rm -rf apps)"',
    'cmd //c rmdir /s /q C:\\x', 'del /s /q x', 'find . -delete', 'node -e "fs.rmSync(\'a\',{recursive:true})"',
    'git clean -fd', 'git reset --hard', 'git reset -q --hard', 'git checkout -- .', 'git checkout .', 'git checkout -f main',
    'git switch --discard-changes main', 'git restore a.ts', 'git branch -D x', 'git stash clear',
    'git push --force', 'git push -f origin main', 'git push origin +main', 'git push origin --delete main',
    'git push origin :main', 'git push --mirror', 'echo "DROP TABLE users" | sqlite3', 'printenv', 'env',
    'cat .env', 'cat apps/api/.dev.vars', 'base64 apps/api/.dev.vars', 'cp .dev.vars x', 'cat ~/.ssh/id_ed25519',
    'cat "C:/Users/user/AppData/Roaming/xdg.config/.wrangler/config/default.toml"',
  ]) {
    denied(bash(undefined, c), /禁止/);
  }
});

test('禁止に当たらないもの', () => {
  for (const c of [
    'rm a.txt', 'git rm -r --cached x', 'git restore --staged a.ts', 'git branch -d done', 'git checkout -b feat',
    'git status', 'pnpm typecheck && pnpm lint', 'node --test hooks/', 'ls -a', 'git add .gitignore',
    "git commit -F - <<'EOF'\nfix: rm -rf の説明\nEOF", 'cat .env.example',
  ]) {
    assert.notEqual(bash(undefined, c)?.decision, 'deny', c);
  }
});

test('ヒアドキュメントで守りの設定に書くのは止める', () => {
  denied(bash(undefined, `cat <<'EOF' > "${MAIN}/.claude/settings.json"\n{}\nEOF`), /シェル/);
  denied(bash(W, `cat <<EOF > "${MAIN}/apps/a.ts"\nx\nEOF`, WT), /Worktree/);
});

test('例外：Worktreeの片付けは、Orchestratorが本体のWorktreeの住所を文字で書いたときだけ', () => {
  const ok = 'cmd //c \'rmdir /s /q "\\\\?\\C:\\Users\\user\\dev\\apps\\sample-app\\.claude\\worktrees\\agent-abc"\'';
  passes(bash(undefined, ok));
  denied(bash(W, ok, WT), /禁止/);
  denied(bash(undefined, 'cmd //c "rmdir /s /q C:\\Users\\user\\dev\\apps\\sample-app\\apps"'), /禁止/);
  denied(bash(undefined, 'cmd //c "rmdir /s /q C:\\x\\.claude\\worktrees\\%NAME%"'), /禁止/);
  denied(bash(undefined, 'cmd //c "rmdir /s /q C:\\Users\\user\\dev\\apps\\sample-app\\.claude\\worktrees\\a\\..\\..\\.."'), /禁止/);
  denied(bash(undefined, 'cmd //c "rmdir /s /q C:\\Users\\user\\.claude\\worktrees\\x"'), /禁止/);
});

test('Orchestrator：コードと記録は書けるが、Review・Handoff・Guard Log は書けない', () => {
  passes(edit(undefined, `${MAIN}/apps/mobile/src/a.ts`));
  passes(edit(undefined, TASK));
  passes(edit(undefined, `${TEAM}/STATUS.md`));
  passes(edit(undefined, `${H}/decisions/2026-11-08-x.md`));
  passes(edit(undefined, `${HOME}/.claude/projects/x/memory/a.md`));
  denied(edit(undefined, AUDIT), /Reviewer だけ/);
  denied(edit(undefined, REPORT), /Worker だけ/);
  denied(edit(undefined, `${TEAM}/logs/guard.jsonl`), /Guardだけ/);
  denied(bash(undefined, `echo x > "${AUDIT}"`), /Reviewer だけ/);
});

test('守りの要（Guard・User scope の設定）だけ Orchestrator も確認。ほかの守りの設定は確認なし（2026-11-09）', () => {
  for (const f of [
    `${H}/hooks/guard.mjs`, `${H}/hooks/done-check.mjs`, `${HOME}/.claude/settings.json`, `${HOME}/.claude/settings.local.json`,
    `${HOME}/.claude/hooks/x.mjs`, `${HOME}/.claude.json`, `${MAIN}/.git/hooks/pre-commit`,
  ]) {
    asked(edit(undefined, f), /守りの要/);
  }
  for (const f of [
    `${MAIN}/.claude/settings.json`, `${MAIN}/.claude/harness.json`, `${MAIN}/CLAUDE.md`, `${MAIN}/.mcp.json`,
    `${MAIN}/.git/config`, `${H}/rules/limits.md`, `${H}/agents/reviewer.md`, `${H}/hooks/guard.test.mjs`,
    `${H}/departments/dev.md`, `${H}/CLAUDE.md`, `${H}/templates/user/CLAUDE.md`, `${H}/templates/user/settings.json`,
    `${HOME}/.claude/CLAUDE.md`, `${HOME}/.claude/agents/worker.md`,
  ]) {
    passes(edit(undefined, f));
  }
  // プロジェクトの設定でも、フックを足す・止める書きかえは確認（Guard を止められないように）
  asked(run(undefined, 'Edit', { file_path: `${MAIN}/.claude/settings.json`, new_string: '"disableAllHooks": true' }), /守りの要/);
  asked(run(undefined, 'Write', { file_path: `${MAIN}/.claude/settings.json`, content: '{ "hooks": {} }' }), /守りの要/);
  passes(run(undefined, 'Write', { file_path: `${MAIN}/.claude/settings.json`, content: '{ "permissions": {} }' }));
  // 設定ファイルと守りの要は、シェルからは変えない
  denied(bash(undefined, `echo x > "${MAIN}/.claude/settings.json"`), /シェル/);
  denied(bash(undefined, `echo x > "${H}/hooks/guard.mjs"`), /シェル/);
  passes(bash(undefined, `sed -i 's/a/b/' "${H}/rules/limits.md"`));
  // Worker・Reviewer・ほかの役は、守りの設定をすべて変えない
  denied(edit(W, `${WT}/.claude/settings.json`, WT), /守りの設定/);
  denied(edit(W, `${WT}/CLAUDE.md`, WT), /守りの設定/);
  passes(edit(W, `${WT}/apps/a.ts`, WT));
});

test('Worker：Worktreeと、本体の記録の handoffs・proposals・investigations だけ', () => {
  passes(edit(W, `${WT}/apps/mobile/src/a.ts`, WT));
  passes(edit(W, 'apps/a.ts', `${WT}/apps/mobile`));
  passes(edit(W, REPORT, WT));
  passes(edit(W, `${TEAM}/proposals/P-009.html`, WT));
  passes(edit(W, `${TMP}/x.txt`, WT));
  denied(edit(W, `${WT}/team/handoffs/T-001.md`, WT), /写し/);
  denied(edit(W, `${MAIN}/apps/a.ts`, WT), /Worktree/);
  denied(edit(W, `${OTHER_WT}/apps/a.ts`, WT), /Worktree/);
  denied(edit(W, TASK, WT), /Worktree/);
  denied(edit(W, AUDIT, WT), /Worktree/);
  denied(edit(W, `${MAIN}/a.ts`, MAIN), /Worktree/);
  passes(edit(W, `${WT.replace(/^C:/, 'c:')}/a.ts`, WT));
});

test('Worker：Worktreeの外へ出る書き方・git・外に出る操作を止める', () => {
  denied(bash(W, `cd "${MAIN}" && echo x > apps/a.ts`, WT), /Worktree/);
  denied(bash(W, 'cd ../agent-xyz && echo x > a.ts', WT), /Worktree/);
  denied(bash(W, `cp -t "${MAIN}/apps" a.ts`, WT), /Worktree/);
  denied(bash(W, 'node -e "require(\'fs\').writeFileSync(\'../../../x\',\'y\')"', WT), /プログラム/);
  denied(bash(W, 'git push origin task', WT), /push/);
  denied(bash(W, 'git merge main', WT), /merge/);
  denied(bash(W, 'git checkout main', WT), /main/);
  denied(bash(W, 'git worktree remove x', WT), /worktree/);
  denied(bash(W, 'git update-ref refs/heads/main HEAD', WT), /update-ref/);
  denied(bash(W, 'git config core.hooksPath x', WT), /config/);
  denied(bash(W, 'git -c a=b commit -m x', WT), /-c/);
  denied(bash(W, `git -C "${MAIN}" commit -am x`, WT), /外の git/);
  denied(bash(W, 'curl -X POST https://example.com -d x', WT), /外に出る/);
  denied(bash(W, 'pnpm --filter api run deploy', WT), /外に出る/);
  denied(run(W, 'mcp__claude-artifacts__publish_version', {}, WT), /外部サービス/);
  denied(run(W, 'WebFetch', { url: 'https://example.com' }, WT), /Web/);
  passes(bash(W, 'git commit -m "feat: x"', WT));
  passes(bash(W, 'pnpm install && pnpm typecheck', WT));
  passes(bash(W, 'echo hi > notes.txt', WT));
  passes(bash(W, 'node -e "console.log(1)"', WT));
});

test('Reviewer：本体の reviews だけ書け、git は読むだけ', () => {
  passes(edit(A, AUDIT, WT));
  denied(edit(A, `${WT}/team/reviews/T-001.md`, WT), /写し/);
  denied(edit(A, `${WT}/apps/a.ts`, WT), /Reviewer が書けるのは/);
  denied(edit(A, REPORT, WT), /Reviewer が書けるのは/);
  passes(bash(A, 'git checkout --detach abc123', WT));
  denied(bash(A, 'git checkout --detach abc123', MAIN), /git/); // 本体（Worktree なし）では切りかえない
  passes(bash(A, 'git diff --stat main...abc123', MAIN));
  passes(bash(A, 'git show abc123:apps/a.ts', MAIN));
  passes(edit(A, AUDIT, MAIN));
  denied(edit(A, `${MAIN}/apps/a.ts`, MAIN), /Reviewer が書けるのは/);
  passes(bash(A, 'git diff --stat main...abc123', WT));
  passes(bash(A, 'git log --oneline -3', WT));
  passes(bash(A, 'pnpm install && pnpm test', WT));
  denied(bash(A, 'git commit -m x', WT), /git/);
  denied(bash(A, 'git checkout main', WT), /git/);
  denied(bash(A, 'git stash', WT), /git/);
  denied(bash(A, 'echo x > apps/a.ts', WT), /Reviewer が書けるのは/);
  passes(bash(A, `cat out.txt > "${AUDIT}"`, WT));
});

test('知らない役（調べ物など）は、いちばん弱い権限', () => {
  denied(edit(G, TASK), /名前のない役/);
  denied(edit(G, `${MAIN}/apps/a.ts`), /名前のない役/);
  denied(bash(G, 'git commit -m x'), /名前のない役/);
  denied(bash(G, 'npx wrangler deploy'), /外に出る/);
  passes(edit(G, `${TMP}/notes.md`));
  passes(bash(G, 'git log --oneline -5'));
  passes(run(G, 'WebFetch', { url: 'https://example.com' }));
  passes(run(G, 'mcp__claude_ai_Google_Calendar__list_events', {}));
  denied(run(G, 'mcp__claude_ai_Google_Calendar__create_event', {}), /外部サービス/);
});

test('本当に危ない外に出る操作だけ Approval Gate を出す（記録の文字では通さない）', () => {
  asked(bash(undefined, 'npx wrangler deploy'), /本番への反映.*Approval Record：なし/);
  asked(bash(undefined, 'npx wrangler deploy --env dev-prod'), /本番への反映/);
  asked(bash(undefined, 'npx wrangler d1 execute db --remote'), /本番データ/);
  asked(bash(undefined, 'pnpm deploy'), /本番への反映/);
  asked(bash(undefined, 'cd apps/api && pnpm upload-packs'), /本番への反映/);
  asked(bash(undefined, 'eas submit -p ios'), /ストア/);
  asked(bash(undefined, 'eas update --branch production'), /本番への反映/);
  asked(bash(undefined, 'npm publish'), /公開/);
  asked(bash(undefined, 'gh repo edit --visibility public'), /公開/);
  asked(bash(undefined, 'npx wrangler secret put KEY'), /鍵/);
  asked(bash(undefined, 'stripe prices create --unit-amount 500'), /お金/);
  asked(bash(undefined, 'curl -d x https://example.com'), /外への送信/);
  asked(bash(undefined, 'ssh user@server ls'), /外への送信/);
});

test('聞かなくなったもの（2026-11-09）：開発用サーバー・パッケージの追加・EAS のビルド・PR・手元への送信', () => {
  for (const c of [
    'npx wrangler deploy --env dev', 'npx wrangler d1 execute db --remote --env dev', 'pnpm deploy:dev',
    'pnpm add zod', 'pnpm --filter mobile add -D jest', 'npm install --save-dev foo', 'npm i @scope/pkg',
    'npx expo install expo-haptics', 'pnpm install', 'pnpm install --frozen-lockfile 2>&1 | tail -3', 'npx expo install --check',
    'eas build -p android --profile development', 'eas whoami', 'gh pr create --fill', 'gh pr merge 3 --squash',
    'curl -s http://localhost:8081/status', 'curl -X POST http://localhost:8787/api -d x', 'git add team/STATUS.md',
  ]) {
    passes(bash(undefined, c));
  }
  denied(bash(W, 'npx wrangler deploy', WT), /外に出る/); // Worker は外に出る操作をしない
});

test('Approval Record：用件1つにコマンドをまとめ、確認画面に一覧・要約・理由を出す', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-'));
  mkdirSync(join(root, 'team', 'approvals'), { recursive: true });
  const c1 = 'npx wrangler d1 migrations apply db --remote';
  const c2 = 'npx wrangler deploy';
  writeFileSync(join(root, 'team', 'approvals', '2026-11-08-01-deploy.md'),
    `- 要約: 本番の API を更新\n- 理由: 新しい画面が API を使うため\n- 実行するコマンド: \`${c1}\`\n- 実行するコマンド: \`${c2}\`\n- 結果: 承認\n`);
  const projectAt = () => ({ root: norm(root), config: {} });
  const ask = (cmd, approved) => judge({ tool_name: 'Bash', cwd: root, tool_input: { command: cmd } },
    { ...opts, projectOf: projectAt, approved: () => approved });
  // まだ許可していない：記録の「結果：承認」の文字では通さず、確認を出す
  const r = ask(c2, false);
  asked(r, /Approval Record：2026-11-08-01-deploy\.md/);
  assert.match(r.reason, /本番の API を更新/);
  assert.match(r.reason, /新しい画面が API を使うため/);
  assert.match(r.reason, /コマンド 2 つ/);
  assert.ok(r.reason.includes(c1) && r.reason.includes(c2));
  // Boss が今日まとめて許可した：記録に書いたコマンドは通す
  assert.equal(ask(c1, true)?.decision, 'pass');
  assert.equal(ask(c2, true)?.decision, 'pass');
  // 記録に書いていないコマンドは、また聞く
  asked(ask('npx wrangler deploy --minify', true), /Approval Record：なし/);
});

test('まとめての許可：確認のあと実行されたら記録し、今日・同じ一覧のときだけ通す', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-'));
  const dir = join(root, 'team', 'approvals');
  mkdirSync(dir, { recursive: true });
  const cmd = 'npx wrangler deploy';
  const file = join(dir, '2026-11-09-01-deploy.md');
  writeFileSync(file, `- 要約: 本番\n- 実行するコマンド: \`${cmd}\`\n`);
  const projectAt = () => ({ root: norm(root), config: {} });
  const input = { tool_name: 'Bash', cwd: root, tool_input: { command: cmd } };
  const row = afterUse(input, { ...opts, projectOf: projectAt, approved: () => false });
  assert.ok(row?.key);
  const log = join(root, 'approved.jsonl');
  writeFileSync(log, `${JSON.stringify(row)}\n`);
  const t = { path: file, commands: [cmd] };
  assert.equal(approvedToday(t, log, row.date), true);
  assert.equal(approvedToday(t, log, '2000-01-01'), false); // 日が変わったら、また聞く
  assert.equal(approvedToday({ path: file, commands: [cmd, 'npx wrangler secret put X'] }, log, row.date), false); // 許可のあとで一覧を足したら通さない
  assert.equal(ticketKey(t), row.key);
  // 確認を出さないコマンド・Worker の操作は記録しない
  assert.equal(afterUse({ ...input, tool_input: { command: 'git status' } }, { ...opts, projectOf: projectAt }), null);
  assert.equal(afterUse({ ...input, agent_type: W }, { ...opts, projectOf: projectAt }), null);
  // まとめての許可の記録は、AI が書けない
  denied(edit(undefined, `${HOME}/.claude/harness-logs/approved.jsonl`), /Guardだけ/);
});

test('Orchestratorは会話の居場所ごとプロジェクトの外へ cd しない', () => {
  denied(bash(undefined, `cd "${H}" && git status`), /居場所/);
  denied(bash(undefined, `cd "${H}"`), /居場所/);
  passes(bash(undefined, `(cd "${H}" && git status)`));
  passes(bash(undefined, `ls; (cd "${H}" && node hooks/check-install.mjs)`)); // 途中の括弧つき cd も通す
  denied(bash(undefined, `(git status); cd "${H}"`), /居場所/); // 括弧の外の cd は止める
  passes(bash(undefined, 'cd apps/mobile && npx jest'));
  passes(bash(undefined, `cd "${MAIN}" && git status`, H)); // プロジェクトの外からなら移ってよい
  passes(bash(W, 'cd apps/mobile && npx jest', WT));
});

test('push：入った先のフォルダの決まりに従う', () => {
  passes(bash(undefined, 'git push origin main'));
  passes(bash(undefined, `cd "${MAIN}" && git push`, H));
  passes(bash(undefined, 'git push', H)); // Harness 自身は本番がないので報告だけ（2026-11-09）
  passes(bash(undefined, `(cd "${H}" && git push)`));
  asked(bash(undefined, 'git push', 'C:/Users/user/Desktop/other'), /push/); // 決まりの分からないフォルダは聞く
  config = { pushNeedsConfirm: true };
  asked(bash(undefined, 'git push origin main'), /push/);
  config = { pushNeedsConfirm: false };
});

test('Merge：手元の main には、Done Gate の検査に通ったコミットなら入れられる（Review は区切りにまとめて）', () => {
  passes(bash(undefined, 'git merge --no-ff worktree-agent-abc'));
  denied(bash(undefined, 'git merge --no-ff worktree-agent-bad'), /Done Gate/);
  denied(bash(undefined, 'git merge nothing-here'), /見つからない/);
  passes(bash(undefined, 'git merge origin/main'));
  passes(bash(undefined, 'git merge --abort'));
  denied(bash(undefined, 'git merge --no-ff worktree-agent-nochk'), /Done Gate/);
});

test('Merge：複数行のメッセージの続きを、Merge するものと読まない', () => {
  passes(bash(undefined, 'git merge --no-ff worktree-agent-abc -m "feat: 吸い込み（T-006）\n\nCo-Authored-By: Claude <noreply@anthropic.com>"'));
  passes(bash(undefined, "git merge --no-ff worktree-agent-abc -m 'feat: a; b | c\n\nd'"));
  denied(bash(undefined, 'git merge --no-ff worktree-agent-bad -m "feat: x\n\ny"'), /Done Gate/);
  denied(bash(undefined, 'git merge -m "ok" worktree-agent-abc worktree-agent-bad'), /Done Gate/);
});

test('Merge：2>&1 や > の書く先を、Merge するものと読まない', () => {
  passes(bash(undefined, 'git merge --no-ff worktree-agent-abc -m "feat: x" 2>&1 | tail -3'));
  passes(bash(undefined, 'git merge --no-ff worktree-agent-abc > out.txt'));
  denied(bash(undefined, 'git merge --no-ff worktree-agent-bad 2>&1'), /Done Gate/);
});

test('push：GitHub の main に出すときだけ、区切りの Review の合格を求める。控えのブランチは止めない', () => {
  head = 'fff0000111'; // Review していない先端
  for (const c of ['git push', 'git push origin', 'git push origin main', 'git push origin HEAD', 'git push origin HEAD:main',
    'git push -u origin main 2>&1 | tail -2', 'git push --all origin']) {
    denied(bash(undefined, c), /区切りの Review/);
  }
  for (const c of ['git push origin HEAD:wip', 'git push origin feature-x', 'git push origin main:wip']) {
    passes(bash(undefined, c));
  }
  branch = 'wip';
  passes(bash(undefined, 'git push')); // main 以外のブランチにいるとき
  branch = 'main';
  head = 'abc1234def'; // Review 済み（またはそのあと team/ だけ）
  passes(bash(undefined, 'git push origin main'));
  passes(bash(undefined, 'git push', H)); // Harness には区切りの Review はない
});

test('検査の記録は、Done Gate の ok: true とコミットの一致で読む', () => {
  const dir = mkdtempSync(join(tmpdir(), 'team-'));
  mkdirSync(join(dir, 'logs'));
  writeFileSync(join(dir, 'logs', 'checks.jsonl'),
    `${JSON.stringify({ commit: 'abc1234def', ok: true })}\n${JSON.stringify({ commit: 'bad9999000', ok: false })}\nこわれた行\n`);
  assert.equal(checksPassed('abc1234def', dir), true);
  assert.equal(checksPassed('abc1234', dir), false); // 全部のハッシュで比べる
  assert.equal(checksPassed('bad9999000', dir), false);
  assert.equal(checksPassed('abc1234def', join(dir, 'none')), false);
});

test('引用符の中では区切らない。引用符が合わないときは前の読み方で止める', () => {
  assert.deepEqual(segmentsOf('git commit -m "a; b\nc" && git log'), ['git commit -m "a; b\nc"', 'git log']);
  assert.deepEqual(segmentsOf("echo 'x | y'; ls"), ["echo 'x | y'", 'ls']);
  denied(bash(W, `echo "it's" ; rm -rf apps`, WT), /一括削除/);
  denied(bash(W, `echo don't && rm -rf apps`, WT), /一括削除/); // 引用符が合わない
  denied(bash(W, 'bash -c "cd x && rm -rf y"', WT), /一括削除/); // 引用符の中で動かす命令は見る
  denied(bash(W, 'echo "$(rm -rf y)"', WT), /一括削除/);
});

test('片付けの手順は Orchestrator だけ', () => {
  passes(bash(undefined, `node "${H}/scripts/clean-worktrees.mjs"`));
  denied(bash(W, `node "${H}/scripts/clean-worktrees.mjs" --yes`, WT), /Orchestrator だけ/);
  denied(bash(A, `node "${H}/scripts/clean-worktrees.mjs" --yes`), /Orchestrator だけ/);
});

test('Review の合格は、verdict: 合格 と commit: 欄の一致で読む', () => {
  const dir = mkdtempSync(join(tmpdir(), 'team-'));
  mkdirSync(join(dir, 'reviews'));
  writeFileSync(join(dir, 'reviews', 'T-001.md'), '---\nverdict: 合格\ncommit: abc1234\n---\n');
  writeFileSync(join(dir, 'reviews', 'T-002.md'), '---\nverdict: 不合格\ncommit: def5678\n---\n');
  // 本文のどこかにハッシュがあるだけでは通さない
  writeFileSync(join(dir, 'reviews', 'T-003.md'), '---\nverdict: 合格\ncommit: 1111111\n---\n参考：0123abcd を見た\n');
  assert.equal(reviewPassed('abc1234ffff', dir), true);
  assert.equal(reviewPassed('def5678ffff', dir), false);
  assert.equal(reviewPassed('0123abcdeeee', dir), false);
  assert.equal(reviewPassed('9999999', dir), false);
});

test('区切りの Review：合格のあとで team/ だけを変えたコミットも、Review 済みとみなす（本物の git で）', () => {
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  mkdirSync(join(root, 'team', 'reviews'), { recursive: true });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), '1');
  git('add', '.');
  git('commit', '-qm', 'a');
  const reviewed = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'team', 'reviews', 'S-001.md'), `---\nverdict: 合格\ncommit: ${reviewed.slice(0, 7)}\n---\n`);
  writeFileSync(join(root, 'team', 'STATUS.md'), 'x');
  git('add', '.');
  git('commit', '-qm', 'docs: STATUS');
  const project = { root: norm(root), config: { pushNeedsConfirm: false } };
  const o = { ...opts, projectOf: () => project, revParse: undefined, reviewCovers: undefined, currentBranch: undefined };
  const push = () => judge({ tool_name: 'Bash', cwd: root, tool_input: { command: 'git push origin main' } }, o);
  passes(push()); // team/ だけの変更は通す
  writeFileSync(join(root, 'src', 'a.ts'), '2');
  git('add', '.');
  git('commit', '-qm', 'feat: b');
  denied(push(), /区切りの Review/); // コードが変わったら、もう一度 Review
});

test('プログラムの中の => や > を、書き込みと読み違えない', () => {
  passes(bash(undefined, `node -e "const f = (x) => x; console.log(f(1) > 0)"`));
  passes(bash(undefined, `node scripts/links.mjs "${H}"`));
  denied(bash(undefined, `node -e "1" > "${MAIN}/.claude/settings.json"`), /シェル/); // 外のリダイレクトは見る
  // Reviewer が計算で確かめるとき（式の中に ; があっても、ちぎって読まない）
  passes(bash(A, `node -e "const v = [1,2].filter((x) => x >= 2); console.log(v.length > 0)"`));
});

test('引用符の中の > を書き込みと読まない。> の後ろの引用符は書く先として見る', () => {
  passes(bash(W, `sed -n '/<script>/,/<\\/script>/p' "${TEAM}/proposals/P-005.html"`, WT));
  passes(bash(W, `grep -o '<link[^>]*href="[^"]*"' "${TEAM}/proposals/P-005.html"`, WT));
  denied(bash(W, `echo x > "${TEAM}/tasks/T-001.md"`, WT), /Worker が書けるのは/);
  denied(bash(W, `grep "<a>" x > '${MAIN}/apps/a.ts'`, WT), /Worker が書けるのは/);
});

test('Worker は本体の proposals フォルダそのものを mkdir できる。ほかのフォルダは作れない', () => {
  passes(bash(W, `mkdir -p "${TEAM}/proposals"`, WT));
  passes(bash(W, `mkdir -p "${TEAM}/investigations"`, WT));
  denied(bash(W, `mkdir -p "${TEAM}/proposals-x"`, WT), /Worker が書けるのは/);
  denied(bash(W, `mkdir -p "${TEAM}/tasks"`, WT), /Worker が書けるのは/);
});

test('Harness：Orchestrator は Guard 以外を確認なしで直せる。Worker は Harness を書かない', () => {
  for (const f of ['README.md', 'projects.md', 'templates/task.md', 'decisions/2026-11-09-x.md', 'rules/defense.md',
    'departments/dev.md', 'agents/worker.md', 'CLAUDE.md', 'templates/user/settings.json']) {
    passes(edit(undefined, `${H}/${f}`));
  }
  asked(edit(undefined, `${H}/hooks/guard.mjs`), /守りの要/);
  denied(edit(W, `${H}/README.md`, WT));
  denied(edit(W, `${H}/rules/defense.md`, WT));
});

test('MCP：人へ送る・公開する・消す・予定・データベースは確認、ほかは通す', () => {
  asked(run(undefined, 'mcp__claude-artifacts__publish_version', {}), /外部サービス/);
  asked(run(undefined, 'mcp__x__execute_sql', {}), /外部サービス/);
  asked(run(undefined, 'mcp__claude_ai_Google_Calendar__create_event', {}), /外部サービス/);
  asked(run(undefined, 'mcp__slack__send_message', {}), /外部サービス/);
  asked(run(undefined, 'mcp__claude_ai_Claude_Docs__delete', {}), /外部サービス/);
  passes(run(undefined, 'mcp__claude-artifacts__db_str_replace', {}));
  passes(run(undefined, 'mcp__claude_ai_Claude_Docs__update', {}));
  passes(run(undefined, 'mcp__claude-artifacts__read_artifact', {}));
  passes(run(undefined, 'mcp__claude_ai_Google_Calendar__list_events', {}));
});

test('Guardの記録には、ヒアドキュメントの中身を残さない', () => {
  const cmd = `cat > "${REPORT}" <<'EOF'\n# 作業報告\n全部できました\nEOF`;
  const t = logText(cmd);
  assert.match(t, /cat > ".*T-001\.md" <<'EOF'/);
  assert.doesNotMatch(t, /全部できました/);
  assert.equal(logText('git status'), 'git status');
});

test('/c/... の形のパスも同じに見る', () => {
  denied(edit(undefined, AUDIT.replace(/^C:/i, '/c')), /Reviewer だけ/);
});
