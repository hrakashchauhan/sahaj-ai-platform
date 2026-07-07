import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../db';
import { intentPolicies } from '../db/schema';
import { riskForIntent } from '../ai/types';

export type IntentState = 'manual' | 'auto_candidate' | 'auto';
export type Outcome = 'clean' | 'edited' | 'rejected';

export interface IntentPolicyRow {
  id: string;
  intentKey: string;
  riskClass: 'low' | 'med' | 'high' | 'never_auto';
  state: IntentState;
  approveClean: number;
  edited: number;
  rejected: number;
}

/** Fetches the (tenant,intent) policy, creating it in MANUAL state on first sight. */
export async function getOrCreateIntentPolicy(
  tx: Tx,
  tenantId: string,
  intentKey: string,
): Promise<IntentPolicyRow> {
  const existing = await tx
    .select()
    .from(intentPolicies)
    .where(and(eq(intentPolicies.tenantId, tenantId), eq(intentPolicies.intentKey, intentKey)))
    .limit(1);
  if (existing[0]) return existing[0] as unknown as IntentPolicyRow;

  // onConflictDoNothing makes this safe under concurrent first-sightings of the same
  // (tenant, intent) — otherwise a duplicate-key throw would abort the pipeline job and
  // trigger a retry that re-sends escalations. Re-select to always return a row.
  await tx
    .insert(intentPolicies)
    .values({ tenantId, intentKey, riskClass: riskForIntent(intentKey), state: 'manual' })
    .onConflictDoNothing();
  const [created] = await tx
    .select()
    .from(intentPolicies)
    .where(and(eq(intentPolicies.tenantId, tenantId), eq(intentPolicies.intentKey, intentKey)))
    .limit(1);
  return created as unknown as IntentPolicyRow;
}

/**
 * Records an owner's approval outcome, recomputes the clean-approval rate, and
 * DEMOTES immediately if an AUTO intent gets rejected/corrected (trust is revocable).
 */
export async function recordOutcome(
  tx: Tx,
  tenantId: string,
  intentKey: string,
  outcome: Outcome,
): Promise<{ demoted: boolean }> {
  const policy = await getOrCreateIntentPolicy(tx, tenantId, intentKey);
  const approveClean = policy.approveClean + (outcome === 'clean' ? 1 : 0);
  const edited = policy.edited + (outcome === 'edited' ? 1 : 0);
  const rejected = policy.rejected + (outcome === 'rejected' ? 1 : 0);
  const total = approveClean + edited + rejected;
  const cleanRate = total > 0 ? approveClean / total : 0;

  // A single rejection/correction of an auto-sent intent revokes auto-send.
  const demoted = policy.state === 'auto' && outcome !== 'clean';

  await tx
    .update(intentPolicies)
    .set({
      approveClean,
      edited,
      rejected,
      cleanRate: cleanRate.toFixed(4),
      state: demoted ? 'auto_candidate' : policy.state,
      updatedAt: sql`now()`,
    })
    .where(eq(intentPolicies.id, policy.id));

  return { demoted };
}
