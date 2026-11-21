export default [
  {
    files: ['index.js', 'src/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setImmediate: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
    },
  },
  {
    ignores: ['node_modules/**', 'coverage/**', 'examples/**'],
  },
];
