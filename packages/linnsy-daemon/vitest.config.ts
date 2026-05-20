import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@renderer/contracts': new URL('./app/renderer/src/contracts/shared.ts', import.meta.url).pathname
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
      '__tests__/**/*.contract.ts',
      '__tests__/**/*.spec.ts'
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli/index.ts', 'src/index.ts'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85
      }
    }
  }
});
