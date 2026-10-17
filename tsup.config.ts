import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

/** Package version baked into the bundles (read by `getVersion()` in `src/prisma8/cli.ts`). */
const define = { __PACKAGE_VERSION__: JSON.stringify(JSON.parse(readFileSync('./package.json', 'utf8')).version) };

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
        define,
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
        define,
        outExtension
    }
]);
