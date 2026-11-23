import * as Sentry from '@sentry/nestjs';

// Must run before anything else so Sentry can patch modules. Env wins over .env (Node semantics).
try {
  process.loadEnvFile();
} catch {
  // no .env file: fine in CI and on Cloud Run
}

Sentry.init({
  dsn: process.env.SENTRY_DSN, // undefined disables Sentry
  environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
  tracesSampleRate: 0.1,
});
