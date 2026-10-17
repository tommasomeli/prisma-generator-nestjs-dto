import type { DMMF } from '@prisma/generator-helper';
import { describe, expect, it } from 'vitest';
import CreateDtoGenerator from '../src/generators/create-dto-generator';
import EntityGenerator from '../src/generators/entity-generator';
import UpdateDtoGenerator from '../src/generators/update-dto-generator';
import { CreateZodGenerator, EntityZodGenerator, UpdateZodGenerator, ZodSupportGenerator } from '../src/generators/zod';
import { resolveScalar } from '../src/prisma8/codec-map';
import { contractToDatamodel } from '../src/prisma8/contract-to-dmmf';
import type { AnnotationMap, ContractColumn, ContractDomainField, FieldAnnotations, Prisma8Contract } from '../src/prisma8/types';
import blogJson from './fixtures/prisma8/blog/contract.json';
import kitchenSinkJson from './fixtures/prisma8/kitchen-sink/contract.json';
import nativeEnumsJson from './fixtures/prisma8/native-enums/contract.json';
import { buildOptions } from './helpers/build-options';

const blog = blogJson as unknown as Prisma8Contract;
const kitchenSink = kitchenSinkJson as unknown as Prisma8Contract;
const nativeEnums = nativeEnumsJson as unknown as Prisma8Contract;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Runs the adapter collecting warnings instead of printing them. */
function convert(contract: Prisma8Contract, options: { annotations?: AnnotationMap; scalarOverrideKeys?: string[] } = {}) {
    const warnings: string[] = [];
    const datamodel = contractToDatamodel(contract, { ...options, warn: (m) => warnings.push(m) });
    const model = (name: string): DMMF.Model => {
        const found = datamodel.models.find((m) => m.name === name);
        if (!found) throw new Error(`model ${name} not found`);
        return found;
    };
    const field = (modelName: string, fieldName: string): DMMF.Field => {
        const found = model(modelName).fields.find((f) => f.name === fieldName);
        if (!found) throw new Error(`field ${modelName}.${fieldName} not found`);
        return found;
    };
    return { datamodel, warnings, model, field };
}

const scalar = (codecId: string, typeParams?: Record<string, unknown>, extra: Partial<ContractDomainField> = {}): ContractDomainField => ({ nullable: false, type: { kind: 'scalar', codecId, ...(typeParams ? { typeParams } : {}) }, ...extra });
const column = (codecId: string, dataType: string): ContractColumn => ({ codecId, dataType, nullable: false });

