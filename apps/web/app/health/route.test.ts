import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@force-pulse/shared';
import { GET } from './route';

describe('GET /health (web)', () => {
  it('returns a valid ok body', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(await res.json())).toEqual({ status: 'ok', service: 'web' });
  });
});
