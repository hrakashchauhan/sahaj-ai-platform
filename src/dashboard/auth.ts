import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { env } from '../config/env';
import { withTenant } from '../tenancy/tenant-context';
import { users } from '../db/schema';

export type DashboardRole = 'owner' | 'staff' | 'internal_admin';

export interface DashboardUser {
  tenantId: string;
  userId: string | null;
  role: DashboardRole;
  name: string | null;
  authMode: 'supabase' | 'dev';
}

interface JwtPayload {
  sub?: string;
  [key: string]: unknown;
}

@Injectable()
export class DashboardAuthService {
  async requireUser(req: Request): Promise<DashboardUser> {
    const tenantId = header(req, 'x-sahaj-tenant-id') ?? env.DASHBOARD_DEV_TENANT_ID;
    if (!tenantId) {
      throw new UnauthorizedException('Missing tenant context');
    }

    const bearer = bearerToken(req);
    if (bearer) {
      return this.requireSupabaseUser(tenantId, bearer);
    }

    if (env.NODE_ENV !== 'production' && env.DASHBOARD_DEV_TENANT_ID && tenantId === env.DASHBOARD_DEV_TENANT_ID) {
      return this.requireDevUser(tenantId);
    }

    throw new UnauthorizedException('Missing dashboard authorization');
  }

  requireRole(user: DashboardUser, roles: DashboardRole[]) {
    if (!roles.includes(user.role)) {
      throw new ForbiddenException('Insufficient dashboard permissions');
    }
  }

  private async requireSupabaseUser(tenantId: string, token: string): Promise<DashboardUser> {
    if (!env.SUPABASE_JWT_SECRET) {
      throw new UnauthorizedException('Supabase auth is not configured');
    }
    const payload = verifyJwt(token, env.SUPABASE_JWT_SECRET);
    if (!payload.sub) {
      throw new UnauthorizedException('JWT subject is missing');
    }

    const row = await withTenant(tenantId, async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.authId, payload.sub!)))
        .limit(1);
      return user;
    });
    if (!row) {
      throw new ForbiddenException('User is not a member of this tenant');
    }
    return {
      tenantId,
      userId: row.id,
      role: row.role,
      name: row.name,
      authMode: 'supabase',
    };
  }

  private async requireDevUser(tenantId: string): Promise<DashboardUser> {
    const row = await withTenant(tenantId, async (tx) => {
      const query = tx.select().from(users).where(eq(users.tenantId, tenantId)).limit(1);
      const [user] = await query;
      return user;
    });
    return {
      tenantId,
      userId: env.DASHBOARD_DEV_USER_ID ?? row?.id ?? null,
      role: (row?.role ?? 'owner') as DashboardRole,
      name: row?.name ?? 'Demo owner',
      authMode: 'dev',
    };
  }
}

function header(req: Request, key: string): string | undefined {
  const value = req.headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(req: Request): string | null {
  const authorization = header(req, 'authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

function verifyJwt(token: string, secret: string): JwtPayload {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new UnauthorizedException('Malformed JWT');
  }
  const headerJson = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: string };
  if (headerJson.alg !== 'HS256') {
    throw new UnauthorizedException('Unsupported JWT algorithm');
  }
  const expected = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(encodedSignature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new UnauthorizedException('Invalid JWT signature');
  }
  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as JwtPayload;
}
