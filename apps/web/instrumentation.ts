import * as Sentry from '@sentry/nextjs';

export function register() {
  // Undefined DSN disables Sentry, so local dev needs no setup.
  Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1 });
}

export const onRequestError = Sentry.captureRequestError;
