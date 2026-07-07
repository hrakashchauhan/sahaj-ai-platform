import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  vector,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ────────────────────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────────────────────
export const planEnum = pgEnum('plan', ['starter', 'growth', 'scale']);
export const tenantStatusEnum = pgEnum('tenant_status', ['trial', 'active', 'paused', 'churned']);
export const userRoleEnum = pgEnum('user_role', ['owner', 'staff', 'internal_admin']);
export const notifyChannelEnum = pgEnum('notify_channel', ['telegram', 'whatsapp']);
export const channelTypeEnum = pgEnum('channel_type', ['whatsapp', 'instagram', 'gbm']);
export const channelStatusEnum = pgEnum('channel_status', ['active', 'disabled', 'pending']);
export const directionEnum = pgEnum('direction', ['in', 'out']);
export const senderTypeEnum = pgEnum('sender_type', ['customer', 'ai', 'human', 'system']);
export const msgStatusEnum = pgEnum('msg_status', [
  'received', 'draft', 'pending_approval', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'discarded',
]);
export const convStatusEnum = pgEnum('conv_status', ['open', 'waiting_approval', 'closed']);
export const kbTypeEnum = pgEnum('kb_type', ['faq', 'price', 'service', 'hours', 'location', 'policy']);
export const intentStateEnum = pgEnum('intent_state', ['manual', 'auto_candidate', 'auto']);
export const riskClassEnum = pgEnum('risk_class', ['low', 'med', 'high', 'never_auto']);
export const approvalStatusEnum = pgEnum('approval_status', [
  'pending', 'approved', 'edited', 'rejected', 'expired',
]);
export const leadStatusEnum = pgEnum('lead_status', ['new', 'qualified', 'hot', 'booked', 'lost']);

const id = () => uuid('id').defaultRandom().primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

// ────────────────────────────────────────────────────────────────────────────
// Tenancy root
// ────────────────────────────────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  vertical: text('vertical'), // dental | cosmetic | immigration | interior | real_estate | ...
  plan: planEnum('plan').default('starter').notNull(),
  status: tenantStatusEnum('status').default('trial').notNull(),
  localeDefault: text('locale_default').default('hi-IN').notNull(),
  timezone: text('timezone').default('Asia/Kolkata').notNull(),
  persona: text('persona'), // tone/voice instructions injected into the prompt
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: id(),
  tenantId: tenantId(),
  role: userRoleEnum('role').default('owner').notNull(),
  name: text('name'),
  phone: text('phone'),
  email: text('email'),
  authId: text('auth_id'), // Supabase auth user id (dashboard login)
  notifyChannel: notifyChannelEnum('notify_channel').default('telegram').notNull(),
  telegramChatId: text('telegram_chat_id'),
  createdAt: createdAt(),
}, (t) => ({
  byTenant: index('users_tenant_idx').on(t.tenantId),
  byTelegram: index('users_telegram_idx').on(t.telegramChatId),
}));

// ────────────────────────────────────────────────────────────────────────────
// Channels (WhatsApp / IG / GBM numbers) + encrypted credentials
// ────────────────────────────────────────────────────────────────────────────
export const channels = pgTable('channels', {
  id: id(),
  tenantId: tenantId(),
  type: channelTypeEnum('type').default('whatsapp').notNull(),
  provider: text('provider').default('meta').notNull(), // meta | 360dialog | gupshup
  providerAccountId: text('provider_account_id'), // WABA id / IG account id
  providerNumberId: text('provider_number_id').notNull(), // phone_number_id — the webhook join key
  displayNumber: text('display_number'),
  status: channelStatusEnum('status').default('pending').notNull(),
  qualityRating: text('quality_rating'), // GREEN | YELLOW | RED
  createdAt: createdAt(),
}, (t) => ({
  byNumber: uniqueIndex('channels_provider_number_idx').on(t.providerNumberId),
  byTenant: index('channels_tenant_idx').on(t.tenantId),
}));

