import IORedis from 'ioredis';
import { env } from '../config/env';

// General-purpose Redis client (approval context, pending-edit state, rate limits).
export const cache = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
