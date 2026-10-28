import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The Claude Code hook `.claude/hooks/test-guard.mjs`, run as Claude Code runs it: the tool's input
// as JSON on stdin; exit code 2 refuses the command, with the reason on stderr.
const hook = fileURLToPath(new URL('../../../.claude/hooks/test-guard.mjs', import.meta.url));

// The hook's temp folder, where `pnpm verify` keeps its lock: a folder of this test's own, so a
// real verify run on the machine is neither seen nor disturbed.
let temp = '';

function guard(command: string): { refused: boolean; reason: string } {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp },
  });
  if (result.status !== 0 && result.status !== 2) throw new Error(result.stderr);
  return { refused: result.status === 2, reason: result.stderr };
}

beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), 'test-guard-'));
});

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

describe('test guard', () => {
  it.each([
    'git status',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm build',
    'pnpm --filter @vertex-food/web dev',
    'git commit -F - <<EOF\nchore: run pnpm test:e2e less\nEOF',
    'git commit -m "ci: shard; pnpm test:e2e via turbo"',
    "git commit -m 'ci: shards\npnpm test:e2e runs in CI'",
    "git commit -m @'\nci: shards\n\npnpm test:e2e now runs on three shards in CI\n'@",
    'gh pr create --body @"\n## Test plan\npnpm test:e2e | shards\n"@',
  ])('lets %s through', (command) => {
    expect(guard(command).refused).toBe(false);
  });

  it.each([
    'timeout 300 pnpm test',
    'timeout -k 5 600 pnpm verify',
    'timeout -s KILL 600 pnpm test',
    'timeout --kill-after=5 --signal=TERM 10m pnpm --filter @vertex-food/db exec vitest run',
    'git status && timeout 60 pnpm --filter @vertex-food/api exec vitest run',
  ])('refuses %s', (command) => {
    expect(guard(command)).toMatchObject({
      refused: true,
      reason: expect.stringContaining('timeout'),
    });
  });

  it.each([
    'pnpm test:e2e',
    'pnpm --filter @vertex-food/restaurant test:e2e',
    'pnpm turbo run test:e2e',
    'pnpm --filter @vertex-food/console exec playwright test',
    'CI=1 pnpm exec playwright test',
  ])('sends a whole suite through pnpm verify: %s', (command) => {
    expect(guard(command)).toMatchObject({
      refused: true,
      reason: expect.stringContaining('pnpm verify'),
    });
  });

  it('refuses a second run while pnpm verify holds its lock', () => {
    const lock = join(temp, 'vertex-food-verify.lock');
    writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, since: new Date().toISOString(), cwd: temp }),
    );
    try {
      for (const command of [
        'pnpm verify',
        'pnpm --silent verify apps/api/test/tenancy.test.ts',
        'pnpm --filter @vertex-food/web exec playwright test e2e/shell.spec.ts',
        'pnpm turbo run typecheck test build',
      ]) {
        expect(guard(command), command).toMatchObject({
          refused: true,
          reason: expect.stringContaining('already going'),
        });
      }
    } finally {
      rmSync(lock, { force: true });
    }
  });
});
