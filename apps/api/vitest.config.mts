import { randomBytes } from 'node:crypto';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC keeps decorator metadata, which Nest DI needs and esbuild drops.
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.spec.ts'],
    // Integration tests share one database.
    fileParallelism: false,
    env: {
      LOG_LEVEL: 'silent',
      // Fresh random secret per run: nothing secret-shaped is committed.
      JWT_SECRET: randomBytes(32).toString('hex'),
      SUPER_ADMIN_EMAILS: 'admin@example.com',
      GOOGLE_CLIENT_ID: 'test-client-id',
      // High so the suites don't trip limits; security.spec lowers AUTH_RATE_LIMIT for its own app.
      RATE_LIMIT: '100000',
      AUTH_RATE_LIMIT: '100000',
    },
  },
});
