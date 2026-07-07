/**
 * Seeds a demo tenant (dental clinic) so the full loop is testable immediately.
 * Usage: npm run db:seed
 * Set SEED_OWNER_TELEGRAM_CHAT_ID to receive real approvals/escalations in Telegram.
 *
 * Runs on the ADMIN/owner connection so it can create a new tenant (the `tenants` and
 * child tables are RLS-scoped; the owner bypasses RLS, which is the provisioning path).
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { tenants, users, channels, knowledgeBaseItems, subscriptions } from './schema';
import { env } from '../config/env';

async function main() {
  const numberId = env.WHATSAPP_PHONE_NUMBER_ID ?? 'TEST_NUMBER_1';
  const adminSql = postgres(env.DATABASE_ADMIN_URL ?? env.DATABASE_URL, { max: 1 });
  const db = drizzle(adminSql);

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'Bright Smile Dental',
      vertical: 'dental',
      plan: 'growth',
      status: 'active',
      persona: 'Friendly, professional, reassuring. Speaks warm Hinglish.',
    })
    .returning();

  {
    const tx = db;
    await tx.insert(channels).values({
      tenantId: tenant.id,
      type: 'whatsapp',
      provider: 'meta',
      providerNumberId: numberId,
      displayNumber: '+91 90000 00000',
      status: 'active',
    });

    await tx.insert(users).values({
      tenantId: tenant.id,
      role: 'owner',
      name: 'Dr. Sharma',
      phone: '+919000000000',
      notifyChannel: 'telegram',
      telegramChatId: process.env.SEED_OWNER_TELEGRAM_CHAT_ID ?? null,
    });

    await tx.insert(subscriptions).values({
      tenantId: tenant.id,
      plan: 'growth',
      status: 'active',
      setupPaid: true,
      mrr: '15000',
    });

    await tx.insert(knowledgeBaseItems).values([
      {
        tenantId: tenant.id,
        type: 'hours',
        question: 'What are your timings / clinic hours?',
        answer: 'Open Monday to Saturday, 10 AM to 8 PM. Closed on Sundays.',
        source: 'manual',
      },
      {
        tenantId: tenant.id,
        type: 'location',
        question: 'Where are you located / address?',
        answer: 'Shop 4, MG Road, Bengaluru 560001. Landmark: opposite the Metro station.',
        source: 'manual',
      },
      {
        tenantId: tenant.id,
        type: 'service',
        question: 'What services / treatments do you offer?',
        answer: 'Cleaning, fillings, root canal (RCT), braces, and teeth whitening.',
        source: 'manual',
      },
      {
        tenantId: tenant.id,
        type: 'price',
        question: 'How much is a root canal (RCT)?',
        answer: 'Root canal (RCT) starts at ₹4500.',
        structuredData: { service: 'root_canal', price: 4500, currency: 'INR' },
        source: 'manual',
      },
      {
        tenantId: tenant.id,
        type: 'price',
        question: 'Cleaning / scaling price?',
        answer: 'Scaling and cleaning is ₹800.',
        structuredData: { service: 'cleaning', price: 800, currency: 'INR' },
        source: 'manual',
      },
    ]);
  }

  console.log(`✅ Seeded tenant ${tenant.id} (${tenant.name}) → phone_number_id="${numberId}"`);
  await adminSql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
