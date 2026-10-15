import eslint from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'
import svelte from 'eslint-plugin-svelte'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.pnpm-store/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  eslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.{ts,mjs,svelte}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      semi: ['error', 'never'],
      'max-lines': ['error', 999],
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: { parser: tsParser },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-undef': 'off',
    },
  },
]
