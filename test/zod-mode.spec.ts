import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generate } from '../src/generator';
import { CreateZodGenerator, EntityZodGenerator, UpdateZodGenerator, ZodSupportGenerator, parseZodAnnotations, resolveMessage, splitArguments } from '../src/generators';
import type { RawGeneratorConfig } from '../src/types';
import { buildOptions } from './helpers/build-options';
import { listTsFiles, typecheck } from './helpers/typecheck';

type Models = Parameters<typeof buildOptions>[0]['models'];

const zodOptions = (models: Models, config: RawGeneratorConfig = {}, enums: { name: string; values: string[] }[] = []) =>
    buildOptions({ models, enums, config: { outputType: 'zod', ...config } });

const render = async (Generator: typeof CreateZodGenerator | typeof EntityZodGenerator | typeof UpdateZodGenerator, models: Models, config: RawGeneratorConfig = {}, enums?: { name: string; values: string[] }[]) => {
    const [file] = await new Generator(zodOptions(models, config, enums)).generate();
    return file;
};

const USER: Models = [
    {
        name: 'User',
        fields: [
            { name: 'id', type: 'Int', isId: true, hasDefaultValue: true, default: { name: 'autoincrement', args: [] } },
            { name: 'email', type: 'String', documentation: "@IsEmail({}, { message: 'Invalid email' })", nativeType: ['VarChar', ['120']] },
            { name: 'nickname', type: 'String', isRequired: false, documentation: '@Length(2, 10)\n@Zod(.trim())' },
            { name: 'age', type: 'Int', isRequired: false, documentation: '@Min(0)\n@Max(130)' },
            { name: 'role', type: 'Role', kind: 'enum', hasDefaultValue: true, default: 'member' },
            { name: 'tags', type: 'String', isList: true, documentation: '@ArrayMaxSize(3)\n@MaxLength(5, { each: true })' },
            { name: 'secret', type: 'String', documentation: '@DtoHidden' },
            { name: 'note', type: 'String', isRequired: false, documentation: '@DtoEntityHidden' },
            { name: 'createdAt', type: 'DateTime', hasDefaultValue: true, default: { name: 'now', args: [] }, documentation: '@createdAt' },
            { name: 'updatedAt', type: 'DateTime', isUpdatedAt: true },
            { name: 'teamId', type: 'Int', isRequired: false },
            { name: 'team', type: 'Team', kind: 'object', isRequired: false, relationFromFields: ['teamId'] }
        ]
    },
    { name: 'Team', fields: [{ name: 'id', type: 'Int', isId: true }, { name: 'members', type: 'User', kind: 'object', isList: true }] }
];
const ROLE = [{ name: 'Role', values: ['admin', 'member'] }];

describe('Zod mode: annotation parsing helpers', () => {
    it('splits arguments respecting strings, regex literals and nesting', () => {
        expect(splitArguments("6, 20, { message: fn('a, b') }")).toEqual(['6', '20', "{ message: fn('a, b') }"]);
        expect(splitArguments('/a,b/i, { each: true }')).toEqual(['/a,b/i', '{ each: true }']);
        expect(splitArguments("['a', 'b'], 0")).toEqual(["['a', 'b']", '0']);
    });

    it('keeps raw bodies with nested parentheses and ignores @ inside arguments', () => {
        const parsed = parseZodAnnotations("@ZodOverride(z.string().regex(/^(a|b)$/).refine((v) => v !== '@x'))\n@DtoReadOnly");
        expect(parsed.map((a) => a.name)).toEqual(['ZodOverride', 'DtoReadOnly']);
        expect(parsed[0].body).toBe("z.string().regex(/^(a|b)$/).refine((v) => v !== '@x')");
    });

    it('resolves messages according to the strategy', () => {
        expect(resolveMessage("i18nValidationMessage('validation.fields.password')", 'key')).toBe("'validation.fields.password'");
        expect(resolveMessage("i18nValidationMessage('k')", 'expression')).toBe("i18nValidationMessage('k')");
        expect(resolveMessage("'literal'", 'key')).toBe("'literal'");
        expect(resolveMessage("'literal'", 'none')).toBeUndefined();
    });
});

