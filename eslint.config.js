export default [
  // Global ignores must be their own config object with ONLY `ignores` --
  // attaching `ignores` alongside `files` only scopes it within that same
  // object's matches, not repo-wide (an ESLint flat-config gotcha,
  // confirmed live: without this, `coverage/`'s generated report JS was
  // being linted too).
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
];
