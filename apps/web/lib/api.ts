export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Machine-readable reason from the API, e.g. "consent_required". */
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function send(path: string, init?: RequestInit) {
  return fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
}

let refreshing: Promise<boolean> | null = null;
// One shared refresh for parallel 401s, so we never rotate the same refresh token twice.
const refreshOnce = () =>
  (refreshing ??= send('/auth/refresh', { method: 'POST' })
    .then((r) => r.ok)
    .finally(() => setTimeout(() => (refreshing = null), 0)));

/** JSON fetch against our API via the same-origin /api proxy. Refreshes the session once on 401. */
export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && !path.startsWith('/auth/') && (await refreshOnce())) {
    res = await send(path, init);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      message?: string | string[];
      code?: string;
      issues?: { path: string; message: string }[];
    };
    const msg =
      body.issues?.map((i) => `${i.path}: ${i.message}`).join(', ') ??
      (Array.isArray(body.message) ? body.message.join(', ') : body.message) ??
      res.statusText;
    if (body.code === 'consent_required' && typeof window !== 'undefined') {
      window.location.assign('/consent');
    }
    throw new ApiError(res.status, msg, body.code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = (path: string) => api(path, { method: 'DELETE' });

/** Uploads straight to storage with a signed URL from the API (bypasses our /api proxy). */
export async function uploadToSignedUrl(
  ticket: { uploadUrl: string; headers: Record<string, string> },
  file: Blob,
) {
  const res = await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: file });
  if (!res.ok) throw new ApiError(res.status, 'Upload failed, please try again');
}
