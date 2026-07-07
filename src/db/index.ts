import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../config/env';
import * as schema from './schema';

// Runtime connection — uses the least-privileged `app` role so RLS is enforced.
export const queryClient = postgres(env.DATABASE_URL, { max: 10 });
export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
/** Transaction handle type, reused by tenant-scoped repository helpers. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { schema };
