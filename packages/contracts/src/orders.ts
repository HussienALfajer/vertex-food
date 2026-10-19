import { z } from 'zod';

/**
 * The order types of the one order model (ADR 0007). S01 uses them for the order types a charge
 * line applies to; S09 adds the order itself.
 */
export const orderTypeSchema = z
  .enum(['dine_in', 'takeaway', 'delivery', 'pickup'])
  .meta({ id: 'OrderType' });

export type OrderType = z.infer<typeof orderTypeSchema>;
