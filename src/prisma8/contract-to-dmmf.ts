import type { DMMF } from '@prisma/generator-helper';
import { Utility } from '../utility';
import { resolveScalar } from './codec-map';
import type {
    ContractColumn,
    ContractColumnDefault,
    ContractDomainField,
    ContractDomainModel,
    ContractExecution,
    ContractExecutionMutationDefault,
    ContractFieldExtras,
    ContractModelExtras,
    ContractRelation,
    ContractRelationExtras,
    ContractStorageNativeEnum,
    ContractStorageValueSet,
    ContractTable,
    ContractToDatamodelOptions,
    ContractValueObject,
    FieldAnnotations,
    Prisma8Contract,
    SyntheticDatamodel
} from './types';

type Relation = ContractRelation & ContractRelationExtras;
type Field = ContractDomainField & ContractFieldExtras;
type Model = ContractDomainModel & ContractModelExtras;
type DmmfDefault = { name: string; args: unknown[] } | unknown;
type GeneratorSpec = NonNullable<ContractExecutionMutationDefault['onCreate']>;

/** Supported `schemaVersion` of `contract.json`. */
export const SUPPORTED_CONTRACT_SCHEMA_VERSION = '1';

const key = (...parts: string[]): string => parts.join('\u0000');
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Assigns DMMF names to entities that live in several namespaces: bare names, prefixed with
 * `<ns>_` only when two namespaces declare the same name (warned once per name).
 */
function buildNameTable(entries: [string, string][], label: string, warn: (message: string) => void): (ns: string | undefined, name: string) => string {
    const counts = new Map<string, number>();
    for (const [, name] of entries) counts.set(name, (counts.get(name) ?? 0) + 1);
    const byKey = new Map<string, string>();
    const byName = new Map<string, string[]>();
    for (const [ns, name] of entries) {
        const finalName = (counts.get(name) ?? 0) > 1 ? `${ns}_${name}` : name;
        byKey.set(key(ns, name), finalName);
        byName.set(name, [...(byName.get(name) ?? []), finalName]);
    }
    for (const [name, count] of counts) if (count > 1) warn(`${label} "${name}" is declared in several namespaces; emitting it as ${byName.get(name)!.join(', ')}.`);
    return (ns, name) => (ns !== undefined && byKey.get(key(ns, name))) || byName.get(name)?.[0] || name;
}

/** A native enum found in storage (`entries.valueSet` / `entries.native_enum`) with no domain enum of the same name. */
type StorageEnum = { nsId: string; name: string; valueSet?: ContractStorageValueSet; nativeEnum?: ContractStorageNativeEnum };

/** Turns a stored enum value into a TypeScript-safe member name (`in-progress` → `in_progress`, `1st` → `_1st`). */
const memberName = (value: string): string => {
    const name = value.replace(/[^\w$]/g, '_');
    return /^[A-Za-z_$]/.test(name) ? name : `_${name}`;
};

/**
 * Collects the native Postgres enums of the storage plane: every `entries.valueSet` (members in order)
 * and `entries.native_enum` entry whose name is not already a domain enum.
 */
function collectStorageEnums(contract: Prisma8Contract, domainEnumNames: ReadonlySet<string>): StorageEnum[] {
    const out: StorageEnum[] = [];
    for (const [nsId, ns] of Object.entries(contract.storage?.namespaces ?? {})) {
        const valueSets = ns?.entries?.valueSet ?? {};
        const nativeEnums = ns?.entries?.native_enum ?? {};
        for (const name of new Set([...Object.keys(valueSets), ...Object.keys(nativeEnums)])) {
            if (domainEnumNames.has(name)) continue;
            out.push({ nsId, name, valueSet: valueSets[name], nativeEnum: nativeEnums[name] });
        }
    }
    return out;
}

/**
 * Column-tuple unique constraints of a table, as DMMF sees them: `uniques[]` plus `unique: true` entries of
 * `indexes[]`. Entries without a column tuple (expression indexes, `expression` instead of `columns`) and
 * partial unique indexes (`where`) do not map to a model-level unique and are skipped.
 */
function uniqueColumnSets(table: ContractTable | undefined): { name: string | null; columns: string[] }[] {
    const hasColumns = (entry: { columns?: readonly string[] }): boolean => Array.isArray(entry.columns) && entry.columns.length > 0;
    const uniques = (table?.uniques ?? []).filter(hasColumns).map((u) => ({ name: u.name ?? null, columns: [...u.columns] }));
    const indexes = (table?.indexes ?? []).filter((i) => i.unique && !i.where && !i.expression && hasColumns(i)).map((i) => ({ name: i.name ?? null, columns: [...(i.columns ?? [])] }));
    return [...uniques, ...indexes];
}