describe('codec-map resolveScalar (§3)', () => {
    const rows: [string, string, [string, string[]] | null, Record<string, unknown>?][] = [
        ['pg/text@1', 'String', null],
        ['sql/varchar@1', 'String', ['VarChar', ['255']], { length: 255 }],
        ['sql/char@1', 'String', ['Char', ['2']], { length: 2 }],
        ['pg/uuid@1', 'String', ['Uuid', []]],
        ['pg/inet@1', 'String', ['Inet', []]],
        ['pg/bit@1', 'String', ['Bit', ['8']], { length: 8 }],
        ['pg/varbit@1', 'String', ['VarBit', []]],
        ['pg/interval@1', 'String', ['Interval', []]],
        ['pg/time-temporal@1', 'String', ['Time', []]],
        ['pg/enum@1', 'String', null],
        // String-backed temporal codecs are DateTime for DTO purposes.
        ['pg/time-string@1', 'DateTime', ['Time', []]],
        ['pg/timetz@1', 'DateTime', ['Timetz', []]],
        ['pg/date-string@1', 'DateTime', ['Date', []]],
        ['pg/timestamp-string@1', 'DateTime', ['Timestamp', []]],
        ['pg/timestamptz-string@1', 'DateTime', ['Timestamptz', []]],
        ['pg/timestamptz-string@1', 'DateTime', ['Timestamptz', ['3']], { precision: 3 }],
        ['pg/bool@1', 'Boolean', null],
        ['pg/int2@1', 'Int', ['SmallInt', []]],
        ['pg/int4@1', 'Int', null],
        ['pg/int8number@1', 'Int', ['BigIntNumber', []]],
        ['pg/int8@1', 'BigInt', null],
        ['pg/unboundedint@1', 'BigInt', ['UnboundedInt', []]],
        ['pg/float4@1', 'Float', ['Real', []]],
        ['pg/float8@1', 'Float', null],
        ['pg/numeric@1', 'Decimal', null],
        ['pg/numeric@1', 'Decimal', ['Decimal', ['10', '2']], { precision: 10, scale: 2 }],
        ['pg/timestamptz-temporal@1', 'DateTime', null],
        ['pg/timestamptz-temporal@1', 'DateTime', ['Timestamptz', ['3']], { precision: 3 }],
        ['pg/timestamptz-date@1', 'DateTime', null],
        ['pg/timestamp-temporal@1', 'DateTime', ['Timestamp', []]],
        ['pg/date-temporal@1', 'DateTime', ['Date', []]],
        ['pg/json@1', 'Json', ['Json', []]],
        ['pg/jsonb@1', 'Json', ['JsonB', []]],
        ['pg/bytea@1', 'Bytes', null]
    ];
    it.each(rows)('%s → %s %j', (codecId, type, nativeType, typeParams) => {
        expect(resolveScalar(scalar(codecId, typeParams), undefined, { warn: () => {} })).toEqual({ type, kind: 'scalar', nativeType });
    });

    it('reads typeParams from the storage column when the domain type has none', () => {
        const col = { ...column('sql/varchar@1', 'pg/varchar'), typeParams: { length: 40 } } as ContractColumn;
        expect(resolveScalar(scalar('sql/varchar@1'), col).nativeType).toEqual(['VarChar', ['40']]);
    });

    it('maps valueSet enums and value objects to enum / object references', () => {
        const enumField = scalar('pg/text@1', undefined, { valueSet: { entityKind: 'enum', entityName: 'Role', namespaceId: 'public', plane: 'domain' } });
        expect(resolveScalar(enumField, undefined)).toEqual({ type: 'Role', kind: 'enum', nativeType: null });
        expect(resolveScalar({ nullable: false, type: { kind: 'valueObject', name: 'Address' } }, undefined)).toEqual({ type: 'Address', kind: 'object', nativeType: null });
    });

    it('emits unknown codecs as Unsupported and warns once per codec', () => {
        const warnings: string[] = [];
        const warnedCodecs = new Set<string>();
        const options = { warn: (m: string) => warnings.push(m), warnedCodecs };
        const first = resolveScalar(scalar('pg/vector@1'), column('pg/vector@1', 'pg/vector'), options);
        resolveScalar(scalar('pg/vector@1'), column('pg/vector@1', 'pg/vector'), options);
        expect(first).toEqual({ type: 'Unsupported', kind: 'unsupported', nativeType: ['pg/vector', []] });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('pg/vector@1');
    });

    it('passes the codec id through as the type when it is an extraScalars key', () => {
        const warnings: string[] = [];
        const resolved = resolveScalar(scalar('pg/vector@1'), column('pg/vector@1', 'pg/vector'), { scalarOverrideKeys: ['pg/vector@1'], warn: (m) => warnings.push(m) });
        expect(resolved).toEqual({ type: 'pg/vector@1', kind: 'scalar', nativeType: ['pg/vector', []] });
        expect(warnings).toEqual([]);
    });

    it('maps native enums (pg/enum@1) through the column valueSet, then typeParams.typeName', () => {
        const field = scalar('pg/enum@1', { typeName: 'UserRole' });
        expect(resolveScalar(field, undefined)).toEqual({ type: 'UserRole', kind: 'enum', nativeType: null });
        const col = { ...column('pg/enum@1', 'pg/enum'), valueSet: { entityKind: 'valueSet', entityName: 'Role', namespaceId: 'auth', plane: 'storage' } } as ContractColumn;
        expect(resolveScalar(field, col)).toEqual({ type: 'Role', kind: 'enum', nativeType: null, namespaceId: 'auth' });
    });

    it('emits union field types as Unsupported', () => {
        const resolved = resolveScalar({ nullable: false, type: { kind: 'union' } }, undefined, { warn: () => {} });
        expect(resolved.type).toBe('Unsupported');
        expect(resolved.kind).toBe('unsupported');
    });
});

