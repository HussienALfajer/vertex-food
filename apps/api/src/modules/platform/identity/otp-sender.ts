import { Logger } from '@nestjs/common';
import type { OtpPurpose } from '@vertex-food/contracts';

/**
 * Sends a one-time code to a phone (spec S02 rule 12). Called synchronously, never through the
 * outbox, because the code is never stored in clear. A failure throws: a password sign-in then
 * answers `OTP_DELIVERY_UNAVAILABLE`; a first sign-in or reset answers as for any phone (rule 13).
 * S03 adds the WhatsApp gateway sender.
 */
export interface OtpSender {
  send(accountId: string, phone: string, code: string, purpose: OtpPurpose): Promise<void>;
}

export const OTP_SENDER = Symbol('OtpSender');

/**
 * The sender of development and tests: it sends nothing, keeps the last code per account in memory
 * for tests, and prints "OTP for account <id>: <code>" to the API's output, never the phone. The
 * API refuses to start with it in production (`loadConfig`).
 */
export class FakeOtpSender implements OtpSender {
  private readonly logger = new Logger('FakeOtpSender');
  private readonly codes = new Map<string, string>();

  async send(accountId: string, _phone: string, code: string): Promise<void> {
    this.codes.set(accountId, code);
    this.logger.log(`OTP for account ${accountId}: ${code}`);
  }

  /** The last code sent to the account. */
  lastCode(accountId: string): string | undefined {
    return this.codes.get(accountId);
  }
}
