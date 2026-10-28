import type { WhatsAppMessageFailureReason } from '@vertex-food/contracts';
import { otpChallenges, type Transaction, whatsappMessages } from '@vertex-food/db';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Ends unsent messages as `failed` or `expired` with their reason, clearing their parameters, and
 * fails the OTP challenge of each (spec S03 rule 19: its `delivery_status` follows the message,
 * forward only). Messages already sent or ended are left alone.
 */
export async function endMessages(
  tx: Transaction,
  ids: readonly string[],
  status: 'failed' | 'expired',
  reason: WhatsAppMessageFailureReason,
): Promise<number> {
  if (ids.length === 0) return 0;
  const ended = await tx
    .update(whatsappMessages)
    .set({ status, failureReason: reason, paramsSealed: null })
    .where(
      and(
        inArray(whatsappMessages.id, [...ids]),
        inArray(whatsappMessages.status, ['queued', 'sending']),
      ),
    )
    .returning({ otpChallengeId: whatsappMessages.otpChallengeId });
  const challenges = ended.flatMap((row) => (row.otpChallengeId ? [row.otpChallengeId] : []));
  if (challenges.length > 0) {
    await tx
      .update(otpChallenges)
      .set({ deliveryStatus: 'failed' })
      .where(
        and(inArray(otpChallenges.id, challenges), eq(otpChallenges.deliveryStatus, 'queued')),
      );
  }
  return ended.length;
}
