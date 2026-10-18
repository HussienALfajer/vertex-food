import { z } from 'zod';

/**
 * Every contract schema with a `.meta({ id })`, as JSON Schema (draft 2020-12) keyed by its id,
 * with references between them. For clients that do not run TypeScript (a Flutter or native app)
 * and for the API's OpenAPI document: the Zod schemas stay the one source (ADR 0020). Importing
 * the package registers the ids, so this reads the registry once the contracts are loaded.
 */
export function contractJsonSchemas() {
  return z.toJSONSchema(z.globalRegistry, { target: 'draft-2020-12', unrepresentable: 'throw' });
}
