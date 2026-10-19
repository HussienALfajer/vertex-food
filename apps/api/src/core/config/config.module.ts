import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Config } from './config.js';

/** Injection token of the checked `Config`. */
export const CONFIG = Symbol('Config');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
