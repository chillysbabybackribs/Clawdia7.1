import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
    environmentMatchGlobs: [
      ['tests/renderer/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
