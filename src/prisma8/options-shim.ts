import path from 'node:path';
import { applyConfigFile, type LoadedConfigFile } from '../config-loader';
import type { GeneratorOptions, RawGeneratorConfig, ScalarOverride } from '../types';
import { PRISMA8_MODE_KEY, type SyntheticDatamodel } from './types';

/**
 * D3 transport types: in Prisma 8 mode (class/interface output) `Decimal` defaults to `string`
 * (Prisma 8's own application type) and `Json` to `JsonValue` from `@prisma/orm-framework`, so
 * no generated file imports `@prisma/client`. Each key yields to a user-defined `extraScalars` entry.
 */
export const PRISMA8_DEFAULT_EXTRA_SCALARS: Readonly<Record<string, ScalarOverride>> = Object.freeze({
    // Prisma 8 reads numeric columns as strings; `decimal` replaces the Prisma 5–7 `Decimal.js` format.
    Decimal: { ts: 'string', format: 'decimal' },
    // `JsonValue` is a type-only export, so it is imported with `import type` and Swagger gets the
    // same `() => Object` the Prisma 5–7 mapping uses.
    Json: { ts: 'JsonValue', from: '@prisma/orm-framework/utils/json', apiType: '() => Object', typeOnly: true }
});

/**
 * D3 transport types for Zod output in Prisma 8 mode: Prisma 8 returns `Decimal` columns as strings,
 * so `Decimal` validates as `z.string()` (Prisma 5–7 Zod output uses `z.number()`). Overridable
 * through `extraScalars.Decimal.zod`. `ts: 'string'` makes Create schemas quote numeric defaults.
 */
export const PRISMA8_DEFAULT_ZOD_EXTRA_SCALARS: Readonly<Record<string, ScalarOverride>> = Object.freeze({
    Decimal: { ts: 'string', zod: 'z.string()' }
});

/** D3 defaults for an output type: {@link PRISMA8_DEFAULT_ZOD_EXTRA_SCALARS} for Zod, {@link PRISMA8_DEFAULT_EXTRA_SCALARS} otherwise. */
export function prisma8ScalarDefaults(outputType: unknown): Readonly<Record<string, ScalarOverride>> {
    return outputType === 'zod' ? PRISMA8_DEFAULT_ZOD_EXTRA_SCALARS : PRISMA8_DEFAULT_EXTRA_SCALARS;
}

export type BuildPrisma8OptionsArgs = {
    /** Synthetic datamodel produced by `contractToDatamodel`. */
    datamodel: SyntheticDatamodel;
    /** Output directory (absolute, or relative to `process.cwd()`). */
    output: string;
    /**
     * The user's config file, pre-loaded with `loadConfigFileFromPath`. It is merged here (through
     * `applyConfigFile`, with its directory so relative `from` paths resolve exactly as in Prisma 5–7)
     * instead of inside `generate()`; see the note on {@link buildPrisma8Options}.
     */
    configFile?: LoadedConfigFile | null;
    /** Base raw config (lowest precedence, below the config file). */
    rawConfig?: RawGeneratorConfig;
    /** First PSL file, or the `contract.json` path for TypeScript-authored contracts. */
    schemaPath: string;
    /** Values from CLI flags; highest precedence. */
    cliOverrides?: RawGeneratorConfig;
};

/** Parses an `extraScalars` raw value (JSON string or object) without validating entries. */
function parseRawExtraScalars(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        // Left to `Utility.parseExtraScalars`, which warns about it downstream.
        return {};
    }
}

/**
 * Merges the D3 `extraScalars` defaults ({@link prisma8ScalarDefaults}) under the user's own entries
 * (user keys win, per key).
 */
export function withPrisma8ScalarDefaults(config: RawGeneratorConfig): RawGeneratorConfig {
    const user = parseRawExtraScalars(config.extraScalars);
    return { ...config, extraScalars: JSON.stringify({ ...prisma8ScalarDefaults(config.outputType), ...user }) };
}

/**
 * Builds the `GeneratorOptions` that `generate()` expects, from a Prisma 8 contract, the same shape
 * Prisma 5–7 hand over through `@prisma/generator-helper` (and that `test/helpers/build-options.ts` fabricates).
 *
 * Precedence: `rawConfig` < config file < `cliOverrides`. Keys the user does not set stay absent so
 * `BaseGenerator` applies its usual defaults. `generator.config.prisma8 = 'true'` flags Prisma 8 mode.
 *
 * The config file is merged **here** and `configFile` is removed from the resulting config, so
 * `generate()`'s own `loadConfigFile`/`applyConfigFile` pass is a no-op. Letting `generate()` merge it
 * instead would make `applyConfigFile` overwrite the whole `extraScalars` value with the file's map,
 * dropping the D3 defaults the user did not override. Relative `from` paths still resolve against the
 * config file directory because `applyConfigFile` receives `configFile.dir`.
 */
export function buildPrisma8Options(args: BuildPrisma8OptionsArgs): GeneratorOptions {
    const fromFile = applyConfigFile({ ...(args.rawConfig ?? {}) }, args.configFile?.config ?? null, args.configFile?.dir);
    const merged: RawGeneratorConfig = { ...fromFile, ...(args.cliOverrides ?? {}) };
    delete merged.configFile;
    merged[PRISMA8_MODE_KEY] = 'true';
    const config = withPrisma8ScalarDefaults(merged);

    const output = path.resolve(args.output);
    const schemaPath = path.resolve(args.schemaPath);
    return {
        generator: {
            name: 'nestjsDTO',
            provider: { value: 'prisma-generator-nestjs-dto', fromEnvVar: null },
            output: { value: output, fromEnvVar: null },
            config,
            binaryTargets: [],
            previewFeatures: [],
            sourceFilePath: schemaPath
        },
        dmmf: {
            datamodel: {
                models: args.datamodel.models,
                enums: args.datamodel.enums,
                types: args.datamodel.types,
                indexes: args.datamodel.indexes
            },
            schema: {},
            mappings: {}
        },
        schemaPath,
        datasources: [],
        otherGenerators: [],
        version: 'prisma8',
        datamodel: ''
    } as unknown as GeneratorOptions;
}
