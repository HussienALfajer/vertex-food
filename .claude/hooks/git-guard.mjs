// PreToolUse hook (Bash): refuse `git commit` on main, pushing to main, and broad staging
// (`git add -A`, `--all`, `-u`, `.`, `:/`). A refusal exits with code 2; the message goes back to
// Claude, which must use a branch, push its own branch, or stage by path.
// Tested by `packages/config/test/git-guard.test.ts`, which pipes commands into this file.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const command = input.tool_input?.command ?? '';

// Global options of `git` that take the next word as their value (`git -C dir commit`).
const OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
]);
// Flags after which a shell takes a script (`bash -c`, `sh -lc`, `pwsh -Command`, `cmd /c`).
const SCRIPT_FLAGS = new Set(['-c', '-lc', '-ic', '-Command', '-command', '/c', '/C']);
// Pathspecs that stage the whole tree.
const WHOLE_TREE = new Set(['.', './', '*', ':', ':/', ':/.', ':/*']);

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

/** Splits a command line into chained parts, outside quotes: `&&`, `||`, `|`, `;`, `&`, newline. */
function splitChain(line) {
  const parts = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      else if (char === '\\' && quote === '"' && i + 1 < line.length) current += line[++i];
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === '\\' && i + 1 < line.length) {
      current += char + line[++i];
    } else if (';&|\n'.includes(char)) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Shell-like words with quotes removed (`"."` → `.`); `$(…)` and backticks are left as text. */
function words(part) {
  const result = [];
  let current = '';
  let started = false;
  let quote = '';
  for (let i = 0; i < part.length; i++) {
    const char = part[i];
    if (quote) {
      if (char === quote) quote = '';
      // Inside double quotes a backslash escapes only `"`, `\`, `$` and a backtick, as in bash, so
      // a Windows path keeps its backslashes.
      else if (char === '\\' && quote === '"' && '"\\$`'.includes(part[i + 1] ?? ''))
        current += part[++i];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && i + 1 < part.length) {
      current += part[++i];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) result.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) result.push(current);
  return result;
}

const isGit = (word) => /(^|[\\/])git(\.exe)?$/i.test(word.replace(/^[(`]|^\$\(/, ''));

/** A pushed refspec whose destination is `main` (`main`, `+main`, `HEAD:main`, `:main`, `refs/heads/main`). */
function targetsMain(refspec) {
  const destination = refspec.replace(/^\+/, '').split(':').pop() ?? '';
  return destination === 'main' || destination === 'refs/heads/main';
}

function checkGit(args) {
  let dir = projectDir;
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    const option = args[index];
    if (OPTIONS_WITH_VALUE.has(option)) {
      if (option === '-C' && args[index + 1]) {
        const value = args[index + 1];
        dir = isAbsolute(value) ? value : resolve(dir, value);
      }
      index += 2;
    } else {
      if (option.startsWith('-C') && option.length > 2) dir = resolve(dir, option.slice(2));
      index += 1;
    }
  }
  const subcommand = args[index];
  const rest = args.slice(index + 1);

  if (subcommand === 'commit' && currentBranch(dir) === 'main') {
    refuse(
      'Refused: never commit to main (AGENTS.md, Git). Create a branch named by type first, e.g. `git switch -c feat/<topic>`.',
    );
  }

  if (subcommand === 'add') {
    const broad = rest.some(
      (arg) =>
        arg === '--all' ||
        arg === '--update' ||
        arg === '--no-ignore-removal' ||
        /^-[a-zA-Z]*[Au][a-zA-Z]*$/.test(arg) ||
        WHOLE_TREE.has(arg),
    );
    if (broad) {
      refuse(
        'Refused: stage files by path, never `git add -A`, `--all`, `-u`, `.` or `:/` (AGENTS.md, Git). Check `git status` and add the intended files.',
      );
    }
  }

  if (subcommand === 'push') {
    const flags = rest.filter((arg) => arg.startsWith('-'));
    const positional = rest.filter((arg) => !arg.startsWith('-'));
    const refspecs = positional.slice(1);
    const pushesMain =
      flags.includes('--all') ||
      flags.includes('--mirror') ||
      refspecs.some(targetsMain) ||
      (refspecs.length === 0 && currentBranch(dir) === 'main');
    if (pushesMain) {
      refuse(
        'Refused: never push main (AGENTS.md, Git). Push your own branch (`git push -u origin <branch>`) and open a pull request.',
      );
    }
  }
}

function check(line, depth = 0) {
  for (const part of splitChain(line)) {
    const parts = words(part);
    // The first `git` word is the command (`git …`, `env X=1 git …`); later ones are arguments.
    const gitIndex = parts.findIndex(isGit);
    if (gitIndex >= 0) {
      checkGit(parts.slice(gitIndex + 1));
      continue;
    }
    // A script run by a shell (`bash -c "git commit …"`, `pwsh -Command "…"`) is checked too.
    parts.forEach((word, index) => {
      if (depth < 2 && SCRIPT_FLAGS.has(parts[index - 1] ?? '')) check(word, depth + 1);
    });
  }
}

check(command);
