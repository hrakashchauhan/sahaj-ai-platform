import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { DashboardAuthService } from './auth';
import { DashboardService } from './dashboard.service';
import {
  approvalActionSchema,
  consentEventSchema,
  conversationQuerySchema,
  kbCreateSchema,
  kbUpdateSchema,
  onboardingTestSchema,
  paginationSchema,
  tenantSettingsSchema,
} from './schemas';

const uuidParam = z.string().uuid();

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly auth: DashboardAuthService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get('me')
  async me(@Req() req: Request) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.me(user);
  }

  @Get('overview')
  async overview(@Req() req: Request) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.overview(user);
  }

  @Get('conversations')
  async conversations(@Req() req: Request, @Query() query: Record<string, string>) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.conversations(user, conversationQuerySchema.parse(query));
  }

  @Get('conversations/:id')
  async conversationDetail(@Req() req: Request, @Param('id') id: string) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.conversationDetail(user, uuidParam.parse(id));
  }

  @Post('approvals/:id/resolve')
  async resolveApproval(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await this.auth.requireUser(req);
    this.auth.requireRole(user, ['owner', 'internal_admin']);
    return this.dashboard.applyApproval(user, uuidParam.parse(id), approvalActionSchema.parse(body));
  }

  @Get('knowledge-base')
  async knowledgeBase(@Req() req: Request, @Query() query: Record<string, string>) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.knowledgeBase(user, paginationSchema.parse(query));
  }

  @Post('knowledge-base')
  async createKnowledgeBaseItem(@Req() req: Request, @Body() body: unknown) {
    const user = await this.auth.requireUser(req);
    this.auth.requireRole(user, ['owner', 'internal_admin']);
    return this.dashboard.createKnowledgeBaseItem(user, kbCreateSchema.parse(body));
  }

  @Patch('knowledge-base/:id')
  async updateKnowledgeBaseItem(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const user = await this.auth.requireUser(req);
    this.auth.requireRole(user, ['owner', 'internal_admin']);
    return this.dashboard.updateKnowledgeBaseItem(user, uuidParam.parse(id), kbUpdateSchema.parse(body));
  }

  @Get('intent-policies')
  async intentPolicies(@Req() req: Request) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.intentPolicies(user);
  }

  @Get('leads')
  async leads(@Req() req: Request, @Query() query: Record<string, string>) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.leads(user, paginationSchema.parse(query));
  }

  @Get('roi')
  async roi(@Req() req: Request) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.roi(user);
  }

  @Get('settings')
  async settings(@Req() req: Request) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.settings(user);
  }

  @Patch('settings')
  async updateSettings(@Req() req: Request, @Body() body: unknown) {
    const user = await this.auth.requireUser(req);
    this.auth.requireRole(user, ['owner', 'internal_admin']);
    return this.dashboard.updateSettings(user, tenantSettingsSchema.parse(body));
  }

  @Get('compliance')
  async compliance(@Req() req: Request, @Query() query: Record<string, string>) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.compliance(user, paginationSchema.parse(query));
  }

  @Post('compliance/consent-events')
  async recordConsent(@Req() req: Request, @Body() body: unknown) {
    const user = await this.auth.requireUser(req);
    this.auth.requireRole(user, ['owner', 'internal_admin']);
    return this.dashboard.recordConsent(user, consentEventSchema.parse(body));
  }

  @Get('billing')
  async billing(@Req() req: Request) {
    const user = await this.auth.requireUser(req);
    return this.dashboard.billing(user);
  }

  @Post('onboarding/test-inbound')
  async runOnboardingTest(@Req() req: Request, @Body() body: unknown) {
    const user = await this.auth.requireUser(req);
    this.auth.requireRole(user, ['owner', 'internal_admin']);
    return this.dashboard.runOnboardingTest(user, onboardingTestSchema.parse(body));
  }
}
