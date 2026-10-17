import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  js.configs.recommended,
  {
    files: ['test/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name="waitForFunction"] > :matches(FunctionExpression, ArrowFunctionExpression)[async=true]',
          message:
            'waitForFunction requires a synchronous predicate; await fixture module imports separately before polling.',
        },
      ],
    },
  },
  {
    rules: {
      curly: ['error', 'all'],
      'comma-dangle': 'off',
      'space-before-function-paren': 'off',
      'no-unused-vars': [
        'error',
        {
          args: 'none',
        },
      ],
    },
  },
]
