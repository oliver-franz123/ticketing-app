// ESLint mínimo para todo el monorepo (T2): solo las reglas recomendadas,
// sin reglas con información de tipos ni de estilo.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/dist/', '**/.next/', 'packages/db/src/generated/', '**/next-env.d.ts'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
);
