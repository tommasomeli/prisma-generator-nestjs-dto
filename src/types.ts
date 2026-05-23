import type { GeneratorOptions as PrismaGeneratorOptions } from '@prisma/generator-helper';

export type NamingStrategy = 'camel' | 'snake' | 'kebab';

export type OutputType = 'class' | 'interface';

export type OutputStructure = 'nestjs' | 'flat';

export type File = {
    path: string;
    content: string;
};

export type Annotation = {
    name: string;
    params: any;
};

/**
 * Pipeline-internal field representation. Mirrors the relevant subset of
 * `DMMF.Field` plus parsed annotations. We deliberately do not extend the
 * Prisma DMMF type because newer versions are deeply readonly and that
 * conflicts with the mutation patterns of sub-generators.
 */
export type Field = {
    name: string;
    type: string;
    kind?: 'scalar' | 'object' | 'enum' | 'unsupported';
    isList: boolean;
    isRequired: boolean;
    isUnique: boolean;
    isId: boolean;
    isReadOnly: boolean;
    isGenerated?: boolean;
    isUpdatedAt?: boolean;
    hasDefaultValue: boolean;
    default?: any;
    relationName?: string;
    relationFromFields?: readonly string[] | string[];
    relationToFields?: readonly string[] | string[];
    relationOnDelete?: string;
    documentation?: string | null;
    annotations: Annotation[];
    isNullable?: boolean;
};

/** Pipeline-internal model representation. See `Field` for rationale. */
export type Model = {
    name: string;
    dbName?: string | null;
    fields: Field[];
    documentation?: string | null;
    primaryKey?: any;
    uniqueFields?: readonly (readonly string[])[] | string[][];
    uniqueIndexes?: any;
    isGenerated?: boolean;
    annotations: Annotation[];
    outputType?: OutputType;
};

/**
 * Override descriptor for a single Prisma scalar (`String`, `Int`, `Decimal`, ...).
 * Applied by the built-in DTO generators when rendering field types, Swagger
 * `@ApiProperty({ type })`, and Swagger `format`. `from` is automatically emitted
 * as a top-level import in every file that references the overridden type.
 *
 * @example
 * ```ts
 * extraScalars: {
 *   Decimal: { ts: 'Decimal', from: 'decimal.js' },
 *   Json:    { ts: 'MyJson', from: 'src/json', apiType: 'Object' }
 * }
 * ```
 */
export type ScalarOverride = {
    /** TypeScript type used in field declarations (`field: ts;`). */
    ts: string;
    /** Module specifier the `ts` symbol is imported from. Omit for ambient/global types. */
    from?: string;
    /** TypeScript expression used in `@ApiProperty({ type: ... })`. Defaults to `ts`. */
    apiType?: string;
    /** Value passed to `@ApiProperty({ format })`. Omit to inherit / drop the default. */
    format?: string;
};

/** Enriched config exposed to sub-generators after parsing the raw Prisma config. */
export type GeneratorConfig = {
    provider: string;
    output: string;
    outputType: OutputType;
    outputStructure: OutputStructure;
    reExport: boolean;
    fileNamingStrategy: NamingStrategy;
    classValidator: boolean;
    swaggerDocs: boolean;
    prettier: boolean;
    schemaDir?: string;
    emitManifest: boolean;
    extraDecorators: ImportType[];
    extraValidators: ImportType[];
    extraImports: ImportType[];
    extraGenerators?: string | string[];
    /** Prisma scalar overrides (TS type + optional import + optional Swagger metadata). */
    extraScalars: Record<string, ScalarOverride>;
    /**
     * Names of user-defined annotations that custom sub-generators want to react to.
     * The base parser still emits any `@Name` it finds in `///` comments, so registering
     * an annotation here is documentation-and-discovery (e.g. for plugins to iterate over).
     */
    extraAnnotations: string[];
};

/**
 * Type passed to `BaseGenerator` and to the `generate()` entry point. We keep
 * it identical to Prisma's `GeneratorOptions` so consumers can pass DMMF results
 * directly without casts.
 */
export type GeneratorOptions = PrismaGeneratorOptions;

export interface ImportType {
    from: string;
    alias?: string;
    destruct?: string[];
}

/** Raw map representation of `options.generator.config` as produced by Prisma. */
export type RawGeneratorConfig = Record<string, string | string[] | undefined>;

/**
 * Type-safe descriptor for an external module import. Equivalent to writing the import
 * statement as a string but enforced by TypeScript: misspelled names and missing paths
 * become compile-time errors when used together with the {@link fromModule} helper.
 */
export type ImportDescriptor = {
    from: string;
    names?: readonly (string | { name: string; as: string })[];
    default?: string;
    namespace?: string;
};

/**
 * Accepted forms for any `extra*` field in {@link GeneratorConfigFile}. Lets users pick
 * between the compact inline syntax (`"Name:path|Other:path2"`), the structured
 * {@link ImportDescriptor} shape, and the type-safe `from()` / `fromNamespace()` /
 * `fromDefault()` helpers (which return descriptors).
 */
export type ExtraImportConfig = string | string[] | ImportDescriptor | ImportDescriptor[];

/**
 * Shape of the object returned by an external configuration file referenced from
 * `schema.prisma` via the `configFile` option. Every field is optional and overrides
 * the value declared in the schema.
 *
 * @example
 * ```ts
 * import { from, fromNamespace, type GeneratorConfigFile } from '@tommasomeli/prisma-generator-nestjs-dto';
 *
 * export default {
 *   extraValidators: from(() => import('src/common/validators'), ['IsUnique', 'IsStrongPassword']),
 *   extraImports: [
 *     fromNamespace('src/common/constants', 'CONSTANTS'),
 *     from('src/users/user.fixtures', 'USER_EXAMPLE')
 *   ]
 * } satisfies GeneratorConfigFile;
 * ```
 */
export type GeneratorConfigFile = {
    outputType?: OutputType;
    outputStructure?: OutputStructure;
    reExport?: boolean;
    fileNamingStrategy?: NamingStrategy;
    classValidator?: boolean;
    swaggerDocs?: boolean;
    prettier?: boolean;
    schemaDir?: string;
    emitManifest?: boolean;
    extraDecorators?: ExtraImportConfig;
    extraValidators?: ExtraImportConfig;
    extraImports?: ExtraImportConfig;
    extraGenerators?: ExtraImportConfig;
    /**
     * Per-scalar overrides. The key is the Prisma scalar name (`'Decimal'`, `'Json'`, ...);
     * the value is a {@link ScalarOverride} describing the TS type, optional import, and
     * optional Swagger metadata. Only available from the external `configFile` since the
     * `schema.prisma` generator block cannot express nested objects.
     */
    extraScalars?: Record<string, ScalarOverride>;
    /**
     * Custom annotation names that downstream sub-generators recognise. Plain strings
     * (one or many) — no imports needed, since annotations live in Prisma `///` comments.
     * Consumed by plugins via `BaseGenerator.getAnnotation(field, name)` /
     * `BaseGenerator.hasAnnotation(field, name)`, or via the exposed `config.extraAnnotations`.
     */
    extraAnnotations?: string | string[];
};
