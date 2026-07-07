import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { withTenant } from '../tenancy/tenant-context';
import { intentPolicies } from '../db/schema';
import { env } from '../config/env';

/**
 * Nightly job: promotes eligible (tenant,intent) policies MANUAL/CANDIDATE → AUTO
 * once they clear the sample + clean-rate bar and are not a never-auto/high risk class.
 * Demotion is handled inline in intent-policy.recordOutcome (a single bad call revokes).
 */
export async function runGraduation(): Promise<void> {
  // `tenants` is RLS-scoped; use the SECURITY DEFINER admin iterator for the cross-tenant sweep.
  const rows = (await db.execute(sql`select admin_list_tenant_ids() as id`)) as unknown as Array<{ id: string }>;
  const allTenants = rows.map((r) => ({ id: r.id }));
  let promoted = 0;

  for (const t of allTenants) {
    await withTenant(t.id, async (tx) => {
      const policies = await tx.select().from(intentPolicies).where(eq(intentPolicies.tenantId, t.id));
      for (const p of policies) {
        if (p.riskClass === 'never_auto' || p.riskClass === 'high') continue;
        if (p.state === 'auto') continue;
        const total = p.approveClean + p.edited + p.rejected;
        const cleanRate = total > 0 ? p.approveClean / total : 0;
        if (total >= env.GRADUATION_MIN_SAMPLES && cleanRate >= env.GRADUATION_MIN_CLEAN_RATE) {
          await tx
            .update(intentPolicies)
            .set({ state: 'auto', graduatedAt: sql`now()` })
            .where(eq(intentPolicies.id, p.id));
          promoted++;
          console.log(
            `⬆️  Graduated tenant=${t.id} intent=${p.intentKey} → AUTO (clean=${(cleanRate * 100).toFixed(0)}%, n=${total})`,
          );
        }
      }
    });
  }
  console.log(`Graduation run complete. Promoted ${promoted} intent(s).`);
}
