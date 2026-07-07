import { and, eq, sql } from 'drizzle-orm';
import { resolveTenantByNumber, withTenant } from '../tenancy/tenant-context';
import { channels, contacts, conversations, messages } from '../db/schema';
import { aiQueue, type InboundJob } from '../queue/queues';

interface WaMessage {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
}
interface WaValue {
  metadata?: { phone_number_id: string };
  contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
  messages?: WaMessage[];
  statuses?: unknown[];
}

/**
 * Parses a Meta webhook payload, resolves the tenant by phone_number_id, then
 * persists the contact/conversation/message and enqueues the AI reply job.
 * Sets the 24h service window on every inbound customer message.
 */
export async function handleInboundEvent(job: InboundJob): Promise<void> {
  const body = job.body as { entry?: Array<{ changes?: Array<{ value?: WaValue }> }> };
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue; // status-only callbacks handled elsewhere (V1)

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const tenantId = await resolveTenantByNumber(phoneNumberId);
      if (!tenantId) {
        console.warn(`No active tenant for phone_number_id=${phoneNumberId} — dropping event`);
        continue;
      }

      for (const m of value.messages) {
        const text = m.text?.body ?? `[${m.type} message]`;
        const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        await ingestOne(tenantId, phoneNumberId, m.from, name, m.id, text);
      }
    }
  }
}

async function ingestOne(
  tenantId: string,
  phoneNumberId: string,
  waId: string,
  name: string | undefined,
  channelMsgId: string,
  text: string,
): Promise<void> {
  // All DB work happens in the tenant transaction; the AI job is enqueued AFTER commit
  // (so it never references an uncommitted row) and ONLY if this message was newly inserted.
  const enqueue = await withTenant(tenantId, async (tx) => {
    const [channel] = await tx.select().from(channels).where(eq(channels.providerNumberId, phoneNumberId)).limit(1);
    if (!channel) return null;

    // Upsert contact.
    let [contact] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.waId, waId)))
      .limit(1);
    if (!contact) {
      [contact] = await tx.insert(contacts).values({ tenantId, waId, phone: waId, name: name ?? null }).returning();
    }

    // Find or open a conversation, (re)setting the 24h service window.
    const windowExpires = sql`now() + interval '24 hours'`;
    let [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.contactId, contact.id), eq(conversations.status, 'open')))
      .limit(1);
    if (!conv) {
      [conv] = await tx
        .insert(conversations)
        .values({
          tenantId,
          contactId: contact.id,
          channelId: channel.id,
          status: 'open',
          lastCustomerMsgAt: sql`now()`,
          windowExpiresAt: windowExpires,
        })
        .returning();
    } else {
      await tx
        .update(conversations)
        .set({ lastCustomerMsgAt: sql`now()`, windowExpiresAt: windowExpires })
        .where(eq(conversations.id, conv.id));
    }

    // Idempotent insert — the (tenant_id, channel_msg_id) unique index makes dedup
    // atomic under concurrency/redelivery. If the row already exists, nothing is
    // returned and we do NOT enqueue a second AI reply.
    const inserted = await tx
      .insert(messages)
      .values({
        tenantId,
        conversationId: conv.id,
        direction: 'in',
        senderType: 'customer',
        channelMsgId,
        content: text,
        status: 'received',
      })
      .onConflictDoNothing()
      .returning();

    if (!inserted[0]) return null; // duplicate delivery — already processed
    return { conversationId: conv.id, messageId: inserted[0].id };
  });

  if (enqueue) {
    // jobId dedups redelivered events at the queue level too (belt-and-suspenders).
    await aiQueue.add('reply', { tenantId, ...enqueue }, { jobId: enqueue.messageId });
  }
}
