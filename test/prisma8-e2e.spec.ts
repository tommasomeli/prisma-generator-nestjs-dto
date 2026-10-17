import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listTsFiles, typecheck } from './helpers/typecheck';

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures/prisma8/blog');
const DECORATOR_STUBS = path.join(__dirname, 'helpers/decorator-stubs.d.ts');

/**
 * Runs the real Prisma 8 CLI entry (`src/bin.ts` with arguments) on the committed blog fixture,
 * exactly as `examples/prisma8-nestjs` does with `npm run generate`. Returns the generated files.
 */
function runCli(output: string, config: string): string[] {
    const outDir = path.join(ROOT, output);
    fs.rmSync(outDir, { recursive: true, force: true });
    execFileSync(process.execPath, ['--import', 'jiti/register', path.join(ROOT, 'src/bin.ts'), '--contract', path.join(FIXTURE, 'contract.prisma'), '--output', output, '--config', path.join(FIXTURE, config)], {
        cwd: ROOT,
        stdio: 'pipe',
        env: { ...process.env, PRISMA_DISABLE_TELEMETRY: '1' }
    });
    return listTsFiles(outDir)
        .map((file) => path.relative(outDir, file).split(path.sep).join('/'))
        .sort();
}

describe('Prisma 8 end to end: blog contract through the CLI (class mode)', () => {
    const output = 'test/.output/prisma8-blog';
    const files = runCli(output, 'nestjs-dto.config.ts');
    const read = (file: string) => fs.readFileSync(path.join(ROOT, output, file), 'utf8');

    it('emits the expected layout', () => {
        expect(files).toEqual([
            'enums/index.ts',
            'enums/role.enum.ts',
            'index.ts',
            'manifest.ts',
            'model-entity-map.ts',
            'post/create-post.dto.ts',
            'post/index.ts',
            'post/post.entity.ts',
            'post/update-post.dto.ts',
            'user/create-user.dto.ts',
            'user/index.ts',
            'user/update-user.dto.ts',
            'user/user.entity.ts'
        ]);
    });

    it('never imports @prisma/client', () => {
        for (const file of files) expect(read(file), file).not.toContain('@prisma/client');
    });

    it('type-checks under strict mode', () => {
        expect(typecheck([...listTsFiles(path.join(ROOT, output)), DECORATOR_STUBS])).toEqual([]);
    });

    it.each(files)('matches the snapshot of %s', async (file) => {
        await expect(read(file)).toMatchFileSnapshot(`__snapshots__/prisma8-blog/${file}`);
    });
});

describe('Prisma 8 end to end: blog contract through the CLI (Zod mode)', () => {
    const output = 'test/.output/prisma8-blog-zod';
    const files = runCli(output, 'nestjs-dto.zod.config.ts');
    const read = (file: string) => fs.readFileSync(path.join(ROOT, output, file), 'utf8');

    it('emits schemas only, importing nothing but zod and generated files', () => {
        expect(files).toContain('enums/role.enum.ts');
        expect(files).toContain('user/create-user.schema.ts');
        expect(files.some((file) => file.endsWith('.dto.ts') || file.endsWith('.entity.ts'))).toBe(false);
        for (const file of files) {
            const specifiers = [...read(file).matchAll(/from '([^']+)'/g)].map((m) => m[1]);
            for (const specifier of specifiers) expect(specifier === 'zod' || specifier.startsWith('.'), `${file} imports ${specifier}`).toBe(true);
        }
    });

    it('type-checks under strict mode', () => {
        expect(typecheck(listTsFiles(path.join(ROOT, output)))).toEqual([]);
    });

    it.each(files)('matches the snapshot of %s', async (file) => {
        await expect(read(file)).toMatchFileSnapshot(`__snapshots__/prisma8-blog-zod/${file}`);
    });
});
