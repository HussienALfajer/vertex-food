import {
  type LocalDate,
  type NumberSeries,
  nextNumberInBlock,
  provisionalOrderLabel,
} from '@vertex-food/contracts';
import type { ResolveContext } from '../registry.js';
import type { NumberUse } from './journal.js';
import type { LocalNumberBlock } from './ports.js';

// Numbering on the hub (spec S04 rules 18, 19, ADR 0035): an order takes the next number of the
// hub's own block of its business date, counted up from the last number used; without a block, or
// with the block used up, it takes a provisional label and the server numbers it on sync. The
// counter is committed with the journal entry, so a number is never handed out twice.

export type TakenNumber = { number: number; label: null } | { number: null; label: string };

/** What a command's `resolve` gets on the hub; a definition that numbers declares this type. */
export interface HubResolveContext extends ResolveContext {
  /** The business date of the command's effective time. */
  businessDate: LocalDate;
  /** One number per command, from this hub's block (rules 18, 19). */
  takeNumber(series: NumberSeries): TakenNumber;
}

/** The numbering of one command, prepared in the writer lock from the block this PC holds. */
export function prepareNumbering(input: {
  commandId: string;
  businessDate: LocalDate;
  block: LocalNumberBlock | null;
}): { take: (series: NumberSeries) => TakenNumber; used: () => NumberUse | null } {
  let used: NumberUse | null = null;
  let taken = false;
  return {
    take(series) {
      if (taken) throw new Error('A command takes one number');
      taken = true;
      const block = input.block?.series === series ? input.block : null;
      const number = block ? nextNumberInBlock(block, block.lastUsed) : null;
      if (number === null) return { number: null, label: provisionalOrderLabel(input.commandId) };
      used = { series, businessDate: input.businessDate, number };
      return { number, label: null };
    },
    used: () => used,
  };
}

/** Whether a number lies in a block (rule 26: a re-sent or forwarded number is the executor's). */
export function inBlock(block: { first: number; last: number } | null, number: number): boolean {
  return block !== null && number >= block.first && number <= block.last;
}
