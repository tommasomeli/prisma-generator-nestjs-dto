import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generate } from '../src/generator';
import ManifestGenerator from '../src/generators/manifest-generator';
import { buildOptions } from './helpers/build-options';

describe('ManifestGenerator', () => {
    let outDir: string;

    beforeEach(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-manifest-'));
    });

    afterEach(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    it('honors fileNamingStrategy in entity import paths (nestjs structure)', async () => {
        const gen = new ManifestGenerator(
            buildOptions({
                output: outDir,
                models: [{ name: 'UserAccount', fields: [{ name: 'id', type: 'Int', isId: true }] }],
                config: { fileNamingStrategy: 'kebab', outputStructure: 'nestjs' }
            })
        );
        const files = await gen.generate();
        const entityMap = files.find((f) => f.path.endsWith('model-entity-map.ts'))!;
        expect(entityMap.content).toContain("from './user-account/user-account.entity'");
    });

    it('emits flat entity import paths when outputStructure is flat', async () => {
        const gen = new ManifestGenerator(
            buildOptions({
                output: outDir,
                models: [{ name: 'UserAccount', fields: [{ name: 'id', type: 'Int', isId: true }] }],
                config: { fileNamingStrategy: 'kebab', outputStructure: 'flat' }
            })
        );
        const files = await gen.generate();
        const entityMap = files.find((f) => f.path.endsWith('model-entity-map.ts'))!;
        expect(entityMap.content).toContain("from './user-account.entity'");
        expect(entityMap.content).not.toContain('user-account/user-account');
    });

    it('is opt-in via emitManifest flag', async () => {
        await generate(
            buildOptions({
                output: outDir,
                models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
                config: { fileNamingStrategy: 'kebab', outputStructure: 'flat', reExport: 'false', prettier: 'false' }
            })
        );
        expect(fs.existsSync(path.join(outDir, 'manifest.ts'))).toBe(false);
        expect(fs.existsSync(path.join(outDir, 'model-entity-map.ts'))).toBe(false);

        await generate(
            buildOptions({
                output: outDir,
                models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
                config: { fileNamingStrategy: 'kebab', outputStructure: 'flat', reExport: 'false', prettier: 'false', emitManifest: 'true' }
            })
        );
        expect(fs.existsSync(path.join(outDir, 'manifest.ts'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'model-entity-map.ts'))).toBe(true);
    });

    it('captures primary key and relations in the manifest body', async () => {
        const gen = new ManifestGenerator(
            buildOptions({
                output: outDir,
                models: [
                    {
                        name: 'Post',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'title', type: 'String', isRequired: true },
                            { name: 'author', type: 'User', kind: 'object', isRequired: true, relationFromFields: ['authorId'] },
                            { name: 'authorId', type: 'Int', isRequired: true }
                        ]
                    }
                ],
                config: { fileNamingStrategy: 'kebab', outputStructure: 'nestjs' }
            })
        );
        const files = await gen.generate();
        const manifest = files.find((f) => f.path.endsWith('manifest.ts'))!;
        expect(manifest.content).toContain('"primaryKey": "id"');
        expect(manifest.content).toContain('"author"');
    });
});
