// SessionStart hook: print the branch, uncommitted files and the open items of TASKS.md,
// so every session starts from the repository's state instead of the chat.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function git(...args) {
  const result = spawnSync('git', ['-C', projectDir, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

const lines = [];
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const changed = git('status', '--porcelain').split('\n').filter(Boolean);
lines.push(`Repository state: branch \`${branch || 'unknown'}\`, ${changed.length} uncommitted file(s).`);
if (branch === 'main') lines.push('On main: create a branch before editing (AGENTS.md, Git).');

const tasksPath = resolve(projectDir, 'TASKS.md');
if (existsSync(tasksPath)) {
  const open = readFileSync(tasksPath, 'utf8')
    .split('\n')
    .filter((line) => /^\s*- \[[ ~]\]/.test(line));
  if (open.length > 0) {
    lines.push(`Open items in TASKS.md (${open.length}):`);
    lines.push(...open.slice(0, 20));
    if (open.length > 20) lines.push(`…and ${open.length - 20} more.`);
  }
}

process.stdout.write(`${lines.join('\n')}\n`);
