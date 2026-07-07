-- Row-Level Security for multi-tenant isolation.
-- Applied by `db:rls` (src/db/apply-rls.ts) / `db:rls:prod` with the ADMIN/owner connection.
--
-- Portability model (local Postgres AND managed hosts like Render/Neon/Supabase with a single
-- non-superuser owner account):
--   • Objects owned by the migration/admin user.
--   • RLS ENABLED (not FORCED) so the OWNER bypasses it — this lets SECURITY DEFINER helper
--     functions work and lets provisioning/migrations run unhindered.
--   • Runtime isolation is enforced by running every tenant-scoped transaction as the restricted
--     NON-owner `app` role, for which the policy applies. Two ways to be `app`:
--       (a) DATABASE_URL connects as the `app` role (local dev), or
--       (b) DATABASE_URL connects as the owner and DB_APP_ROLE=app, so withTenant() runs
--           `SET LOCAL ROLE app` per transaction (managed hosts w/ one connection string).
--   • The app REFUSES TO BOOT if the effective role can bypass RLS (see src/db/rls-check.ts) —
--     isolation fails closed, never open.

-- 1) Tenant resolver — the intentional cross-tenant read (returns only a tenant_id).
CREATE OR REPLACE FUNCTION resolve_tenant_by_number(p_number_id text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id
  FROM channels
  WHERE provider_number_id = p_number_id
    AND status = 'active'
  LIMIT 1;
$$;

-- 2) Admin iterator for cron/reporting that must span tenants (e.g. nightly graduation).
--    SECURITY DEFINER (owner) → bypasses RLS. Returns only ids, no tenant data.
CREATE OR REPLACE FUNCTION admin_list_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id FROM tenants;
$$;

-- 3) Restricted `app` role + grants (best-effort: on hosts lacking CREATEROLE this is skipped
--    with a NOTICE, and you must connect DATABASE_URL as a pre-existing non-owner role).
DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
      CREATE ROLE app LOGIN PASSWORD 'app';
    END IF;
    GRANT USAGE ON SCHEMA public TO app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app;
    GRANT EXECUTE ON FUNCTION resolve_tenant_by_number(text) TO app;
    GRANT EXECUTE ON FUNCTION admin_list_tenant_ids() TO app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app;
    -- Let the owner assume the app role (needed for SET LOCAL ROLE on managed hosts).
    EXECUTE format('GRANT app TO %I', current_user);
  EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN
    RAISE NOTICE 'Skipped app-role setup (insufficient privilege). Ensure DATABASE_URL connects as a non-owner role for RLS to apply.';
  END;
END $$;

-- 4) Enable RLS + isolation policy on every tenant-scoped CHILD table (keyed by tenant_id).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'users','channels','channel_credentials','contacts','conversations',
    'messages','message_events','knowledge_base_items','intent_policies',
    'approval_tasks','leads','appointments','roi_reports','subscriptions',
    'consent_logs','audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    $f$, t);
  END LOOP;
END $$;

-- 5) The `tenants` ROOT table: scope by id (a tenant can only see/modify its own row).
--    Provisioning (create a new tenant) uses the OWNER/admin connection, which bypasses this.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);
