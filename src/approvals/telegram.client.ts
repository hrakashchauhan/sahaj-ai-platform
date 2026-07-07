import { Telegraf, Markup } from 'telegraf';
import { env } from '../config/env';

let bot: Telegraf | null = null;

/** Singleton Telegraf instance (null when no token → mock-logging mode). */
export function getBot(): Telegraf | null {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  if (!bot) bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  return bot;
}

export async function notifyApproval(
  chatId: string,
  opts: { taskId: string; customerMsg: string; draft: string; intent: string; confidence: number },
): Promise<string | null> {
  const b = getBot();
  const text =
    `🟡 *Approval needed*\n\n` +
    `👤 _${opts.customerMsg}_\n\n` +
    `🤖 ${opts.draft}\n\n` +
    `🏷 ${opts.intent} · conf ${(opts.confidence * 100).toFixed(0)}%`;

  if (!b || chatId === 'mock') {
    console.log(`🔔 [MOCK TG approval task=${opts.taskId}]\n${text}`);
    return null;
  }
  // Non-throwing: a Telegram failure must never abort the caller's DB transaction.
  try {
    const msg = await b.telegram.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        Markup.button.callback('✅ Approve', `ap|${opts.taskId}|approve`),
        Markup.button.callback('✏️ Edit', `ap|${opts.taskId}|edit`),
        Markup.button.callback('❌ Reject', `ap|${opts.taskId}|reject`),
      ]),
    });
    return String(msg.message_id);
  } catch (e) {
    console.error(`Telegram approval notify failed (task=${opts.taskId}):`, e);
    return null;
  }
}

export async function notifyEscalation(
  chatId: string,
  opts: { summary: string; contact: string },
): Promise<void> {
  const b = getBot();
  const text = `🚨 *Hot lead / needs you*\n\n${opts.summary}\n\n📞 ${opts.contact}`;
  if (!b) {
    console.log(`🚨 [MOCK TG escalation → ${chatId}] ${text}`);
    return;
  }
  // Non-throwing: escalation is best-effort and must not abort the pipeline transaction.
  try {
    await b.telegram.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('Telegram escalation notify failed:', e);
  }
}
