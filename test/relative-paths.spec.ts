import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyConfigFile, descriptorToImportStatement } from '../src/config-loader';
import { generate } from '../src/generator';
import { buildOptions } from './helpers/build-options';

describe('descriptorToImportStatement with configFileDir', () => {
    it('resolves relative ./ paths against the config file directory', () => {
        const stmt = descriptorToImportStatement({ from: './my-validators', names: ['IsBool'] }, '/abs/config-dir');
        expect(stmt).toBe('IsBool:/abs/config-dir/my-validators');
    });

    it('resolves relative ../ paths against the config file directory', () => {
        const stmt = descriptorToImportStatement({ from: '../shared/validators', names: ['IsBool'] }, '/abs/config-dir');
        expect(stmt).toBe('IsBool:/abs/shared/validators');
    });

    it('leaves bare specifiers untouched', () => {
        const stmt = descriptorToImportStatement({ from: 'class-validator', names: ['IsBool'] }, '/abs/config-dir');
        expect(stmt).toBe('IsBool:class-validator');
    });

    it('leaves TS path aliases untouched', () => {
        const stmt = descriptorToImportStatement({ from: 'src/common/validators', names: ['IsBool'] }, '/abs/config-dir');
        expect(stmt).toBe('IsBool:src/common/validators');
    });

    it('leaves absolute paths untouched', () => {
        const stmt = descriptorToImportStatement({ from: '/abs/already', names: ['IsBool'] }, '/abs/config-dir');
        expect(stmt).toBe('IsBool:/abs/already');
    });

    it('returns the original from when no configFileDir is provided', () => {
        const stmt = descriptorToImportStatement({ from: './my-validators', names: ['IsBool'] });
        expect(stmt).toBe('IsBool:./my-validators');
    });
});

describe('applyConfigFile rewrites relative paths inside raw inline strings', () => {
    it('rewrites a single inline string', () => {
        const merged = applyConfigFile({}, { extraValidators: 'IsBool:./my-validators' }, '/abs/config-dir');
        expect(merged.extraValidators).toBe('IsBool:/abs/config-dir/my-validators');
    });

    it('rewrites every relative entry in an array', () => {
        const merged = applyConfigFile({}, {
            extraImports: [
                '* as CONSTANTS:./constants',
                'Foo:nestjs-i18n',
                'Bar:../shared/lib'
            ]
        }, '/abs/config-dir');
        expect(merged.extraImports).toEqual([
            '* as CONSTANTS:/abs/config-dir/constants',
            'Foo:nestjs-i18n',
            'Bar:/abs/shared/lib'
        ]);
    });

    it('rewrites only the relative groups inside a pipe-joined string', () => {
        const merged = applyConfigFile({}, { extraImports: '* as CONSTANTS:./constants|Foo:nestjs-i18n|Bar:../shared/lib' }, '/abs/config-dir');
        expect(merged.extraImports).toBe('* as CONSTANTS:/abs/config-dir/constants|Foo:nestjs-i18n|Bar:/abs/shared/lib');
    });
});

describe('generated files use paths relative to the output file', () => {
    let workDir: string;

    beforeEach(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-rel-'));
    });

    afterEach(() => {
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    it('rewrites a relative configFile path to a relative import in the emitted DTO', async () => {
        const configDir = path.join(workDir, 'prisma');
        fs.mkdirSync(configDir, { recursive: true });
        const validatorsDir = path.join(workDir, 'validators');
        fs.mkdirSync(validatorsDir, { recursive: true });
        const cfg = {
            extraValidators: { from: '../validators/index', names: ['IsUnique'] }
        };
        const cfgPath = path.join(configDir, 'gen.config.json');
        fs.writeFileSync(cfgPath, JSON.stringify(cfg));

        const outDir = path.join(workDir, 'generated');
        await generate(buildOptions({
            output: outDir,
            models: [{
                name: 'Toggle',
                fields: [
                    { name: 'id', type: 'Int', isId: true },
                    { name: 'enabled', type: 'Boolean', isRequired: true, documentation: '@IsUnique' }
                ]
            }],
            config: { configFile: cfgPath, fileNamingStrategy: 'kebab', outputStructure: 'nestjs', reExport: 'false', prettier: 'false' }
        }));

        const dto = fs.readFileSync(path.join(outDir, 'toggle', 'create-toggle.dto.ts'), 'utf8');
        expect(dto).toContain("from '../../validators/index'");
        expect(dto).not.toContain("/abs/");
        expect(dto).not.toContain(workDir);
    });

    it('leaves TS path aliases (src/...) untouched in the emitted DTO', async () => {
        const cfgPath = path.join(workDir, 'gen.config.json');
        fs.writeFileSync(cfgPath, JSON.stringify({
            extraValidators: { from: 'src/common/validators', names: ['IsUnique'] }
        }));
        const outDir = path.join(workDir, 'out');
        await generate(buildOptions({
            output: outDir,
            models: [{
                name: 'Toggle',
                fields: [
                    { name: 'id', type: 'Int', isId: true },
                    { name: 'enabled', type: 'Boolean', isRequired: true, documentation: '@IsUnique' }
                ]
            }],
            config: { configFile: cfgPath, fileNamingStrategy: 'kebab', outputStructure: 'flat', reExport: 'false', prettier: 'false' }
        }));
        const dto = fs.readFileSync(path.join(outDir, 'create-toggle.dto.ts'), 'utf8');
        expect(dto).toContain("from 'src/common/validators'");
    });
});
