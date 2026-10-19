import { expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/core/openapi/openapi.js';
import { listRoutes } from '../src/core/routes.js';
import { createTestApp } from './app.js';

// The committed document is what clients are generated from: a route or contract change that
// alters it fails here until the file is regenerated (`pnpm --filter @vertex-food/api test -u`,
// apps/api/CLAUDE.md) and reviewed. Copied from Vertex Shifa.
it('matches the committed openapi.json', async () => {
  const app = await createTestApp();
  const document = buildOpenApiDocument(listRoutes(app));
  await app.close();
  await expect(`${JSON.stringify(document, null, 2)}\n`).toMatchFileSnapshot('../openapi.json');
});

// Generated clients refuse a document with a dangling reference.
it('refers only to schemas the document holds', async () => {
  const app = await createTestApp();
  const document = buildOpenApiDocument(listRoutes(app));
  await app.close();
  const references = [...JSON.stringify(document).matchAll(/"\$ref":"([^"]+)"/g)].map(
    ([, reference]) => reference,
  );
  expect(references.length).toBeGreaterThan(0);
  for (const reference of references) {
    const [, id = ''] = /^#\/components\/schemas\/(.+)$/.exec(reference ?? '') ?? [];
    expect(document.components.schemas, reference).toHaveProperty([id]);
  }
});
