import { z } from 'zod';
import { idSchema, instantSchema } from './primitives.js';

/**
 * Governorates and their cities (module `areas`, platform data), for branch addresses (S01) and,
 * later, discovery by city. Seeded with Aleppo → Azaz; Vertex staff add more with the CLI until
 * S23. A city is archived, never deleted: it stays valid on the branches that use it but is not
 * offered for new choices.
 */

export const areaNameArSchema = z.string().trim().min(2).max(100);

export const areaNameLatinSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z '.-]*$/, "Latin letters, spaces and ' . - only");

export const citySchema = z
  .object({
    id: idSchema,
    governorateId: idSchema,
    nameAr: z.string(),
    nameLatin: z.string(),
    archivedAt: instantSchema.nullable(),
  })
  .meta({ id: 'City' });

export type City = z.infer<typeof citySchema>;

/** A governorate with its cities, as `GET /api/cities` answers it. */
export const governorateSchema = z
  .object({
    id: idSchema,
    nameAr: z.string(),
    nameLatin: z.string(),
    cities: z.array(citySchema),
  })
  .meta({ id: 'Governorate' });

export type Governorate = z.infer<typeof governorateSchema>;

export const governorateListSchema = z.array(governorateSchema).meta({ id: 'GovernorateList' });

export const createGovernorateSchema = z
  .object({ nameAr: areaNameArSchema, nameLatin: areaNameLatinSchema })
  .meta({ id: 'CreateGovernorate' });

export type CreateGovernorate = z.infer<typeof createGovernorateSchema>;

export const createCitySchema = z
  .object({ governorateId: idSchema, nameAr: areaNameArSchema, nameLatin: areaNameLatinSchema })
  .meta({ id: 'CreateCity' });

export type CreateCity = z.infer<typeof createCitySchema>;
