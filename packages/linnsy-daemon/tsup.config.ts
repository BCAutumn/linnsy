import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli/index.ts'
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: true
});
