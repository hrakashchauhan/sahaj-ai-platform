import type { Config } from 'drizzle-kit';
import { config as loadEnv } from 'dotenv';

loadEnv();

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Migrations run as the admin/owner role (DDL). App runtime uses DATABASE_URL.
    url: process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? '',
  },
} satisfies Config;
