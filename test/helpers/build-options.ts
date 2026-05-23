import type { DMMF } from '@prisma/generator-helper';
import type { GeneratorOptions, RawGeneratorConfig } from '../../src/types';

type ModelInput = {
    name: string;
    documentation?: string;
    fields: FieldInput[];
};

type FieldInput = {
    name: string;
    type: string;
    kind?: 'scalar' | 'object' | 'enum';
    isList?: boolean;
    isRequired?: boolean;
    isUnique?: boolean;
    isId?: boolean;
    isReadOnly?: boolean;
    isUpdatedAt?: boolean;
    hasDefaultValue?: boolean;
    default?: unknown;
    relationFromFields?: string[];
    documentation?: string;
};

/** Builds a `DMMF.Field`-shaped object from a minimal input description. */
function makeField(input: FieldInput): DMMF.Field {
    return {
        name: input.name,
        type: input.type,
        kind: (input.kind || 'scalar') as DMMF.Field['kind'],
        isList: Boolean(input.isList),
        isRequired: input.isRequired !== false,
        isUnique: Boolean(input.isUnique),
        isId: Boolean(input.isId),
        isReadOnly: Boolean(input.isReadOnly),
        isUpdatedAt: Boolean(input.isUpdatedAt),
        hasDefaultValue: Boolean(input.hasDefaultValue),
        default: input.default,
        relationFromFields: input.relationFromFields,
        documentation: input.documentation
    } as DMMF.Field;
}

/** Builds a `DMMF.Model`-shaped object from a minimal input description. */
function makeModel(input: ModelInput): DMMF.Model {
    return {
        name: input.name,
        documentation: input.documentation,
        fields: input.fields.map(makeField),
        primaryKey: null,
        uniqueFields: [],
        uniqueIndexes: [],
        dbName: null
    } as unknown as DMMF.Model;
}

/**
 * Creates a `GeneratorOptions` object suitable for instantiating a sub-generator
 * in a test. Provider/output default to plausible values; `config` is merged with
 * sensible defaults so tests only have to declare what they exercise.
 */
export function buildOptions(args: { models: ModelInput[]; config?: RawGeneratorConfig; output?: string }): GeneratorOptions {
    const models = args.models.map(makeModel);
    return {
        generator: {
            name: 'nestjsDTO',
            provider: { value: 'prisma-generator-nestjs-dto', fromEnvVar: null },
            output: { value: args.output || '/tmp/generated', fromEnvVar: null },
            config: {
                outputType: 'class',
                outputStructure: 'nestjs',
                fileNamingStrategy: 'kebab',
                reExport: 'true',
                classValidator: 'true',
                swaggerDocs: 'true',
                prettier: 'false',
                ...(args.config || {})
            },
            binaryTargets: [],
            previewFeatures: [],
            sourceFilePath: '/tmp/schema.prisma'
        },
        dmmf: {
            datamodel: {
                models,
                enums: [],
                types: [],
                indexes: []
            },
            schema: {} as any,
            mappings: {} as any,
            datasources: []
        } as any,
        schemaPath: '/tmp/schema.prisma',
        datasources: [],
        otherGenerators: [],
        version: 'test',
        datamodel: ''
    } as unknown as GeneratorOptions;
}
