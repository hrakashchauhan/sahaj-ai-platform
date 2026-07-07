import { and, eq, sql } from 'drizzle-orm';
import { withTenant } from '../tenancy/tenant-context';
import type { Tx } from '../db';
import { approvalTasks, messages, conversations } from '../db/schema';
import { notifyApproval } from './telegram.client';
import { recordOutcome } from './intent-policy';
import { outboundQueue } from '../queue/queues';
import { cache } from '../lib/cache';

/** Creates a pending ApprovalTask, flips message/conversation state, and pushes to the owner. */
export async function createApprovalAndNotify(
  tx: Tx,
  opts: {
    tenantId: string;
    conversationId: string;
    draftMessageId: string;
    ownerChatId: string | null;
    customerMsg: string;
    draft: string;
    intent: string;
    confidence: number;
  },
): Promise<void> {
  const [task] = await tx
    .insert(approvalTasks)
    .values({
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      draftMessageId: opts.draftMessageId,
      status: 'pending',
      deliveryChannel: 'telegram',
    })
    .returning();

  await tx.update(messages).set({ status: 'pending_approval' }).where(eq(messages.id, opts.draftMessageId));
  await tx.update(conversations).set({ status: 'waiting_approval' }).where(eq(conversations.id, opts.conversationId));

  // The Telegram callback has no tenant scope of its own — stash the mapping in Redis.
  await cache.set(`appr:${task.id}`, JSON.stringify({ tenantId: opts.tenantId }), 'EX', 7 * 24 * 3600);

  const notifRef = await notifyApproval(opts.ownerChatId ?? 'mock', {
    taskId: task.id,
    customerMsg: opts.customerMsg,
    draft: opts.draft,
    intent: opts.intent,
    confidence: opts.confidence,
  });
  if (notifRef) {
    await tx.update(approvalTasks).set({ notifRef }).where(eq(approvalTasks.id, task.id));
  }
}

/** Applies the owner's decision from Telegram: approve / edit / reject. */
export async function resolveApproval(
  tenantId: string,
  taskId: string,
  action: 'approve' | 'edit' | 'reject',
  editedText?: string,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const edited = action === 'edit' && !!editedText && editedText.trim().length > 0;
    const finalStatus = action === 'reject' ? 'rejected' : edited ? 'edited' : 'approved';

    // Atomically CLAIM the task (pending → resolved). If two owner taps race, only the
    // first UPDATE matches `status='pending'` and returns a row — the second no-ops.
    // This is the double-tap / TOCTOU guard.
    const claimed = await tx
      .update(approvalTasks)
      .set({ status: finalStatus, ownerAction: action, resolvedAt: sql`now()` })
      .where(and(eq(approvalTasks.id, taskId), eq(approvalTasks.status, 'pending')))
      .returning();
    const task = claimed[0];
    if (!task) return; // already resolved elsewhere

    const [msg] = await tx.select().from(messages).where(eq(messages.id, task.draftMessageId)).limit(1);
    if (!msg) return;

    const latencyMs = Date.now() - new Date(task.createdAt as unknown as string).getTime();
    await tx.update(approvalTasks).set({ latencyMs }).where(eq(approvalTasks.id, task.id));
    const intentKey = msg.intent ?? 'other';

    if (action === 'reject') {
      await tx.update(messages).set({ status: 'discarded' }).where(eq(messages.id, msg.id));
      await recordOutcome(tx, tenantId, intentKey, 'rejected');
    } else {
      if (edited) {
        await tx.update(messages).set({ content: editedText!, senderType: 'human' }).where(eq(messages.id, msg.id));
      }
      await tx.update(messages).set({ status: 'queued' }).where(eq(messages.id, msg.id));
      await recordOutcome(tx, tenantId, intentKey, edited ? 'edited' : 'clean');
      // jobId dedups if this path somehow runs twice; outbound also re-checks status.
      await outboundQueue.add('send', { tenantId, messageId: msg.id }, { jobId: `send-${msg.id}` });
    }

    await tx.update(conversations).set({ status: 'open' }).where(eq(conversations.id, task.conversationId));
  });
}
