module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
    plugins: ['@typescript-eslint'],
    extends: ['plugin:@typescript-eslint/recommended'],
    env: { node: true, es2022: true },
    ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '*.cjs', 'test/fixtures/**'],
    rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-empty-object-type': 'off',
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/ban-types': 'off',
        'prefer-const': 'warn'
    }
};
