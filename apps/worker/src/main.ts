import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.js';
import { loadConfig } from './core/config/config.js';
import { jobs } from './jobs/index.js';
import { WorkerModule } from './worker.module.js';

const config = loadConfig(process.env);
const app = configureApp(await NestFactory.create(WorkerModule.forRoot(config, jobs)));
await app.listen(config.port, config.host);
