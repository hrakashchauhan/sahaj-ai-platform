import type { RiskClass } from '../ai/types';
import type { IntentState } from '../approvals/intent-policy';

export interface DecisionInput {
  intentState: IntentState;
  riskClass: RiskClass;
  confidence: number;
  forceApproval: boolean;
  withinWindow: boolean;
  threshold: number;
}

export type Decision = 'auto_send' | 'needs_approval';

/**
 * The gate between AI draft and send. Auto-send requires ALL green:
 * not forced to approval, inside the 24h window, a low/med risk intent that has
 * graduated to AUTO for this tenant, and confidence over threshold.
 */
export function decide(input: DecisionInput): Decision {
  if (input.forceApproval) return 'needs_approval';
  if (!input.withinWindow) return 'needs_approval'; // out-of-window ⇒ needs template ⇒ human for MVP
  if (input.riskClass === 'never_auto' || input.riskClass === 'high') return 'needs_approval';
  if (input.intentState !== 'auto') return 'needs_approval';
  if (input.confidence < input.threshold) return 'needs_approval';
  return 'auto_send';
}
