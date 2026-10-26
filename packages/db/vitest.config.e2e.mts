import { defineConfig } from 'vitest/config';

// Contra Postgres real: un archivo a la vez, como las e2e de la api.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.e2e-spec.mts'],
    fileParallelism: false,
  },
});
