import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate } from '../src/generator';
import CreateDtoGenerator from '../src/generators/create-dto-generator';
import EntityGenerator from '../src/generators/entity-generator';
import EnumGenerator from '../src/generators/enum-generator';
import { contractToDatamodel } from '../src/prisma8/contract-to-dmmf';
import { withPrisma8ScalarDefaults } from '../src/prisma8/options-shim';
import type { Prisma8Contract } from '../src/prisma8/types';
import type { RawGeneratorConfig } from '../src/types';
import blogJson from './fixtures/prisma8/blog/contract.json';
import kitchenSinkJson from './fixtures/prisma8/kitchen-sink/contract.json';
import nativeEnumsJson from './fixtures/prisma8/native-enums/contract.json';
import { buildOptions } from './helpers/build-options';
import { listTsFiles, typecheck } from './helpers/typecheck';

// Output lives inside the repository so that `@prisma/orm-framework/utils/json` (a devDependency) resolves.
const OUTPUT_ROOT = path.join(__dirname, '.output/prisma8-output');
const DECORATOR_STUBS = path.join(__dirname, 'helpers/decorator-stubs.d.ts');

const blog = () => contractToDatamodel(blogJson as unknown as Prisma8Contract, { annotations: new Map(), warn: () => {} });
const kitchenSink = () => contractToDatamodel(kitchenSinkJson as unknown as Prisma8Contract, { annotations: new Map(), warn: () => {} });
const nativeEnums = () => contractToDatamodel(nativeEnumsJson as unknown as Prisma8Contract, { annotations: new Map(), warn: () => {} });

/** Runs the whole pipeline in Prisma 8 mode (D3 defaults injected as the CLI does) and returns the emitted files. */
async function run(name: string, datamodel: ReturnType<typeof blog>, config: RawGeneratorConfig = {}): Promise<{ dir: string; read: (file: string) => string; files: string[] }> {
    const dir = path.join(OUTPUT_ROOT, name);
    fs.rmSync(dir, { recursive: true, force: true });
    await generate(buildOptions({ output: dir, datamodel, config: withPrisma8ScalarDefaults({ prisma8: 'true', ...config }) }));
    return { dir, read: (file) => fs.readFileSync(path.join(dir, file), 'utf8'), files: listTsFiles(dir).map((f) => path.relative(dir, f)).sort() };
}

describe('Prisma 8 output: blog contract (class mode)', () => {
    it('emits local enum files and never imports @prisma/client', async () => {
        const { read, files, dir } = await run('blog', blog());
        expect(files).toContain('enums/role.enum.ts');
        expect(files).toContain('enums/index.ts');
        expect(read('enums/role.enum.ts')).toBe("export enum Role {\n    ADMIN = 'ADMIN',\n    USER = 'USER'\n}\n");
        expect(read('index.ts').split('\n')[0]).toBe("export * from './enums';");
        for (const file of files) expect(read(file), file).not.toContain('@prisma/client');
        expect(typecheck([...listTsFiles(dir), DECORATOR_STUBS])).toEqual([]);
    });

    it('routes enum imports to the enums barrel and renders enum defaults as members', async () => {
        const { read } = await run('blog', blog());
        const createUser = read('user/create-user.dto.ts');
        expect(createUser).toContain("import { Role } from '../enums';");
        expect(createUser).toContain("@ApiProperty({ enum: Role, enumName: 'Role', required: true, default: 'USER' })");
        expect(createUser).toContain('role?: Role = Role.USER;');
    });

    it('types Decimal as string (format decimal) and imports JsonValue with `import type`', async () => {
        const { read } = await run('blog', blog());
        const post = read('post/post.entity.ts');
        expect(post).toContain("import type { JsonValue } from '@prisma/orm-framework/utils/json';");
        expect(post).toContain("@ApiProperty({ type: 'string', required: true, format: 'decimal' })\n\t score!: string;");
        expect(post).not.toContain('Decimal.js');
        expect(post).toContain('meta?: JsonValue | null;');
    });

    it('imports the enum file directly without reExport, and from a sibling file with the flat structure', async () => {
        const nested = await run('blog-no-reexport', blog(), { reExport: 'false' });
        expect(nested.read('user/user.entity.ts')).toContain("import { Role } from '../enums/role.enum';");
        const flat = await run('blog-flat', blog(), { reExport: 'false', outputStructure: 'flat' });
        expect(flat.files).toContain('role.enum.ts');
        expect(flat.read('user.entity.ts')).toContain("import { Role } from './role.enum';");
    });

    it('a user extraScalars entry with `from` still wins over the D3 defaults', async () => {
        const { read } = await run('blog-user-decimal', blog(), { extraScalars: JSON.stringify({ Decimal: { ts: 'Big', from: 'big.js' } }) });
        const post = read('post/post.entity.ts');
        expect(post).toContain("import { Big } from 'big.js';");
        expect(post).toContain('score!: Big;');
        expect(post).toContain("import type { JsonValue } from '@prisma/orm-framework/utils/json';");
    });
});

