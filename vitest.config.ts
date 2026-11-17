import { defineConfig } from 'vitest/config';
import path from 'path';

const INTEGRATION = 'scripts/lib/**/*.integration.test.ts';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['scripts/lib/**/*.test.ts', 'src/lib/**/*.test.ts'],
          exclude: ['**/node_modules/**', INTEGRATION],
        },
      },
      {
        // The integration suites each wipe the same FIXTURE_DATABASE_URL
        // (DROP SCHEMA public CASCADE), so they must never run at the same time.
        extends: true,
        test: {
          name: 'integration',
          include: [INTEGRATION],
          fileParallelism: false,
        },
      },
    ],
  },
});
