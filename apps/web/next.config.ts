import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server for the Cloud Run image (Next infers the monorepo root from the lockfile).
  output: 'standalone',
  // The browser only talks to this origin; /api/* is proxied to the API so session cookies are
  // first-party (no third-party-cookie or CORS issues). Resolved at build time.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

// Source maps upload only when SENTRY_AUTH_TOKEN is set (CI); local builds skip it.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
});
