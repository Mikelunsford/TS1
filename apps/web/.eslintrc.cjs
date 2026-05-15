/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: '18.3' } },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'playwright-report',
    'test-results',
    'src/lib/database.types.ts',
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': 'warn',
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: 'antd', message: 'AntD is banned. Use src/components/ui primitives.' },
          { name: '@ant-design/icons', message: 'AntD icons are banned. Use lucide-react.' },
          { name: 'redux', message: 'Redux is banned. Use TanStack Query + React Context.' },
          { name: '@reduxjs/toolkit', message: 'RTK is banned. Use TanStack Query + React Context.' },
          { name: 'react-hook-form', message: 'react-hook-form is banned. Use native React state + Zod parse.' },
          { name: 'formik', message: 'Formik is banned. Use native React state + Zod parse.' },
          { name: 'dayjs', message: 'dayjs is banned. Use native Intl APIs.' },
          { name: 'date-fns', message: 'date-fns is banned. Use native Intl APIs.' },
          { name: 'moment', message: 'moment is banned. Use native Intl APIs.' },
          { name: 'lodash', message: 'lodash is banned. Use native ES2022 helpers.' },
          { name: 'shadcn', message: 'shadcn is banned. Use src/components/ui primitives.' },
          { name: 'uuid', message: 'uuid package is banned. Use crypto.randomUUID().' },
          { name: 'axios', message: 'axios is banned. Use the fetch wrapper in src/lib/apiClient.ts.' },
        ],
        patterns: [
          { group: ['@ant-design/*'], message: 'AntD ecosystem is banned. Use src/components/ui.' },
          { group: ['@radix-ui/*'], message: 'Radix is banned. Use src/components/ui primitives.' },
        ],
      },
    ],
  },
  overrides: [
    {
      files: ['*.config.ts', '*.config.js', '*.config.cjs', 'vite.config.ts', 'vitest.config.ts', 'vitest.contract.config.ts', 'playwright.config.ts', 'tailwind.config.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
