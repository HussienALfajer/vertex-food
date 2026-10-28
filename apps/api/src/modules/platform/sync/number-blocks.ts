import {
  type LocalDate,
  MAX_NUMBER_BLOCK_INDEX,
  type NumberBlock,
  type NumberSeries,
  numberBlockRange,
} from '@vertex-food/contracts';
import { numberBlocks as blocks, devices, type Transaction } from '@vertex-food/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { isUniqueViolation } from '../../../core/database/unique-violation.js';
import { lock } from './sync-locks.js';

// Order-number blocks (spec S04 rules 17–20, ADR 0035): each hub-capable PC holds one block per
// series and business date, so the hub and the standby number orders offline without colliding.
// Blocks are never deleted or reused.

/**
 * Rule 17: the PC's blocks for `dates`, allocating the missing ones under a lock on the branch's
 * blocks: the configured hub takes the lowest free block of a date, so a day starts at 1, and the
 * standby the next free one after the block the hub takes. Idempotent per PC and date.
 */
export async function allocateNumberBlocks(
  tx: Transaction,
  input: {
    tenantId: string;
    branchId: string;
    deviceId: string;
    hubRole: 'hub' | 'standby';
    series: NumberSeries;
    dates: readonly LocalDate[];
    now: Date;
  },
): Promise<NumberBlock[]> {
  await lock(tx, 'number-blocks', `${input.branchId}:${input.series}`);
  const held = await tx
    .select({
      deviceId: blocks.deviceId,
      businessDate: blocks.businessDate,
      blockIndex: blocks.blockIndex,
    })
    .from(blocks)
    .where(
      and(
        eq(blocks.branchId, input.branchId),
        eq(blocks.series, input.series),
        inArray(blocks.businessDate, [...input.dates]),
      ),
    );
  const [hub] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.branchId, input.branchId),
        eq(devices.hubRole, 'hub'),
        eq(devices.status, 'active'),
      ),
    );
  for (const date of input.dates) {
    const ofDate = held.filter((block) => block.businessDate === date);
    if (ofDate.some((block) => block.deviceId === input.deviceId)) continue;
    const taken = new Set(ofDate.map((block) => block.blockIndex));
    const free: number[] = [];
    for (let index = 1; index <= MAX_NUMBER_BLOCK_INDEX && free.length < 2; index++) {
      if (!taken.has(index)) free.push(index);
    }
    const hubHolds = hub !== undefined && ofDate.some((block) => block.deviceId === hub.id);
    const blockIndex = input.hubRole === 'hub' || hubHolds ? free[0] : free[1];
    if (blockIndex === undefined) throw new Error(`No free number block on ${date}`);
    const range = numberBlockRange(blockIndex);
    await tx.insert(blocks).values({
      tenantId: input.tenantId,
      branchId: input.branchId,
      series: input.series,
      businessDate: date,
      blockIndex,
      firstNumber: range.first,
      lastNumber: range.last,
      deviceId: input.deviceId,
      allocatedAt: input.now,
    });
    held.push({ deviceId: input.deviceId, businessDate: date, blockIndex });
  }
  const mine = await tx
    .select({
      businessDate: blocks.businessDate,
      first: blocks.firstNumber,
      last: blocks.lastNumber,
    })
    .from(blocks)
    .where(
      and(
        eq(blocks.deviceId, input.deviceId),
        eq(blocks.series, input.series),
        inArray(blocks.businessDate, [...input.dates]),
      ),
    )
    .orderBy(asc(blocks.businessDate));
  return mine;
}

/**
 * Rule 20 for the executors of numbered commands (S09's orders): whether `number` lies in the block
 * the executing PC holds for its series and business date.
 */
async function check(
  tx: Transaction,
  input: { deviceId: string; series: NumberSeries; businessDate: LocalDate; number: number },
): Promise<'in_block' | 'number_out_of_block'> {
  const [block] = await tx
    .select({ first: blocks.firstNumber, last: blocks.lastNumber })
    .from(blocks)
    .where(
      and(
        eq(blocks.deviceId, input.deviceId),
        eq(blocks.series, input.series),
        eq(blocks.businessDate, input.businessDate),
      ),
    );
  return block && input.number >= block.first && input.number <= block.last
    ? 'in_block'
    : 'number_out_of_block';
}

/**
 * Rule 20: whether an insert failed because the number is already taken in the branch, series and
 * date (the owning table's unique index `constraint`); the executor then keeps the record without
 * a number and opens `number_taken` (Spike A finding 3).
 */
function taken(error: unknown, constraint: string): boolean {
  return isUniqueViolation(error, constraint);
}

export const numberBlocks = { check, taken };