describe('Zod mode: Create / Update / Entity schemas', () => {
    it('mirrors class-mode field selection in the Create schema', async () => {
        const { path: filePath, content } = await render(CreateZodGenerator, USER, {}, ROLE);
        expect(filePath).toBe('/tmp/generated/user/create-user.schema.ts');
        expect(content).toContain("import { z } from 'zod';");
        expect(content).toContain('export const CreateUserSchema = z.object({');
        expect(content).toContain('export type CreateUser = z.input<typeof CreateUserSchema>;');
        expect(content).toContain('export type CreateUserOutput = z.output<typeof CreateUserSchema>;');
        expect(content).not.toMatch(/^ {4}(id|secret|createdAt|updatedAt|teamId):/m);
        expect(content).toContain("email: z.email({ error: 'Invalid email' }).max(120),");
        expect(content).toContain('nickname: z.string().min(2).max(10).trim().nullish(),');
        expect(content).toContain('age: z.int().min(0).max(130).nullish(),');
        expect(content).toContain("role: RoleSchema.default('member'),");
        expect(content).toContain("import { RoleSchema } from '../enums/role.enum';");
        expect(content).toContain('tags: z.array(z.string().max(5)).max(3).nullish(),');
        expect(content).toContain('team: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).nullish()\n');
        expect(content).toContain("note: z.string().nullish()");
        expect(content).toContain(".meta({ id: 'CreateUser' });");
    });

    it('keeps the id required and drops defaults in the Update schema', async () => {
        const { content } = await render(UpdateZodGenerator, USER, {}, ROLE);
        expect(content).toContain('id: z.int(),');
        expect(content).toContain('role: RoleSchema.optional(),');
        expect(content).toContain("email: z.email({ error: 'Invalid email' }).max(120).optional(),");
        expect(content).not.toContain('.default(');
    });

    it('renders the Entity schema without validators, with annotated getters for relations', async () => {
        const { path: filePath, content } = await render(EntityZodGenerator, USER, {}, ROLE);
        expect(filePath).toBe('/tmp/generated/user/user.schema.ts');
        expect(content).toContain('email: z.string(),');
        expect(content).toContain('createdAt: DateTimeEntitySchema,');
        expect(content).toContain('teamId: z.int().nullish(),');
        expect(content).toContain('get team(): z.ZodOptional<z.ZodNullable<typeof TeamSchema>> {\n        return TeamSchema.nullish();\n    }');
        expect(content).toContain("import { TeamSchema } from '../team/team.schema';");
        expect(content).not.toMatch(/\b(secret|note):/);
        expect(content).toContain('export type User = z.infer<typeof UserSchema>;');
    });

    it('honours @DtoReadOnly, @DtoCreateOptional, @IsOptional, @IsIn and @Matches', async () => {
        const { content } = await render(CreateZodGenerator, [
            {
                name: 'Post',
                fields: [
                    { name: 'id', type: 'Int', isId: true },
                    { name: 'slug', type: 'String', documentation: "@DtoReadOnly\n@Matches(/^[a-z-]+$/, { message: 'slug' })" },
                    { name: 'title', type: 'String', documentation: '@DtoCreateOptional' },
                    { name: 'status', type: 'String', documentation: "@IsIn(['draft', 'live'])" },
                    { name: 'body', type: 'String', documentation: '@IsOptional()' }
                ]
            }
        ]);
        expect(content).toContain("slug: z.string().regex(/^[a-z-]+$/, { error: 'slug' }).min(1).readonly(),");
        expect(content).toContain('title: z.string().nullish(),');
        expect(content).toContain("status: z.literal(['draft', 'live']),");
        expect(content).toContain('body: z.string().min(1).nullish()');
    });

    it('supports the expression and none message strategies', async () => {
        const models: Models = [{ name: 'A', fields: [{ name: 'id', type: 'Int', isId: true }, { name: 'code', type: 'String', documentation: "@MinLength(3, { message: i18nValidationMessage('v.code') })" }] }];
        const expression = await render(CreateZodGenerator, models, { zodMessageStrategy: 'expression', extraImports: 'i18nValidationMessage:nestjs-i18n' });
        expect(expression.content).toContain("code: z.string().min(3, { error: i18nValidationMessage('v.code') })");
        expect(expression.content).toContain("import { i18nValidationMessage } from 'nestjs-i18n';");
        const none = await render(CreateZodGenerator, models, { zodMessageStrategy: 'none', extraImports: 'i18nValidationMessage:nestjs-i18n' });
        expect(none.content).toContain('code: z.string().min(3)\n');
        expect(none.content).not.toContain('nestjs-i18n');
    });

    it('resolves @DtoOverrideType and @ZodOverride, importing referenced identifiers via extraImports', async () => {
        const models: Models = [
            {
                name: 'Asset',
                fields: [
                    { name: 'id', type: 'Int', isId: true },
                    { name: 'formats', type: 'Json', isRequired: false, documentation: '@DtoOverrideType(MediaFormatsDto)' },
                    { name: 'label', type: 'Json', documentation: '@DtoOverrideType(string)' },
                    { name: 'owner', type: 'Json', isRequired: false, documentation: '@DtoOverrideType(Asset)' },
                    { name: 'slug', type: 'String', documentation: '@ZodOverride(z.string().regex(SLUG_REGEX))' }
                ]
            }
        ];
        const config = { extraImports: 'MediaFormatsSchema:@acme/shared|SLUG_REGEX,UNUSED:@acme/regex' };
        const entity = await render(EntityZodGenerator, models, config);
        expect(entity.content).toContain('formats: MediaFormatsSchema.nullish(),');
        expect(entity.content).toContain('label: z.string(),');
        expect(entity.content).toContain('get owner(): z.ZodOptional<z.ZodNullable<typeof AssetSchema>> {');
        expect(entity.content).toContain('slug: z.string().regex(SLUG_REGEX)\n');
        expect(entity.content).toContain("import { MediaFormatsSchema } from '@acme/shared';");
        expect(entity.content).toContain("import { SLUG_REGEX } from '@acme/regex';");
        expect(entity.content).not.toContain('UNUSED');
        const create = await render(CreateZodGenerator, models, config);
        expect(create.content).toContain('label: z.string().min(1),');
        expect(create.content).toContain('get owner() {\n        return AssetSchema.nullish();\n    }');
    });

    it('omits .meta ids when zodMeta is false', async () => {
        const { content } = await render(EntityZodGenerator, [{ name: 'A', fields: [{ name: 'id', type: 'Int', isId: true }] }], { zodMeta: 'false' });
        expect(content).toContain('export const ASchema = z.object({\n    id: z.int()\n});');
    });

    it('uses extraScalars zod expressions', async () => {
        const { content } = await render(CreateZodGenerator, [{ name: 'Price', fields: [{ name: 'id', type: 'Int', isId: true }, { name: 'amount', type: 'Decimal' }] }], {
            extraScalars: JSON.stringify({ Decimal: { zod: 'z.string().regex(/^\\d+(\\.\\d+)?$/)' } })
        });
        expect(content).toContain('amount: z.string().regex(/^\\d+(\\.\\d+)?$/)\n');
    });
});

