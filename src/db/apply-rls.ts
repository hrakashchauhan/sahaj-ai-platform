/**
 * Applies src/db/rls.sql with the ADMIN/owner connection.
 * Run AFTER migrations: npm run db:rls
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { env } from '../config/env';

async function main() {
  const url = env.DATABASE_ADMIN_URL ?? env.DATABASE_URL;
  const sql = postgres(url, { max: 1 });

  const rls = readFileSync(join(__dirname, 'rls.sql'), 'utf8');
  console.log('Applying RLS policies + app role…');
  await sql.unsafe(rls);
  console.log('✅ RLS applied');

  await sql.end();
}

main().catch((err) => {
  console.error('Applying RLS failed:', err);
  process.exit(1);
});
