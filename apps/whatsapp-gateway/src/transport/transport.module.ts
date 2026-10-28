import { Global, Module } from '@nestjs/common';
import type { Config } from '../core/config/config.js';
import { CONFIG } from '../core/config/config.module.js';
import { BaileysWhatsAppTransport } from './baileys-transport.js';
import { FakeWhatsAppTransport } from './fake-transport.js';
import { WHATSAPP_TRANSPORT } from './whatsapp-transport.js';

/** Provides `WHATSAPP_TRANSPORT`, the transport the config names. */
@Global()
@Module({
  providers: [
    {
      provide: WHATSAPP_TRANSPORT,
      inject: [CONFIG],
      useFactory: (config: Config) => {
        switch (config.transport) {
          case 'fake':
            return new FakeWhatsAppTransport();
          case 'baileys':
            return new BaileysWhatsAppTransport();
        }
      },
    },
  ],
  exports: [WHATSAPP_TRANSPORT],
})
export class TransportModule {}
