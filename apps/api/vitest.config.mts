import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest 12 se publica solo como ESM: Jest no lo carga en Node 22 y Vitest sí.
// SWC compila los tests y emite la metadata de los decoradores que usa la
// inyección de dependencias de Nest (esbuild no la emite).
export const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  plugins,
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
