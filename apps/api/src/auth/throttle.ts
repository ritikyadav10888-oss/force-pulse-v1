import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';

/** Per-IP limits: a general one for every route, and a strict one for /auth/*. */
export const throttlerOptions = (): ThrottlerModuleOptions => [
  { name: 'default', ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) },
  {
    name: 'auth',
    ttl: 60_000,
    limit: Number(process.env.AUTH_RATE_LIMIT ?? 10),
    skipIf: (ctx) => !ctx.switchToHttp().getRequest<Request>().path.startsWith('/auth/'),
  },
];

@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  // Cloud Run puts the client IP first in X-Forwarded-For, and the web app's /api proxy passes the
  // header through, so the first entry is the browser's IP for direct and proxied calls alike.
  // shortcut: a client can spoof this header to dodge per-IP limits; move to Cloud Armor rate
  // limiting on a load balancer before public launch.
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as Request;
    const xff = r.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    return first || r.socket.remoteAddress || 'unknown';
  }
}
