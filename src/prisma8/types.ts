/**
 * Shared types for the Prisma ORM 8 adapter (`src/prisma8/*`).
 *
 * Prisma 8 ("Prisma Next") has no `prisma generate`, no `generator` block and no DMMF. The
 * adapter reads the `contract.json` written by `prisma contract emit` (plus the `///` doc
 * comments recovered from the PSL sources) and produces a DMMF-shaped datamodel so that
 * `generate()`, `BaseGenerator` and every sub-generator run unchanged. See `docs/prisma-8-plan.md`.
 *
 * The contract types below are intentionally partial: they describe only the parts of
 * `contract.json` (schemaVersion "1") that the adapter reads.
 */
import type { DMMF } from '@prisma/generator-helper';

// ---------------------------------------------------------------------------
// contract.json (schemaVersion "1")
// ---------------------------------------------------------------------------

/** A reference to a domain entity (enum, value object) from a field's `valueSet`. */
export type ContractValueSetRef = {
    entityKind: 'enum' | string;
    entityName: string;
    namespaceId: string;
    plane: 'domain' | string;
};

/** Field type as written in `domain.namespaces.<ns>.models.<Model>.fields.<field>.type`. */
export type ContractFieldType = {
    /** Codec id such as `pg/text@1`, `sql/varchar@1`, `pg/numeric@1`. Present for scalars. */
    codecId?: string;
    /** `'scalar'` for codec-backed columns, `'valueObject'` for inline `type` blocks. */
    kind: 'scalar' | 'valueObject' | string;
    /** Codec parameters (e.g. `{ length: 255 }` for `sql/varchar@1`, `{ precision, scale }` for numeric). */
    typeParams?: Record<string, unknown>;
    /** Name of the referenced value object when `kind === 'valueObject'`. */
    name?: string;
    /** Namespace of the referenced value object when `kind === 'valueObject'`. */
    namespace?: string;
};

export type ContractDomainField = {
    nullable: boolean;
    type: ContractFieldType;
    /** Present when the scalar is constrained to an enum. */
    valueSet?: ContractValueSetRef;
};

export type ContractRelation = {
    /** `'N:1'` on the owning (FK) side, `'1:N'` on the back-relation side. `'1:1'` also exists. */
    cardinality: 'N:1' | '1:N' | '1:1' | string;
    on: { localFields: string[]; targetFields: string[] };
    to: { model: string; namespace: string };
};

export type ContractDomainModel = {
    fields: Record<string, ContractDomainField>;
    relations?: Record<string, ContractRelation>;
    storage?: {
        fields: Record<string, { column: string }>;
        namespaceId: string;
        table: string;
    };
    /** Present when the model inherits from another through `@@base`. Out of scope for 0.3.0. */
    base?: unknown;
};

export type ContractEnumMember = { name: string; value: string | number };

export type ContractEnum = {
    codecId?: string;
    members: ContractEnumMember[];
};

/** Inline `type` block (value object). Fields use the same shape as model fields. */
export type ContractValueObject = {
    fields: Record<string, ContractDomainField>;
};

export type ContractDomainNamespace = {
    models: Record<string, ContractDomainModel>;
    enum?: Record<string, ContractEnum>;
    /** Value objects (`type` blocks). Key name may vary between RCs; the adapter feature-detects it. */
    valueObjects?: Record<string, ContractValueObject>;
    types?: Record<string, ContractValueObject>;
};

export type ContractColumnDefault = { kind: 'function'; expression: string } | { kind: 'literal'; value: unknown } | { kind: string; [key: string]: unknown };

export type ContractColumn = {
    codecId: string;
    dataType: string;
    nullable: boolean;
    default?: ContractColumnDefault;
};

export type ContractTable = {
    columns: Record<string, ContractColumn>;
    primaryKey?: { columns: string[] };
    uniques?: { columns: string[]; name?: string }[];
    indexes?: { columns: string[]; name: string; unique: boolean }[];
    foreignKeys?: {
        source: { columns: string[]; namespaceId: string; tableName: string };
        target: { columns: string[]; namespaceId: string; tableName: string };
    }[];
};

export type ContractStorageNamespace = {
    id: string;
    kind: string;
    entries: {
        table: Record<string, ContractTable>;
        valueSet?: Record<string, unknown>;
    };
};

export type Prisma8Contract = {
    schemaVersion: string;
    targetFamily: 'sql' | 'mongo' | string;
    target: 'postgres' | 'sqlite' | string;
    roots?: Record<string, { model: string; namespace: string }>;
    domain: { namespaces: Record<string, ContractDomainNamespace> };
    storage: { namespaces: Record<string, ContractStorageNamespace> };
};

// ---------------------------------------------------------------------------
// Annotations recovered from the PSL sources (contract.json drops `///` comments)
// ---------------------------------------------------------------------------