describe('contractToDatamodel: blog fixture (§4)', () => {
    const { datamodel, warnings, model, field } = convert(blog);

    it('produces models, enums, no value objects and no warnings', () => {
        expect(datamodel.models.map((m) => m.name)).toEqual(['Post', 'User']);
        expect(datamodel.types).toEqual([]);
        expect(datamodel.indexes).toEqual([]);
        expect(warnings).toEqual([]);
    });

    it('sets dbName from the storage table and keeps primaryKey null for single-column ids', () => {
        expect(model('User').dbName).toBe('user');
        expect(model('Post').dbName).toBe('post');
        expect(model('User').primaryKey).toBeNull();
        expect(model('User').uniqueFields).toEqual([]);
    });

    it('derives isRequired, isId, isUnique and nativeType', () => {
        expect(field('User', 'id')).toMatchObject({ kind: 'scalar', type: 'Int', isId: true, isRequired: true, isUnique: false });
        expect(field('User', 'email')).toMatchObject({ type: 'String', isUnique: true, isId: false });
        expect(field('User', 'bio')).toMatchObject({ type: 'String', isRequired: false, nativeType: ['VarChar', ['255']] });
        expect(field('Post', 'meta')).toMatchObject({ type: 'Json', isRequired: false, nativeType: ['JsonB', []] });
        expect(field('Post', 'score')).toMatchObject({ type: 'Decimal', nativeType: null });
        // A non-unique FK index does not make the column unique.
        expect(field('Post', 'authorId').isUnique).toBe(false);
    });

    it('maps column defaults (function and literal)', () => {
        expect(field('User', 'id')).toMatchObject({ hasDefaultValue: true, default: { name: 'autoincrement', args: [] } });
        expect(field('User', 'createdAt')).toMatchObject({ type: 'DateTime', hasDefaultValue: true, default: { name: 'now', args: [] } });
        expect(field('User', 'role')).toMatchObject({ kind: 'enum', type: 'Role', hasDefaultValue: true, default: 'USER' });
        expect(field('User', 'name')).toMatchObject({ hasDefaultValue: false });
        expect(field('User', 'name').default).toBeUndefined();
    });

    it('derives isUpdatedAt from the execution onUpdate generator even without annotations', () => {
        expect(field('User', 'updatedAt')).toMatchObject({ isUpdatedAt: true, hasDefaultValue: false });
        expect(field('User', 'createdAt').isUpdatedAt).toBe(false);
    });

    it('marks FK scalars of N:1 relations as read-only', () => {
        expect(field('Post', 'authorId').isReadOnly).toBe(true);
        expect(field('Post', 'title').isReadOnly).toBe(false);
    });

    it('emits both relation sides as object fields', () => {
        expect(field('Post', 'author')).toMatchObject({
            kind: 'object',
            type: 'User',
            isList: false,
            isRequired: true,
            relationName: 'PostToUser',
            relationFromFields: ['authorId'],
            relationToFields: ['id']
        });
        expect(field('User', 'posts')).toMatchObject({ kind: 'object', type: 'Post', isList: true, relationName: 'PostToUser', relationFromFields: [], relationToFields: [] });
    });

    it('builds enums from domain enums', () => {
        expect(datamodel.enums).toEqual([{ name: 'Role', values: [{ name: 'ADMIN', dbName: null }, { name: 'USER', dbName: null }], dbName: null }]);
    });

    it('follows JSON key order without annotations (scalars, then relations)', () => {
        expect(model('User').fields.map((f) => f.name)).toEqual(['bio', 'createdAt', 'email', 'id', 'name', 'passwordHash', 'role', 'updatedAt', 'posts']);
    });

    it('follows PSL order and copies documentation / list / updatedAt facts from annotations', () => {
        const annotations = blogAnnotations();
        const { model: m, field: f, datamodel: d } = convert(blog, { annotations });
        expect(m('User').fields.map((x) => x.name)).toEqual(['id', 'email', 'name', 'passwordHash', 'role', 'bio', 'posts', 'createdAt', 'updatedAt']);
        // Models follow the PSL declaration order (User before Post), not the alphabetical JSON order.
        expect(d.models.map((x) => x.name)).toEqual(['User', 'Post']);
        expect(m('User').documentation).toBe('@Auditable("user_audit")');
        expect(f('User', 'passwordHash').documentation).toBe('Field hidden from every emitted DTO.\n@DtoHidden');
        expect(f('Post', 'title').documentation).toBe('@MaxLength(120)');
        expect(f('User', 'email').documentation).toBeUndefined();
        expect(d.enums[0].name).toBe('Role');
    });

    it('throws on a contract without domain.namespaces and warns on an unknown schemaVersion', () => {
        expect(() => contractToDatamodel({ schemaVersion: '1' } as unknown as Prisma8Contract)).toThrow(/domain\.namespaces/);
        const future = clone(blog);
        future.schemaVersion = '2';
        const { warnings: w, datamodel: d } = convert(future);
        expect(d.models).toHaveLength(2);
        expect(w.some((x) => x.includes('schemaVersion "2"'))).toBe(true);
    });
});

