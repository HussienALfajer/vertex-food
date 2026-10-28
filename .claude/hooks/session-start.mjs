// SessionStart hook: print the branch, uncommitted and unpushed work, the work in flight on
// other branches and the open items of TASKS.md, so every session (local or cloud) starts
// from the repository's state instead of the chat.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function git(args, timeout = 5000) {
  const result = spawnSync('git', ['-C', projectDir, ...args], { encoding: 'utf8', timeout });
  return result.status === 0 ? result.stdout.trim() : '';
}

// Refresh the remote branches so work pushed from another machine shows; offline it fails quietly.
git(['fetch', '--quiet', '--prune', 'origin'], 8000);

const lines = [];
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const changed = git(['status', '--porcelain']).split('\n').filter(Boolean);
lines.push(
  `Repository state: branch \`${branch || 'unknown'}\`, ${changed.length} uncommitted file(s).`,
);
if (branch === 'main') lines.push('On main: create a branch before editing (AGENTS.md, Git).');

if (branch && branch !== 'main' && branch !== 'HEAD') {
  const counts = git(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`]);
  if (!counts) {
    lines.push(`Branch \`${branch}\` is not on origin: push it so another session can continue.`);
  } else {
    const [behind, ahead] = counts.split(/\s+/).map(Number);
    if (behind > 0) lines.push(`Behind origin/${branch} by ${behind} commit(s): pull first.`);
    if (ahead > 0) lines.push(`${ahead} commit(s) not pushed to origin/${branch}.`);
  }
}

const inFlight = git(['branch', '-r', '--no-merged', 'origin/main', '--format=%(refname:short)'])
  .split('\n')
  .filter((name) => name && name !== 'origin/HEAD');
if (inFlight.length > 0) {
  lines.push(`Branches on origin not merged into main: ${inFlight.join(', ')}.`);
}

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