/**
 * Reorders `items` by the position of their raw (PSL) name in `order`; names absent from `order` keep
 * their relative order and come last. A no-op when `order` is empty.
 */
function sortByPslOrder<T>(items: { raw: string; value: T }[], order: readonly string[]): T[] {
    if (order.length === 0) return items.map((i) => i.value);
    const rank = new Map(order.map((name, i) => [name, i]));
    const of = (raw: string): number => rank.get(raw) ?? order.length;
    return items
        .map((item, i) => ({ item, i }))
        .sort((a, b) => of(a.item.raw) - of(b.item.raw) || a.i - b.i)
        .map(({ item }) => item.value);
}

/** Parses the numeric/string arguments of a default function call (`uuid(7)` → `[7]`). */
function parseArgs(raw: string): unknown[] {
    if (!raw.trim()) return [];
    return raw.split(',').map((arg) => {
        const value = arg.trim().replace(/^["'](.*)["']$/, '$1');
        return /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
    });
}

/** Maps a storage column default to the DMMF `default` value. */
function mapColumnDefault(def: ContractColumnDefault, scalarType: string): { value: DmmfDefault } | null {
    if (def.kind === 'literal') {
        const value = (def as { value: unknown }).value;
        // DMMF carries Json defaults as their JSON text.
        return { value: scalarType === 'Json' && typeof value !== 'string' ? JSON.stringify(value) : value };
    }
    if (def.kind === 'function') {
        const expression = String((def as { expression: unknown }).expression).trim();
        const match = /^(now|autoincrement|uuid|cuid|ulid|nanoid)\((.*)\)$/.exec(expression);
        if (match) return { value: { name: match[1], args: parseArgs(match[2]) } };
        // Raw SQL default (Prisma 7 `dbgenerated("...")`, Prisma 8 tagged SQL literal).
        return { value: { name: 'dbgenerated', args: [expression] } };
    }
    return null;
}

/** Maps an execution-plane generator (`uuidv4`, `cuid2`, `instantNow` …) to the DMMF `default`. */
function mapGeneratorDefault(spec: GeneratorSpec): { name: string; args: unknown[] } {
    switch (spec.id) {
        case 'uuidv4':
            return { name: 'uuid', args: [] };
        case 'uuidv7':
            return { name: 'uuid', args: [7] };
        case 'cuid2':
            return { name: 'cuid', args: [2] };
        case 'nanoid':
            return { name: 'nanoid', args: typeof spec.params?.size === 'number' ? [spec.params.size] : [] };
        case 'instantNow':
            return { name: 'now', args: [] };
        default:
            return { name: spec.id, args: [] };
    }
}

/**
 * Converts a Prisma 8 `contract.json` (schemaVersion "1") into a DMMF-shaped datamodel that
 * `BaseGenerator` consumes unchanged. Pure: no I/O, warnings go through `options.warn`.
 *
 * Flag derivation follows `docs/prisma-8-plan.md` §4. Facts that are present in the JSON (`many`
 * for lists, `execution.mutations.defaults` `onUpdate` for `temporal.updatedAt()`) are used directly;
 * the PSL annotation map adds documentation, list/updatedAt facts and the source field order.
 *
 * @param contract Parsed `contract.json`.
 * @param options Annotations, `extraScalars` keys and warning sink.
 * @return Models, enums, value objects (`types`) and an empty `indexes` list.
 * @throws Error when `domain.namespaces` is missing.
 */
export function contractToDatamodel(contract: Prisma8Contract, options: ContractToDatamodelOptions = {}): SyntheticDatamodel {
    const warn = options.warn ?? ((message: string) => Utility.warn(message));
    const warnedOnce = new Set<string>();
    const warnOnce = (id: string, message: string): void => {
        if (warnedOnce.has(id)) return;
        warnedOnce.add(id);
        warn(message);
    };
    const domainNamespaces = contract?.domain?.namespaces;
    if (!domainNamespaces || typeof domainNamespaces !== 'object') throw new Error('Invalid Prisma 8 contract: `domain.namespaces` is missing. Is this a contract.json written by `prisma contract emit`?');
    if (contract.schemaVersion !== SUPPORTED_CONTRACT_SCHEMA_VERSION)
        warn(`contract.json schemaVersion "${contract.schemaVersion}" is not "${SUPPORTED_CONTRACT_SCHEMA_VERSION}"; the output may be incomplete. Please report it.`);

    const annotations = options.annotations ?? new Map();
    const scalarOverrideKeys = [...(options.scalarOverrideKeys ?? [])];
    const warnedCodecs = new Set<string>();
    const namespaces = Object.entries(domainNamespaces);
    const valueObjectsOf = (ns: (typeof namespaces)[number][1]): Record<string, ContractValueObject> => ns.valueObjects ?? ns.types ?? {};

    const modelName = buildNameTable(
        namespaces.flatMap(([nsId, ns]) => Object.keys(ns.models ?? {}).map((n): [string, string] => [nsId, n])),
        'Model',
        warn
    );
    const domainEnumEntries = namespaces.flatMap(([nsId, ns]) => Object.keys(ns.enum ?? {}).map((n): [string, string] => [nsId, n]));
    const storageEnums = collectStorageEnums(contract, new Set(domainEnumEntries.map(([, n]) => n)));
    const enumName = buildNameTable(
        [...domainEnumEntries, ...storageEnums.map((e): [string, string] => [e.nsId, e.name])],
        'Enum',
        warn
    );
    const valueObjectName = buildNameTable(
        namespaces.flatMap(([nsId, ns]) => Object.keys(valueObjectsOf(ns)).map((n): [string, string] => [nsId, n])),
        'Value object',
        warn
    );

    const tableOf = (model: ContractDomainModel): ContractTable | undefined => {
        const storage = model.storage;
        if (!storage) return undefined;
        return contract.storage?.namespaces?.[storage.namespaceId]?.entries?.table?.[storage.table];
    };
    const execDefaults = new Map<string, ContractExecutionMutationDefault>();
    for (const def of (contract as Prisma8Contract & { execution?: ContractExecution }).execution?.mutations?.defaults ?? []) execDefaults.set(key(def.ref.namespace, def.ref.entry, def.ref.field), def);

    /** `true` when the relation's `localFields` are foreign keys of this model (owning side). */
    const isOwningSide = (model: ContractDomainModel, relation: Relation): boolean => {
        if (relation.cardinality === 'N:1') return true;
        if (relation.cardinality !== '1:1' || !relation.on) return false;
        const table = tableOf(model);
        const columns = relation.on.localFields.map((f) => model.storage?.fields?.[f]?.column ?? f);
        if (table?.foreignKeys) return table.foreignKeys.some((fk) => sameSet(fk.source?.columns ?? [], columns));
        const pk = table?.primaryKey?.columns ?? [];
        return !columns.every((c) => pk.includes(c));
    };

    // Owning-side relation counts per (owner, target) pair, to disambiguate relation names.
    const pairCounts = new Map<string, number>();
    for (const [nsId, ns] of namespaces)
        for (const [name, model] of Object.entries(ns.models ?? {}))
            for (const relation of Object.values((model.relations ?? {}) as Record<string, Relation>)) {
                if (!isOwningSide(model, relation)) continue;
                const pair = key(modelName(nsId, name), modelName(relation.to.namespace, relation.to.model));
                pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
            }
    const relationNameOf = (self: string, target: string, owner: string, fkFields: string[]): string => {
        const base = [self, target].sort().join('To');
        const ownerTarget = owner === self ? target : self;
        return (pairCounts.get(key(owner, ownerTarget)) ?? 0) > 1 && fkFields.length ? `${base}_${fkFields.join('_')}` : base;
    };

    const orderFields = (fields: DMMF.Field[], fieldAnnotations: Map<string, FieldAnnotations> | undefined): DMMF.Field[] => {
        if (!fieldAnnotations) return fields;
        const order = [...fieldAnnotations.keys()];
        const rank = (f: DMMF.Field): number => (order.includes(f.name) ? order.indexOf(f.name) : order.length);
        return fields.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(({ f }) => f);
    };

    const renameRef = (resolved: ReturnType<typeof resolveScalar>, field: Field, nsId: string): string => {
        if (resolved.kind === 'enum') return enumName(resolved.namespaceId ?? field.valueSet?.namespaceId ?? nsId, resolved.type);
        if (resolved.kind === 'object') return valueObjectName((field.type.namespace as string | undefined) ?? nsId, resolved.type);
        return resolved.type;
    };

    /** Builds the scalar / enum / value-object DMMF field shared by models and value objects. */
    const buildField = (name: string, field: Field, nsId: string, column: ContractColumn | undefined, fieldAnnotation: FieldAnnotations | undefined): DMMF.Field => {
        const resolved = resolveScalar(field, column, { scalarOverrideKeys, warn, warnedCodecs });
        const dmmf: Record<string, unknown> = {
            name,
            kind: resolved.kind,
            isList: Boolean(field.many) || Boolean(fieldAnnotation?.isList),
            isRequired: !field.nullable,
            isUnique: false,
            isId: false,
            isReadOnly: false,
            hasDefaultValue: false,
            type: renameRef(resolved, field, nsId),
            nativeType: resolved.nativeType,
            isGenerated: false,
            isUpdatedAt: Boolean(fieldAnnotation?.isUpdatedAt),
            dbName: null
        };
        if (fieldAnnotation?.doc) dmmf.documentation = fieldAnnotation.doc;
        return dmmf as unknown as DMMF.Field;
    };

    const models: { raw: string; value: DMMF.Model }[] = [];
    for (const [nsId, ns] of namespaces) {
        for (const [rawName, rawModel] of Object.entries(ns.models ?? {})) {
            const model = rawModel as Model;
            const name = modelName(nsId, rawName);
            if (model.base || model.discriminator || model.variants)
                warnOnce('inheritance', `Model inheritance (@@base / @@discriminator) is not supported yet; "${name}" and related models are emitted as flat models.`);
            const modelAnnotation = annotations.get(rawName);
            const table = tableOf(model);
            const storageFields = model.storage?.fields ?? {};
            const columnOf = (field: string): string => storageFields[field]?.column ?? field;
            const fieldOfColumn = new Map(Object.keys(model.fields ?? {}).map((f) => [columnOf(f), f]));
            const toFields = (columns: readonly string[]): string[] => columns.map((c) => fieldOfColumn.get(c) ?? c);

            const pkColumns = table?.primaryKey?.columns ?? [];
            const uniqueSets = uniqueColumnSets(table);
            const singleUniques = new Set(uniqueSets.filter((u) => u.columns.length === 1).map((u) => u.columns[0]));
            const compoundUniques = uniqueSets.filter((u) => u.columns.length > 1);

            const relations = Object.entries((model.relations ?? {}) as Record<string, Relation>);
            const readOnly = new Set(relations.filter(([, r]) => r.on && isOwningSide(model, r)).flatMap(([, r]) => r.on.localFields));

            const fields: DMMF.Field[] = [];
            for (const [fieldName, rawField] of Object.entries(model.fields ?? {})) {
                const field = rawField as Field;
                const columnName = columnOf(fieldName);
                const column = table?.columns?.[columnName];
                const dmmf = buildField(fieldName, field, nsId, column, modelAnnotation?.fields.get(fieldName)) as unknown as Record<string, unknown>;
                dmmf.isId = pkColumns.length === 1 && pkColumns[0] === columnName;
                dmmf.isUnique = singleUniques.has(columnName) && !dmmf.isId;
                dmmf.isReadOnly = readOnly.has(fieldName);
                dmmf.dbName = columnName !== fieldName ? columnName : null;
                const exec = model.storage ? execDefaults.get(key(model.storage.namespaceId, model.storage.table, columnName)) : undefined;
                if (exec?.onUpdate) dmmf.isUpdatedAt = true;
                const fromColumn = column?.default ? mapColumnDefault(column.default, String(dmmf.type)) : null;
                const fromExec = !fromColumn && exec?.onCreate && !exec.onUpdate ? { value: mapGeneratorDefault(exec.onCreate) } : null;
                const def = fromColumn ?? fromExec;
                if (def) {
                    dmmf.hasDefaultValue = true;
                    dmmf.default = def.value;
                }
                fields.push(dmmf as unknown as DMMF.Field);
            }

            for (const [relName, relation] of relations) {
                const target = modelName(relation.to.namespace, relation.to.model);
                const owning = Boolean(relation.on) && isOwningSide(model, relation);
                const localFields = [...(relation.on?.localFields ?? [])];
                const targetFields = [...(relation.on?.targetFields ?? [])];
                const isList = relation.cardinality === '1:N' || relation.cardinality === 'N:M';
                const fkRequired = localFields.every((f) => model.fields?.[f] && !model.fields[f].nullable);
                const dmmf: Record<string, unknown> = {
                    name: relName,
                    kind: 'object',
                    isList,
                    // DMMF marks list relations as required (never null); to-one sides follow `nullable`.
                    isRequired: isList ? true : owning ? (typeof relation.nullable === 'boolean' ? !relation.nullable : fkRequired) : false,
                    isUnique: false,
                    isId: false,
                    isReadOnly: false,
                    hasDefaultValue: false,
                    type: target,
                    nativeType: null,
                    relationName: relationNameOf(name, target, owning ? name : target, owning ? localFields : targetFields),
                    relationFromFields: owning ? localFields : [],
                    relationToFields: owning ? targetFields : [],
                    isGenerated: false,
                    isUpdatedAt: false,
                    dbName: null
                };
                const doc = modelAnnotation?.fields.get(relName)?.doc;
                if (doc) dmmf.documentation = doc;
                fields.push(dmmf as unknown as DMMF.Field);
            }

            const dbName = model.storage?.table && model.storage.table !== rawName ? model.storage.table : null;
            const out: Record<string, unknown> = {
                name,
                dbName,
                schema: null,
                fields: orderFields(fields, modelAnnotation?.fields),
                primaryKey: pkColumns.length > 1 ? { name: null, fields: toFields(pkColumns) } : null,
                uniqueFields: compoundUniques.map((u) => toFields(u.columns)),
                uniqueIndexes: compoundUniques.map((u) => ({ name: u.name, fields: toFields(u.columns) })),
                isGenerated: false
            };
            if (modelAnnotation?.doc) out.documentation = modelAnnotation.doc;
            models.push({ raw: rawName, value: out as unknown as DMMF.Model });
        }
    }

    const enums: { raw: string; value: DMMF.DatamodelEnum }[] = [];
    for (const [nsId, ns] of namespaces) {
        for (const [rawName, contractEnum] of Object.entries(ns.enum ?? {})) {
            const out: Record<string, unknown> = {
                name: enumName(nsId, rawName),
                values: contractEnum.members.map((m) => ({ name: m.name, dbName: m.value === m.name ? null : String(m.value) })),
                dbName: null
            };
            const doc = annotations.get(rawName)?.doc;
            if (doc) out.documentation = doc;
            enums.push({ raw: rawName, value: out as unknown as DMMF.DatamodelEnum });
        }
    }
    for (const storageEnum of storageEnums) {
        const values = storageEnum.valueSet?.values ?? storageEnum.nativeEnum?.members ?? [];
        const typeName = storageEnum.nativeEnum?.typeName;
        const out: Record<string, unknown> = {
            name: enumName(storageEnum.nsId, storageEnum.name),
            values: values.map((raw) => {
                const value = String(raw);
                const name = memberName(value);
                return { name, dbName: name === value ? null : value };
            }),
            dbName: typeName && typeName !== storageEnum.name ? typeName : null
        };
        const doc = annotations.get(storageEnum.name)?.doc;
        if (doc) out.documentation = doc;
        enums.push({ raw: storageEnum.name, value: out as unknown as DMMF.DatamodelEnum });
    }

    const types: { raw: string; value: DMMF.Model }[] = [];
    for (const [nsId, ns] of namespaces) {
        for (const [rawName, valueObject] of Object.entries(valueObjectsOf(ns))) {
            const voAnnotation = annotations.get(rawName);
            const fields = Object.entries(valueObject.fields ?? {}).map(([fieldName, field]) => buildField(fieldName, field as Field, nsId, undefined, voAnnotation?.fields.get(fieldName)));
            const out: Record<string, unknown> = {
                name: valueObjectName(nsId, rawName),
                dbName: null,
                schema: null,
                fields: orderFields(fields, voAnnotation?.fields),
                primaryKey: null,
                uniqueFields: [],
                uniqueIndexes: [],
                isGenerated: false
            };
            if (voAnnotation?.doc) out.documentation = voAnnotation.doc;
            types.push({ raw: rawName, value: out as unknown as DMMF.Model });
        }
    }

    // `contract.json` sorts entries alphabetically; the PSL annotation map is in declaration order (the order
    // Prisma 5-7 DMMF follows), so use it when PSL sources were read.
    const pslOrder = [...annotations.keys()];
    return { models: sortByPslOrder(models, pslOrder), enums: sortByPslOrder(enums, pslOrder), types: sortByPslOrder(types, pslOrder), indexes: [] };
}
