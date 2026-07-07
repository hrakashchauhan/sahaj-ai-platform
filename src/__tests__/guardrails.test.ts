import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature } from '../webhooks/signature';
import { aiOutputSchema } from '../ai/types';
import { validateDraft } from '../ai/validation';

describe('webhook signature verification', () => {
  const secret = 's3cr3t';
  const body = Buffer.from('{"entry":[{"x":1}]}');
  const good = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

  it('accepts a valid signature', () => {
    expect(verifyMetaSignature(body, good, secret)).toBe(true);
  });
  it('rejects a tampered body', () => {
    expect(verifyMetaSignature(Buffer.from('{"entry":[]}'), good, secret)).toBe(false);
  });
  it('rejects a wrong secret', () => {
    expect(verifyMetaSignature(body, good, 'other')).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
  });
  it('rejects a length-mismatched header without throwing', () => {
    expect(verifyMetaSignature(body, 'sha256=abc', secret)).toBe(false);
  });
});

describe('AI output schema hardening', () => {
  const base = { intent: 'hours', confidence: 0.9, draft_reply: 'ok' };

  it('rejects an empty draft_reply', () => {
    expect(() => aiOutputSchema.parse({ ...base, draft_reply: '' })).toThrow();
  });
  it('rejects a whitespace-only draft_reply', () => {
    expect(() => aiOutputSchema.parse({ ...base, draft_reply: '   \n ' })).toThrow();
  });
  it('defaults a missing intent to "other"', () => {
    const parsed = aiOutputSchema.parse({ confidence: 0.5, draft_reply: 'hi' });
    expect(parsed.intent).toBe('other');
  });
});

describe('citation guardrail', () => {
  const ai = (over: Partial<ReturnType<typeof aiOutputSchema.parse>>) =>
    aiOutputSchema.parse({ intent: 'hours', confidence: 0.95, draft_reply: 'We open at 10 AM.', ...over });

  it('flags a fabricated citation not in the loaded KB and penalizes confidence', () => {
    const r = validateDraft(ai({ cited_kb_ids: ['ghost-id'] }), [], ['k1', 'k2']);
    expect(r.reasons).toContain('fabricated_citation');
    expect(r.reasons).toContain('no_citation');
    expect(r.confidence).toBeLessThanOrEqual(0.6);
  });
  it('accepts a real citation present in the loaded KB', () => {
    const r = validateDraft(ai({ cited_kb_ids: ['k1'] }), [], ['k1', 'k2']);
    expect(r.reasons).not.toContain('no_citation');
    expect(r.reasons).not.toContain('fabricated_citation');
  });
});
