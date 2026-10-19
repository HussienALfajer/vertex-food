import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.js';
import { AppModule } from './app.module.js';
import { loadConfig } from './core/config/config.js';

const config = loadConfig(process.env);
const app = configureApp(await NestFactory.create(AppModule.forRoot(config)));
await app.listen(config.port, config.host);
