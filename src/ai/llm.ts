import { GoogleGenerativeAI } from '@google/generative-ai';
import { env, hasLlm } from '../config/env';

export interface LlmProvider {
  name: string;
  generateJson(system: string, user: string): Promise<string>;
}

/** Gemini Flash — primary. Structured JSON via responseMimeType, capped tokens for COGS. */
class GeminiProvider implements LlmProvider {
  name = 'gemini';
  private client = new GoogleGenerativeAI(env.GEMINI_API_KEY as string);

  async generateJson(system: string, user: string): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: env.GEMINI_MODEL,
      systemInstruction: system,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 800,
      },
    });
    const res = await model.generateContent(user);
    return res.response.text();
  }
}

/**
 * Extracts just the customer's new message out of the composed prompt (which also
 * contains the KB dump + conversation history — see prompt.ts's buildUserPrompt).
 * The mock classifier below must match against ONLY this, not the whole prompt:
 * every tenant's KB routinely contains an "hours" FAQ item with words like
 * "timing"/"open", which would otherwise match the 'hours' pattern first for
 * almost any message. Falls back to the raw input when the marker is absent
 * (e.g. a caller/test passing the customer message directly).
 */
function extractCustomerMessage(user: string): string {
  const marker = '=== NEW CUSTOMER MESSAGE ===';
  const idx = user.indexOf(marker);
  if (idx === -1) return user;
  const line = user
    .slice(idx + marker.length)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? user;
}

/**
 * Offline heuristic responder so the FULL loop is runnable/testable without a
 * Gemini key. Intentionally conservative: it never fabricates prices and escalates
 * when unsure — matching the grounding contract.
 */
class MockProvider implements LlmProvider {
  name = 'mock';

  async generateJson(_system: string, user: string): Promise<string> {
    const msg = extractCustomerMessage(user).toLowerCase();
    let intent = 'other';
    let reply = 'Thanks for your message! Let me check with the team and get back to you shortly. 🙏';
    let confidence = 0.4;
    let needs_escalation = true;

    if (/(time|timing|hours|open|khula|kab.*open|kitne baje)/.test(msg)) {
      intent = 'hours';
      reply = 'We are open Monday to Saturday, 10 AM to 8 PM. 😊';
      confidence = 0.9;
      needs_escalation = false;
    } else if (/(price|cost|kitna|kitne|fees|charge|rate|paisa)/.test(msg)) {
      intent = 'pricing';
      reply = 'Let me confirm the exact price with the team and share it right away.';
      confidence = 0.5; // pricing is never_auto anyway
      needs_escalation = true;
    } else if (/(book|appointment|slot|kal|today|aaj|milna|visit)/.test(msg)) {
      intent = 'booking';
      reply = 'Sure! May I have your name and a preferred time so I can book you in?';
      confidence = 0.7;
      needs_escalation = false;
    } else if (/(where|location|address|kahan|kaha)/.test(msg)) {
      intent = 'location';
      reply = 'We are easy to reach — sharing our address so you can find us. See you soon!';
      confidence = 0.85;
      needs_escalation = false;
    } else if (/(agent|human|call me|owner|baat kar|complaint|problem|refund)/.test(msg)) {
      intent = /(complaint|problem|refund)/.test(msg) ? 'complaint' : 'human_request';
      reply = 'I hear you — connecting you with our team right away.';
      confidence = 0.8;
      needs_escalation = true;
    }

    // Match against the isolated customer message too — the full prompt's KB dump
    // and history can contain unrelated digit sequences (prices, dates, etc.).
    const phone = extractCustomerMessage(user).match(/(\+?\d[\d\s-]{7,}\d)/);
    return JSON.stringify({
      language: 'hi-IN',
      intent,
      confidence,
      draft_reply: reply,
      cited_kb_ids: [],
      lead_slots: { name: null, phone: phone ? phone[1].trim() : null, service: null, intent_summary: null },
      needs_escalation,
      restricted_claim_flag: false,
    });
  }
}

export const llm: LlmProvider = hasLlm ? new GeminiProvider() : new MockProvider();
