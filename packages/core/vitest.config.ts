import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration files share one PostgreSQL; running them one at a time keeps connection usage bounded.
    fileParallelism: false,
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.int.test.ts'] } },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: { include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts', 'src/index.ts'] },
  },
});
