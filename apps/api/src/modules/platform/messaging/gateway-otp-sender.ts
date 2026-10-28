import { DomainError } from '@vertex-food/contracts';
import {
  enqueueWhatsAppMessage,
  type MessagingCrypto,
  sendAvailability,
  type Transaction,
  whatsappRecipientHash,
} from '@vertex-food/db';
import type { OtpRequest, OtpSender } from '../identity/index.js';

/**
 * The WhatsApp gateway's OTP sender (spec S03 rules 18–22), provided to identity when
 * `OTP_SENDER=gateway`. In the challenge's transaction it checks that a healthy platform number
 * could send to this phone now, then queues the code sealed for the gateway and returns without
 * waiting for WhatsApp; the challenge's `delivery_status` then follows the message. OTPs go even
 * to a phone that opted out: the person asked for the code (rule 22).
 */
export class GatewayOtpSender implements OtpSender {
  readonly deliveryStatus = 'queued';

  constructor(private readonly crypto: MessagingCrypto) {}

  async send(tx: Transaction, { challengeId, phone, code }: OtpRequest): Promise<void> {
    const recipientHash = whatsappRecipientHash(this.crypto, phone);
    if (!(await sendAvailability(tx, recipientHash, 'otp'))) {
      throw new DomainError('OTP_DELIVERY_UNAVAILABLE', 'No platform number can send an OTP now');
    }
    await enqueueWhatsAppMessage(tx, this.crypto, {
      kind: 'otp',
      template: 'otp',
      phone,
      params: { code },
      otpChallengeId: challengeId,
    });
  }
}
