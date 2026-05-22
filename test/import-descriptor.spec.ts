import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyConfigFile, defaultFrom, descriptorToImportStatement, from, fromDefault, fromModule, fromNamespace, namespaceFrom } from '../src/config-loader';
import { generate } from '../src/generator';
import { Utility } from '../src/utility';
import { buildOptions } from './helpers/build-options';

describe('descriptorToImportStatement', () => {
    it('renders named imports as Name:path', () => {
        expect(descriptorToImportStatement({ from: 'pkg', names: ['Foo', 'Bar'] })).toBe('Foo,Bar:pkg');
    });

    it('renders default imports as default as X:path', () => {
        expect(descriptorToImportStatement({ from: 'pkg', default: 'Foo' })).toBe('default as Foo:pkg');
    });

    it('renders namespace imports as * as X:path', () => {
        expect(descriptorToImportStatement({ from: 'pkg', namespace: 'Foo' })).toBe('* as Foo:pkg');
    });

    it('combines default + named into two pipe-joined groups', () => {
        expect(descriptorToImportStatement({ from: 'pkg', default: 'Foo', names: ['Bar', 'Baz'] })).toBe('default as Foo:pkg|Bar,Baz:pkg');
    });

    it('collapses rename aliases to the local name', () => {
        expect(descriptorToImportStatement({ from: 'pkg', names: [{ name: 'Foo', as: 'Bar' }] })).toBe('Bar:pkg');
    });

    it('returns an empty string when no clauses are provided', () => {
        expect(descriptorToImportStatement({ from: 'pkg' })).toBe('');
    });
});

describe('fromModule / namespaceFrom / defaultFrom helpers', () => {
    it('fromModule reads object keys regardless of values', () => {
        const fakeIsBool = () => undefined;
        const fakeIsImage = () => undefined;
        expect(fromModule('src/validators', { IsBool: fakeIsBool, IsImage: fakeIsImage })).toEqual({
            from: 'src/validators',
            names: ['IsBool', 'IsImage']
        });
    });

    it('namespaceFrom builds a namespace descriptor', () => {
        expect(namespaceFrom('src/constants', 'CONSTANTS')).toEqual({ from: 'src/constants', namespace: 'CONSTANTS' });
    });

    it('defaultFrom builds a default-only descriptor', () => {
        expect(defaultFrom('src/lib', 'Foo')).toEqual({ from: 'src/lib', default: 'Foo', names: undefined });
    });

    it('defaultFrom combines default + named', () => {
        expect(defaultFrom('src/lib', 'Foo', { Bar: 1, Baz: 1 })).toEqual({ from: 'src/lib', default: 'Foo', names: ['Bar', 'Baz'] });
    });
});

describe('from() — string form', () => {
    it('accepts a single name as a string', () => {
        expect(from('class-validator', 'IsEmail')).toEqual({ from: 'class-validator', names: ['IsEmail'] });
    });

    it('accepts multiple names as an array', () => {
        expect(from('src/lib', ['Foo', 'Bar', 'Baz'])).toEqual({ from: 'src/lib', names: ['Foo', 'Bar', 'Baz'] });
    });
});

describe('from() — dynamic-import closure form', () => {
    const withStringifiedSource = <T extends Function>(fn: T, source: string): T => {
        Object.defineProperty(fn, 'toString', { value: () => source });
        return fn;
    };

    it('extracts the module path from a raw import() closure', () => {
        const closure = withStringifiedSource(() => Promise.resolve({} as any), "() => import('src/lib')");
        expect(from(closure as any, 'Foo')).toEqual({ from: 'src/lib', names: ['Foo'] });
    });

    it('extracts the module path from a jiti-transformed closure', () => {
        const closure = withStringifiedSource(
            () => Promise.resolve({} as any),
            "() => Promise.resolve().then(() => jitiImport('src/common/validators').then((m) => _interopRequireWildcard(m)))"
        );
        expect(from(closure as any, ['IsBool', 'IsUnique'])).toEqual({ from: 'src/common/validators', names: ['IsBool', 'IsUnique'] });
    });

    it('extracts the module path from a CJS-transpiled require() closure', () => {
        const closure = withStringifiedSource(() => undefined, "function () { return require('node:path'); }");
        expect(from(closure as any, 'join')).toEqual({ from: 'node:path', names: ['join'] });
    });

    it('falls back to the first quoted string when no known wrapper is detected', () => {
        const closure = withStringifiedSource(() => undefined, "function () { return loadModule('weird/path'); }");
        expect(from(closure as any, 'Foo')).toEqual({ from: 'weird/path', names: ['Foo'] });
    });

    it('throws a descriptive error when no module path can be extracted', () => {
        const closure = withStringifiedSource(() => undefined, 'function () { return 42; }');
        expect(() => from(closure as any, 'X')).toThrow(/Could not extract module path/);
    });

    it('rejects typos at the type level (compile-only assertion)', () => {
        type FakeMod = { Foo: unknown; Bar: unknown };
        const fakeImporter = () => Promise.resolve({ Foo: 1, Bar: 2 } as FakeMod);
        if (false as boolean) {
            // @ts-expect-error - 'Typo' is not a key of FakeMod
            from(fakeImporter, 'Typo');
            // @ts-expect-error - array form rejects typos too
            from(fakeImporter, ['Foo', 'Typo']);
        }
        expect(true).toBe(true);
    });
});