describe('Zod mode: support files', () => {
    it('emits enums, scalar helpers and server rules', async () => {
        const files = await new ZodSupportGenerator(
            zodOptions(
                [
                    {
                        name: 'User',
                        fields: [
                            { name: 'id', type: 'Int', isId: true },
                            { name: 'email', type: 'String', documentation: "@IsUnique({ message: 'taken' })" },
                            { name: 'avatar', type: 'String', documentation: '@DtoUpdateValidateIf((o) => o.avatar !== undefined)\n@IsImage()' }
                        ]
                    }
                ],
                { extraValidators: 'IsUnique:src/validators' },
                ROLE
            )
        ).generate();
        expect(files.map((f) => f.path)).toEqual(['/tmp/generated/enums/role.enum.ts', '/tmp/generated/scalars.ts', '/tmp/generated/server-rules.ts']);
        expect(files[0].content).toContain("export const RoleSchema = z.enum(['admin', 'member']).meta({ id: 'Role' });");
        expect(files[0].content).toContain('export type Role = z.infer<typeof RoleSchema>;');
        const rules = files[2].content;
        expect(rules).toContain('"rule": "IsUnique"');
        expect(rules).toContain('"message": "taken"');
        expect(rules).toContain('"rule": "ValidateIf"');
        expect(rules).toContain('"rule": "IsImage"');
    });
});

