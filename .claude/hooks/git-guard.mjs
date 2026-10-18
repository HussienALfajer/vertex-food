// PreToolUse hook (Bash): refuse `git commit` on main and broad staging (`git add -A`, `--all`, `.`).
// A refusal exits with code 2; the message goes back to Claude, which must use a branch or stage by path.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const command = input.tool_input?.command ?? '';

// Split chained commands so each git invocation is checked on its own.
const parts = command.split(/&&|\|\||;|\n/);

function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function currentBranch(dir) {
  const result = spawnSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

for (const part of parts) {
  const match = part.match(/\bgit\b((?:\s+-C\s+("[^"]+"|'[^']+'|\S+))?)\s+(commit|add)\b(.*)$/);
  if (!match) continue;
  const dirArg = match[2]?.replace(/^["']|["']$/g, '');
  const subcommand = match[3];
  const rest = ` ${match[4] ?? ''} `;

  if (subcommand === 'commit') {
    const branch = currentBranch(dirArg ? resolve(projectDir, dirArg) : projectDir);
    if (branch === 'main') {
      refuse(
        'Refused: never commit to main (AGENTS.md, Git). Create a branch named by type first, e.g. `git switch -c feat/<topic>`.',
      );
    }
  }

  if (subcommand === 'add' && /\s(-A|--all|\.|-u|--update)\s/.test(rest)) {
    refuse(
      'Refused: stage files by path, never `git add -A`, `--all`, `-u` or `.` (AGENTS.md, Git). Check `git status` and add the intended files.',
    );
  }
}
