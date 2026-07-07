import { sql } from 'drizzle-orm';
import { withTenant } from '../tenancy/tenant-context';
import { env } from '../config/env';
import { withTimeout } from '../lib/timeout';

// A throwaway tenant id used only to exercise the role switch during the probe.
const PROBE_TENANT = '00000000-0000-0000-0000-0000000000ff';

/**
 * Proves that the connection the app uses at runtime CANNOT bypass RLS. It runs inside
 * withTenant (so the DB_APP_ROLE switch, if any, is applied) and inspects the effective
 * role's privileges. A role bypasses RLS if it is a superuser, has BYPASSRLS, or owns the
 * table while the policy is not FORCED. Throws if any of those hold — the fail-closed guard
 * against the "RLS silently not enforced" disaster.
 */
export async function assertRlsEnforced(): Promise<void> {
  await withTenant(PROBE_TENANT, async (tx) => {
    const rows = (await tx.execute(sql`
      select
        current_user as role,
        (select rolsuper from pg_roles where rolname = current_user) as is_super,
        (select rolbypassrls from pg_roles where rolname = current_user) as bypass_rls,
        (current_user = (select tableowner from pg_tables
           where schemaname = 'public' and tablename = 'messages')) as is_owner,
        (select relforcerowsecurity from pg_class where oid = 'public.messages'::regclass) as force_rls,
        (select relrowsecurity from pg_class where oid = 'public.messages'::regclass) as rls_enabled
    `)) as unknown as Array<{
      role: string;
      is_super: boolean;
      bypass_rls: boolean;
      is_owner: boolean;
      force_rls: boolean;
      rls_enabled: boolean;
    }>;

    const r = rows[0];
    if (!r) throw new Error('RLS self-check: could not read role/table metadata');
    if (!r.rls_enabled) throw new Error('RLS self-check FAILED: row security is not enabled on `messages`');

    const canBypass = r.is_super === true || r.bypass_rls === true || (r.is_owner === true && r.force_rls !== true);
    if (canBypass) {
      throw new Error(
        `RLS self-check FAILED: effective role "${r.role}" can bypass RLS ` +
          `(super=${r.is_super}, bypassrls=${r.bypass_rls}, owner=${r.is_owner}, forced=${r.force_rls}). ` +
          `Fix: set DB_APP_ROLE to a non-owner role (and run db:rls), or connect DATABASE_URL as one.`,
      );
    }
  });
}

/** Boot guard: hard-fail in production if RLS can be bypassed; warn-and-continue in dev. */
export async function verifyRlsOrExit(): Promise<void> {
  try {
    await withTimeout(assertRlsEnforced(), 8000, 'RLS self-check');
    console.log('🔒 RLS self-check passed — tenant isolation is enforced.');
  } catch (e) {
    if (env.NODE_ENV === 'production') {
      console.error('❌ RLS self-check failed — refusing to start in production.\n', e);
      process.exit(1);
    }
    console.warn(`⚠️  RLS self-check skipped (non-production): ${(e as Error).message}`);
  }
}