export const channelCredentials = pgTable('channel_credentials', {
  id: id(),
  tenantId: tenantId(),
  channelId: uuid('channel_id').notNull(),
  tokenCiphertext: text('token_ciphertext').notNull(), // encrypted access token — never logged
  refreshAt: timestamp('refresh_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// ────────────────────────────────────────────────────────────────────────────
// Contacts / Conversations / Messages
// ────────────────────────────────────────────────────────────────────────────
export const contacts = pgTable('contacts', {
  id: id(),
  tenantId: tenantId(),
  waId: text('wa_id'), // WhatsApp id (usually the phone in intl format)
  phone: text('phone'),
  igId: text('ig_id'),
  name: text('name'),
  locale: text('locale'),
  consentStatus: text('consent_status').default('implied').notNull(), // implied | opted_in | opted_out
  optInAt: timestamp('opt_in_at', { withTimezone: true }),
  firstSeen: createdAt(),
}, (t) => ({
  byTenantWa: uniqueIndex('contacts_tenant_wa_idx').on(t.tenantId, t.waId),
}));

export const conversations = pgTable('conversations', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  status: convStatusEnum('status').default('open').notNull(),
  lastCustomerMsgAt: timestamp('last_customer_msg_at', { withTimezone: true }),
  windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }), // 24h service window
  assignedTo: uuid('assigned_to'),
  createdAt: createdAt(),
}, (t) => ({
  byTenant: index('conversations_tenant_idx').on(t.tenantId),
  byContact: index('conversations_contact_idx').on(t.contactId),
}));

export const messages = pgTable('messages', {
  id: id(),
  tenantId: tenantId(),
  conversationId: uuid('conversation_id').notNull(),
  direction: directionEnum('direction').notNull(),
  senderType: senderTypeEnum('sender_type').notNull(),
  channelMsgId: text('channel_msg_id'), // provider message id (dedupe + status correlation)
  content: text('content'),
  mediaRef: text('media_ref'), // R2 object key for media
  intent: text('intent'),
  language: text('language'),
  confidence: numeric('confidence'),
  citedKbIds: uuid('cited_kb_ids').array(),
  status: msgStatusEnum('status').default('received').notNull(),
  templateName: text('template_name'),
  promptVersion: text('prompt_version'),
  createdAt: createdAt(),
}, (t) => ({
  byConversation: index('messages_conversation_idx').on(t.conversationId),
  byChannelMsg: index('messages_channel_msg_idx').on(t.channelMsgId),
  // Idempotency guarantee: a provider message id is unique per tenant (partial —
  // outbound drafts have null channel_msg_id until sent). Backs ingestion dedup.
  channelMsgUq: uniqueIndex('messages_tenant_channel_msg_uq')
    .on(t.tenantId, t.channelMsgId)
    .where(sql`${t.channelMsgId} is not null`),
}));

export const messageEvents = pgTable('message_events', {
  id: id(),
  tenantId: tenantId(),
  messageId: uuid('message_id').notNull(),
  event: text('event').notNull(), // sent | delivered | read | failed
  detail: jsonb('detail'),
  at: createdAt(),
});

// ────────────────────────────────────────────────────────────────────────────
// Knowledge base (structured, per tenant) — grounding source
// ────────────────────────────────────────────────────────────────────────────
export const knowledgeBaseItems = pgTable('knowledge_base_items', {
  id: id(),
  tenantId: tenantId(),
  type: kbTypeEnum('type').notNull(),
  question: text('question'),
  answer: text('answer'),
  structuredData: jsonb('structured_data'), // e.g. { service, price, currency } for `price` rows
  embedding: vector('embedding', { dimensions: 768 }),
  isActive: boolean('is_active').default(true).notNull(),
  source: text('source'), // manual | website | gbp | pdf
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byTenant: index('kb_tenant_idx').on(t.tenantId),
}));

// ────────────────────────────────────────────────────────────────────────────
// Intent policy (the auto-send trust ladder, per tenant+intent)
// ────────────────────────────────────────────────────────────────────────────
export const intentPolicies = pgTable('intent_policies', {
  id: id(),
  tenantId: tenantId(),
  intentKey: text('intent_key').notNull(),
  riskClass: riskClassEnum('risk_class').default('med').notNull(),
  state: intentStateEnum('state').default('manual').notNull(),
  approveClean: integer('approve_clean').default(0).notNull(),
  edited: integer('edited').default(0).notNull(),
  rejected: integer('rejected').default(0).notNull(),
  cleanRate: numeric('clean_rate').default('0').notNull(),
  graduatedAt: timestamp('graduated_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byTenantIntent: uniqueIndex('intent_policies_tenant_intent_idx').on(t.tenantId, t.intentKey),
}));

