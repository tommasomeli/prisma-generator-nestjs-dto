import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyConfigFile } from '../src/config-loader';
import { CreateDtoGenerator, EntityGenerator } from '../src/generators';
import { generate } from '../src/generator';
import type { GeneratorConfigFile, RawGeneratorConfig } from '../src/types';
import { Utility } from '../src/utility';
import { buildOptions } from './helpers/build-options';

describe('extraScalars', () => {
    describe('parseExtraScalars (Utility)', () => {
        it('accepts a JSON string and an already-parsed object form interchangeably', () => {
            const json = JSON.stringify({
                Decimal: { ts: 'Decimal', from: 'decimal.js' },
                Json: { ts: 'MyJson', from: 'src/json', apiType: 'Object' }
            });
            const fromString = Utility.parseExtraScalars(json);
            const fromObject = Utility.parseExtraScalars(JSON.parse(json));
            expect(fromString).toEqual(fromObject);
            expect(fromString.Decimal).toEqual({ ts: 'Decimal', from: 'decimal.js', apiType: undefined, format: undefined });
        });

        it('drops entries missing a string `ts` field', () => {
            const out = Utility.parseExtraScalars({ Decimal: { ts: 'Decimal' }, BadOne: { from: 'oops' } } as unknown);
            expect(Object.keys(out)).toEqual(['Decimal']);
        });

        it('returns {} for null/undefined/garbage input', () => {
            expect(Utility.parseExtraScalars(undefined)).toEqual({});
            expect(Utility.parseExtraScalars(null)).toEqual({});
            expect(Utility.parseExtraScalars('not-json')).toEqual({});
        });
    });

    describe('applyConfigFile (serialization)', () => {
        it('serializes extraScalars to a JSON string and resolves relative `from` paths', () => {
            const raw: RawGeneratorConfig = {};
            const configDir = '/Users/jane/proj/prisma';
            const result = applyConfigFile(
                raw,
                {
                    extraScalars: {
                        Decimal: { ts: 'Decimal', from: 'decimal.js' },
                        Json: { ts: 'MyJson', from: './local-json' }
                    }
                } satisfies GeneratorConfigFile,
                configDir
            );
            const parsed = JSON.parse(result.extraScalars as string);
            expect(parsed.Decimal).toEqual({ ts: 'Decimal', from: 'decimal.js' });
            expect(parsed.Json.from).toBe(path.resolve(configDir, './local-json'));
        });
    });

    describe('end-to-end', () => {
        let outDir: string;

        beforeEach(() => {
            outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-scalars-'));
        });

        afterEach(() => {
            fs.rmSync(outDir, { recursive: true, force: true });
        });

        it('replaces Decimal TS type with the overridden one and emits the import', async () => {
            const options = buildOptions({
                output: outDir,
                models: [
                    {
                        name: 'Invoice',
                        fields: [
                            { name: 'id', type: 'Int', isId: true, isRequired: true },
                            { name: 'amount', type: 'Decimal', isRequired: true }
                        ]
                    }
                ],
                config: {
                    outputStructure: 'flat',
                    fileNamingStrategy: 'kebab',
                    reExport: 'false',
                    prettier: 'false',
                    extraScalars: JSON.stringify({
                        Decimal: { ts: 'Decimal', from: 'decimal.js' }
                    })
                }
            });
            await generate(options);
            const entity = fs.readFileSync(path.join(outDir, 'invoice.entity.ts'), 'utf8');
            expect(entity).toContain("import { Decimal } from 'decimal.js'");
            expect(entity).toContain('amount!: Decimal;');
            expect(entity).not.toContain("import { Prisma } from '@prisma/client'");
        });

        it('uses the override even at the unit level (CreateDtoGenerator + EntityGenerator)', async () => {
            const options = buildOptions({
                output: outDir,
                models: [
                    {
                        name: 'Invoice',
                        fields: [
                            { name: 'id', type: 'Int', isId: true, isRequired: true },
                            { name: 'metadata', type: 'Json', isRequired: false }
                        ]
                    }
                ],
                config: {
                    outputStructure: 'flat',
                    fileNamingStrategy: 'kebab',
                    reExport: 'false',
                    prettier: 'false',
                    extraScalars: JSON.stringify({
                        Json: { ts: 'MyJson', from: 'src/json', apiType: 'Object' }
                    })
                }
            });

            const entityFiles = await new EntityGenerator(options).generate();
            const createFiles = await new CreateDtoGenerator(options).generate();

            const entitySource = entityFiles[0].content;
            const createSource = createFiles[0].content;

            expect(entitySource).toContain("import { MyJson } from 'src/json'");
            expect(entitySource).toContain('metadata?: MyJson');
            expect(entitySource).toContain('type: Object');
            expect(createSource).toContain("import { MyJson } from 'src/json'");
            expect(createSource).toContain('metadata?: MyJson');
        });
    });
});
