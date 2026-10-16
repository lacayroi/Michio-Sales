import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Files share one database (isolated by organisation), run them one at a time.
    fileParallelism: false,
  },
});