describe('Prisma 8 output: kitchen-sink contract (class mode)', () => {
    it('renders numeric enums with explicit values', async () => {
        const { read } = await run('kitchen-sink', kitchenSink());
        expect(read('enums/priority.enum.ts')).toBe('export enum Priority {\n    Low = 0,\n    Medium = 1,\n    High = 2\n}\n');
        expect(read('account/create-account.dto.ts')).toContain('priority?: Priority = Priority.Medium;');
    });

    it('emits value objects as their own entity + Create/Update DTOs, referenced by variant from the parent (D4)', async () => {
        const { read, files } = await run('kitchen-sink', kitchenSink());
        for (const file of ['address/address.entity.ts', 'address/create-address.dto.ts', 'address/update-address.dto.ts', 'address/index.ts']) expect(files).toContain(file);
        const address = read('address/address.entity.ts');
        expect(address).toContain('export class Address {');
        expect(address).toContain('zip?: string | null;');
        expect(read('address/create-address.dto.ts')).toContain('@IsString()\n\t street!: string;');
        expect(read('address/update-address.dto.ts')).toContain('street?: string;');
        for (const [dto, cls] of [['account/create-account.dto.ts', 'CreateAddressDto'], ['account/update-account.dto.ts', 'UpdateAddressDto']]) {
            const source = read(dto);
            expect(source, dto).toContain(`import { ${cls} } from '../address';`);
            expect(source, dto).toContain(`@ApiProperty({ type: () => ${cls}, required: false, nullable: true })`);
            expect(source, dto).toContain(`@ValidateNested()\n\t@Type(() => ${cls})\n\t address?: ${cls} | null;`);
            // Relations keep referencing the entity class.
            expect(source, dto).toContain('profile?: Profile | null;');
        }
        expect(read('account/account.entity.ts')).toContain('address?: Address | null;'); 
        expect(read('index.ts')).toContain("export * from './address';");
    });

    it('renders BigInt / Decimal literal defaults that type-check, and types unmapped codecs as unknown (entity only)', async () => {
        const { read } = await run('kitchen-sink', kitchenSink());
        const create = read('account/create-account.dto.ts');
        expect(create).toContain('views?: bigint = BigInt(0);');
        expect(create).toContain("balance?: string = '0.00';");
        expect(create).not.toContain('embedding');
        expect(read('account/update-account.dto.ts')).not.toContain('embedding');
        expect(read('account/account.entity.ts')).toContain('@ApiProperty({ type: () => Object, required: false, nullable: true })\n\t embedding?: unknown | null;');
    });

    it('imports IsOptional for required list relations (Create DTO of a model whose only optional field is a list)', async () => {
        const { read } = await run('kitchen-sink', kitchenSink());
        expect(read('team/create-team.dto.ts')).toMatch(/import \{[^}]*IsOptional[^}]*\} from 'class-validator';/);
    });

    it('type-checks the whole package (class and interface output)', async () => {
        for (const outputType of ['class', 'interface']) {
            const { dir, files } = await run(`kitchen-sink-${outputType}`, kitchenSink(), { outputType, emitManifest: 'true' });
            for (const file of files) expect(fs.readFileSync(path.join(dir, file), 'utf8'), file).not.toContain('@prisma/client');
            expect(typecheck([...listTsFiles(dir), DECORATOR_STUBS]), outputType).toEqual([]);
        }
    });

    it('type-checks the Zod output, with numeric enums as z.enum({ ... }) and value objects embedded', async () => {
        const { dir, read } = await run('kitchen-sink-zod', kitchenSink(), { outputType: 'zod', emitManifest: 'true' });
        expect(read('enums/priority.enum.ts')).toContain("z.enum({ Low: 0, Medium: 1, High: 2 }).meta({ id: 'Priority' })");
        expect(read('account/create-account.schema.ts')).toContain('priority: PrioritySchema.default(1)');
        const create = read('account/create-account.schema.ts');
        expect(create).toContain("import { CreateAddressSchema } from '../address/create-address.schema';");
        expect(create).toContain("balance: z.string().default('0.00')");
        expect(read('account/update-account.schema.ts')).toContain("import { UpdateAddressSchema } from '../address/update-address.schema';");
        expect(read('account/account.schema.ts')).toContain("import { AddressSchema } from '../address/address.schema';");
        expect(typecheck(listTsFiles(dir))).toEqual([]);
    });
});