describe('contractToDatamodel: native-enums fixture (storage valueSet, string temporal codecs)', () => {
    const { datamodel, warnings, field } = convert(nativeEnums);

    it('builds enums from storage.entries.valueSet, members in order, with no warnings', () => {
        expect(warnings).toEqual([]);
        expect(datamodel.enums).toEqual([
            { name: 'MemberRole', values: ['owner', 'admin', 'member'].map((name) => ({ name, dbName: null })), dbName: null },
            { name: 'TicketStatus', values: ['open', 'in_progress', 'closed'].map((name) => ({ name, dbName: null })), dbName: null }
        ]);
    });

    it('references native enums from required, nullable and list fields', () => {
        expect(field('Member', 'role')).toMatchObject({ kind: 'enum', type: 'MemberRole', isRequired: true, isList: false, nativeType: null, hasDefaultValue: true, default: 'member' });
        expect(field('Member', 'pastRoles')).toMatchObject({ kind: 'enum', type: 'MemberRole', isList: true });
        expect(field('Ticket', 'status')).toMatchObject({ kind: 'enum', type: 'TicketStatus', isRequired: false });
    });

    it('maps string-backed temporal codecs to DateTime with their native type', () => {
        expect(field('Member', 'createdAt')).toMatchObject({ kind: 'scalar', type: 'DateTime', nativeType: ['Timestamptz', []], default: { name: 'now', args: [] } });
        expect(field('Member', 'lastSeenAt')).toMatchObject({ type: 'DateTime', isRequired: false, nativeType: ['Timestamptz', []] });
        expect(field('Ticket', 'dueOn')).toMatchObject({ type: 'DateTime', nativeType: ['Date', []] });
    });

    it('falls back to typeParams.typeName without a column valueSet and to native_enum members without a valueSet', () => {
        const contract = clone(nativeEnums);
        const entries = contract.storage.namespaces.public.entries;
        delete entries.table.ticket.columns.status.valueSet;
        delete entries.valueSet!.TicketStatus;
        entries.native_enum!.TicketStatus = { kind: 'postgres-enum', members: ['open', 'in-progress'], typeName: 'ticket_status' };
        const { datamodel: d, field: f } = convert(contract);
        expect(f('Ticket', 'status')).toMatchObject({ kind: 'enum', type: 'TicketStatus' });
        expect(d.enums.find((e) => e.name === 'TicketStatus')).toEqual({
            name: 'TicketStatus',
            values: [
                { name: 'open', dbName: null },
                { name: 'in_progress', dbName: 'in-progress' }
            ],
            dbName: 'ticket_status'
        });
    });

    it('skips expression and partial unique indexes (no columns / `where`) for isUnique and uniqueFields', () => {
        expect(convert(nativeEnums).model('Member')).toMatchObject({ uniqueFields: [], uniqueIndexes: [] });
        expect(convert(nativeEnums).model('Ticket')).toMatchObject({ uniqueFields: [], uniqueIndexes: [] });
        const contract = clone(nativeEnums);
        const table = contract.storage.namespaces.public.entries.table.ticket;
        table.uniques = [{ name: 'no_columns' } as unknown as { columns: string[] }, { columns: ['title'] }];
        table.indexes!.push({ columns: ['authorId', 'title'], name: 'ticket_author_title_key', unique: true });
        const { model: m, field: f } = convert(contract);
        expect(f('Ticket', 'title').isUnique).toBe(true);
        expect(m('Ticket').uniqueIndexes).toEqual([{ name: 'ticket_author_title_key', fields: ['authorId', 'title'] }]);
    });

    it('orders models and enums by PSL declaration order when annotations are present, JSON order otherwise', () => {
        expect(datamodel.models.map((m) => m.name)).toEqual(['Member', 'Ticket']);
        expect(datamodel.enums.map((e) => e.name)).toEqual(['MemberRole', 'TicketStatus']);
        const annotations: AnnotationMap = new Map([
            ['TicketStatus', { fields: new Map() }],
            ['Ticket', { fields: new Map() }],
            ['MemberRole', { fields: new Map() }]
        ]);
        const { datamodel: d } = convert(nativeEnums, { annotations });
        // `Member` is not in the PSL: it keeps its JSON position after the declared models.
        expect(d.models.map((m) => m.name)).toEqual(['Ticket', 'Member']);
        expect(d.enums.map((e) => e.name)).toEqual(['TicketStatus', 'MemberRole']);
    });

    it('emits an enum present both as a domain enum and as a storage valueSet once (domain wins)', () => {
        expect(convert(blog).datamodel.enums.map((e) => e.name)).toEqual(['Role']);
        const contract = clone(nativeEnums);
        contract.domain.namespaces.public.enum = { MemberRole: { codecId: 'pg/text@1', members: [{ name: 'OWNER', value: 'owner' }] } };
        const { datamodel: d } = convert(contract);
        expect(d.enums.map((e) => e.name)).toEqual(['MemberRole', 'TicketStatus']);
        expect(d.enums[0].values).toEqual([{ name: 'OWNER', dbName: 'owner' }]);
    });
});

