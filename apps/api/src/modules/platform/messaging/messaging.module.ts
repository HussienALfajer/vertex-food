import { Module } from '@nestjs/common';
import type { Config } from '../../../core/config/config.js';
import { CONFIG } from '../../../core/config/config.module.js';
import { MessagingConsoleController } from './messaging.console.controller.js';
import { MessagingService } from './messaging.service.js';
import { MESSAGING_CRYPTO, messagingCrypto } from './messaging-crypto.js';

/**
 * Vertex's platform WhatsApp numbers and the send queue's API side (spec S03, ADR 0034): the
 * console's routes and the messaging health. The gateway OTP sender (`GatewayOtpSender`) is
 * provided to identity as its `OtpSender` when `OTP_SENDER=gateway`; the names of the admins on a
 * session's events come from identity (`PLATFORM_USER_NAMES`).
 */
@Module({
  controllers: [MessagingConsoleController],
  providers: [
    {
      provide: MESSAGING_CRYPTO,
      inject: [CONFIG],
      useFactory: (config: Config) => messagingCrypto(config.messaging),
    },
    MessagingService,
  ],
})
export class MessagingModule {}
