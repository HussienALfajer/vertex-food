import { errorResponseSchema, fileBytesSchema, noContentSchema } from '@vertex-food/contracts';
import { z } from 'zod';
import type { Route } from '../routes.js';

const COMPONENTS = '#/components/schemas/';

/** The stable `.meta({ id })` of a contract schema (ADR 0020), or undefined. */
export function schemaId(schema: unknown): string | undefined {
  return schema instanceof z.ZodType ? z.globalRegistry.get(schema)?.id : undefined;
}

function reference(schema: unknown, route: Route): { $ref: string } {
  const id = schemaId(schema);
  if (!id) throw new Error(`${route.name} answers with a schema that has no .meta({ id })`);
  return { $ref: `${COMPONENTS}${id}` };
}

/** A schema with an id by reference; one without (a path parameter's `z.uuid()`) inline. */
function schemaOf(schema: unknown): unknown {
  if (schemaId(schema)) return { $ref: `${COMPONENTS}${schemaId(schema)}` };
  if (schema instanceof z.ZodType) {
    const { $schema: _, ...json } = z.toJSONSchema(schema, { io: 'input' });
    return json;
  }
  return { type: 'string' };
}

/** Query parameters: one per property of the route's query schema, as the client sends them. */
function queryParameters(schema: unknown) {
  if (!(schema instanceof z.ZodType)) return [];
  type ObjectSchema = { properties?: Record<string, unknown>; required?: string[] };
  const root = z.toJSONSchema(schema, { io: 'input' }) as ObjectSchema & {
    $ref?: string;
    $defs?: Record<string, ObjectSchema>;
  };
  // A schema with an id comes back as a reference to its definition.
  const json = root.$ref ? (root.$defs?.[root.$ref.replace('#/$defs/', '')] ?? {}) : root;
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: 'query',
    required: json.required?.includes(name) ?? false,
    schema: componentReferences(property),
  }));
}

/**
 * A query property's references to schemas with an id (`#/$defs/TenantStatus`), pointed at the
 * document's components, which hold every such schema.
 */
function componentReferences(property: unknown): unknown {
  return JSON.parse(JSON.stringify(property).replaceAll('"#/$defs/', `"${COMPONENTS}`));
}

function requestOf(route: Route) {
  const parameters = [
    ...route.request.params.map(({ name, schema }) => ({
      name,
      in: 'path',
      required: true,
      schema: schemaOf(schema),
    })),
    ...queryParameters(route.request.query),
  ];
  const requestBody = route.request.file
    ? {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: { file: { type: 'string', format: 'binary' } },
              required: ['file'],
            },
          },
        },
      }
    : route.request.body
      ? {
          required: true,
          content: { 'application/json': { schema: reference(route.request.body, route) } },
        }
      : undefined;
  return {
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
  };
}

/**
 * The success answer: nothing (204), a file's bytes (of the route's declared type, else the
 * stored images'), or JSON of the route's schema.
 */
function successOf(route: Route) {
  if (route.responseSchema === noContentSchema) return { description: 'No content' };
  if (route.responseSchema === fileBytesSchema) {
    const binary = { schema: { type: 'string', format: 'binary' } };
    const types = route.contentType ? [route.contentType] : ['image/png', 'image/webp'];
    return {
      description: 'OK',
      content: Object.fromEntries(types.map((type) => [type, binary])),
    };
  }
  return {
    description: route.status === 201 ? 'Created' : 'OK',
    content: { 'application/json': { schema: reference(route.responseSchema, route) } },
  };
}

/** Every contract schema with an id, as OpenAPI components that refer to each other by id. */
function components() {
  const { schemas } = z.toJSONSchema(z.globalRegistry, { uri: (id) => `${COMPONENTS}${id}` });
  return Object.fromEntries(
    Object.entries(schemas)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, { $schema: _, $id: __, ...schema }]) => [id, schema]),
  );
}

/**
 * The OpenAPI 3.1 document of the API, generated from its routes and the Zod contracts they
 * declare (ADR 0002). `apps/api/openapi.json` holds the committed copy; a test fails when it
 * drifts. Copied from Vertex Shifa, with 204 and binary answers.
 */
export function buildOpenApiDocument(routes: Route[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  const sorted = [...routes].sort((a, b) => a.path.localeCompare(b.path));
  for (const route of sorted) {
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    paths[path] ??= {};
    paths[path][route.method.toLowerCase()] = {
      operationId: route.name,
      ...requestOf(route),
      responses: {
        [String(route.status)]: successOf(route),
        default: {
          description: 'Error',
          content: { 'application/json': { schema: reference(errorResponseSchema, route) } },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Vertex Food API', version: '0.0.0' },
    paths,
    components: { schemas: components() },
  };
}
