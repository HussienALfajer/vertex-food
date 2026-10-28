import type { WhatsAppSessionDetail, WhatsAppSessionState } from '@vertex-food/contracts';

/** Where the add-and-link dialog stands (screen 2). */
export type LinkOutcome = 'linking' | 'connected' | 'duplicate' | 'timeout' | 'failed';

/**
 * The dialog's step from the QR's state and, once the link has ended, the number's recent events
 * (newest first): the reason of a link that ended in `needs_relink` is the event written since
 * this link started (`created` or `relink_started`), `duplicate_number` or `link_timeout` (rules 4
 * and 5). Any other end (a logout while linking, an unlink elsewhere) is `failed`.
 */
export function linkOutcome(
  state: WhatsAppSessionState,
  events: WhatsAppSessionDetail['events'] | undefined,
): LinkOutcome {
  if (state === 'linking') return 'linking';
  if (state === 'connected') return 'connected';
  if (state !== 'needs_relink' || !events) return 'failed';
  for (const event of events) {
    if (event.type === 'duplicate_number') return 'duplicate';
    if (event.type === 'link_timeout') return 'timeout';
    if (event.type === 'created' || event.type === 'relink_started') break;
  }
  return 'failed';
}

/** What is left until `deadline` as `m:ss` (Latin digits), never below zero. */
export function countdown(deadline: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
