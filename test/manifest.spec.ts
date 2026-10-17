import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generate } from '../src/generator';
import ManifestGenerator from '../src/generators/manifest-generator';
import { contractToDatamodel } from '../src/prisma8/contract-to-dmmf';
import type { Prisma8Contract } from '../src/prisma8/types';
import kitchenSinkJson from './fixtures/prisma8/kitchen-sink/contract.json';
import { buildOptions } from './helpers/build-options';
import { listTsFiles, typecheck } from './helpers/typecheck';

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

    it('inlines the ModelName union in Prisma 8 mode and leaves value objects out (no @prisma/client)', async () => {
        const datamodel = contractToDatamodel(kitchenSinkJson as unknown as Prisma8Contract, { annotations: new Map(), warn: () => {} });
        expect(datamodel.types.map((t) => t.name)).toEqual(['Address']);
        const options = buildOptions({ output: outDir, datamodel, config: { prisma8: 'true', emitManifest: 'true' } });
        const files = await new ManifestGenerator(options).generate();
        const manifest = files.find((f) => f.path.endsWith('manifest.ts'))!.content;
        const entityMap = files.find((f) => f.path.endsWith('model-entity-map.ts'))!.content;
        expect(manifest).not.toContain('@prisma/client');
        expect(manifest).toContain("export type ModelName = 'Account' | 'Profile' | 'Team' | 'Membership';");
        expect(manifest).toContain('PrismaManifest: Record<ModelName, ModelManifest>');
        // `address` is a value object field: kept in entityFields, not reported as a relation.
        const body = JSON.parse(manifest.slice(manifest.indexOf('= {') + 2, manifest.lastIndexOf('}') + 1));
        expect(body.Account.entityFields).toContain('address');
        expect(Object.keys(body.Account.relations)).toEqual(['profile', 'memberships', 'invitations']);
        expect(body.Address).toBeUndefined();
        expect(entityMap).toContain("import type { Account as AccountEntity } from './account/account.entity';");
        expect(entityMap).not.toContain('Address');
    });

    it('model-entity-map.ts type-checks against the Prisma 8 entities', async () => {
        const datamodel = contractToDatamodel(kitchenSinkJson as unknown as Prisma8Contract, { annotations: new Map(), warn: () => {} });
        // Inside the repository so that `@prisma/orm-framework/utils/json` (a devDependency) resolves.
        const repoOut = path.join(__dirname, '.output/manifest-prisma8');
        fs.rmSync(repoOut, { recursive: true, force: true });
        await generate(buildOptions({ output: repoOut, datamodel, config: { prisma8: 'true', emitManifest: 'true', classValidator: 'false', swaggerDocs: 'false' } }));
        expect(fs.existsSync(path.join(repoOut, 'model-entity-map.ts'))).toBe(true);
        expect(typecheck(listTsFiles(repoOut))).toEqual([]);
    });
});
