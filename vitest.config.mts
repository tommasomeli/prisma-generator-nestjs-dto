import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.spec.ts'],
        environment: 'node',
        // Several tests run tsc on the generated output; under coverage instrumentation on CI runners they exceed the 5 s default.
        testTimeout: 60_000,
        hookTimeout: 120_000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/bin.ts', 'src/index.ts']
        }
    }
});
