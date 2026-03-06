import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/lib/insights/**/*.test.ts', 'src/lib/insights/**/*.test.ts'],
  },
});
