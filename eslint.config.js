import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import security from 'eslint-plugin-security';
import importPlugin from 'eslint-plugin-import';

export default [
  js.configs.recommended,
  security.configs.recommended,
  prettierConfig,
  {
    ignores: [
      'public/js/bundle.js',
      'public/js/chunks/**',
      'dist/**',
      'node_modules/**',
    ],
  },
  {
    files: ['**/*.js'],
    plugins: {
      prettier,
      security,
      import: importPlugin,
    },
    rules: {
      'prettier/prettier': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-console': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-unreachable': 'error',
      'no-unused-expressions': 'error',
      // Complexity rules (relaxed for real-world app)
      complexity: ['warn', { max: 25 }],
      'max-depth': ['warn', { max: 6 }],
      'max-lines-per-function': [
        'warn',
        { max: 200, skipBlankLines: true, skipComments: true },
      ],
      'max-params': ['warn', { max: 6 }],
      // Import rules (relaxed for Node.js environment)
      'import/no-unresolved': 'off', // Node.js modules may not be resolved
      'import/named': 'error',
      'import/default': 'error',
      'import/no-absolute-path': 'error',
      'import/no-self-import': 'error',
      'import/no-cycle': 'warn',
      'import/no-duplicates': 'error',
      // Security rules (additional to plugin defaults)
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-unsafe-regex': 'error',
      'security/detect-possible-timing-attacks': 'off',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearInterval: 'readonly',
        setInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        AbortController: 'readonly',
        Image: 'readonly',
        showToast: 'readonly',
        IntersectionObserver: 'readonly',
        Sortable: 'readonly',
        availableCountries: 'readonly',
        releaseGroups: 'readonly',
        showMobileEditForm: 'readonly',
        showMobileEditFormSafe: 'readonly',
        showMobileListMenu: 'readonly',
        playAlbumSafe: 'readonly',
        toggleMobileLists: 'readonly',
        list: 'readonly',
        newIndex: 'readonly',
        oldIndex: 'readonly',
        Blob: 'readonly',
        navigator: 'readonly',
        File: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        EventSource: 'readonly',
        clearTimeout: 'readonly',
        setImmediate: 'readonly',
        confirm: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
      },
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
  {
    files: ['public/service-worker.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        skipWaiting: 'readonly',
        registration: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-require': 'off',
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['db/**/*.js'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-require': 'off',
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['routes/**/*.js', 'templates.js', 'settings-template.js'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'max-lines-per-function': 'off',
      complexity: 'off',
    },
  },
  {
    files: ['src/js/**/*.js'],
    rules: {
      'no-console': 'off',
      'import/no-cycle': 'off',
      complexity: 'off',
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['test/**/*.js', 'utils/**/*.js'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
];
