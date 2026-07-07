import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { WebhookModule } from './webhooks/webhook.module';
import { HealthController } from './health/health.controller';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: { autoLogging: false, level: process.env.LOG_LEVEL ?? 'info' } }),
    WebhookModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