describe('Zod mode: end-to-end generate()', () => {
    let outDir: string;
    let runId = 0;

    // A distinct directory per test: dynamically imported modules are cached by path.
    beforeEach(() => {
        outDir = path.join(__dirname, `.output/unit-${process.pid}-${runId++}`);
        fs.rmSync(outDir, { recursive: true, force: true });
    });
    afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));

    const run = (config: RawGeneratorConfig, models: Models = USER) =>
        generate(buildOptions({ output: outDir, models, enums: ROLE, config: { outputType: 'zod', fileNamingStrategy: 'kebab', reExport: 'true', ...config } }));

    it('replaces class DTOs, runs plugins and exports root files from the main barrel', async () => {
        await run({ outputStructure: 'nestjs', extraGenerators: `TsPluginGenerator:${path.resolve(__dirname, 'fixtures/ts-plugin-generator.ts')}`, emitManifest: 'true' });
        expect(fs.existsSync(path.join(outDir, 'user/user.entity.ts'))).toBe(false);
        expect(fs.existsSync(path.join(outDir, 'user/user.ts-plugin.ts'))).toBe(true);
        const mainIndex = fs.readFileSync(path.join(outDir, 'index.ts'), 'utf8');
        expect(mainIndex).toContain("export * from './scalars';");
        expect(mainIndex).toContain("export * from './server-rules';");
        expect(mainIndex).toContain("export * from './enums';");
        expect(mainIndex).not.toContain(`export * from './${path.basename(outDir)}'`);
        expect(fs.existsSync(path.join(outDir, 'scalars.ts/index.ts'))).toBe(false);
        const manifest = fs.readFileSync(path.join(outDir, 'manifest.ts'), 'utf8');
        expect(manifest).toContain("export type ModelName = 'User' | 'Team';");
        expect(manifest).not.toContain('@prisma/client');
        expect(fs.readFileSync(path.join(outDir, 'model-entity-map.ts'), 'utf8')).toContain("from './user/user.schema'");
        expect(fs.readFileSync(path.join(outDir, 'user/index.ts'), 'utf8')).toContain("export * from './user.ts-plugin';");
        expect(typecheck(listTsFiles(outDir))).toEqual([]);
    });

    it('supports the flat output structure', async () => {
        await run({ outputStructure: 'flat' });
        for (const file of ['user.schema.ts', 'create-user.schema.ts', 'update-user.schema.ts', 'role.enum.ts', 'scalars.ts', 'server-rules.ts', 'index.ts']) expect(fs.existsSync(path.join(outDir, file)), file).toBe(true);
        expect(fs.readFileSync(path.join(outDir, 'user.schema.ts'), 'utf8')).toContain("import { TeamSchema } from './team.schema';");
        expect(typecheck(listTsFiles(outDir))).toEqual([]);
    });

    it('decodes Date / bigint / Uint8Array with zodCodecs = "true"', async () => {
        const models: Models = [
            {
                name: 'Event',
                fields: [
                    { name: 'id', type: 'BigInt', isId: true },
                    { name: 'at', type: 'DateTime' },
                    { name: 'payload', type: 'Bytes', isRequired: false },
                    { name: 'startsAt', type: 'DateTime', hasDefaultValue: true, default: '2026-01-01T00:00:00.000Z' }
                ]
            }
        ];
        await run({ outputStructure: 'nestjs', zodCodecs: 'true' }, models);
        expect(typecheck(listTsFiles(outDir))).toEqual([]);
        const { CreateEventSchema, EventSchema } = await import(path.join(outDir, 'index.ts'));
        const parsed = CreateEventSchema.parse({ at: '2026-10-16T19:48:00.000Z', payload: 'aGk=' });
        expect(parsed.at).toBeInstanceOf(Date);
        expect(parsed.startsAt).toBeInstanceOf(Date);
        expect(Array.from(parsed.payload)).toEqual([104, 105]);
        const at = new Date('2026-10-16T19:48:00.000Z');
        const encoded = EventSchema.encode({ id: 10n, at, payload: null, startsAt: at });
        expect(encoded).toEqual({ id: '10', at: '2026-10-16T19:48:00.000Z', payload: null, startsAt: '2026-10-16T19:48:00.000Z' });
        expect(() => z.toJSONSchema(EventSchema, { io: 'input' })).not.toThrow();
    });

    it('keeps JSON wire types by default (BigInt as string, Bytes as base64)', async () => {
        const models: Models = [{ name: 'Blob', fields: [{ name: 'id', type: 'BigInt', isId: true }, { name: 'data', type: 'Bytes' }, { name: 'price', type: 'Decimal' }] }];
        await run({ outputStructure: 'nestjs' }, models);
        const { BlobSchema } = await import(path.join(outDir, 'index.ts'));
        expect(BlobSchema.parse({ id: 5n, data: new Uint8Array([104, 105]), price: { toNumber: () => 1.5 } })).toEqual({ id: '5', data: 'aGk=', price: 1.5 });
        for (const io of ['input', 'output'] as const) expect(() => z.toJSONSchema(BlobSchema, { io })).not.toThrow();
    });
});
