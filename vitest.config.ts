import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['tests/e2e/**', '**/node_modules/**'],
    // Dummy values so modules that validate env at import (src/lib/env.ts) load
    // under test. Real network calls are mocked per-test. DATABASE_PATH points at
    // a throwaway file so route tests don't write to the real dev activity log.
    env: {
      ARCHIVE_ACCESS_KEY: 'test-access-key',
      ARCHIVE_SECRET_KEY: 'test-secret-key',
      ARCHIVE_EMAIL: 'test@example.com',
      DATABASE_PATH: './data/test.db',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
