import { getBot } from './telegram.client';
import { resolveApproval } from './approval.service';
import { cache } from '../lib/cache';

/**
 * Registers the owner-approval bot handlers and launches long-polling.
 * Approve/Reject are inline buttons; Edit captures the owner's next text message.
 */
export function startBot(): void {
  const bot = getBot();
  if (!bot) {
    console.log('ℹ️  Telegram bot disabled (no TELEGRAM_BOT_TOKEN) — approvals will mock-log.');
    return;
  }

  bot.start((ctx) =>
    ctx.reply(
      `Sahaj approvals connected ✅\nYour chat id: ${ctx.chat.id}\n` +
        `Save this as the owner's telegram_chat_id to receive approvals & hot-lead alerts.`,
    ),
  );

  bot.action(/^ap\|([0-9a-fA-F-]{36})\|(approve|reject|edit)$/, async (ctx) => {
    const taskId = ctx.match[1];
    const action = ctx.match[2] as 'approve' | 'reject' | 'edit';
    const ctxRaw = await cache.get(`appr:${taskId}`);
    if (!ctxRaw) {
      await ctx.answerCbQuery('This approval has expired.');
      return;
    }
    const { tenantId } = JSON.parse(ctxRaw) as { tenantId: string };

    if (action === 'edit') {
      await cache.set(`edit:${ctx.chat!.id}`, JSON.stringify({ taskId, tenantId }), 'EX', 900);
      await ctx.answerCbQuery();
      await ctx.reply('✏️ Send the corrected reply text now.');
      return;
    }

    await resolveApproval(tenantId, taskId, action);
    await ctx.answerCbQuery(action === 'approve' ? 'Sent ✅' : 'Rejected ❌');
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch {
      /* message may be too old to edit */
    }
  });

  bot.on('text', async (ctx) => {
    const pending = await cache.get(`edit:${ctx.chat.id}`);
    if (!pending) return; // not in an edit flow — ignore
    const { taskId, tenantId } = JSON.parse(pending) as { taskId: string; tenantId: string };
    await cache.del(`edit:${ctx.chat.id}`);
    await resolveApproval(tenantId, taskId, 'edit', ctx.message.text);
    await ctx.reply('✅ Edited reply sent.');
  });

  bot.launch().then(() => console.log('🤖 Telegram bot launched (long-polling)'));
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
