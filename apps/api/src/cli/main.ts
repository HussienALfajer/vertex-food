import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createDatabase, type Database, describeForLog } from '@vertex-food/db';
import { AppModule } from '../app.module.js';
import { loadConfig } from '../core/config/config.js';
import { AreasService } from '../modules/platform/areas/index.js';
import { TenancyService } from '../modules/platform/tenancy/index.js';
import { runCommand } from './commands.js';

// The API CLI: `pnpm --filter @vertex-food/api cli <command> …` after `pnpm build`, on the server.
// It runs the API's modules without serving HTTP, connected as the app role like the API; only the
// area commands open the owner connection (DATABASE_OWNER_URL). An unexpected failure prints only
// what `describeForLog` allows: a database error's message quotes the values of its query.
let owner: Database | undefined;
try {
  const config = loadConfig(process.env);
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    logger: false,
  });
  try {
    process.exitCode = await runCommand(
      process.argv.slice(2),
      {
        tenancy: app.get(TenancyService),
        areas: app.get(AreasService),
        owner: () => {
          const url = process.env.DATABASE_OWNER_URL;
          if (!url) throw new Error('DATABASE_OWNER_URL is not set');
          owner ??= createDatabase(url);
          return owner;
        },
      },
      {
        out: (text: string) => process.stdout.write(`${text}\n`),
        err: (text: string) => process.stderr.write(`${text}\n`),
      },
    );
  } finally {
    await app.close();
    await owner?.$client.end();
  }
} catch (error) {
  process.stderr.write(`INTERNAL_ERROR: ${describeForLog(error)}\n`);
  process.exitCode = 1;
}
