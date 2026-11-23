import type { HealthResponse } from '@force-pulse/shared';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok', service: 'web' } satisfies HealthResponse);
}
