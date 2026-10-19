import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@vertex-food/db';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

/**
 * Injection token of the one `Database` of the process, connected as the app role, which cannot
 * bypass row-level security. Tenant data is read and written only inside
 * `withTenant(db, tenantId, …)` from `@vertex-food/db`, with the tenant of the authenticated
 * session or device, never from client input (ADR 0004).
 */
export const DATABASE = Symbol('Database');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [CONFIG],
      useFactory: (config: Config) => createDatabase(config.databaseUrl),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown() {
    await this.db.$client.end();
  }
}