export type FieldAnnotations = {
    /** Joined `///` text above the field, undefined when absent. */
    doc?: string;
    /** Field type exactly as written in PSL (`VarChar(255)?`, `Post[]`, `temporal.updatedAt()`). */
    writtenType?: string;
    /** `true` when the written type ends with `[]`. */
    isList: boolean;
    /** `true` when the written type is `temporal.updatedAt()`. */
    isUpdatedAt: boolean;
};

export type ModelAnnotations = {
    /** Joined `///` text above the model/type/enum block, undefined when absent. */
    doc?: string;
    fields: Map<string, FieldAnnotations>;
};

/** Keyed by model name (also value-object and enum names). */
export type AnnotationMap = Map<string, ModelAnnotations>;

// ---------------------------------------------------------------------------
// Adapter output
// ---------------------------------------------------------------------------

/** DMMF-shaped datamodel consumed by `BaseGenerator` through `options.dmmf.datamodel`. */
export type SyntheticDatamodel = {
    models: DMMF.Model[];
    enums: DMMF.DatamodelEnum[];
    /** Value objects (Prisma 8 `type` blocks), emitted as nested DTOs. Same shape as models. */
    types: DMMF.Model[];
    indexes: DMMF.Index[];
};

export type ContractToDatamodelOptions = {
    /** Annotations from `psl-annotations.ts`; empty map when PSL sources are unavailable. */
    annotations?: AnnotationMap;
    /**
     * Keys of the user's `extraScalars` config. A codec id listed here is passed through as the
     * field `type` (so the existing override lookup resolves it) instead of becoming `Unsupported`.
     */
    scalarOverrideKeys?: Iterable<string>;
    /** Warning sink; defaults to `Utility.warn`. */
    warn?: (message: string) => void;
};

/** Result of locating the contract on disk (see `contract-reader.ts`). */
export type ContractLocation = {
    /** Absolute path of `contract.json`. */
    jsonPath: string;
    /** Directory containing `contract.json`. */
    dir: string;
    /** Absolute paths of the PSL sources (`*.prisma`) that produced the contract, if any. */
    pslFiles: string[];
};

/** Config key that flags Prisma 8 mode to the generators (`generator.config.prisma8 === 'true'`). */
export const PRISMA8_MODE_KEY = 'prisma8';

// ---------------------------------------------------------------------------
// Phase 1 additions (codec map / contract-to-dmmf). Additive only.
// ---------------------------------------------------------------------------

/**
 * Optional `contract.json` facts the adapter reads on top of the base shapes above. They exist in
 * rc.18 (`@prisma/orm-framework` `ContractField.many`, `ContractToOneRelation.nullable`,
 * `ContractModelBase.discriminator`/`variants`, `execution.mutations.defaults`) but are typed
 * separately so the shared shapes stay untouched.
 */
export type ContractFieldExtras = {
    /** Present (non-false) when the field is a list (`String[]`). */
    many?: false | { elementNullable: boolean };
    /** `true` for dictionary-valued fields. */
    dict?: true;
};

/** `kind: 'union'` field type (`String | Int`). Not representable in DMMF; emitted as `Unsupported`. */
export type ContractUnionFieldType = { kind: 'union'; members: ContractFieldType[] };

export type ContractRelationExtras = {
    /** To-one relations record whether the related row may be absent (`author User?`). */
    nullable?: boolean;
    /** Present on `N:M` relations (implicit join table). */
    through?: { table: string; namespaceId: string; parentColumns: string[]; childColumns: string[]; targetColumns: string[] };
};

export type ContractModelExtras = {
    discriminator?: { field: string };
    variants?: Record<string, { model: string; namespace: string }>;
};

/** Generator-based default (`uuid()`, `cuid()`, `temporal.updatedAt()` …) from `execution.mutations.defaults`. */
export type ContractExecutionMutationDefault = {
    ref: { namespace: string; entry: string; field: string };
    onCreate?: { kind: 'generator' | string; id: string; params?: Record<string, unknown> };
    onUpdate?: { kind: 'generator' | string; id: string; params?: Record<string, unknown> };
};

export type ContractExecution = {
    mutations?: { defaults?: ContractExecutionMutationDefault[] };
};

/** Result of `resolveScalar` (`codec-map.ts`). `nativeType` uses DMMF's string-parameter tuple. */
export type ResolvedScalar = {
    type: string;
    kind: 'scalar' | 'enum' | 'object' | 'unsupported';
    nativeType: [string, string[]] | null;
};

export type ResolveScalarOptions = {
    /** Codec ids (or any keys) present in the user's `extraScalars`; see `ContractToDatamodelOptions`. */
    scalarOverrideKeys?: Iterable<string>;
    /** Warning sink; defaults to `Utility.warn`. */
    warn?: (message: string) => void;
    /** Codec ids already warned about. Pass a shared set to warn once per codec across calls. */
    warnedCodecs?: Set<string>;
};
