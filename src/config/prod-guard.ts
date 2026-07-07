import { env } from './env';

/**
 * In production, loudly warn when credentials are missing so the operator knows the app is
 * silently running in a degraded/insecure mode rather than fully live. We WARN rather than
 * hard-fail because a deliberate "mock mode" demo deploy is a valid state.
 *
 * The one true security hole to flag hard is META_APP_SECRET: without it, inbound webhook
 * signature verification is skipped entirely (fail-open). We warn prominently.
 */
export function warnMissingProdSecrets(): void {
  if (env.NODE_ENV !== 'production') return;

  const degraded: string[] = [];
  if (!env.GEMINI_API_KEY) degraded.push('GEMINI_API_KEY (AI replies use the offline mock)');
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID)
    degraded.push('WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID (outbound sends are mocked)');
  if (!env.TELEGRAM_BOT_TOKEN) degraded.push('TELEGRAM_BOT_TOKEN (owner approvals/escalations are mocked)');
  if (!env.ENCRYPTION_KEY) degraded.push('ENCRYPTION_KEY (per-tenant credential encryption unavailable)');

  if (!env.META_APP_SECRET) {
    console.warn(
      '🚨 SECURITY: META_APP_SECRET is not set in production — inbound webhook signatures are ' +
        'NOT verified. Set it before pointing a real Meta app at this instance.',
    );
  }
  if (degraded.length) {
    console.warn('⚠️  Running in production with degraded/mock features:\n  - ' + degraded.join('\n  - '));
  }
}
