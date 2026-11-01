import { defineConfig } from 'vitest/config';

const COVERAGE_THRESHOLD = 80;

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The composition root only wires tested parts together and starts listening;
      // the README's run instructions are its check.
      exclude: ['src/server.ts'],
      reporter: [
        'text',
        'lcov',
      ],
      thresholds: {
        lines: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'tooling',
          include: [
            'eslint-rules/**/*.test.mjs',
            'scripts/**/*.test.mjs',
          ],
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
