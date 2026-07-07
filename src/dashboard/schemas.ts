import { z } from 'zod';

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().max(120).optional(),
});

export const conversationQuerySchema = paginationSchema.extend({
  status: z.enum(['open', 'waiting_approval', 'closed']).optional(),
  intent: z.string().trim().max(80).optional(),
});

export const kbCreateSchema = z.object({
  type: z.enum(['faq', 'price', 'service', 'hours', 'location', 'policy']),
  question: z.string().trim().min(1).max(240),
  answer: z.string().trim().min(1).max(2000),
  structuredData: z.record(z.unknown()).nullable().optional(),
  source: z.string().trim().max(80).default('manual'),
  isActive: z.boolean().default(true),
});

export const kbUpdateSchema = kbCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const approvalActionSchema = z.object({
  action: z.enum(['approve', 'edit', 'reject']),
  editedText: z.string().trim().min(1).max(2000).optional(),
}).refine((v) => v.action !== 'edit' || !!v.editedText, {
  message: 'editedText is required when action is edit',
});

export const tenantSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  vertical: z.string().trim().max(80).nullable().optional(),
  localeDefault: z.string().trim().min(2).max(24).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  persona: z.string().trim().max(1200).nullable().optional(),
});

export const consentEventSchema = z.object({
  contactId: z.string().uuid(),
  event: z.enum(['opt_in', 'opt_out', 'data_export', 'data_delete']),
  purpose: z.string().trim().min(1).max(120).default('customer_support'),
  basis: z.enum(['consent', 'contract', 'legitimate_interest']).default('legitimate_interest'),
});

export const onboardingTestSchema = z.object({
  customerPhone: z.string().trim().min(8).max(24).default('919812345678'),
  customerName: z.string().trim().max(80).default('Asha'),
  message: z.string().trim().min(1).max(1000),
});
