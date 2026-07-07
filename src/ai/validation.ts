import type { AiOutput } from './types';

// Per-vertical claims we never allow the AI to make unattended.
const RESTRICTED_PATTERNS: RegExp[] = [
  /\bguarantee(d|s)?\b/i,
  /100\s?%\s?(cure|safe|success|result)/i,
  /permanent(ly)?\s+(cure|fix|solution)/i,
  /\bno\s+(pain|risk|side\s?effect)/i,
  /\bcertain(ly)?\s+cure\b/i,
];

export interface ValidationResult {
  forceApproval: boolean; // dangerous → must be human-approved regardless of policy
  confidence: number; // possibly reduced from the model's self-reported value
  reasons: string[];
}

/**
 * Deterministic guardrail pass layered on top of the LLM output.
 * - Restricted claims and ungrounded prices HARD-force approval (liability).
 * - Citations that don't exist in the loaded KB are treated as NO citation (a fabricated
 *   id must not buy the model out of the no-citation confidence penalty).
 */
export function validateDraft(ai: AiOutput, allowedPrices: number[], allowedKbIds: string[] = []): ValidationResult {
  const reasons: string[] = [];
  let forceApproval = false;
  let confidence = ai.confidence;

  if (ai.restricted_claim_flag || RESTRICTED_PATTERNS.some((re) => re.test(ai.draft_reply))) {
    reasons.push('restricted_claim');
    forceApproval = true;
  }

  const nums = (ai.draft_reply.match(/₹?\s?\d{2,7}/g) ?? [])
    .map((s) => parseInt(s.replace(/[^\d]/g, ''), 10))
    .filter((n) => n >= 50);
  const ungrounded = nums.filter((n) => !allowedPrices.includes(n));
  if (ungrounded.length > 0) {
    reasons.push(`ungrounded_price:${ungrounded.join(',')}`);
    forceApproval = true;
  }

  // Only citations that actually exist in the loaded KB count. If a caller passes no
  // allow-list (allowedKbIds=[]), fall back to trusting the ids (backward compatible).
  const validCitations =
    allowedKbIds.length > 0 ? ai.cited_kb_ids.filter((id) => allowedKbIds.includes(id)) : ai.cited_kb_ids;
  if (allowedKbIds.length > 0 && validCitations.length < ai.cited_kb_ids.length) {
    reasons.push('fabricated_citation');
  }
  if (validCitations.length === 0 && !ai.needs_escalation) {
    reasons.push('no_citation');
    confidence = Math.min(confidence, 0.6);
  }

  return { forceApproval, confidence, reasons };
}
