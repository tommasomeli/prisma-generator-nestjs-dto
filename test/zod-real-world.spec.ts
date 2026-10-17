import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { listTsFiles, typecheck } from './helpers/typecheck';

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_DIR = path.join(__dirname, 'fixtures/real-world/schema');
const OUTPUT = path.join(__dirname, '.output/real-world');

/** Runs the real Prisma 7 CLI against the fixture, using the TypeScript sources as the generator binary. */
function runPrismaGenerate(): void {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    execFileSync(process.execPath, [path.join(ROOT, 'node_modules/prisma/build/index.js'), 'generate', '--schema', SCHEMA_DIR], {
        cwd: ROOT,
        stdio: 'pipe',
        env: {
            ...process.env,
            CHECKPOINT_DISABLE: '1',
            PRISMA_HIDE_UPDATE_MESSAGE: '1',
            NESTJS_DTO_GENERATOR: `node --import jiti/register ${path.join(ROOT, 'src/bin.ts')}`
        }
    });
}

const read = (relative: string) => fs.readFileSync(path.join(OUTPUT, relative), 'utf8');
const prismaMajor = Number(JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/prisma/package.json'), 'utf8')).version.split('.')[0]);

describe.skipIf(prismaMajor < 7)('Zod mode: real-world schema (Prisma 7 CLI)', () => {
    let contracts: Record<string, any>;

    beforeAll(async () => {
        runPrismaGenerate();
        contracts = await import(path.join(OUTPUT, 'index.ts'));
    }, 120_000);

    it('emits the expected layout', () => {
        for (const file of ['user/user.schema.ts', 'user/create-user.schema.ts', 'user/update-user.schema.ts', 'user/index.ts', 'enums/user-role.enum.ts', 'enums/index.ts', 'scalars.ts', 'server-rules.ts', 'index.ts', 'manifest.ts', 'model-entity-map.ts']) {
            expect(fs.existsSync(path.join(OUTPUT, file)), file).toBe(true);
        }
        expect(fs.existsSync(path.join(OUTPUT, 'user/user.entity.ts'))).toBe(false);
        expect(fs.existsSync(path.join(OUTPUT, 'user/create-user.dto.ts'))).toBe(false);
    });

    it.each([
        'user/user.schema.ts',
        'user/create-user.schema.ts',
        'user/update-user.schema.ts',
        'media/media.schema.ts',
        'media/create-media.schema.ts',
        'media-path/media-path.schema.ts',
        'enums/user-role.enum.ts',
        'scalars.ts',
        'server-rules.ts',
        'manifest.ts',
        'index.ts'
    ])('matches the snapshot of %s', async (file) => {
        await expect(read(file)).toMatchFileSnapshot(`__snapshots__/real-world/${file}`);
    });

    it('only imports zod, generated files and configured fixture modules (framework-free)', () => {
        for (const file of listTsFiles(OUTPUT)) {
            const specifiers = [...fs.readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]);
            for (const specifier of specifiers) expect(specifier === 'zod' || specifier.startsWith('.'), `${path.relative(OUTPUT, file)} imports ${specifier}`).toBe(true);
            expect(fs.readFileSync(file, 'utf8')).not.toMatch(/@nestjs|class-validator|class-transformer|@prisma\/client|nestjs-i18n/);
        }
    });

    it('type-checks the generated package under strict mode (including cyclic getters)', () => {
        expect(typecheck(listTsFiles(OUTPUT))).toEqual([]);
    });

    it('CreateUserSchema applies defaults, translated validators and i18n keys', () => {
        const { CreateUserSchema } = contracts;
        const parsed = CreateUserSchema.parse({ email: 'jane@example.com', password: 'Secret1', avatar: 3, id: 99 });
        expect(parsed).toMatchObject({ email: 'jane@example.com', role: 'guest', provider: 'local', isActive: false, mfaEnabled: false, avatar: 3 });
        expect(parsed).not.toHaveProperty('id');
        const tooShort = CreateUserSchema.safeParse({ password: 'Ab1' });
        expect(tooShort.success).toBe(false);
        expect(tooShort.error.issues[0].message).toBe('validation.fields.password');
        expect(CreateUserSchema.safeParse({ password: 'alllowercase1' }).success).toBe(false);
        expect(CreateUserSchema.safeParse({ role: 'root' }).success).toBe(false);
        expect(CreateUserSchema.safeParse({ firstName: 'x'.repeat(256) }).success).toBe(false);
        expect(CreateUserSchema.safeParse({ language: { id: 2, label: 'kept for nested writes' } }).data.language).toEqual({ id: 2, label: 'kept for nested writes' });
    });

    it('UpdateUserSchema requires the id and never injects defaults', () => {
        const { UpdateUserSchema } = contracts;
        expect(UpdateUserSchema.safeParse({}).success).toBe(false);
        expect(UpdateUserSchema.parse({ id: 1 })).toEqual({ id: 1 });
        expect(UpdateUserSchema.parse({ id: 1, firstName: null })).toEqual({ id: 1, firstName: null });
    });

    it('UserSchema serializes Prisma rows (Date -> ISO string) and strips hidden fields', () => {
        const { UserSchema } = contracts;
        const createdAt = new Date('2026-01-02T03:04:05.000Z');
        const row = {
            id: 1,
            createdAt,
            mfaEnabled: false,
            mfaSecret: 'secret',
            avatarId: 7,
            avatar: { id: 7, name: 'a', filename: 'a.png', ext: 'png', children: [{ id: 8, name: 'b', filename: 'b.png', ext: 'png' }] }
        };
        const parsed = UserSchema.parse(row);
        expect(parsed.createdAt).toBe('2026-01-02T03:04:05.000Z');
        expect(parsed).not.toHaveProperty('mfaSecret');
        expect(parsed).not.toHaveProperty('avatarId');
        expect(parsed.avatar.children[0].name).toBe('b');
        expect(UserSchema.parse(JSON.parse(JSON.stringify(row))).createdAt).toBe('2026-01-02T03:04:05.000Z');
    });

    it('MediaSchema uses the configured MediaFormatsSchema for the @ignore-d formats field', () => {
        const { MediaSchema } = contracts;
        const base = { id: 1, name: 'a', filename: 'a.png', ext: 'png' };
        expect(MediaSchema.safeParse({ ...base, formats: { original: { url: '/a.png', size: 10 } } }).success).toBe(true);
        expect(MediaSchema.safeParse({ ...base, formats: { original: { url: 1 } } }).success).toBe(false);
        expect(MediaSchema.safeParse({ ...base, mimeType: 'image/png' }).success).toBe(true);
    });

    it('enum schemas expose values and reject unknown members', () => {
        expect(contracts.UserRole).toEqual({ admin: 'admin', manager: 'manager', guest: 'guest' });
        expect(contracts.UserRoleSchema.safeParse('guest').success).toBe(true);
        expect(contracts.UserRoleSchema.safeParse('root').success).toBe(false);
    });

    it('z.toJSONSchema works on every exported schema, in both io modes, including cyclic relations', () => {
        const schemas = Object.entries(contracts).filter(([, value]) => value instanceof z.ZodType);
        expect(schemas.length).toBeGreaterThan(40);
        for (const [name, schema] of schemas) {
            for (const io of ['input', 'output'] as const) {
                expect(() => z.toJSONSchema(schema as z.ZodType, { io }), `${name} (${io})`).not.toThrow();
            }
        }
        const media = z.toJSONSchema(contracts.MediaSchema) as any;
        expect(media.$ref).toBe('#/$defs/Media');
        expect(Object.keys(media.$defs).sort()).toEqual(['Media', 'MediaFormats', 'MediaPath']);
        const user = JSON.stringify(z.toJSONSchema(contracts.UserSchema));
        expect(user).not.toContain('__schema');
        expect(user).toContain('"format":"date-time"');
    });

    it('exports server-only validators as plain data', () => {
        expect(contracts.serverRules).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ model: 'User', field: 'email', rule: 'IsUnique', message: 'validation.fields.email_exists', schemas: ['create', 'update'] }),
                expect.objectContaining({ model: 'User', field: 'userName', rule: 'IsUnique' }),
                expect.objectContaining({ model: 'Option', field: 'key', rule: 'IsUnique', args: [] })
            ])
        );
        expect(contracts.serverRules).toHaveLength(3);
    });
});
