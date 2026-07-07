import { and, eq } from 'drizzle-orm';
import { withTenant } from '../tenancy/tenant-context';
import {
  messages,
  conversations,
  contacts,
  channels,
  channelCredentials,
  messageEvents,
} from '../db/schema';
import { sendWhatsAppText } from './whatsapp.client';
import { decryptSecret } from '../lib/crypto';
import type { OutboundJob } from '../queue/queues';

/**
 * Sends a queued outbound message with AT-MOST-ONCE semantics (never double-send).
 *
 * Design (avoids the "external side-effect inside a DB transaction + retry" duplicate-send trap):
 *  1. Atomically CLAIM the message queued→sending in its own tx. If no row is claimed
 *     (already sending/sent/discarded, or a duplicate/retried job), stop — idempotent no-op.
 *  2. Read recipient/channel/token in a read-only tx.
 *  3. Send the WhatsApp HTTP request OUTSIDE any DB transaction.
 *  4. Record sent/failed in a separate committed tx.
 * On failure we do NOT rethrow: a retry could double-send (the first attempt may have
 * reached Meta even if the response was lost). We mark 'failed' and record it instead.
 */
export async function processOutbound(job: OutboundJob): Promise<void> {
  // 1) Claim.
  const claimed = await withTenant(job.tenantId, async (tx) => {
    const rows = await tx
      .update(messages)
      .set({ status: 'sending' })
      .where(and(eq(messages.id, job.messageId), eq(messages.status, 'queued')))
      .returning();
    return rows[0] ?? null;
  });
  if (!claimed || !claimed.content) return; // already handled, or empty draft

  // 2) Resolve recipient + credentials.
  const ctx = await withTenant(job.tenantId, async (tx) => {
    const [conv] = await tx.select().from(conversations).where(eq(conversations.id, claimed.conversationId)).limit(1);
    if (!conv) return null;
    const [contact] = await tx.select().from(contacts).where(eq(contacts.id, conv.contactId)).limit(1);
    const [channel] = await tx.select().from(channels).where(eq(channels.id, conv.channelId)).limit(1);

    let token: string | undefined;
    const [cred] = await tx.select().from(channelCredentials).where(eq(channelCredentials.channelId, conv.channelId)).limit(1);
    if (cred?.tokenCiphertext) {
      try {
        token = decryptSecret(cred.tokenCiphertext);
      } catch (e) {
        console.error('Failed to decrypt channel credential; using env fallback', e);
      }
    }
    return { to: contact?.waId ?? contact?.phone ?? '', phoneNumberId: channel?.providerNumberId ?? undefined, token };
  });

  if (!ctx || !ctx.to) {
    await finalize(job.tenantId, claimed.id, 'failed', { reason: 'no recipient' });
    return;
  }

  // 3) Send outside any transaction. 4) Record outcome.
  try {
    const result = await sendWhatsAppText({ token: ctx.token, phoneNumberId: ctx.phoneNumberId, to: ctx.to, body: claimed.content });
    await finalize(job.tenantId, claimed.id, 'sent', { mock: result.mock }, result.channelMsgId ?? undefined);
  } catch (err) {
    // At-most-once: record failure, do NOT rethrow (a retry might double-send).
    console.error(`Outbound send failed for message ${claimed.id}:`, err);
    await finalize(job.tenantId, claimed.id, 'failed', { error: String(err) });
  }
}

async function finalize(
  tenantId: string,
  messageId: string,
  status: 'sent' | 'failed',
  detail: Record<string, unknown>,
  channelMsgId?: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(messages)
      .set({ status, ...(channelMsgId ? { channelMsgId } : {}) })
      .where(eq(messages.id, messageId));
    await tx.insert(messageEvents).values({ tenantId, messageId, event: status, detail });
  });
}
