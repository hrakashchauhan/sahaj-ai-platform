import { Module } from '@nestjs/common';
import { DashboardAuthService } from './auth';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardAuthService, DashboardService],
})
export class DashboardModule {}
