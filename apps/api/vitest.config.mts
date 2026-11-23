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
      JWT_SECRET: 'test-secret-test-secret-test-secret-0000',
      SUPER_ADMIN_EMAILS: 'admin@example.com',
      GOOGLE_CLIENT_ID: 'test-client-id',
    },
  },
});
