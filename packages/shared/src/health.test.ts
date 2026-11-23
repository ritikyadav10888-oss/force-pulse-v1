import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health';

describe('healthResponseSchema', () => {
  it('accepts a valid health body', () => {
    expect(
      healthResponseSchema.parse({ status: 'ok', service: 'api', checks: { database: 'up' } }),
    ).toBeTruthy();
  });

  it('rejects an unknown service', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok', service: 'db' }).success).toBe(false);
  });
});
