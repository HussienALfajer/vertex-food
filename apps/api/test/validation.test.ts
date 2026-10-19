import {
  Body,
  Controller,
  type INestApplication,
  Module,
  Param,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import {
  idSchema,
  listConsoleTenantsQuerySchema,
  noContentSchema,
  updateBranchSchema,
} from '@vertex-food/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { NoFeature, Public } from '../src/core/access/access.decorators.js';
import { createTestApp } from './app.js';

// Every route's request schemas run before its handler (ADR 0020: one validation source). A
// test-only public route stands in for the staff routes, which answer 401 until S02.

let received: unknown;

@Controller('probe')
@Public()
@NoFeature()
class ProbeController {
  @Post(':id')
  @SerializeOptions({ schema: noContentSchema })
  probe(
    @Param('id', { schema: idSchema }) id: string,
    @Query({ schema: listConsoleTenantsQuerySchema })
    query: z.output<typeof listConsoleTenantsQuerySchema>,
    @Body({ schema: updateBranchSchema }) body: z.output<typeof updateBranchSchema>,
  ) {
    received = { id, query, body };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const ID = '0199fd00-0000-7000-8000-000000000001';
const updatedAt = '2026-10-19T12:00:00.000Z';

describe('request validation', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp({ imports: [ProbeModule] });
  });
  afterAll(() => app.close());

  it('hands the handler parsed values: defaults, coercion and E.164 phones', async () => {
    await request(app.getHttpServer())
      .post(`/api/probe/${ID}?page=2`)
      .send({ contactPhones: [{ phone: '0900 000 001', whatsapp: true }], updatedAt })
      .expect(201);
    expect(received).toEqual({
      id: ID,
      query: { page: 2, pageSize: 50, order: 'asc' },
      body: { contactPhones: [{ phone: '+963900000001', whatsapp: true }], updatedAt },
    });
  });

  it.each([
    [
      'a bad body',
      `/api/probe/${ID}`,
      { contactPhones: [{ phone: 'x', whatsapp: 'y' }], updatedAt },
    ],
    ['a missing updatedAt', `/api/probe/${ID}`, { addressDescription: 'شارع' }],
    ['a bad query', `/api/probe/${ID}?pageSize=1000`, { updatedAt }],
    ['a bad id', '/api/probe/not-a-uuid', { updatedAt }],
  ])('refuses %s with VALIDATION_FAILED, naming fields, never values', async (_, path, body) => {
    received = undefined;
    const response = await request(app.getHttpServer()).post(path).send(body).expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(Array.isArray(response.body.details.fields)).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('"x"');
    expect(received).toBeUndefined();
  });
});
