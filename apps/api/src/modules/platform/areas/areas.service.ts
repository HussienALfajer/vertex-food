import { Inject, Injectable } from '@nestjs/common';
import {
  type City,
  type CreateCity,
  type CreateGovernorate,
  DomainError,
  type Governorate,
} from '@vertex-food/contracts';
import { cities, type Database, governorates, type Transaction } from '@vertex-food/db';
import { asc, eq, isNull, max } from 'drizzle-orm';
import type { Actor } from '../../../core/access/actor.js';
import { auditPlatform } from '../../../core/audit/audit.js';
import { DATABASE } from '../../../core/database/database.module.js';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';

type CityRow = typeof cities.$inferSelect;

function toCity(row: CityRow): City {
  return {
    id: row.id,
    governorateId: row.governorateId,
    nameAr: row.nameAr,
    nameLatin: row.nameLatin,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/**
 * Governorates and cities (module `areas`, spec S01): platform data the restaurant app reads for
 * branch addresses. The app role only reads them; Vertex staff add them with the CLI, which passes
 * the owner connection, and every addition is in the platform audit log.
 */
@Injectable()
export class AreasService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Governorates with their non-archived cities, in display order; empty governorates left out. */
  async listCities(): Promise<Governorate[]> {
    const rows = await this.db
      .select({ governorate: governorates, city: cities })
      .from(cities)
      .innerJoin(governorates, eq(cities.governorateId, governorates.id))
      .where(isNull(cities.archivedAt))
      .orderBy(asc(governorates.position), asc(cities.position));
    const byId = new Map<string, Governorate>();
    for (const { governorate, city } of rows) {
      if (governorate.archivedAt) continue;
      const group = byId.get(governorate.id) ?? {
        id: governorate.id,
        nameAr: governorate.nameAr,
        nameLatin: governorate.nameLatin,
        cities: [],
      };
      group.cities.push(toCity(city));
      byId.set(governorate.id, group);
    }
    return [...byId.values()];
  }

  /** A city by id, archived ones included (they stay valid on the branches that use them). */
  async findCity(db: Database | Transaction, id: string): Promise<City | undefined> {
    const [row] = await db.select().from(cities).where(eq(cities.id, id));
    return row ? toCity(row) : undefined;
  }

  /** CLI only, with the owner connection: the app role cannot write areas. */
  async addGovernorate(owner: Database, actor: Actor, input: CreateGovernorate) {
    return owner.transaction(async (tx) => {
      const [last] = await tx.select({ position: max(governorates.position) }).from(governorates);
      const row = await tx
        .insert(governorates)
        .values({ ...input, position: (last?.position ?? 0) + 1 })
        .returning()
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new DomainError('CONFLICT', 'A governorate with this name exists');
          }
          throw error;
        });
      const created = row[0];
      if (!created) throw new Error('No governorate inserted');
      await auditPlatform(tx, actor, {
        action: 'governorate.created',
        entityType: 'governorate',
        entityId: created.id,
      });
      return { id: created.id, nameAr: created.nameAr, nameLatin: created.nameLatin };
    });
  }

  /** CLI only, with the owner connection: the app role cannot write areas. */
  async addCity(owner: Database, actor: Actor, input: CreateCity): Promise<City> {
    return owner.transaction(async (tx) => {
      const [governorate] = await tx
        .select({ id: governorates.id })
        .from(governorates)
        .where(eq(governorates.id, input.governorateId));
      if (!governorate) throw new DomainError('NOT_FOUND', 'No such governorate');
      const [last] = await tx
        .select({ position: max(cities.position) })
        .from(cities)
        .where(eq(cities.governorateId, input.governorateId));
      const row = await tx
        .insert(cities)
        .values({ ...input, position: (last?.position ?? 0) + 1 })
        .returning()
        .catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new DomainError('CONFLICT', 'A city with this name exists in the governorate');
          }
          throw error;
        });
      const created = row[0];
      if (!created) throw new Error('No city inserted');
      await auditPlatform(tx, actor, {
        action: 'city.created',
        entityType: 'city',
        entityId: created.id,
      });
      return toCity(created);
    });
  }
}
