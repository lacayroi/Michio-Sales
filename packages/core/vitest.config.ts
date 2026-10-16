import { defineConfig } from 'vitest/config';

// Unit tests only; database-backed tests live in *.int.test.ts (vitest.integration.config.ts).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], exclude: ['src/**/*.int.test.ts'] },
});
