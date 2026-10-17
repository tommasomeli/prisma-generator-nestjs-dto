import { Utility } from '../utility';
import type { ContractColumn, ContractDomainField, ResolvedScalar, ResolveScalarOptions } from './types';

/**
 * One row of the codec table: the Prisma scalar the codec maps to and how to derive the DMMF
 * `nativeType` tuple (string parameters, exactly as DMMF emits `@db.VarChar(255)` → `['VarChar', ['255']]`).
 */
export type CodecMapping = {
    scalar: string;
    nativeType: (params: Record<string, unknown>) => [string, string[]] | null;
};

const none = (): null => null;
const fixed =
    (name: string) =>
    (): [string, string[]] =>
        [name, []];
/** Native type with the listed `typeParams` keys as positional args (missing keys stop the list). */
const withParams =
    (name: string, keys: string[], nullWhenEmpty = false) =>
    (params: Record<string, unknown>): [string, string[]] | null => {
        const args: string[] = [];
        for (const key of keys) {
            if (params[key] === undefined || params[key] === null) break;
            args.push(String(params[key]));
        }
        return nullWhenEmpty && args.length === 0 ? null : [name, args];
    };

const map = (scalar: string, nativeType: CodecMapping['nativeType'] = none): CodecMapping => ({ scalar, nativeType });

/**
 * PostgreSQL (and shared `sql/*`) codecs, per `docs/prisma-8-plan.md` §3. Codec ids verified against
 * `@prisma/orm-postgres@8.0.0-rc.18`.
 */
export const POSTGRES_CODECS: Readonly<Record<string, CodecMapping>> = {
    // Strings
    'pg/text@1': map('String'),
    'sql/text@1': map('String'),
    'pg/text-array@1': map('String'),
    'sql/varchar@1': map('String', withParams('VarChar', ['length'])),
    'pg/varchar@1': map('String', withParams('VarChar', ['length'])),
    'sql/char@1': map('String', withParams('Char', ['length'])),
    'pg/char@1': map('String', withParams('Char', ['length'])),
    'pg/uuid@1': map('String', fixed('Uuid')),
    'pg/inet@1': map('String', fixed('Inet')),
    'pg/bit@1': map('String', withParams('Bit', ['length'])),
    'pg/varbit@1': map('String', withParams('VarBit', ['length'])),
    'pg/interval@1': map('String', withParams('Interval', ['precision'])),
    'pg/time-string@1': map('String', withParams('Time', ['precision'])),
    'pg/time-temporal@1': map('String', withParams('Time', ['precision'])),
    'pg/timetz@1': map('String', withParams('Timetz', ['precision'])),
    'pg/date-string@1': map('String', fixed('Date')),
    'pg/timestamp-string@1': map('String', withParams('Timestamp', ['precision'])),
    'pg/timestamptz-string@1': map('String', withParams('Timestamptz', ['precision'])),
    // Native enum without a `valueSet` reference (should not happen; enum fields resolve through `valueSet`).
    'pg/enum@1': map('String'),
    // Booleans
    'pg/bool@1': map('Boolean'),
    // Integers
    'pg/int2@1': map('Int', fixed('SmallInt')),
    'pg/int4@1': map('Int'),
    'pg/int@1': map('Int'),
    'sql/int@1': map('Int'),
    'pg/int8number@1': map('Int', fixed('BigIntNumber')),
    'pg/int8@1': map('BigInt'),
    'pg/unboundedint@1': map('BigInt', fixed('UnboundedInt')),
    // Floats / decimals
    'pg/float4@1': map('Float', fixed('Real')),
    'pg/float8@1': map('Float'),
    'pg/float@1': map('Float'),
    'sql/float@1': map('Float'),
    'pg/numeric@1': map('Decimal', withParams('Decimal', ['precision', 'scale'], true)),
    // Date/time. `pg/timestamptz-temporal@1` is the default storage of PSL `DateTime`, so it maps to
    // `nativeType: null` (the "no @db attribute" case) unless a precision is given.
    'pg/timestamptz-temporal@1': map('DateTime', withParams('Timestamptz', ['precision'], true)),
    'pg/timestamptz-date@1': map('DateTime', withParams('Timestamptz', ['precision'], true)),
    'pg/timestamp-temporal@1': map('DateTime', withParams('Timestamp', ['precision'])),
    'pg/date-temporal@1': map('DateTime', fixed('Date')),
    // JSON / binary
    'pg/json@1': map('Json', fixed('Json')),
    'pg/jsonb@1': map('Json', fixed('JsonB')),
    'pg/bytea@1': map('Bytes')
};