describe('contractToDatamodel: kitchen-sink fixture', () => {
    const { datamodel, warnings, model, field } = convert(kitchenSink);

    it('emits value objects into types[] and references them without a relation', () => {
        expect(datamodel.types.map((t) => t.name)).toEqual(['Address']);
        const address = datamodel.types[0];
        expect(address).toMatchObject({ dbName: null, primaryKey: null, uniqueFields: [], uniqueIndexes: [] });
        expect(address.fields.map((f) => [f.name, f.type, f.isRequired])).toEqual([
            ['street', 'String', true],
            ['city', 'String', true],
            ['zip', 'String', false]
        ]);
        expect(address.fields.find((f) => f.name === 'zip')!.nativeType).toEqual(['VarChar', ['10']]);
        const parent = field('Account', 'address');
        expect(parent).toMatchObject({ kind: 'object', type: 'Address', isList: false, isRequired: false });
        expect(parent.relationName).toBeUndefined();
    });

    it('emits enums with numeric members using dbName for the value', () => {
        expect(datamodel.enums).toEqual([
            {
                name: 'Priority',
                values: [
                    { name: 'Low', dbName: '0' },
                    { name: 'Medium', dbName: '1' },
                    { name: 'High', dbName: '2' }
                ],
                dbName: null
            }
        ]);
        expect(field('Account', 'priority')).toMatchObject({ kind: 'enum', type: 'Priority', default: 1 });
    });

    it('maps a composite primary key like DMMF (primaryKey set, isId false on members)', () => {
        expect(model('Membership').primaryKey).toEqual({ name: null, fields: ['accountId', 'teamId'] });
        expect(field('Membership', 'accountId').isId).toBe(false);
        expect(field('Membership', 'teamId').isId).toBe(false);
    });

    it('maps composite uniques and single-column unique indexes', () => {
        expect(model('Team').uniqueFields).toEqual([['orgId', 'slug']]);
        expect(model('Team').uniqueIndexes).toEqual([{ name: 'team_org_slug_key', fields: ['orgId', 'slug'] }]);
        expect(field('Team', 'slug').isUnique).toBe(false);
        expect(field('Team', 'handle').isUnique).toBe(true);
        expect(model('Team').dbName).toBeNull();
    });

    it('maps a uuid id with an execution uuid() default', () => {
        expect(field('Account', 'id')).toMatchObject({ type: 'String', isId: true, nativeType: ['Uuid', []], hasDefaultValue: true, default: { name: 'uuid', args: [] } });
    });

    it('maps numeric(10,2), int8, bytea and jsonb columns with their defaults', () => {
        expect(field('Account', 'balance')).toMatchObject({ type: 'Decimal', nativeType: ['Decimal', ['10', '2']], default: '0.00' });
        expect(field('Account', 'views')).toMatchObject({ type: 'BigInt', nativeType: null, default: 0 });
        expect(field('Account', 'avatar')).toMatchObject({ type: 'Bytes', isRequired: false, nativeType: null, hasDefaultValue: false });
        expect(field('Account', 'settings')).toMatchObject({ type: 'Json', nativeType: ['JsonB', []], default: '{"theme":"dark"}' });
    });

    it('maps raw SQL function defaults to dbgenerated(...)', () => {
        expect(field('Account', 'code').default).toEqual({ name: 'dbgenerated', args: ['gen_random_uuid()::text'] });
    });

    it('sets the field dbName only when the column differs', () => {
        expect(field('Account', 'displayName').dbName).toBe('display_name');
        expect(field('Account', 'views').dbName).toBeNull();
    });

    it('derives isList for scalar lists from `many`', () => {
        expect(field('Account', 'tags')).toMatchObject({ type: 'String', isList: true });
        expect(field('Account', 'views').isList).toBe(false);
    });

    it('handles a nullable FK relation and disambiguates relation names between the same models', () => {
        expect(field('Membership', 'invitedBy')).toMatchObject({ type: 'Account', isRequired: false, relationFromFields: ['invitedById'], relationName: 'AccountToMembership_invitedById' });
        expect(field('Membership', 'invitedById')).toMatchObject({ isReadOnly: true, isRequired: false });
        expect(field('Membership', 'account').relationName).toBe('AccountToMembership_accountId');
        expect(field('Account', 'invitations')).toMatchObject({ isList: true, relationName: 'AccountToMembership_invitedById', relationFromFields: [] });
        expect(field('Account', 'memberships').relationName).toBe('AccountToMembership_accountId');
        expect(field('Membership', 'team').relationName).toBe('MembershipToTeam');
        expect(field('Team', 'memberships').relationName).toBe('MembershipToTeam');
    });

    it('maps a 1:1 relation: owning side carries the FK, back side is optional and empty', () => {
        expect(field('Profile', 'account')).toMatchObject({ kind: 'object', type: 'Account', isList: false, isRequired: true, relationName: 'AccountToProfile', relationFromFields: ['accountId'], relationToFields: ['id'] });
        expect(field('Profile', 'accountId')).toMatchObject({ isUnique: true, isReadOnly: true });
        expect(field('Account', 'profile')).toMatchObject({ kind: 'object', type: 'Profile', isList: false, isRequired: false, relationName: 'AccountToProfile', relationFromFields: [], relationToFields: [] });
        expect(field('Account', 'id').isReadOnly).toBe(false);
    });

    it('emits pg/vector@1 as Unsupported with a single warning', () => {
        expect(field('Account', 'embedding')).toMatchObject({ type: 'Unsupported', kind: 'unsupported', nativeType: ['pg/vector', []] });
        expect(warnings.filter((w) => w.includes('pg/vector@1'))).toHaveLength(1);
    });

    it('passes pg/vector@1 through as the type when it is an extraScalars key', () => {
        const { field: f, warnings: w } = convert(kitchenSink, { scalarOverrideKeys: ['pg/vector@1'] });
        expect(f('Account', 'embedding')).toMatchObject({ type: 'pg/vector@1', kind: 'scalar' });
        expect(w).toEqual([]);
    });

    it('feature-detects the value object key (`types`)', () => {
        const contract = clone(kitchenSink);
        const ns = contract.domain.namespaces.public;
        ns.types = ns.valueObjects;
        delete ns.valueObjects;
        expect(convert(contract).datamodel.types.map((t) => t.name)).toEqual(['Address']);
    });

    it('emits @@base / @@discriminator models flat with one warning', () => {
        const contract = clone(kitchenSink);
        const models = contract.domain.namespaces.public.models as Record<string, Record<string, unknown>>;
        models.Team.discriminator = { field: 'slug' };
        models.Profile.base = { model: 'Team', namespace: 'public' };
        const { warnings: w, datamodel: d } = convert(contract);
        expect(w.filter((x) => x.includes('inheritance'))).toHaveLength(1);
        expect(d.models).toHaveLength(4);
    });

    it('keeps bare names across namespaces and prefixes only on collision', () => {
        const contract = clone(kitchenSink);
        contract.domain.namespaces.audit = {
            models: {
                Team: { fields: { id: scalar('pg/int4@1') }, relations: {}, storage: { fields: { id: { column: 'id' } }, namespaceId: 'audit', table: 'team' } },
                Log: { fields: { id: scalar('pg/int4@1') }, relations: {}, storage: { fields: { id: { column: 'id' } }, namespaceId: 'audit', table: 'log' } }
            }
        };
        const { datamodel: d, warnings: w } = convert(contract);
        const names = d.models.map((m) => m.name);
        expect(names).toEqual(expect.arrayContaining(['public_Team', 'audit_Team', 'Log', 'Account']));
        expect(names).not.toContain('Team');
        expect(d.models.find((m) => m.name === 'Membership')!.fields.find((f) => f.name === 'team')!.type).toBe('public_Team');
        expect(w.some((x) => x.includes('"Team"'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Acceptance (plan Phase 1.4): Prisma 8 contract → same DTO sources as the Prisma 7 DMMF route.
// ---------------------------------------------------------------------------

/** Hand-built annotation map for the blog fixture (Phase 2 produces it from contract.prisma). */
function blogAnnotations(): AnnotationMap {
    const fields = (entries: [string, Partial<FieldAnnotations>?][]): Map<string, FieldAnnotations> => new Map(entries.map(([name, a]) => [name, { isList: false, isUpdatedAt: false, ...a }]));
    return new Map([
        ['Role', { fields: new Map() }],
        [
            'User',
            {
                doc: '@Auditable("user_audit")',
                fields: fields([
                    ['id'],
                    ['email'],
                    ['name'],
                    ['passwordHash', { doc: 'Field hidden from every emitted DTO.\n@DtoHidden' }],
                    ['role'],
                    ['bio'],
                    ['posts', { isList: true, writtenType: 'Post[]' }],
                    ['createdAt'],
                    ['updatedAt', { isUpdatedAt: true, writtenType: 'temporal.updatedAt()' }]
                ])
            }
        ],
        [
            'Post',
            {
                doc: '@Auditable("post_audit")',
                fields: fields([['id'], ['title', { doc: '@MaxLength(120)' }], ['body'], ['score'], ['meta'], ['author'], ['authorId'], ['createdAt']])
            }
        ]
    ]);
}

/**
 * DMMF that `prisma generate` (Prisma 7) emits for the equivalent schema:
 * `examples/blog/prisma/schema.prisma` plus `role Role @default(USER)`, `bio String? @db.VarChar(255)`,
 * `updatedAt DateTime @updatedAt`, `meta Json? @db.JsonB`, `/// @MaxLength(120)` on `title` and `@@map`.
 */
function prisma7BlogDatamodel(): { models: DMMF.Model[]; enums: DMMF.DatamodelEnum[] } {
    const f = (props: Partial<DMMF.Field> & { name: string; type: string }): DMMF.Field =>
        ({ kind: 'scalar', isList: false, isRequired: true, isUnique: false, isId: false, isReadOnly: false, hasDefaultValue: false, nativeType: null, isGenerated: false, isUpdatedAt: false, dbName: null, ...props }) as DMMF.Field;
    const m = (name: string, dbName: string, documentation: string, fields: DMMF.Field[]): DMMF.Model =>
        ({ name, dbName, schema: null, documentation, fields, primaryKey: null, uniqueFields: [], uniqueIndexes: [], isGenerated: false }) as unknown as DMMF.Model;
    return {
        enums: [{ name: 'Role', values: [{ name: 'ADMIN', dbName: null }, { name: 'USER', dbName: null }], dbName: null }] as DMMF.DatamodelEnum[],
        models: [
            m('User', 'user', '@Auditable("user_audit")', [
                f({ name: 'id', type: 'Int', isId: true, hasDefaultValue: true, default: { name: 'autoincrement', args: [] } }),
                f({ name: 'email', type: 'String', isUnique: true }),
                f({ name: 'name', type: 'String' }),
                f({ name: 'passwordHash', type: 'String', documentation: 'Field hidden from every emitted DTO.\n@DtoHidden' }),
                f({ name: 'role', kind: 'enum', type: 'Role', hasDefaultValue: true, default: 'USER' }),
                f({ name: 'bio', type: 'String', isRequired: false, nativeType: ['VarChar', ['255']] }),
                f({ name: 'posts', kind: 'object', type: 'Post', isList: true, relationName: 'PostToUser', relationFromFields: [], relationToFields: [] }),
                f({ name: 'createdAt', type: 'DateTime', hasDefaultValue: true, default: { name: 'now', args: [] } }),
                f({ name: 'updatedAt', type: 'DateTime', isUpdatedAt: true })
            ]),
            m('Post', 'post', '@Auditable("post_audit")', [
                f({ name: 'id', type: 'Int', isId: true, hasDefaultValue: true, default: { name: 'autoincrement', args: [] } }),
                f({ name: 'title', type: 'String', documentation: '@MaxLength(120)' }),
                f({ name: 'body', type: 'String' }),
                f({ name: 'score', type: 'Decimal' }),
                f({ name: 'meta', type: 'Json', isRequired: false, nativeType: ['JsonB', []] }),
                f({ name: 'author', kind: 'object', type: 'User', relationName: 'PostToUser', relationFromFields: ['authorId'], relationToFields: ['id'] }),
                f({ name: 'authorId', type: 'Int', isReadOnly: true }),
                f({ name: 'createdAt', type: 'DateTime', hasDefaultValue: true, default: { name: 'now', args: [] } })
            ])
        ]
    };
}

const stripPrismaClient = (source: string): string =>
    source
        .split('\n')
        .filter((line) => !line.includes('@prisma/client'))
        .join('\n');

async function render(datamodel: { models: DMMF.Model[]; enums: DMMF.DatamodelEnum[] }): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const Generator of [EntityGenerator, CreateDtoGenerator, UpdateDtoGenerator]) {
        const files = await new Generator(buildOptions({ datamodel })).generate();
        for (const file of files) out.set(file.path, stripPrismaClient(file.content));
    }
    return out;
}

describe('acceptance: Prisma 8 blog contract matches the Prisma 7 DMMF output', () => {
    it('generates identical User / CreateUserDto / UpdateUserDto / Post sources', async () => {
        const fromContract = await render(contractToDatamodel(blog, { annotations: blogAnnotations(), warn: () => {} }));
        const fromDmmf = await render(prisma7BlogDatamodel());
        expect([...fromContract.keys()].sort()).toEqual([...fromDmmf.keys()].sort());
        const paths = [...fromDmmf.keys()];
        for (const name of ['user.entity', 'create-user.dto', 'update-user.dto', 'post.entity']) expect(paths.some((p) => p.includes(name))).toBe(true);
        for (const path of paths) expect(fromContract.get(path), path).toBe(fromDmmf.get(path));
        // Sanity: the annotation-driven parts made it through.
        const createUser = [...fromContract.entries()].find(([p]) => p.includes('create-user.dto'))![1];
        expect(createUser).not.toContain('passwordHash');
        expect(createUser).not.toContain('updatedAt');
        const createPost = [...fromContract.entries()].find(([p]) => p.includes('create-post.dto'))![1];
        expect(createPost).toContain('MaxLength(120)');
    });
});

describe('acceptance (Phase 4.5): Zod output of the Prisma 8 blog contract matches the Prisma 7 DMMF output', () => {
    async function renderZod(datamodel: { models: DMMF.Model[]; enums: DMMF.DatamodelEnum[] }, config: Record<string, string>): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        for (const Generator of [ZodSupportGenerator, CreateZodGenerator, EntityZodGenerator, UpdateZodGenerator]) {
            const files = await new Generator(buildOptions({ datamodel, config: { outputType: 'zod', ...config } })).generate();
            for (const file of files) out.set(file.path, file.content);
        }
        return out;
    }

    it('generates byte-identical schemas, enums, scalars and server rules with the prisma8 flag on', async () => {
        // The only intended difference is the D3 Zod default (`Decimal` → `z.string()`), applied by hand on the Prisma 7 side.
        const fromContract = await renderZod(contractToDatamodel(blog, { annotations: blogAnnotations(), warn: () => {} }), { prisma8: 'true' });
        const fromDmmf = await renderZod(prisma7BlogDatamodel(), { extraScalars: JSON.stringify({ Decimal: { ts: 'string', zod: 'z.string()' } }) });
        expect([...fromContract.keys()].sort()).toEqual([...fromDmmf.keys()].sort());
        for (const name of ['enums/role.enum.ts', 'user/user.schema.ts', 'user/create-user.schema.ts', 'post/update-post.schema.ts', 'scalars.ts', 'server-rules.ts']) {
            expect([...fromDmmf.keys()].some((p) => p.endsWith(name)), name).toBe(true);
        }
        // No line filter here: Zod output never imports `@prisma/client`.
        for (const path of fromDmmf.keys()) expect(fromContract.get(path), path).toBe(fromDmmf.get(path));
        for (const content of fromContract.values()) expect(content).not.toContain('@prisma/client');
        expect([...fromContract.entries()].find(([p]) => p.endsWith('post/create-post.schema.ts'))![1]).toContain('score: z.string()');
    });

    it('without the prisma8 flag the blog Decimal stays z.number() (single expected difference)', async () => {
        const prisma7 = await renderZod(prisma7BlogDatamodel(), {});
        expect([...prisma7.entries()].find(([p]) => p.endsWith('post/create-post.schema.ts'))![1]).toContain('score: z.number()');
    });
});
