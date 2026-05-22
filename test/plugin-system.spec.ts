import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generate } from '../src/generator';
import { buildOptions } from './helpers/build-options';

describe('Plugin system (extraGenerators)', () => {
    let outDir: string;

    beforeEach(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-test-'));
    });

    afterEach(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    it('loads and runs a custom generator referenced via absolute path', async () => {
        const fixture = path.resolve(__dirname, 'fixtures/custom-generator.cjs');
        const options = buildOptions({
            output: outDir,
            models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
            config: {
                fileNamingStrategy: 'kebab',
                outputStructure: 'flat',
                reExport: 'false',
                prettier: 'false',
                extraGenerators: `MyTestGenerator:${fixture}`
            }
        });
        await generate(options);
        const customFile = path.join(outDir, 'widget.custom.ts');
        expect(fs.existsSync(customFile)).toBe(true);
        expect(fs.readFileSync(customFile, 'utf8')).toContain("export const CustomWidget = 'Widget'");
    });

    it('loads a TypeScript plugin file directly via jiti', async () => {
        const fixture = path.resolve(__dirname, 'fixtures/ts-plugin-generator.ts');
        const options = buildOptions({
            output: outDir,
            models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }] }],
            config: {
                fileNamingStrategy: 'kebab',
                outputStructure: 'flat',
                reExport: 'false',
                prettier: 'false',
                extraGenerators: `TsPluginGenerator:${fixture}`
            }
        });
        await generate(options);
        const tsPluginFile = path.join(outDir, 'widget.ts-plugin.ts');
        expect(fs.existsSync(tsPluginFile)).toBe(true);
        expect(fs.readFileSync(tsPluginFile, 'utf8')).toContain("TsPlugin_Widget = 'Widget'");
    });

    it('emits built-in generators alongside custom ones', async () => {
        const fixture = path.resolve(__dirname, 'fixtures/custom-generator.cjs');
        const options = buildOptions({
            output: outDir,
            models: [{ name: 'Widget', fields: [{ name: 'id', type: 'Int', isId: true }, { name: 'label', type: 'String', isRequired: true }] }],
            config: {
                fileNamingStrategy: 'kebab',
                outputStructure: 'flat',
                reExport: 'false',
                prettier: 'false',
                extraGenerators: `MyTestGenerator:${fixture}`
            }
        });
        await generate(options);
        expect(fs.existsSync(path.join(outDir, 'widget.entity.ts'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'create-widget.dto.ts'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'update-widget.dto.ts'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'widget.custom.ts'))).toBe(true);
    });
});
