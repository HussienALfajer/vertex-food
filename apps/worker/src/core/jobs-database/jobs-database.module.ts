import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@vertex-food/db';
import type { Config } from '../config/config.js';
import { CONFIG } from '../config/config.module.js';

/**
 * Injection token of the `Database` connected as the audited platform-jobs role (ADR 0004): it
 * reaches across tenants only through the grants and policies `JOBS_ACCESS` lists in
 * `packages/db`. Every statement it runs is in the server log, so its statements carry ids, codes
 * and timestamps only.
 */
export const JOBS_DATABASE = Symbol('JobsDatabase');

@Global()
@Module({
  providers: [
    {
      provide: JOBS_DATABASE,
      inject: [CONFIG],
      useFactory: (config: Config) => createDatabase(config.jobsDatabaseUrl),
    },
  ],
  exports: [JOBS_DATABASE],
})
export class JobsDatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(JOBS_DATABASE) private readonly db: Database) {}

  async onApplicationShutdown() {
    await this.db.$client.end();
  }
}
