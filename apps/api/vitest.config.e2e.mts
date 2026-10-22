import { defineConfig } from 'vitest/config';
import { plugins } from './vitest.config.mts';

export default defineConfig({
  plugins,
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    // Comparten la BD local: un archivo a la vez.
    fileParallelism: false,
  },
});
