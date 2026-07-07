import { z } from 'zod';

export const RISK_CLASSES = ['low', 'med', 'high', 'never_auto'] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

/** The single structured object the LLM must return (one call per turn). */
export const aiOutputSchema = z.object({
  language: z.string().default('hi-IN'),
  intent: z.string().min(1).default('other'), // hours | pricing | booking | location | services | complaint | human_request | other
  confidence: z.number().min(0).max(1),
  // Reject empty/whitespace-only drafts (a truncated or blank reply must not be sendable).
  draft_reply: z.string().trim().min(1),
  cited_kb_ids: z.array(z.string()).default([]),
  lead_slots: z
    .object({
      name: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      service: z.string().nullable().optional(),
      intent_summary: z.string().nullable().optional(),
    })
    .default({}),
  needs_escalation: z.boolean().default(false),
  restricted_claim_flag: z.boolean().default(false),
});
export type AiOutput = z.infer<typeof aiOutputSchema>;

/**
 * Default risk class per intent. Pricing / medical / legal NEVER auto-graduate —
 * a wrong price or clinical claim damages the client, so a human stays in the loop
 * by policy, not by luck.
 */
export const INTENT_RISK: Record<string, RiskClass> = {
  greeting: 'low',
  hours: 'low',
  location: 'low',
  services: 'low',
  faq: 'low',
  booking: 'med',
  other: 'med',
  pricing: 'never_auto',
  medical: 'never_auto',
  legal: 'never_auto',
  complaint: 'high',
  human_request: 'high',
};

export function riskForIntent(intent: string): RiskClass {
  return INTENT_RISK[intent] ?? 'med';
}