/**
 * SQLite codecs.
 *
 * TODO(prisma8): no `@prisma/orm-sqlite` package is installed in `examples/prisma8-nestjs`, so the
 * `sqlite/*` codec ids could not be verified. Shared `sql/*` codecs resolve through
 * `POSTGRES_CODECS`; add `sqlite/*` rows here once a SQLite contract is available.
 */
export const SQLITE_CODECS: Readonly<Record<string, CodecMapping>> = {};

/**
 * MongoDB codecs.
 *
 * TODO(prisma8): MongoDB is early access and its package is not installed in the example; `mongo/*`
 * codec ids (ObjectId, embedded documents) are not mapped yet and fall back to `Unsupported`.
 */
export const MONGO_CODECS: Readonly<Record<string, CodecMapping>> = {};

/** Every known codec, keyed by codec id. */
export const CODEC_MAP: Readonly<Record<string, CodecMapping>> = { ...POSTGRES_CODECS, ...SQLITE_CODECS, ...MONGO_CODECS };

/** Strips the `@<version>` suffix of a codec id (`pg/vector@1` → `pg/vector`). */
const codecBaseName = (codecId: string): string => codecId.replace(/@\d+$/, '');

/**
 * Resolves the DMMF `type` / `kind` / `nativeType` of a contract domain field.
 *
 * - enum-constrained fields (`valueSet.entityKind === 'enum'`) → `{ kind: 'enum', type: <enum name> }`;
 * - value-object fields → `{ kind: 'object', type: <value object name> }`;
 * - known codecs → the Prisma scalar of the codec table (§3), `typeParams` driving `nativeType`;
 * - unknown codecs → `Unsupported` with `nativeType: [dataType, []]` (warned once per codec), unless the
 *   codec id is one of `options.scalarOverrideKeys`, in which case the codec id itself becomes the
 *   scalar `type` so the `extraScalars[field.type]` lookup in `BaseGenerator` resolves it.
 *
 * @param field Domain field (`domain.namespaces.<ns>.models.<Model>.fields.<name>`).
 * @param column Storage column backing the field, if any (absent for value-object members).
 * @param options Override keys, warning sink and the shared "already warned" set.
 * @return The resolved type information.
 */
export function resolveScalar(field: ContractDomainField, column: ContractColumn | undefined, options: ResolveScalarOptions = {}): ResolvedScalar {
    if (field.valueSet && field.valueSet.entityKind === 'enum') return { type: field.valueSet.entityName, kind: 'enum', nativeType: null };
    const fieldType = field.type;
    if (fieldType.kind === 'valueObject' && fieldType.name) return { type: fieldType.name, kind: 'object', nativeType: null };

    const warn = options.warn ?? ((message: string) => Utility.warn(message));
    const warned = options.warnedCodecs ?? new Set<string>();
    const codecId = fieldType.codecId ?? column?.codecId;
    if (fieldType.kind !== 'scalar' || !codecId) {
        const key = `kind:${fieldType.kind}`;
        if (!warned.has(key)) {
            warned.add(key);
            warn(`Prisma 8 field type kind "${fieldType.kind}" is not supported; emitting it as Unsupported.`);
        }
        return { type: 'Unsupported', kind: 'unsupported', nativeType: [column?.dataType ?? String(fieldType.kind), []] };
    }

    const mapping = CODEC_MAP[codecId];
    if (mapping) {
        const params = { ...((column as (ContractColumn & { typeParams?: Record<string, unknown> }) | undefined)?.typeParams), ...fieldType.typeParams };
        return { type: mapping.scalar, kind: 'scalar', nativeType: mapping.nativeType(params) };
    }

    const dataType = column?.dataType ?? codecBaseName(codecId);
    const overrideKeys = new Set(options.scalarOverrideKeys ?? []);
    if (overrideKeys.has(codecId)) return { type: codecId, kind: 'scalar', nativeType: [dataType, []] };
    if (!warned.has(codecId)) {
        warned.add(codecId);
        warn(`Unknown Prisma 8 codec "${codecId}"; emitting it as Unsupported. Add "${codecId}" to extraScalars to map it to a TypeScript type.`);
    }
    return { type: 'Unsupported', kind: 'unsupported', nativeType: [dataType, []] };
}
