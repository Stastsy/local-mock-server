import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'acceptance',
          include: ['qa/acceptance/**/*.spec.ts'],
          environment: 'node',
          testTimeout: 15000,
          hookTimeout: 15000,
        },
      },
    ],
  },
});
