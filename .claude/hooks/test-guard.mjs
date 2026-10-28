// PreToolUse hook (Bash, PowerShell): one test run at a time on this machine, no test run cut
// short by `timeout`, and a whole E2E suite runs through `pnpm verify` (the apps the branch affects)
// or CI, never as a bare Playwright command. A refusal exits with code 2; the message
// goes back to Claude with what to do instead (docs/testing.md). Commands that run no tests pass
// straight through. Tested by `packages/config/test/test-guard.test.ts`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNS_TESTS = [
  // pnpm [options] [exec|dlx] vitest | playwright test
  /^(?:pnpm|npx|pnpx)\b(?:\s+--?[\w-]+(?:[= ]\S+)?)*\s+(?:exec\s+|dlx\s+)?(?:vitest|playwright\s+test)\b/,
  // pnpm [options] [run] test | test:e2e | verify
  /^pnpm\b(?:\s+--?[\w-]+(?:[= ]\S+)?)*\s+(?:run\s+)?(?:test|test:e2e|verify)(?:\s|$)/,
  // [pnpm [options] [exec]] turbo [run] … test
  /^(?:pnpm\b(?:\s+--?[\w-]+(?:[= ]\S+)?)*\s+(?:exec\s+)?)?turbo\s+(?:run\s+)?.*\btest(?::e2e)?\b/,
  /^(?:vitest|playwright\s+test)\b/,
  /^node\s+\S*(?:verify\.mjs|vitest\.mjs|cli\.js\s+test)\b/,
];
const LOCK_FILE = resolve(tmpdir(), 'vertex-food-verify.lock');
// As in scripts/verify.mjs: past it, the lock is a leftover of a killed run.
const LOCK_MAX_AGE_MS = 30 * 60_000;

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
// Text that is data, not commands (a commit message, a PR body, a file): heredocs and PowerShell
// here-strings are dropped, and quoted strings keep their words without the separators that would
// split them into commands of their own.
const command = String(input.tool_input?.command ?? '')
  .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '')
  .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, '')
  .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (quoted) => quoted.replace(/[;&|\r\n]/g, ' '));
const parts = command
  .split(/&&|\|\||[;|\n]/)
  .map((part) => part.trim().replace(/^[({]\s*/, ''))
  .map(withoutEnvAssignments)
  .filter(Boolean);
const runsTests = (part) => RUNS_TESTS.some((pattern) => pattern.test(part));

if (parts.some((part) => /^timeout\s/.test(part) && wrapsTests(part))) {
  refuse(
    'Do not wrap a test run in `timeout`: a killed run proves nothing and gets run again. Give ' +
      'the Bash call a timeout long enough for it, or run it in the background and wait for its ' +
      'notification.',
  );
}
const testRuns = parts.filter(runsTests);
if (testRuns.length === 0) process.exit(0);

if (testRuns.some(isWholeE2E)) {
  refuse(
    'A whole E2E suite runs through `pnpm verify`, which runs the suites of the apps the branch ' +
      'affects (all five: `pnpm verify --e2e-all`), and in CI on shards. For some specs while ' +
      'building: `pnpm verify apps/<app>/e2e/<file>.spec.ts [--grep <title>]`.',
  );
}

const busy = runningTests();
if (busy.length > 0) {
  refuse(
    `A test run is already going: ${busy.join('; ')}. Wait for it to end (its notification or ` +
      'summary) before starting another: two runs share the CPU, the ports of the E2E servers ' +
      "and PostgreSQL's connections, and fail each other's tests.",
  );
}

function withoutEnvAssignments(part) {
  return part.replace(/^(?:env\s+)?(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '');
}

/**
 * Whether `timeout` runs a test command: the command starts at some word after its options and
 * duration, whichever options take a value (`-k 5`, `-s KILL`, `--kill-after=5`).
 */
function wrapsTests(part) {
  const words = part.split(/\s+/);
  return words.some((_, index) => index > 0 && runsTests(words.slice(index).join(' ')));
}

/** Playwright with no spec file, test name or changed-only filter: a whole suite. */
function isWholeE2E(part) {
  if (/\bverify\b/.test(part)) return false;
  if (!/\bplaywright\s+test\b|\btest:e2e\b/.test(part)) return false;
  return !/\.spec\.ts\b|(?:^|\s)(?:-g|--grep|--only-changed|--last-failed)\b/.test(part);
}

/** Test processes of this repository (any of its checkouts) that are still running. */
function runningTests() {
  const found = [];
  try {
    const held = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
    if (alive(held.pid) && Date.now() - Date.parse(held.since) < LOCK_MAX_AGE_MS) {
      // Enough to refuse; the process scan below takes about a second on Windows.
      return [`pnpm verify (pid ${held.pid}, since ${held.since}; lock file ${LOCK_FILE})`];
    }
  } catch {
    // No verify run holds the lock.
  }
  const roots = repositoryRoots();
  for (const { pid, args } of processes()) {
    const line = args.replaceAll('\\', '/').toLowerCase();
    if (!roots.some((root) => line.includes(root))) continue;
    if (!/vitest|@playwright\/test|playwright\/cli\.js/.test(line)) continue;
    found.push(`${args.length > 120 ? `${args.slice(0, 117)}…` : args} (pid ${pid})`);
    if (found.length === 3) break;
  }
  return found;
}

/** This checkout and the main one: worktrees share the machine's PostgreSQL and E2E ports. */
function repositoryRoots() {
  const here = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: here,
    encoding: 'utf8',
    windowsHide: true,
  });
  const main = common.status === 0 ? resolve(common.stdout.trim(), '..') : here;
  return [...new Set([here, main])].map((path) => path.replaceAll('\\', '/').toLowerCase());
}

function processes() {
  const result =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }",
          ],
          { encoding: 'utf8', windowsHide: true },
        )
      : spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter((match) => match && Number(match[1]) !== process.pid)
    .map((match) => ({ pid: Number(match[1]), args: match[2] }));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