describe('Prisma 8 output: native-enums contract (storage valueSet enums, string temporal codecs)', () => {
    it('class mode: emits and imports the native enums, types string temporals as Date, and type-checks', async () => {
        const { read, files, dir } = await run('native-enums', nativeEnums());
        expect(files).toEqual(expect.arrayContaining(['enums/member-role.enum.ts', 'enums/ticket-status.enum.ts', 'enums/index.ts']));
        expect(read('enums/ticket-status.enum.ts')).toBe("export enum TicketStatus {\n    open = 'open',\n    in_progress = 'in_progress',\n    closed = 'closed'\n}\n");
        const member = read('member/member.entity.ts');
        expect(member).toContain("import { MemberRole } from '../enums';");
        expect(member).toContain("@ApiProperty({ enum: MemberRole, enumName: 'MemberRole', isArray: true");
        expect(member).toContain('pastRoles?: MemberRole[]');
        expect(member).toContain('role?: MemberRole = MemberRole.member;');
        expect(member).toContain('lastSeenAt?: Date | null;');
        expect(read('ticket/ticket.entity.ts')).toContain('status?: TicketStatus | null;');
        expect(read('member/create-member.dto.ts')).toContain('role?: MemberRole = MemberRole.member;');
        for (const file of files) expect(read(file), file).not.toMatch(/Unsupported|unknown|@prisma\/client/);
        expect(typecheck([...listTsFiles(dir), DECORATOR_STUBS])).toEqual([]);
    });

    it('Zod mode: emits enum schemas, references them and the DateTime schema, and type-checks', async () => {
        const { read, files, dir } = await run('native-enums-zod', nativeEnums(), { outputType: 'zod' });
        expect(files).toEqual(expect.arrayContaining(['enums/member-role.enum.ts', 'enums/ticket-status.enum.ts']));
        expect(read('enums/member-role.enum.ts')).toContain("z.enum(['owner', 'admin', 'member'])");
        const member = read('member/member.schema.ts');
        expect(member).toContain('MemberRoleSchema');
        expect(member).toContain('DateTimeEntitySchema');
        expect(read('ticket/ticket.schema.ts')).toContain('TicketStatusSchema');
        for (const file of files) expect(read(file), file).not.toMatch(/Unsupported|z\.unknown\(\)/);
        expect(typecheck(listTsFiles(dir))).toEqual([]);
    });
});

describe('Prisma 5–7 path is unchanged (no prisma8 flag)', () => {
    it('keeps @prisma/client enum imports and emits no enum files or value objects', async () => {
        const options = buildOptions({ datamodel: kitchenSink() });
        expect(await new EnumGenerator(options).generate()).toEqual([]);
        const entities = await new EntityGenerator(options).generate();
        expect(entities.map((f) => path.basename(f.path))).not.toContain('address.entity.ts');
        const account = entities.find((f) => f.path.endsWith('account.entity.ts'))!.content;
        expect(account).toContain("import { Prisma, Priority } from '@prisma/client';");
        expect(account).toContain('priority?: Priority = 1;');
    });

    it('still renders `new Prisma.Decimal(n)` for a numeric Decimal default, but a `string` override takes the literal', async () => {
        const models = [{ name: 'Price', fields: [{ name: 'id', type: 'Int', isId: true }, { name: 'amount', type: 'Decimal', hasDefaultValue: true, default: 1.5 }] }];
        const plain = await new CreateDtoGenerator(buildOptions({ models })).generate();
        expect(plain[0].content).toContain('amount?: Prisma.Decimal = new Prisma.Decimal(1.5);');
        const asString = await new CreateDtoGenerator(buildOptions({ models, config: { extraScalars: JSON.stringify({ Decimal: { ts: 'string' } }) } })).generate();
        expect(asString[0].content).toContain("amount?: string = '1.5';");
    });
});

describe('Prisma 8 value objects: import paths', () => {
    it('import the variant file directly without reExport, and from a sibling file with the flat structure', async () => {
        const nested = await run('kitchen-sink-no-reexport', kitchenSink(), { reExport: 'false' });
        expect(nested.read('account/create-account.dto.ts')).toContain("import { CreateAddressDto } from '../address/create-address.dto';");
        expect(nested.read('account/update-account.dto.ts')).toContain("import { UpdateAddressDto } from '../address/update-address.dto';");
        const flat = await run('kitchen-sink-flat', kitchenSink(), { reExport: 'false', outputStructure: 'flat' });
        expect(flat.read('create-account.dto.ts')).toContain("import { CreateAddressDto } from './create-address.dto';");
    });
});
