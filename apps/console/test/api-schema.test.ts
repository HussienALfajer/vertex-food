import { readFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import { expect, it } from 'vitest';

// The API's types are generated from its committed document (`apps/api/openapi.json`): a change
// there fails here until `api-schema.gen.ts` is regenerated with `vitest run -u` (CLAUDE.md).
it('matches the API document', async () => {
  const document = await readFile(new URL('../../api/openapi.json', import.meta.url), 'utf8');
  const types = astToString(await openapiTS(document));
  await expect(
    `// Generated from apps/api/openapi.json by test/api-schema.test.ts; never edit by hand.\n${types}`,
  ).toMatchFileSnapshot('../src/lib/api-schema.gen.ts');
});
