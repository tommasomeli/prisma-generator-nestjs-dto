import { defineConfig } from 'tsup';

const outExtension = ({ format }: { format: 'cjs' | 'esm' | 'iife' }) => {
    if (format === 'cjs') return { js: '.cjs' };
    if (format === 'esm') return { js: '.mjs' };
    return {};
};

export default defineConfig([
    {
        entry: { index: 'src/index.ts' },
        format: ['esm', 'cjs'],
        dts: true,
        sourcemap: true,
        clean: true,
        target: 'node18',
        platform: 'node',
        outDir: 'dist',
        splitting: false,
        treeshake: true,
        outExtension
    },
    {
        entry: { bin: 'src/bin.ts' },
        format: ['cjs'],
        dts: false,
        sourcemap: true,
        clean: false,
        target: 'node18',
        platform: 'node',
        outDir: 'dist',
        splitting: false,
        treeshake: true,
        banner: { js: '#!/usr/bin/env node' },
        outExtension
    }
]);
