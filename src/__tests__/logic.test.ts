import { describe, it, expect } from 'vitest';
import { decide } from '../policy/decision';
import { validateDraft } from '../ai/validation';
import { aiOutputSchema, riskForIntent } from '../ai/types';
import { llm } from '../ai/llm';
import { buildUserPrompt } from '../ai/prompt';

describe('decision gate', () => {
  const base = {
    intentState: 'auto' as const,
    riskClass: 'low' as const,
    confidence: 0.9,
    forceApproval: false,
    withinWindow: true,
    threshold: 0.75,
  };

  it('auto-sends when everything is green', () => {
    expect(decide(base)).toBe('auto_send');
  });

  it('needs approval when guardrails force it', () => {
    expect(decide({ ...base, forceApproval: true })).toBe('needs_approval');
  });

  it('needs approval outside the 24h window', () => {
    expect(decide({ ...base, withinWindow: false })).toBe('needs_approval');
  });

  it('never auto-sends never_auto / high-risk intents', () => {
    expect(decide({ ...base, riskClass: 'never_auto' })).toBe('needs_approval');
    expect(decide({ ...base, riskClass: 'high' })).toBe('needs_approval');
  });

  it('needs approval when the intent has not graduated', () => {
    expect(decide({ ...base, intentState: 'manual' })).toBe('needs_approval');
    expect(decide({ ...base, intentState: 'auto_candidate' })).toBe('needs_approval');
  });

  it('needs approval below the confidence threshold', () => {
    expect(decide({ ...base, confidence: 0.5 })).toBe('needs_approval');
  });
});

describe('intent risk classes', () => {
  it('marks pricing/medical/legal as never_auto', () => {
    expect(riskForIntent('pricing')).toBe('never_auto');
    expect(riskForIntent('medical')).toBe('never_auto');
  });
  it('marks hours/location as low risk', () => {
    expect(riskForIntent('hours')).toBe('low');
    expect(riskForIntent('location')).toBe('low');
  });
});

describe('guardrail validation', () => {
  const ai = (over: Partial<ReturnType<typeof aiOutputSchema.parse>>) =>
    aiOutputSchema.parse({ intent: 'hours', confidence: 0.9, draft_reply: 'x', cited_kb_ids: ['k1'], ...over });

  it('forces approval on restricted claims', () => {
    const r = validateDraft(ai({ draft_reply: 'This gives a permanent cure, 100% safe.' }), []);
    expect(r.forceApproval).toBe(true);
    expect(r.reasons).toContain('restricted_claim');
  });

  it('forces approval on an ungrounded price', () => {
    const r = validateDraft(ai({ draft_reply: 'It costs ₹9999.' }), [4500, 800]);
    expect(r.forceApproval).toBe(true);
    expect(r.reasons.some((x) => x.startsWith('ungrounded_price'))).toBe(true);
  });

  it('accepts a grounded price', () => {
    const r = validateDraft(ai({ draft_reply: 'Root canal starts at ₹4500.' }), [4500, 800]);
    expect(r.forceApproval).toBe(false);
  });

  it('reduces confidence when there is no citation', () => {
    const r = validateDraft(ai({ cited_kb_ids: [], confidence: 0.95 }), []);
    expect(r.confidence).toBeLessThanOrEqual(0.6);
  });
});

describe('mock LLM provider', () => {
  it('produces schema-valid grounded output and never fabricates prices', async () => {
    for (const msg of [
      'Aapke clinic ka timing kya hai?',
      'root canal ka price kitna hai?',
      'I want to book an appointment, call me on 9812345678',
    ]) {
      const raw = await llm.generateJson('sys', msg);
      const parsed = aiOutputSchema.parse(JSON.parse(raw));
      expect(parsed.draft_reply.length).toBeGreaterThan(0);
      // mock must not invent a rupee figure
      expect(/₹\s?\d/.test(parsed.draft_reply)).toBe(false);
    }
  });

  it('classifies the actual customer message, not the KB dump it is embedded in', async () => {
    // Regression test: found by running the full pipeline against a real DB — every
    // seeded tenant's KB includes an "hours" FAQ (containing "timing"/"open"), which
    // used to make the mock classifier match 'hours' for almost any message because
    // it ran regexes over the WHOLE composed prompt instead of just the new message.
    const kbContext = '- (k1) HOURS: What are your timings? => Open Monday to Saturday, 10 AM to 8 PM.';
    const user = buildUserPrompt({
      kbContext,
      history: '',
      customerMessage: 'I have a complaint, please call me on 9900011122',
    });
    const raw = await llm.generateJson('sys', user);
    const parsed = aiOutputSchema.parse(JSON.parse(raw));
    expect(parsed.intent).toBe('complaint');
    expect(parsed.needs_escalation).toBe(true);
    expect(parsed.lead_slots.phone).toContain('9900011122');
  });
});
