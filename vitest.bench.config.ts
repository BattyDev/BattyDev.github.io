import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/bench/**/*.bench.ts'],
    testTimeout: 60 * 60 * 1000,
  },
});
