import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'scripts/lib/**/*.test.ts',
      'src/lib/**/*.test.ts',
    ],
  },
});
