import { describe, expect, it } from 'vitest';
import { BaseGenerator } from '../src/base-generator';
import type { File, ImportType, Model } from '../src/types';
import { buildOptions } from './helpers/build-options';

/**
 * Test-only subclass that exposes the protected helpers as public so we can
 * exercise them without going through a real `generate()` cycle. Production
 * plugins consume them as `protected` members on subclasses of `BaseGenerator`.
 */
class HelperExposingGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.gql';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        return [];
    }

    publicAddImport(imports: ImportType[], next: ImportType): void {
        this.addImport(imports, next);
    }

    publicFormatImports(imports: ImportType[], outputPath?: string): string {
        return this.formatImports(imports, outputPath);
    }

    publicGetImportPath(model: Model, fromOutputPath?: string): string {
        return this.getImportPath(model, fromOutputPath);
    }
}

const newGen = () =>
    new HelperExposingGenerator(
        buildOptions({
            models: [
                {
                    name: 'User',
                    fields: [
                        { name: 'id', type: 'Int', isId: true, isRequired: true },
                        { name: 'name', type: 'String', isRequired: true }
                    ]
                },
                {
                    name: 'Post',
                    fields: [
                        { name: 'id', type: 'Int', isId: true, isRequired: true },
                        { name: 'title', type: 'String', isRequired: true }
                    ]
                }
            ],
            output: '/tmp/generated',
            config: { outputStructure: 'nestjs', fileNamingStrategy: 'kebab' }
        })
    );

describe('BaseGenerator#addImport', () => {
    it('merges named imports targeting the same path', () => {
        const gen = newGen();
        const imports: ImportType[] = [];
        gen.publicAddImport(imports, { from: '@nestjs/graphql', destruct: ['Field'] });
        gen.publicAddImport(imports, { from: '@nestjs/graphql', destruct: ['ObjectType'] });
        gen.publicAddImport(imports, { from: '@nestjs/graphql', destruct: ['Field'] });
        expect(imports).toHaveLength(1);
        expect(imports[0]).toEqual({ from: '@nestjs/graphql', destruct: ['Field', 'ObjectType'] });
    });

    it('keeps alias entries separate from destruct entries on the same path', () => {
        const gen = newGen();
        const imports: ImportType[] = [];
        gen.publicAddImport(imports, { from: 'src/lib', destruct: ['helper'] });
        gen.publicAddImport(imports, { from: 'src/lib', alias: 'default as Lib' });
        expect(imports).toHaveLength(2);
        expect(imports).toEqual(expect.arrayContaining([
            { from: 'src/lib', destruct: ['helper'] },
            { from: 'src/lib', alias: 'default as Lib' }
        ]));
    });
});

describe('BaseGenerator#formatImports', () => {
    it('renders named and alias imports', () => {
        const gen = newGen();
        const block = gen.publicFormatImports([
            { from: '@nestjs/graphql', destruct: ['Field', 'ObjectType'] },
            { from: 'lodash', alias: 'default as Lodash' }
        ]);
        expect(block).toBe([
            "import { Field, ObjectType } from '@nestjs/graphql';",
            "import default as Lodash from 'lodash';"
        ].join('\n'));
    });

    it('rewrites absolute paths as POSIX-style relative to outputPath', () => {
        const gen = newGen();
        const block = gen.publicFormatImports(
            [{ from: '/abs/project/src/post/post.gql', destruct: ['Post'] }],
            '/abs/project/src/user/user.gql.ts'
        );
        expect(block).toBe("import { Post } from '../post/post.gql';");
    });

    it('leaves bare specifiers and TS path aliases untouched', () => {
        const gen = newGen();
        const block = gen.publicFormatImports(
            [
                { from: '@prisma/client', destruct: ['Prisma'] },
                { from: 'src/common/constants', alias: '* as CONSTANTS' }
            ],
            '/abs/output/user.ts'
        );
        expect(block).toBe([
            "import { Prisma } from '@prisma/client';",
            "import * as CONSTANTS from 'src/common/constants';"
        ].join('\n'));
    });

    it('strips `.ts` / `.mts` / `.cts` / `.tsx` extensions from the import specifier', () => {
        const gen = newGen();
        const block = gen.publicFormatImports([
            { from: '../post/post.gql.ts', destruct: ['Post'] },
            { from: '../media/media.entity.mts', destruct: ['Media'] },
            { from: '../shared/lib.cts', destruct: ['Lib'] },
            { from: '../widget/Widget.tsx', destruct: ['Widget'] }
        ]);
        expect(block).toBe([
            "import { Post } from '../post/post.gql';",
            "import { Media } from '../media/media.entity';",
            "import { Lib } from '../shared/lib';",
            "import { Widget } from '../widget/Widget';"
        ].join('\n'));
    });
});

describe('BaseGenerator#getImportPath', () => {
    it('returns the relative path with the TS extension stripped', () => {
        const gen = newGen();
        const models = (gen as unknown as { models: Model[] }).models;
        const post = models.find((m) => m.name === 'Post')!;
        const user = models.find((m) => m.name === 'User')!;
        const userPath = (gen as unknown as { getPath(m: Model): string }).getPath(user);
        // HelperExposingGenerator has `fileSuffix = '.gql'`, so the bare file is `post.gql.ts`.
        expect(gen.publicGetImportPath(post, userPath)).toBe('../post/post.gql');
    });

    it('adds a `./` prefix when the result would otherwise be a bare specifier (flat layout)', () => {
        const gen = new HelperExposingGenerator(
            buildOptions({
                models: [
                    { name: 'User', fields: [{ name: 'id', type: 'Int', isId: true }] },
                    { name: 'Post', fields: [{ name: 'id', type: 'Int', isId: true }] }
                ],
                output: '/tmp/generated',
                config: { outputStructure: 'flat', fileNamingStrategy: 'kebab' }
            })
        );
        const post = (gen as unknown as { models: Model[] }).models.find((m) => m.name === 'Post')!;
        expect(gen.publicGetImportPath(post, '/tmp/generated/user.ts')).toBe('./post.gql');
    });
});
