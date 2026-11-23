import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC keeps decorator metadata, which Nest DI needs and esbuild drops.
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.spec.ts'],
    env: { LOG_LEVEL: 'silent' },
  },
});
