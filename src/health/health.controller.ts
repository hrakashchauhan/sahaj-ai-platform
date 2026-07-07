import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { cache } from '../lib/cache';
import { withTimeout } from '../lib/timeout';

@Controller('health')
export class HealthController {
  // Liveness — cheap, always 200 if the process is up.
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  // Readiness — verifies DB + Redis so a broken instance is NOT marked healthy.
  @Get()
  async health() {
    const checks: Record<string, string> = {};
    let ok = true;
    try {
      await withTimeout(db.execute(sql`select 1`), 2000, 'db');
      checks.db = 'ok';
    } catch (e) {
      ok = false;
      checks.db = `error: ${(e as Error).message}`;
    }
    try {
      await withTimeout(cache.ping(), 2000, 'redis');
      checks.redis = 'ok';
    } catch (e) {
      ok = false;
      checks.redis = `error: ${(e as Error).message}`;
    }

    const body = { status: ok ? 'ok' : 'degraded', service: 'sahaj-platform', checks, ts: new Date().toISOString() };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }
}
