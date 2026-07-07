import { env } from '../config/env';

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface SendResult {
  channelMsgId: string | null;
  mock: boolean;
}

/**
 * Sends a free-form WhatsApp text (valid only inside the 24h service window).
 * Falls back to a logged MOCK send when no token is configured, so the loop is
 * exercisable end-to-end in local dev without Meta credentials.
 */
export async function sendWhatsAppText(opts: {
  token?: string;
  phoneNumberId?: string;
  to: string;
  body: string;
}): Promise<SendResult> {
  const token = opts.token ?? env.WHATSAPP_TOKEN;
  const phoneNumberId = opts.phoneNumberId ?? env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log(`📤 [MOCK WA→${opts.to}] ${opts.body}`);
    return { channelMsgId: `mock-${Date.now()}`, mock: true };
  }

  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: opts.to,
      type: 'text',
      text: { preview_url: false, body: opts.body },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { messages?: Array<{ id: string }> };
  return { channelMsgId: data.messages?.[0]?.id ?? null, mock: false };
}
