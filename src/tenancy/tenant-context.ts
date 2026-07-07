import { sql } from 'drizzle-orm';
import { db, type Tx } from '../db';
import { env } from '../config/env';

/**
 * Runs `fn` inside a transaction with `app.tenant_id` set, so Postgres RLS scopes
 * every query to this tenant. This is THE multi-tenant safety boundary — all
 * tenant-scoped DB work must go through here.
 *
 * If DB_APP_ROLE is set, the transaction also assumes that (non-owner) role so RLS
 * applies on managed hosts where DATABASE_URL is the owner. DB_APP_ROLE is validated
 * as a plain identifier in env.ts, so sql.raw here is safe.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (env.DB_APP_ROLE) {
      await tx.execute(sql`set local role ${sql.raw(env.DB_APP_ROLE)}`);
    }
    // set_config(..., true) => transaction-local; auto-reset at commit/rollback.
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Maps an inbound provider number (WhatsApp `phone_number_id`) to its tenant.
 * Uses the SECURITY DEFINER `resolve_tenant_by_number` function (the one
 * intentional cross-tenant read) because we don't yet know the tenant.
 */
export async function resolveTenantByNumber(providerNumberId: string): Promise<string | null> {
  const rows = (await db.execute(
    sql`select resolve_tenant_by_number(${providerNumberId}) as tenant_id`,
  )) as unknown as Array<{ tenant_id: string | null }>;
  return rows[0]?.tenant_id ?? null;
}
