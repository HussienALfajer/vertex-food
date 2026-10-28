import { Logger } from '@nestjs/common';
import type { OtpPurpose } from '@vertex-food/contracts';
import type { Transaction } from '@vertex-food/db';

/** One code to send: the challenge it belongs to, its account and that account's phone. */
export type OtpRequest = {
  challengeId: string;
  accountId: string;
  phone: string;
  code: string;
  purpose: OtpPurpose;
};

/**
 * Sends a one-time code to a phone (spec S02 rule 12, S03 rule 18), in the transaction that creates
 * the challenge, never through the outbox, because the code is never stored in clear. A failure
 * throws: a password sign-in then answers `OTP_DELIVERY_UNAVAILABLE`; a first sign-in or reset
 * answers as for any phone (rule 13). The messaging module provides the WhatsApp gateway sender.
 */
export interface OtpSender {
  /** The challenge's `delivery_status` once `send` returns: `queued` for the gateway. */
  readonly deliveryStatus: 'queued' | 'sent';
  send(tx: Transaction, request: OtpRequest): Promise<void>;
}

export const OTP_SENDER = Symbol('OtpSender');

/**
 * The sender of development and tests: it sends nothing, keeps the last code per account in memory
 * for tests, and prints "OTP for account <id>: <code>" to the API's output, never the phone. The
 * API refuses to start with it in production (`loadConfig`).
 */
export class FakeOtpSender implements OtpSender {
  readonly deliveryStatus = 'sent';
  private readonly logger = new Logger('FakeOtpSender');
  private readonly codes = new Map<string, string>();

  async send(_tx: Transaction, { accountId, code }: OtpRequest): Promise<void> {
    this.codes.set(accountId, code);
    this.logger.log(`OTP for account ${accountId}: ${code}`);
  }

  /** The last code sent to the account. */
  lastCode(accountId: string): string | undefined {
    return this.codes.get(accountId);
  }
}
