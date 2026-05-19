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

const inferrableReturnTypeNodes = new Set([
  'TSBooleanKeyword',
  'TSNullKeyword',
  'TSNumberKeyword',
  'TSStringKeyword',
  'TSUndefinedKeyword',
  'TSVoidKeyword',
]);

function isFunctionNode(node) {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression'
  );
}

function isFunctionReturnType(node) {
  const parent = node.parent;

  return parent !== undefined && isFunctionNode(parent) && parent.returnType === node;
}

function isExportedFunctionSignature(functionNode) {
  const parent = functionNode.parent;

  if (parent?.type === 'ExportDefaultDeclaration' || parent?.type === 'ExportNamedDeclaration') {
    return true;
  }

  if (parent?.type !== 'VariableDeclarator') {
    return false;
  }

  return parent.parent?.parent?.type === 'ExportNamedDeclaration';
}

const localTypeStylePlugin = {
  rules: {
    'no-inferrable-primitive-function-return-type': {
      create(context) {
        function checkFunctionReturnType(node) {
          if (node.returnType === undefined || node.body === null) {
            return;
          }

          if (!inferrableReturnTypeNodes.has(node.returnType.typeAnnotation.type)) {
            return;
          }

          context.report({
            fix(fixer) {
              return fixer.removeRange(node.returnType.range);
            },
            message:
              'Omit primitive and void function return types that TypeScript can infer from the implementation.',
            node: node.returnType,
          });
        }

        return {
          ArrowFunctionExpression: checkFunctionReturnType,
          FunctionDeclaration: checkFunctionReturnType,
          FunctionExpression: checkFunctionReturnType,
        };
      },
      meta: {
        fixable: 'code',
        schema: [],
        type: 'suggestion',
      },
    },
    'no-inline-object-function-type': {
      create(context) {
        function isFunctionParameterType(node) {
          const parent = node.parent;

          if (parent === undefined) {
            return false;
          }

          const ancestors = context.sourceCode.getAncestors(node);
          const functionAncestor = ancestors.findLast((ancestor) => isFunctionNode(ancestor));

          return (
            functionAncestor !== undefined &&
            functionAncestor.params.includes(parent) &&
            isExportedFunctionSignature(functionAncestor)
          );
        }

        return {
          TSTypeAnnotation(node) {
            if (node.typeAnnotation.type !== 'TSTypeLiteral') {
              return;
            }

            if (isFunctionReturnType(node)) {
              context.report({
                fix(fixer) {
                  return fixer.removeRange(node.range);
                },
                message:
                  'Omit inline object return types that TypeScript can infer from the implementation.',
                node,
              });

              return;
            }

            if (!isFunctionParameterType(node)) {
              return;
            }

            context.report({
              message:
                'Use a named interface or type alias instead of an inline object type in function signatures.',
              node,
            });
          },
        };
      },
      meta: {
        fixable: 'code',
        schema: [],
        type: 'problem',
      },
    },
  },
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
      'apps/*/scripts/**/*.{js,mjs,ts,mts}',
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
          groups: [[String.raw`^\u0000`, '^node:', String.raw`^@?\w`, '^', String.raw`^\.`]],
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
    plugins: {
      'cv-maxxing-local': localTypeStylePlugin,
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
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
      'cv-maxxing-local/no-inferrable-primitive-function-return-type': 'error',
      'cv-maxxing-local/no-inline-object-function-type': 'error',
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
