import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: [
      'scripts/lib/**/*.test.ts',
      'src/lib/**/*.test.ts',
    ],
  },
});
