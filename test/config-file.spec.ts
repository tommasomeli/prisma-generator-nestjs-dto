import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyConfigFile, loadConfigFile } from '../src/config-loader';
import { generate } from '../src/generator';
import CreateDtoGenerator from '../src/generators/create-dto-generator';
import { buildOptions } from './helpers/build-options';

const FIXTURE_TS = path.resolve(__dirname, 'fixtures/sample-config.ts');
const FIXTURE_JSON = path.resolve(__dirname, 'fixtures/sample-config.json');

describe('configFile loader', () => {
    it('loads a .ts file via jiti and returns its default export', async () => {
        const options = buildOptions({
            models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
            config: { configFile: FIXTURE_TS }
        });
        const result = await loadConfigFile(options);
        expect(result).not.toBeNull();
        expect(result!.config.extraValidators).toBeDefined();
        expect(result!.config.extraImports).toHaveLength(2);
        expect(result!.dir).toBe(path.dirname(FIXTURE_TS));
    });

    it('loads a .json file', async () => {
        const options = buildOptions({
            models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
            config: { configFile: FIXTURE_JSON }
        });
        const result = await loadConfigFile(options);
        expect(result).not.toBeNull();
        expect(result!.config.extraValidators).toBe('IsUnique:src/common/validators');
        expect(result!.dir).toBe(path.dirname(FIXTURE_JSON));
    });

    it('returns null when configFile is unset', async () => {
        const options = buildOptions({ models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }] });
        expect(await loadConfigFile(options)).toBeNull();
    });

    it('returns null and does not throw when configFile path does not exist', async () => {
        const options = buildOptions({
            models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
            config: { configFile: '/nonexistent/path.ts' }
        });
        expect(await loadConfigFile(options)).toBeNull();
    });
});

describe('applyConfigFile', () => {
    it('overrides schema values with configFile values and coerces booleans/arrays to strings', () => {
        const raw = { outputType: 'class', emitManifest: 'false', extraImports: 'old' } as Record<string, string | string[] | undefined>;
        const cfg = { emitManifest: true, extraImports: ['a', 'b'] };
        const merged = applyConfigFile(raw, cfg);
        expect(merged.outputType).toBe('class');
        expect(merged.emitManifest).toBe('true');
        expect(merged.extraImports).toEqual(['a', 'b']);
    });

    it('returns the raw config untouched when configFile is null', () => {
        const raw = { outputType: 'class' } as Record<string, string | string[] | undefined>;
        expect(applyConfigFile(raw, null)).toEqual(raw);
    });
});

describe('configFile end-to-end', () => {
    let outDir: string;

    beforeEach(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-cfg-'));
    });

    afterEach(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    it('configFile values feed the DTO render pipeline', async () => {
        await generate(
            buildOptions({
                output: outDir,
                models: [{
                    name: 'Toggle',
                    fields: [
                        { name: 'id', type: 'Int', isId: true },
                        { name: 'enabled', type: 'Boolean', isRequired: true, documentation: '@IsUnique' }
                    ]
                }],
                config: { configFile: FIXTURE_TS, fileNamingStrategy: 'kebab', outputStructure: 'flat', reExport: 'false', prettier: 'false' }
            })
        );
        const created = fs.readFileSync(path.join(outDir, 'create-toggle.dto.ts'), 'utf8');
        expect(created).toContain("import { IsUnique } from 'src/common/validators'");
    });

    it('inline schema values still work when configFile is absent', () => {
        const gen = new CreateDtoGenerator(
            buildOptions({
                models: [{ name: 'Toggle', fields: [{ name: 'id', type: 'Int', isId: true }, { name: 'enabled', type: 'Boolean', isRequired: true }] }]
            })
        );
        return gen.generate().then(([file]) => {
            expect(file.content).toContain('@IsBoolean()');
        });
    });
});
