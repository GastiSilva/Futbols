/* eslint-env node */

module.exports = {
  root: true,

  overrides: [
    {
      files: ['*.js'],
      env: { node: true },
      extends: ['eslint:recommended'],
    },
    {
      files: ['*.vue', '*.js'],
      extends: [
        'plugin:vue/vue3-essential',
        'eslint:recommended',
      ],
      plugins: ['vue'],
      env: { browser: true, es2022: true },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      rules: {
        'vue/multi-word-component-names': 'off',
      },
    },
  ],
}
