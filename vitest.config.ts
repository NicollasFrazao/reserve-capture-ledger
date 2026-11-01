import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          // The files share one database and the expiry sweep is global,
          // so they run one after the other. Tests inside a file still
          // fire requests concurrently where that is the point.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
