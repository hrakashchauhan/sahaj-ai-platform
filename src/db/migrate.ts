/**
 * Runs Drizzle migrations with the ADMIN/owner connection, then enables pgvector.
 * Usage: npm run db:migrate
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { env } from '../config/env';

async function main() {
  const url = env.DATABASE_ADMIN_URL ?? env.DATABASE_URL;
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  // pgvector must exist before the schema (knowledge_base_items.embedding) is created.
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;

  console.log('Running migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('✅ Migrations complete');

  await sql.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
