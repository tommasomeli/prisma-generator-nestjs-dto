import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expandGlob, globStaticPrefix, locateContract, readContract } from '../src/prisma8/contract-reader';

const FIXTURE = path.resolve(__dirname, 'fixtures/prisma8/blog');
const EXAMPLE = path.resolve(__dirname, '../examples/prisma8-nestjs');

describe('prisma8 contract reader', () => {
    let tmp: string;
    let prismaDir: string;

    beforeEach(() => {
        // realpath: macOS tmpdir is a symlink (/var → /private/var); keep comparisons stable.
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-p8-')));
        prismaDir = path.join(tmp, 'src/prisma');
        fs.mkdirSync(path.join(prismaDir, 'models'), { recursive: true });
        fs.copyFileSync(path.join(FIXTURE, 'contract.json'), path.join(prismaDir, 'contract.json'));
        fs.copyFileSync(path.join(FIXTURE, 'contract.prisma'), path.join(prismaDir, 'contract.prisma'));
        fs.writeFileSync(path.join(prismaDir, 'models/extra.prisma'), '// use prisma-8\n');
        fs.writeFileSync(path.join(prismaDir, 'models/notes.txt'), 'not a schema');
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('(a) accepts an explicit contract.json path and picks up the sibling contract.prisma', async () => {
        const location = await locateContract('src/prisma/contract.json', tmp);
        expect(location).toEqual({ jsonPath: path.join(prismaDir, 'contract.json'), dir: prismaDir, pslFiles: [path.join(prismaDir, 'contract.prisma')] });
    });

    it('(b) accepts a .prisma path and reads the sibling contract.json', async () => {
        const location = await locateContract(path.join(prismaDir, 'contract.prisma'));
        expect(location.jsonPath).toBe(path.join(prismaDir, 'contract.json'));
        expect(location.pslFiles).toEqual([path.join(prismaDir, 'contract.prisma')]);
    });

    it('(c) accepts a glob: JSON in the static prefix dir, every .prisma match sorted', async () => {
        const location = await locateContract('./src/prisma/**/*.prisma', tmp);
        expect(location.jsonPath).toBe(path.join(prismaDir, 'contract.json'));
        expect(location.dir).toBe(prismaDir);
        expect(location.pslFiles).toEqual([path.join(prismaDir, 'contract.prisma'), path.join(prismaDir, 'models/extra.prisma')]);
    });

    it('(d) accepts a prisma.config.ts with the normalised { source.inputs, output } contract shape', async () => {
        fs.writeFileSync(
            path.join(tmp, 'prisma.config.ts'),
            "export default { orm: { contract: { source: { format: 'psl', inputs: ['./src/prisma/**/*.prisma'] }, output: './src/prisma/contract.json' } }, $prismaConfig: 1 };\n"
        );
        const location = await locateContract(path.join(tmp, 'prisma.config.ts'), '/');
        expect(location.jsonPath).toBe(path.join(prismaDir, 'contract.json'));
        expect(location.pslFiles).toEqual([path.join(prismaDir, 'contract.prisma'), path.join(prismaDir, 'models/extra.prisma')]);
    });

    it('(d) accepts a prisma.config.mjs with a plain string contract, resolved against the config dir', async () => {
        const configDir = path.join(tmp, 'config');
        fs.mkdirSync(configDir);
        fs.writeFileSync(path.join(configDir, 'prisma.config.mjs'), "export default { orm: { contract: '../src/prisma/contract.prisma' } };\n");
        const location = await locateContract('config/prisma.config.mjs', tmp);
        expect(location.jsonPath).toBe(path.join(prismaDir, 'contract.json'));
        expect(location.pslFiles).toEqual([path.join(prismaDir, 'contract.prisma')]);
    });

    it('(d) fails with a helpful error when the config has no contract setting', async () => {
        fs.writeFileSync(path.join(tmp, 'prisma.config.ts'), 'export default { orm: { db: {} } };\n');
        await expect(locateContract('prisma.config.ts', tmp)).rejects.toThrow(/Could not read the contract location .*orm keys: db/);
    });

    it.skipIf(!fs.existsSync(path.join(EXAMPLE, 'node_modules/prisma')))('(d) reads the real definePrismaConfig() output of the example project', async () => {
        const location = await locateContract(path.join(EXAMPLE, 'prisma.config.ts'));
        expect(location.jsonPath).toBe(path.join(EXAMPLE, 'src/prisma/contract.json'));
        expect(location.pslFiles).toEqual([path.join(EXAMPLE, 'src/prisma/contract.prisma')]);
    }, 30_000);

    it('throws with the resolved path and the `prisma contract emit` hint when contract.json is missing', async () => {
        fs.rmSync(path.join(prismaDir, 'contract.json'));
        await expect(locateContract('src/prisma/contract.prisma', tmp)).rejects.toThrow(path.join(prismaDir, 'contract.json'));
        await expect(locateContract('src/prisma/**/*.prisma', tmp)).rejects.toThrow(/run `prisma contract emit`/);
    });

    it('readContract parses the JSON and validates domain/storage', async () => {
        const location = await locateContract('src/prisma/contract.json', tmp);
        const contract = readContract(location);
        expect(Object.keys(contract.domain.namespaces.public.models)).toEqual(expect.arrayContaining(['User', 'Post']));
        fs.writeFileSync(location.jsonPath, JSON.stringify({ schemaVersion: '1', domain: {} }));
        expect(() => readContract(location)).toThrow(/missing 'storage'/);
        fs.writeFileSync(location.jsonPath, '{ not json');
        expect(() => readContract(location)).toThrow(/Failed to parse/);
    });

    it('glob helpers: static prefix and ?/{}/** matching', () => {
        expect(globStaticPrefix('./src/prisma/**/*.prisma')).toBe('./src/prisma');
        expect(globStaticPrefix('**/*.prisma')).toBe('');
        expect(expandGlob('src/prisma/contract.pr?sma', tmp)).toEqual([path.join(prismaDir, 'contract.prisma')]);
        expect(expandGlob('src/prisma/{models,nope}/*', tmp)).toEqual([path.join(prismaDir, 'models/extra.prisma'), path.join(prismaDir, 'models/notes.txt')]);
        expect(expandGlob('src/**', tmp)).toHaveLength(4);
    });
});
