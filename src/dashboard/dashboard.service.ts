import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { handleInboundEvent } from '../ingestion/ingestion.service';
import { withTenant } from '../tenancy/tenant-context';
import {
  auditLogs,
  consentLogs,
  contacts,
  knowledgeBaseItems,
  messages,
  roiReports,
  tenants,
} from '../db/schema';
import type { DashboardUser } from './auth';
import type {
  approvalActionSchema,
  consentEventSchema,
  conversationQuerySchema,
  kbCreateSchema,
  kbUpdateSchema,
  onboardingTestSchema,
  paginationSchema,
  tenantSettingsSchema,
} from './schemas';
import { resolveApproval } from '../approvals/approval.service';
import type { z } from 'zod';

type Pagination = z.infer<typeof paginationSchema>;
type ConversationQuery = z.infer<typeof conversationQuerySchema>;
type KbCreate = z.infer<typeof kbCreateSchema>;
type KbUpdate = z.infer<typeof kbUpdateSchema>;
type ApprovalAction = z.infer<typeof approvalActionSchema>;
type TenantSettings = z.infer<typeof tenantSettingsSchema>;
type ConsentEvent = z.infer<typeof consentEventSchema>;
type OnboardingTest = z.infer<typeof onboardingTestSchema>;

@Injectable()
export class DashboardService {
  async me(user: DashboardUser) {
    return withTenant(user.tenantId, async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
      return {
        user,
        tenant: tenant
          ? {
              id: tenant.id,
              name: tenant.name,
              vertical: tenant.vertical,
              plan: tenant.plan,
              status: tenant.status,
              localeDefault: tenant.localeDefault,
              timezone: tenant.timezone,
            }
          : null,
      };
    });
  }

  async overview(user: DashboardUser) {
    return withTenant(user.tenantId, async (tx) => {
      const [metrics] = await tx.execute(sql`
        select
          count(*) filter (where m.direction = 'in' and m.created_at >= now() - interval '24 hours')::int as enquiries_today,
          count(*) filter (where m.status = 'pending_approval')::int as pending_approvals,
          count(*) filter (where l.status = 'hot' and l.created_at >= now() - interval '14 days')::int as hot_leads,
          coalesce(avg(extract(epoch from (out_msg.created_at - m.created_at))) filter (where out_msg.id is not null), 0)::int as avg_response_time_s,
          count(*) filter (where m.direction = 'out' and m.status in ('sent','delivered','read'))::int as sent_replies,
          count(*) filter (where m.direction = 'out' and m.sender_type = 'ai' and m.status in ('sent','delivered','read'))::int as ai_sent_replies
        from messages m
        left join leads l on l.conversation_id = m.conversation_id
        left join lateral (
          select id, created_at
          from messages mo
          where mo.conversation_id = m.conversation_id
            and mo.direction = 'out'
            and mo.created_at >= m.created_at
          order by mo.created_at asc
          limit 1
        ) out_msg on true
      `) as unknown as Array<Record<string, number>>;

      const approvals = await tx.execute(sql`
        select at.id, at.status, at.created_at, m.intent, m.confidence, m.content as draft,
               c.name as contact_name, c.phone
        from approval_tasks at
        join messages m on m.id = at.draft_message_id
        join conversations conv on conv.id = at.conversation_id
        join contacts c on c.id = conv.contact_id
        where at.status = 'pending'
        order by at.created_at asc
        limit 6
      `);

      const leadsRows = await tx.execute(sql`
        select l.id, l.status, l.score, l.value_estimate, l.captured_fields, l.created_at,
               c.name as contact_name, c.phone
        from leads l
        join contacts c on c.id = l.contact_id
        order by l.created_at desc
        limit 6
      `);

      const [latestRoi] = await tx
        .select()
        .from(roiReports)
        .where(eq(roiReports.tenantId, user.tenantId))
        .orderBy(desc(roiReports.generatedAt))
        .limit(1);

      const m = metrics ?? {};
      const sent = Number(m.sent_replies ?? 0);
      const aiSent = Number(m.ai_sent_replies ?? 0);
      return {
        metrics: {
          enquiriesToday: Number(m.enquiries_today ?? 0),
          pendingApprovals: Number(m.pending_approvals ?? 0),
          hotLeads: Number(m.hot_leads ?? 0),
          avgResponseTimeS: Number(m.avg_response_time_s ?? 0),
          autoSendRate: sent > 0 ? Number((aiSent / sent).toFixed(2)) : 0,
        },
        actionQueue: approvals,
        hotLeads: leadsRows,
        latestRoi,
      };
    });
  }

  async conversations(user: DashboardUser, query: ConversationQuery) {
    return withTenant(user.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        select conv.id, conv.status, conv.last_customer_msg_at, conv.window_expires_at, conv.created_at,
               c.name as contact_name, c.phone, c.wa_id,
               ch.type as channel_type,
               last_msg.content as last_message,
               last_msg.intent as last_intent,
               last_msg.status as last_message_status,
               last_msg.created_at as last_message_at,
               pending.id as pending_approval_id
        from conversations conv
        join contacts c on c.id = conv.contact_id
        join channels ch on ch.id = conv.channel_id
        left join lateral (
          select content, intent, status, created_at
          from messages m
          where m.conversation_id = conv.id
          order by m.created_at desc
          limit 1
        ) last_msg on true
        left join lateral (
          select id from approval_tasks at
          where at.conversation_id = conv.id and at.status = 'pending'
          order by at.created_at desc
          limit 1
        ) pending on true
        where (${query.status ? sql`conv.status = ${query.status}` : sql`true`})
          and (${query.intent ? sql`last_msg.intent = ${query.intent}` : sql`true`})
          and (${query.q ? sql`(c.name ilike ${`%${query.q}%`} or c.phone ilike ${`%${query.q}%`} or last_msg.content ilike ${`%${query.q}%`})` : sql`true`})
        order by coalesce(last_msg.created_at, conv.created_at) desc
        limit ${query.limit} offset ${query.offset}
      `);
      return { rows, limit: query.limit, offset: query.offset };
    });
  }

  async conversationDetail(user: DashboardUser, conversationId: string) {
    return withTenant(user.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        select conv.id, conv.status, conv.last_customer_msg_at, conv.window_expires_at,
               c.id as contact_id, c.name as contact_name, c.phone, c.wa_id, c.consent_status,
               ch.type as channel_type, ch.display_number
        from conversations conv
        join contacts c on c.id = conv.contact_id
        join channels ch on ch.id = conv.channel_id
        where conv.id = ${conversationId}
        limit 1
      `) as unknown as Array<Record<string, unknown>>;
      if (!rows[0]) throw new NotFoundException('Conversation not found');

      const timeline = await tx.execute(sql`
        select id, direction, sender_type, content, intent, language, confidence, cited_kb_ids,
               status, channel_msg_id, prompt_version, created_at
        from messages
        where conversation_id = ${conversationId}
        order by created_at asc
      `);
      const approvals = await tx.execute(sql`
        select at.id, at.status, at.owner_action, at.latency_ms, at.created_at, at.resolved_at,
               m.content as draft, m.intent, m.confidence
        from approval_tasks at
        join messages m on m.id = at.draft_message_id
        where at.conversation_id = ${conversationId}
        order by at.created_at desc
      `);
      return { conversation: rows[0], timeline, approvals };
    });
  }

  async applyApproval(user: DashboardUser, taskId: string, input: ApprovalAction) {
    await resolveApproval(user.tenantId, taskId, input.action, input.editedText);
    await this.audit(user, 'approval.resolve', 'approval_task', { taskId, action: input.action });
    return { status: 'ok' };
  }

  async knowledgeBase(user: DashboardUser, query: Pagination) {
    return withTenant(user.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(knowledgeBaseItems)
        .where(eq(knowledgeBaseItems.tenantId, user.tenantId))
        .orderBy(desc(knowledgeBaseItems.updatedAt))
        .limit(query.limit)
        .offset(query.offset);
      return { rows, limit: query.limit, offset: query.offset };
    });
  }

  async createKnowledgeBaseItem(user: DashboardUser, input: KbCreate) {
    const item = await withTenant(user.tenantId, async (tx) => {
      const [created] = await tx
        .insert(knowledgeBaseItems)
        .values({ ...input, tenantId: user.tenantId, structuredData: input.structuredData ?? null })
        .returning();
      return created;
    });
    await this.audit(user, 'kb.create', 'knowledge_base_item', { id: item.id, type: item.type });
    return item;
  }

  async updateKnowledgeBaseItem(user: DashboardUser, id: string, input: KbUpdate) {
    const item = await withTenant(user.tenantId, async (tx) => {
      const [updated] = await tx
        .update(knowledgeBaseItems)
        .set({ ...input, updatedAt: sql`now()` })
        .where(and(eq(knowledgeBaseItems.id, id), eq(knowledgeBaseItems.tenantId, user.tenantId)))
        .returning();
      return updated;
    });
    if (!item) throw new NotFoundException('Knowledge base item not found');
    await this.audit(user, 'kb.update', 'knowledge_base_item', { id });
    return item;
  }

  async intentPolicies(user: DashboardUser) {
    return withTenant(user.tenantId, async (tx) => tx.execute(sql`
      select intent_key, risk_class, state, approve_clean, edited, rejected, clean_rate, graduated_at, updated_at
      from intent_policies
      order by
        case risk_class when 'never_auto' then 1 when 'high' then 2 when 'med' then 3 else 4 end,
        intent_key asc
    `));
  }

  async leads(user: DashboardUser, query: Pagination) {
    return withTenant(user.tenantId, async (tx) => {
      const rows = await tx.execute(sql`
        select l.id, l.status, l.score, l.captured_fields, l.value_estimate, l.owner_notified_at, l.created_at,
               c.name as contact_name, c.phone, conv.status as conversation_status
        from leads l
        join contacts c on c.id = l.contact_id
        join conversations conv on conv.id = l.conversation_id
        where (${query.q ? sql`(c.name ilike ${`%${query.q}%`} or c.phone ilike ${`%${query.q}%`})` : sql`true`})
        order by l.created_at desc
        limit ${query.limit} offset ${query.offset}
      `);
      return { rows, limit: query.limit, offset: query.offset };
    });
  }

  async roi(user: DashboardUser) {
    return withTenant(user.tenantId, async (tx) => {
      const reports = await tx
        .select()
        .from(roiReports)
        .where(eq(roiReports.tenantId, user.tenantId))
        .orderBy(desc(roiReports.generatedAt))
        .limit(12);
      const [pilot] = await tx.execute(sql`
        select
          count(*) filter (where m.direction = 'in')::int as enquiries_handled,
          count(distinct l.id)::int as leads_captured,
          count(distinct a.id)::int as appointments_booked,
          coalesce(sum(l.value_estimate), 0)::numeric as revenue_recovered_est,
          coalesce(avg(extract(epoch from (out_msg.created_at - m.created_at))) filter (where out_msg.id is not null), 0)::int as avg_response_time_s
        from messages m
        left join leads l on l.conversation_id = m.conversation_id
        left join appointments a on a.lead_id = l.id
        left join lateral (
          select id, created_at
          from messages mo
          where mo.conversation_id = m.conversation_id and mo.direction = 'out' and mo.created_at >= m.created_at
          order by mo.created_at asc
          limit 1
        ) out_msg on true
        where m.created_at >= now() - interval '14 days'
      `) as unknown as Array<Record<string, unknown>>;
      return { reports, pilot14Day: pilot ?? {} };
    });
  }

  async settings(user: DashboardUser) {
    return withTenant(user.tenantId, async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId)).limit(1);
      const channels = await tx.execute(sql`
        select id, type, provider, provider_account_id, provider_number_id, display_number, status, quality_rating, created_at
        from channels
        order by created_at desc
      `);
      const [subscription] = await tx.execute(sql`
        select plan, status, setup_paid, mrr, current_period_end, created_at
        from subscriptions
        order by created_at desc
        limit 1
      `) as unknown as Array<Record<string, unknown>>;
      return { tenant, channels, subscription };
    });
  }

  async updateSettings(user: DashboardUser, input: TenantSettings) {
    const tenant = await withTenant(user.tenantId, async (tx) => {
      const [updated] = await tx.update(tenants).set(input).where(eq(tenants.id, user.tenantId)).returning();
      return updated;
    });
    await this.audit(user, 'tenant.update', 'tenant', { changed: Object.keys(input) });
    return tenant;
  }

  async compliance(user: DashboardUser, query: Pagination) {
    return withTenant(user.tenantId, async (tx) => {
      const consents = await tx.execute(sql`
        select cl.id, cl.contact_id, c.name as contact_name, c.phone, cl.purpose, cl.basis, cl.event, cl.at
        from consent_logs cl
        join contacts c on c.id = cl.contact_id
        order by cl.at desc
        limit ${query.limit} offset ${query.offset}
      `);
      const audits = await tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.tenantId, user.tenantId))
        .orderBy(desc(auditLogs.at))
        .limit(20);
      return { consents, audits };
    });
  }

  async recordConsent(user: DashboardUser, input: ConsentEvent) {
    const row = await withTenant(user.tenantId, async (tx) => {
      const [contact] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, input.contactId), eq(contacts.tenantId, user.tenantId)))
        .limit(1);
      if (!contact) throw new NotFoundException('Contact not found');
      if (input.event === 'opt_out') {
        await tx.update(contacts).set({ consentStatus: 'opted_out' }).where(eq(contacts.id, input.contactId));
      }
      if (input.event === 'opt_in') {
        await tx.update(contacts).set({ consentStatus: 'opted_in', optInAt: sql`now()` }).where(eq(contacts.id, input.contactId));
      }
      const [created] = await tx.insert(consentLogs).values({ ...input, tenantId: user.tenantId }).returning();
      return created;
    });
    await this.audit(user, 'consent.record', 'contact', { contactId: input.contactId, event: input.event });
    return row;
  }

  async billing(user: DashboardUser) {
    const data = await this.settings(user);
    return {
      subscription: data.subscription,
      razorpay: {
        configured: false,
        note: 'Razorpay is scaffolded as a safe display surface; payment mutation endpoints should be added only after webhook verification is implemented.',
      },
    };
  }

  async runOnboardingTest(user: DashboardUser, input: OnboardingTest) {
    const settings = await this.settings(user);
    const channel = Array.isArray(settings.channels) ? settings.channels[0] as Record<string, unknown> : null;
    const phoneNumberId = typeof channel?.provider_number_id === 'string' ? channel.provider_number_id : null;
    if (!phoneNumberId) throw new NotFoundException('No active channel configured for test');
    const id = `wamid.dashboard-test-${Date.now()}`;
    await handleInboundEvent({
      provider: 'whatsapp',
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: phoneNumberId },
                  contacts: [{ wa_id: input.customerPhone, profile: { name: input.customerName } }],
                  messages: [{ from: input.customerPhone, id, type: 'text', text: { body: input.message } }],
                },
              },
            ],
          },
        ],
      },
    });
    await this.audit(user, 'onboarding.test_inbound', 'channel', { phoneNumberId });
    return { status: 'queued', channelMsgId: id };
  }

  private async audit(user: DashboardUser, action: string, entity: string, after: Record<string, unknown>) {
    await withTenant(user.tenantId, async (tx) => {
      await tx.insert(auditLogs).values({
        tenantId: user.tenantId,
        actor: user.userId ?? user.authMode,
        action,
        entity,
        after,
      });
    });
  }
}
