/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Served from battydev.com/gwent, assembled into the site at build time.
export default defineConfig({
  base: '/gwent/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
