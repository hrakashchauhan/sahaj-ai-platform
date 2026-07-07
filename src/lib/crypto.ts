import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

/**
 * AES-256-GCM encryption for per-tenant channel credentials at rest.
 * ENCRYPTION_KEY must be a 32-byte base64 string. Format: base64(iv).base64(tag).base64(ct)
 */
function key(): Buffer {
  if (!env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY not set');
  const k = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  return k;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
