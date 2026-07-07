import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { env } from './config/env';
import { verifyRlsOrExit } from './db/rls-check';
import { warnMissingProdSecrets } from './config/prod-guard';

/**
 * HTTP process: webhooks + health + (future) dashboard API.
 * The message-processing workers run in a separate process (src/worker.ts).
 */
async function bootstrap() {
  warnMissingProdSecrets();
  await verifyRlsOrExit(); // fail-closed: refuse to boot in prod if RLS can be bypassed
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableCors({
    origin: env.DASHBOARD_CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
    allowedHeaders: ['authorization', 'content-type', 'x-sahaj-tenant-id'],
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  console.log(`🚀 Sahaj API on :${env.PORT}  (webhook → ${env.PUBLIC_URL}/webhooks/whatsapp)`);
}

bootstrap().catch((err) => {
  console.error('Failed to start API', err);
  process.exit(1);
});
