import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  define: {
    // Prevent Vite from replacing NODE_ENV with 'production' in node_modules
    // so that React and react-dom load their development builds (which export act).
    'process.env.NODE_ENV': JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      exclude: ['tests/**', 'dist/**'],
      thresholds: {
        statements: 39,
        branches: 29,
        functions: 45,
        lines: 40,
      },
    },
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
    environmentMatchGlobs: [
      ['tests/renderer/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./tests/setup.ts'],
    deps: {
      // Process @testing-library/react through Vite so its internal
      // require("react-dom/test-utils") is subject to module resolution
      // and picks up the correct React.act (React 19 compat).
      inline: ['@testing-library/react'],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