// ────────────────────────────────────────────────────────────────────────────
// Approvals / Leads / Appointments
// ────────────────────────────────────────────────────────────────────────────
export const approvalTasks = pgTable('approval_tasks', {
  id: id(),
  tenantId: tenantId(),
  conversationId: uuid('conversation_id').notNull(),
  draftMessageId: uuid('draft_message_id').notNull(),
  status: approvalStatusEnum('status').default('pending').notNull(),
  ownerAction: text('owner_action'),
  actionBy: uuid('action_by'),
  deliveryChannel: notifyChannelEnum('delivery_channel').default('telegram').notNull(),
  notifRef: text('notif_ref'), // telegram message id, for edits/cleanup
  latencyMs: integer('latency_ms'),
  createdAt: createdAt(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => ({
  byTenant: index('approval_tasks_tenant_idx').on(t.tenantId),
  byDraft: index('approval_tasks_draft_idx').on(t.draftMessageId),
}));

export const leads = pgTable('leads', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  status: leadStatusEnum('status').default('new').notNull(),
  score: integer('score').default(0).notNull(),
  capturedFields: jsonb('captured_fields'), // { name, phone, service, ... }
  valueEstimate: numeric('value_estimate'),
  ownerNotifiedAt: timestamp('owner_notified_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({
  byTenant: index('leads_tenant_idx').on(t.tenantId),
}));

export const appointments = pgTable('appointments', {
  id: id(),
  tenantId: tenantId(),
  leadId: uuid('lead_id'),
  contactId: uuid('contact_id').notNull(),
  calendarEventId: text('calendar_event_id'),
  startAt: timestamp('start_at', { withTimezone: true }),
  endAt: timestamp('end_at', { withTimezone: true }),
  service: text('service'),
  status: text('status').default('proposed').notNull(),
  createdAt: createdAt(),
});

// ────────────────────────────────────────────────────────────────────────────
// Reporting / Billing / Compliance
// ────────────────────────────────────────────────────────────────────────────
export const roiReports = pgTable('roi_reports', {
  id: id(),
  tenantId: tenantId(),
  period: text('period').notNull(), // YYYY-MM
  enquiriesHandled: integer('enquiries_handled').default(0).notNull(),
  leadsCaptured: integer('leads_captured').default(0).notNull(),
  appointmentsBooked: integer('appointments_booked').default(0).notNull(),
  revenueRecoveredEst: numeric('revenue_recovered_est').default('0').notNull(),
  avgResponseTimeS: integer('avg_response_time_s').default(0).notNull(),
  autoSendRate: numeric('auto_send_rate').default('0').notNull(),
  pdfRef: text('pdf_ref'),
  generatedAt: createdAt(),
}, (t) => ({
  byTenantPeriod: uniqueIndex('roi_reports_tenant_period_idx').on(t.tenantId, t.period),
}));

export const subscriptions = pgTable('subscriptions', {
  id: id(),
  tenantId: tenantId(),
  plan: planEnum('plan').default('starter').notNull(),
  razorpaySubscriptionId: text('razorpay_subscription_id'),
  status: text('status').default('created').notNull(),
  setupPaid: boolean('setup_paid').default(false).notNull(),
  mrr: numeric('mrr').default('0').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: createdAt(),
});

export const consentLogs = pgTable('consent_logs', {
  id: id(),
  tenantId: tenantId(),
  contactId: uuid('contact_id').notNull(),
  purpose: text('purpose').notNull(),
  basis: text('basis').notNull(), // consent | contract | legitimate_interest
  event: text('event').notNull(), // opt_in | opt_out | data_export | data_delete
  at: createdAt(),
});

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  tenantId: tenantId(),
  actor: text('actor'),
  action: text('action').notNull(),
  entity: text('entity'),
  before: jsonb('before'),
  after: jsonb('after'),
  at: createdAt(),
});

// List of tenant-scoped tables — consumed by apply-rls.ts to enable RLS uniformly.
export const TENANT_SCOPED_TABLES = [
  'users', 'channels', 'channel_credentials', 'contacts', 'conversations',
  'messages', 'message_events', 'knowledge_base_items', 'intent_policies',
  'approval_tasks', 'leads', 'appointments', 'roi_reports', 'subscriptions',
  'consent_logs', 'audit_logs',
] as const;
