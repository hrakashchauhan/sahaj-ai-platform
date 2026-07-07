import { Queue, type JobsOptions, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env';

/**
 * Pass connection OPTIONS (not an ioredis instance) so BullMQ instantiates its own
 * bundled ioredis — avoids the dual-package type/version conflict, and gives each
 * Queue/Worker its own connection as BullMQ recommends.
 */
function parseRedis(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    maxRetriesPerRequest: null,
    // Managed Redis (Upstash, Render external) uses rediss:// (TLS). Because BullMQ gets
    // parsed options (not the URL), we must enable TLS explicitly for the scheme.
    ...(u.protocol === 'rediss:' ? { tls: { servername: u.hostname } } : {}),
  };
}

export const redisConnection: ConnectionOptions = parseRedis(env.REDIS_URL);

// NOTE: BullMQ forbids ':' in queue names (it's the Redis key delimiter).
export const QUEUES = {
  inbound: 'sahaj-inbound',
  ai: 'sahaj-ai',
  outbound: 'sahaj-outbound',
  schedule: 'sahaj-schedule',
} as const;

const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export const inboundQueue = new Queue(QUEUES.inbound, { connection: redisConnection, defaultJobOptions });
export const aiQueue = new Queue(QUEUES.ai, { connection: redisConnection, defaultJobOptions });
export const outboundQueue = new Queue(QUEUES.outbound, { connection: redisConnection, defaultJobOptions });
export const scheduleQueue = new Queue(QUEUES.schedule, { connection: redisConnection });

// ── Job payloads ────────────────────────────────────────────────────────────
export interface InboundJob {
  provider: string;
  body: unknown;
}
export interface AiJob {
  tenantId: string;
  conversationId: string;
  messageId: string;
}
export interface OutboundJob {
  tenantId: string;
  messageId: string;
}
