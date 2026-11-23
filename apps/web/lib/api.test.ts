import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('api()', () => {
  it('refreshes once on 401 and retries', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(401))
      .mockResolvedValueOnce(json(204))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', fetch);
    await expect(api('/me')).resolves.toEqual({ ok: true });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/me', '/api/auth/refresh', '/api/me']);
  });

  it('surfaces validation issues as the error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(400, { issues: [{ path: 'dob', message: 'Invalid date' }] })),
    );
    await expect(api('/players')).rejects.toEqual(new ApiError(400, 'dob: Invalid date'));
  });
});

describe('consent redirect', () => {
  it('sends the browser to /consent when the API says consent_required', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(403, { code: 'consent_required', message: 'Please accept' })),
    );
    await expect(api('/players')).rejects.toMatchObject({ status: 403, code: 'consent_required' });
    expect(assign).toHaveBeenCalledWith('/consent');
  });
});
