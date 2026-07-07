import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_ADMIN_URL: z.string().optional(),
  // When set (e.g. on managed hosts with one connection string), tenant transactions
  // run `SET LOCAL ROLE <this>` so RLS applies even though DATABASE_URL is the owner.
  DB_APP_ROLE: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'DB_APP_ROLE must be a valid role identifier')
    .optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  GEMINI_EMBED_MODEL: z.string().default('text-embedding-004'),

  META_VERIFY_TOKEN: z.string().default('sahaj-verify-token'),
  META_APP_SECRET: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),

  ENCRYPTION_KEY: z.string().optional(),

  // Dashboard auth. Production expects Supabase JWTs plus an explicit tenant header.
  // Local demo mode is disabled in production and requires a configured tenant id.
  SUPABASE_JWT_SECRET: z.string().optional(),
  DASHBOARD_DEV_TENANT_ID: z.string().uuid().optional(),
  DASHBOARD_DEV_USER_ID: z.string().uuid().optional(),
  DASHBOARD_CORS_ORIGIN: z.string().default('http://localhost:3001'),

  AUTOSEND_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  GRADUATION_MIN_SAMPLES: z.coerce.number().int().default(20),
  GRADUATION_MIN_CLEAN_RATE: z.coerce.number().min(0).max(1).default(0.95),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable message rather than crashing deep in a worker.
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof schema>;

/** True when a real Gemini key is configured; otherwise the mock LLM provider is used. */
export const hasLlm = Boolean(env.GEMINI_API_KEY);
