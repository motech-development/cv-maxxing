import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { flatConfigs as importXFlatConfigs } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = ['**/*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}'];
const typeScriptFiles = ['**/*.{cts,mts,ts,tsx}'];
const reactFiles = ['**/*.{jsx,tsx}'];

const projectTerminologyAbbreviations = {
  CLI: true,
  CV: true,
  Db: true,
  PDF: true,
  UI: true,
  args: true,
  cli: true,
  cv: true,
  db: true,
  env: true,
  ipc: true,
  params: true,
  pdf: true,
  props: true,
  ref: true,
  ui: true,
};

export default tseslint.config(
  {
    ignores: [
      '.husky/_/**',
      '**/coverage/**',
      '**/dist/**',
      'node_modules/**',
      'out/**',
      'release/**',
      'tmp/**',
      '*.pen',
    ],
    name: 'cv-maxxing/ignores',
  },
  {
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.es2025,
      },
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
    name: 'cv-maxxing/base-language',
  },
  {
    files: [
      '*.config.{js,mjs}',
      'apps/*/*.config.ts',
      'apps/*/tests/e2e/**/*.ts',
      'apps/*/src/main/**/*.ts',
      'apps/*/src/preload/**/*.ts',
      'eslint.config.mjs',
      'scripts/**/*.{js,mjs,ts,mts}',
      'tools/**/*.{js,mjs,ts,mts}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    name: 'cv-maxxing/node-config-files',
  },
  {
    files: ['apps/*/src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    name: 'cv-maxxing/browser-renderer-files',
  },
  eslint.configs.recommended,
  importXFlatConfigs.recommended,
  unicorn.configs['flat/recommended'],
  {
    files: sourceFiles,
    name: 'cv-maxxing/strict-readable-code',
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'array-callback-return': [
        'error',
        {
          allowImplicit: false,
          checkForEach: true,
        },
      ],
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-alert': 'error',
      'no-console': [
        'error',
        {
          allow: ['error', 'info', 'warn'],
        },
      ],
      'no-else-return': [
        'error',
        {
          allowElseIf: false,
        },
      ],
      'no-implicit-coercion': 'error',
      'no-lonely-if': 'error',
      'no-nested-ternary': 'error',
      'no-template-curly-in-string': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-assignment': 'error',
      'object-shorthand': ['error', 'always'],
      'one-var': ['error', 'never'],
      'padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          next: 'return',
          prev: '*',
        },
      ],
      'prefer-const': 'error',
      'prefer-template': 'error',
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [['^node:'], [String.raw`^@?\w`], ['^'], [String.raw`^\.`]],
        },
      ],
      'unicorn/filename-case': [
        'error',
        {
          cases: {
            kebabCase: true,
            pascalCase: true,
          },
        },
      ],
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prevent-abbreviations': [
        'error',
        {
          allowList: projectTerminologyAbbreviations,
        },
      ],
    },
  },
  {
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      importXFlatConfigs.typescript,
    ],
    files: typeScriptFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    name: 'cv-maxxing/typescript',
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          fixStyle: 'separate-type-imports',
          prefer: 'type-imports',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-inferrable-types': [
        'error',
        {
          ignoreParameters: false,
          ignoreProperties: false,
        },
      ],
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          ignoreVoid: false,
        },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
    },
  },
  {
    files: ['**/*.d.ts'],
    name: 'cv-maxxing/declaration-files',
    rules: {
      'unicorn/require-module-specifiers': 'off',
    },
  },
  {
    files: reactFiles,
    languageOptions: {
      ...jsxA11y.flatConfigs.strict.languageOptions,
    },
    name: 'cv-maxxing/react-accessibility',
    plugins: {
      ...jsxA11y.flatConfigs.strict.plugins,
      ...reactHooks.configs.flat.recommended.plugins,
    },
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      ...reactHooks.configs.flat.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/incompatible-library': 'error',
      'react-hooks/unsupported-syntax': 'error',
    },
  },
  {
    files: ['apps/*/src/main/main.ts'],
    name: 'cv-maxxing/electron-main-entry',
    rules: {
      'unicorn/prefer-top-level-await': 'off',
    },
  },
  prettier,
);
