import { desc, eq } from 'drizzle-orm';
import { withTenant } from '../tenancy/tenant-context';
import { tenants, users, messages, conversations, contacts, leads } from '../db/schema';
import { loadKb, renderKbContext, kbPrices } from './kb';
import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION } from './prompt';
import { llm } from './llm';
import { aiOutputSchema } from './types';
import { validateDraft } from './validation';
import { getOrCreateIntentPolicy } from '../approvals/intent-policy';
import { createApprovalAndNotify } from '../approvals/approval.service';
import { notifyEscalation } from '../approvals/telegram.client';
import { decide } from '../policy/decision';
import { outboundQueue, type AiJob } from '../queue/queues';
import { env } from '../config/env';

/**
 * The product's brain: one grounded LLM call → guardrails → decision → send-or-approve.
 * Escalation fires in parallel, independent of the approval outcome.
 */
export async function runPipeline(job: AiJob): Promise<void> {
  await withTenant(job.tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, job.tenantId)).limit(1);
    if (!tenant) return;
    const [inbound] = await tx.select().from(messages).where(eq(messages.id, job.messageId)).limit(1);
    if (!inbound || !inbound.content) return;
    const [conv] = await tx.select().from(conversations).where(eq(conversations.id, job.conversationId)).limit(1);
    if (!conv) return;
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, conv.contactId)).limit(1);
    const [owner] = await tx.select().from(users).where(eq(users.tenantId, job.tenantId)).limit(1);

    // ── Grounding context (context-stuffed KB) + short history ──────────────
    const kbItems = await loadKb(tx, job.tenantId);
    const kbContext = renderKbContext(kbItems);
    const history = await tx
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(desc(messages.createdAt))
      .limit(6);
    const historyText = history
      .reverse()
      .map((m) => `${m.senderType === 'customer' ? 'Customer' : 'Us'}: ${m.content ?? ''}`)
      .join('\n');

    // ── Single LLM call ─────────────────────────────────────────────────────
    const system = buildSystemPrompt({
      businessName: tenant.name,
      vertical: tenant.vertical,
      persona: tenant.persona,
      locale: tenant.localeDefault,
    });
    const user = buildUserPrompt({ kbContext, history: historyText, customerMessage: inbound.content });

    let ai;
    try {
      const raw = await llm.generateJson(system, user);
      ai = aiOutputSchema.parse(JSON.parse(raw));
    } catch (err) {
      console.error('AI generation/parse failed — escalating', err);
      ai = aiOutputSchema.parse({
        intent: 'other',
        confidence: 0,
        draft_reply: 'Let me check with the team and get back to you shortly. 🙏',
        needs_escalation: true,
      });
    }

    // ── Deterministic guardrails ────────────────────────────────────────────
    const validation = validateDraft(
      ai,
      kbPrices(kbItems),
      kbItems.map((i) => i.id),
    );

    // ── Persist the draft outbound message ──────────────────────────────────
    const [draft] = await tx
      .insert(messages)
      .values({
        tenantId: job.tenantId,
        conversationId: conv.id,
        direction: 'out',
        senderType: 'ai',
        content: ai.draft_reply,
        intent: ai.intent,
        language: ai.language,
        confidence: validation.confidence.toFixed(4),
        citedKbIds: ai.cited_kb_ids.length ? ai.cited_kb_ids : null,
        status: 'draft',
        promptVersion: PROMPT_VERSION,
      })
      .returning();

    // ── Lead capture / qualification ────────────────────────────────────────
    if (ai.lead_slots?.phone || ai.lead_slots?.name || ai.intent === 'booking') {
      await tx.insert(leads).values({
        tenantId: job.tenantId,
        contactId: conv.contactId,
        conversationId: conv.id,
        status: ai.needs_escalation ? 'hot' : 'qualified',
        score: ai.intent === 'booking' ? 70 : 40,
        capturedFields: ai.lead_slots,
        ownerNotifiedAt: ai.needs_escalation ? new Date() : null,
      });
    }

    // ── Escalation (parallel to approval) ───────────────────────────────────
    if (ai.needs_escalation && owner?.telegramChatId) {
      await notifyEscalation(owner.telegramChatId, {
        summary: `${tenant.name}: ${ai.lead_slots?.intent_summary ?? inbound.content}`,
        contact: contact?.phone ?? contact?.waId ?? 'unknown',
      });
    }

    // ── Decision: auto-send or human approval ───────────────────────────────
    const policy = await getOrCreateIntentPolicy(tx, job.tenantId, ai.intent);
    const withinWindow = conv.windowExpiresAt
      ? new Date(conv.windowExpiresAt as unknown as string).getTime() > Date.now()
      : true;
    const decision = decide({
      intentState: policy.state,
      riskClass: policy.riskClass,
      confidence: validation.confidence,
      forceApproval: validation.forceApproval,
      withinWindow,
      threshold: env.AUTOSEND_CONFIDENCE_THRESHOLD,
    });

    if (decision === 'auto_send') {
      await tx.update(messages).set({ status: 'queued' }).where(eq(messages.id, draft.id));
      await outboundQueue.add('send', { tenantId: job.tenantId, messageId: draft.id });
    } else {
      await createApprovalAndNotify(tx, {
        tenantId: job.tenantId,
        conversationId: conv.id,
        draftMessageId: draft.id,
        ownerChatId: owner?.telegramChatId ?? null,
        customerMsg: inbound.content,
        draft: ai.draft_reply,
        intent: ai.intent,
        confidence: validation.confidence,
      });
    }
  });
}
