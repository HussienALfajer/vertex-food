import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.js';
import { loadConfig } from './core/config/config.js';
import { GatewayModule } from './gateway.module.js';

const config = loadConfig(process.env);
const app = configureApp(await NestFactory.create(GatewayModule.forRoot(config)));
await app.listen(config.port, config.host);
