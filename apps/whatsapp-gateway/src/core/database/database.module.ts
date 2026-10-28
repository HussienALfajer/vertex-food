import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { KeyedHash, SecretBox } from '@vertex-food/crypto';
import { createDatabase, type Database, type MessagingCrypto } from '@vertex-food/db';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

/**
 * Injection token of the one `Database` of the process, connected as the app role. Every table
 * the gateway reads and writes is platform scope (spec S03, "Data"); tenant data is never reached.
 */
export const DATABASE = Symbol('Database');

/** Injection token of the messaging keys: recipients hashed; phones, texts and QR codes sealed. */
export const MESSAGING_CRYPTO = Symbol('MessagingCrypto');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [CONFIG],
      useFactory: (config: Config) => createDatabase(config.databaseUrl),
    },
    {
      provide: MESSAGING_CRYPTO,
      inject: [CONFIG],
      useFactory: (config: Config): MessagingCrypto => ({
        hash: new KeyedHash(config.messaging.hashKey),
        box: new SecretBox(config.messaging.encryptionKey),
      }),
    },
  ],
  exports: [DATABASE, MESSAGING_CRYPTO],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown() {
    await this.db.$client.end();
  }
}