describe('fromNamespace() overloads', () => {
    it('accepts a plain string source', () => {
        expect(fromNamespace('src/common/constants', 'CONSTANTS')).toEqual({ from: 'src/common/constants', namespace: 'CONSTANTS' });
    });

    it('accepts a dynamic-import closure source', () => {
        const closure = () => Promise.resolve({});
        Object.defineProperty(closure, 'toString', { value: () => "() => import('src/common/constants')" });
        expect(fromNamespace(closure as any, 'CONSTANTS')).toEqual({ from: 'src/common/constants', namespace: 'CONSTANTS' });
    });
});

describe('fromDefault() overloads', () => {
    it('accepts a plain string source — default only', () => {
        expect(fromDefault('lodash', 'Lodash')).toEqual({ from: 'lodash', default: 'Lodash', names: undefined });
    });

    it('accepts a plain string source — default + named array', () => {
        expect(fromDefault('src/lib', 'Lib', ['helperA', 'helperB'])).toEqual({
            from: 'src/lib',
            default: 'Lib',
            names: ['helperA', 'helperB']
        });
    });

    it('accepts a plain string source — default + single named', () => {
        expect(fromDefault('src/lib', 'Lib', 'helperA')).toEqual({ from: 'src/lib', default: 'Lib', names: ['helperA'] });
    });

    it('accepts a dynamic-import closure source', () => {
        const closure = () => Promise.resolve({ default: 0, helperA: 1 } as any);
        Object.defineProperty(closure, 'toString', { value: () => "() => import('src/lib')" });
        expect(fromDefault(closure as any, 'Lib', ['helperA'])).toEqual({ from: 'src/lib', default: 'Lib', names: ['helperA'] });
    });
});

describe('applyConfigFile with ImportDescriptor', () => {
    it('serializes a single descriptor into an inline string', () => {
        const merged = applyConfigFile({}, { extraValidators: { from: 'src/validators', names: ['IsBool'] } });
        expect(merged.extraValidators).toBe('IsBool:src/validators');
    });

    it('serializes an array of descriptors', () => {
        const merged = applyConfigFile({}, {
            extraImports: [
                { from: 'src/constants', namespace: 'CONSTANTS' },
                { from: 'nestjs-i18n', names: ['i18nValidationMessage'] }
            ]
        });
        expect(merged.extraImports).toEqual([
            '* as CONSTANTS:src/constants',
            'i18nValidationMessage:nestjs-i18n'
        ]);
    });

    it('supports arrays mixing inline strings and descriptors', () => {
        const merged = applyConfigFile({}, {
            extraDecorators: [
                'Existing:pkg/a',
                { from: 'pkg/b', names: ['Generated'] }
            ]
        });
        expect(merged.extraDecorators).toEqual([
            'Existing:pkg/a',
            'Generated:pkg/b'
        ]);
    });

    it('non-extra fields keep their existing coercion behaviour', () => {
        const merged = applyConfigFile({}, { emitManifest: true, prettier: false });
        expect(merged.emitManifest).toBe('true');
        expect(merged.prettier).toBe('false');
    });
});

describe('Utility.parseImports consumes descriptor-derived strings', () => {
    it('parses the canonical inline strings produced by descriptors', () => {
        const stmt = descriptorToImportStatement({ from: 'src/validators', names: ['IsBool', { name: 'IsUnique', as: 'Unique' }] });
        const parsed = Utility.parseImports(stmt);
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toMatchObject({ from: 'src/validators' });
        const destruct = (parsed[0] as { destruct?: string[] }).destruct ?? [];
        expect(destruct).toContain('IsBool');
        expect(destruct).toContain('Unique');
    });
});

describe('descriptor end-to-end', () => {
    let outDir: string;

    beforeEach(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgnd-desc-'));
    });

    afterEach(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
    });

    it('descriptors in the schema config produce the same output as inline strings', async () => {
        const baseModels = [{ name: 'Toggle', fields: [{ name: 'id', type: 'Int', isId: true }, { name: 'enabled', type: 'Boolean', isRequired: true }] }];
        const inlineOut = path.join(outDir, 'inline');
        const descriptorOut = path.join(outDir, 'descriptor');
        fs.mkdirSync(inlineOut, { recursive: true });
        fs.mkdirSync(descriptorOut, { recursive: true });

        await generate(buildOptions({
            output: inlineOut,
            models: baseModels,
            config: {
                extraValidators: 'IsUnique:src/common/validators',
                outputStructure: 'flat',
                fileNamingStrategy: 'kebab',
                reExport: 'false',
                prettier: 'false'
            }
        }));

        const cfgPath = path.join(outDir, 'cfg.json');
        fs.writeFileSync(cfgPath, JSON.stringify({
            extraValidators: { from: 'src/common/validators', names: ['IsUnique'] }
        }));
        await generate(buildOptions({
            output: descriptorOut,
            models: baseModels,
            config: {
                configFile: cfgPath,
                outputStructure: 'flat',
                fileNamingStrategy: 'kebab',
                reExport: 'false',
                prettier: 'false'
            }
        }));

        expect(fs.readFileSync(path.join(descriptorOut, 'create-toggle.dto.ts'), 'utf8')).toBe(fs.readFileSync(path.join(inlineOut, 'create-toggle.dto.ts'), 'utf8'));
    });
});
