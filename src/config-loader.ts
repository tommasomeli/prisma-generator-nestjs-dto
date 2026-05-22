import fs from 'node:fs';
import path from 'node:path';
import { ExtraImportConfig, GeneratorConfigFile, GeneratorOptions, ImportDescriptor, RawGeneratorConfig } from './types';
import { Utility } from './utility';

/** Keys whose values support {@link ImportDescriptor} forms and need serialization. */
const EXTRA_IMPORT_KEYS = new Set(['extraDecorators', 'extraValidators', 'extraImports', 'extraGenerators']);

/** File extensions handled directly by Node's `require` without a TS loader. */
const NATIVE_EXTS = new Set(['.js', '.cjs', '.mjs', '.json']);

/** Extensions requiring a TypeScript-aware loader (jiti). */
const TS_EXTS = new Set(['.ts', '.cts', '.mts']);

/**
 * Resolves the `configFile` option from `schema.prisma` to an absolute filesystem path.
 * The value is interpreted relative to the schema file when possible, falling back to
 * the current working directory so users running `prisma generate` from anywhere still work.
 */
function resolveConfigFilePath(value: string, options: GeneratorOptions): string | null {
    if (path.isAbsolute(value)) return fs.existsSync(value) ? value : null;
    const candidates: string[] = [];
    const schemaPath = (options as { schemaPath?: string }).schemaPath;
    if (schemaPath) {
        // Prisma 7 multi-file schemas point `schemaPath` to a directory; single-file schemas
        // point to the `.prisma` file. Resolve `value` against the directory in both cases.
        let schemaDir = path.dirname(schemaPath);
        try {
            if (fs.statSync(schemaPath).isDirectory()) schemaDir = schemaPath;
        } catch {
            // schemaPath does not exist on disk; fall back to dirname semantics.
        }
        candidates.push(path.resolve(schemaDir, value));
    }
    candidates.push(path.resolve(process.cwd(), value));
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/** Dynamically imports a file using a TypeScript-aware loader. */
async function importWithJiti(filePath: string): Promise<unknown> {
    const { createJiti } = await import('jiti');
    const jiti = createJiti(filePath, { interopDefault: true, moduleCache: false });
    return jiti.import(filePath, { default: true });
}

/** Extracts the configuration object from a module. Accepts both `export default` and named `config`. */
function pickConfig(mod: unknown): GeneratorConfigFile | null {
    if (!mod || typeof mod !== 'object') return null;
    const candidate = (mod as { default?: unknown }).default ?? (mod as { config?: unknown }).config ?? mod;
    if (!candidate || typeof candidate !== 'object') return null;
    return candidate as GeneratorConfigFile;
}

/**
 * Result of {@link loadConfigFile}: the parsed configuration object and the absolute
 * directory of the file it came from. The directory is used downstream to resolve
 * relative `from` paths declared inside the config file.
 */
export type LoadedConfigFile = {
    config: GeneratorConfigFile;
    dir: string;
    file: string;
};

/**
 * Loads the configuration object referenced by `configFile`. Returns `null` when the
 * option is unset or the file fails to load; all error paths are logged and non-fatal
 * so misconfigurations never crash `prisma generate`.
 */
export async function loadConfigFile(options: GeneratorOptions): Promise<LoadedConfigFile | null> {
    const rawConfig = options.generator.config as RawGeneratorConfig;
    const configFile = typeof rawConfig.configFile === 'string' ? rawConfig.configFile : undefined;
    if (!configFile) return null;

    const resolved = resolveConfigFilePath(configFile, options);
    if (!resolved) {
        Utility.error(`configFile not found: ${configFile}`);
        return null;
    }
    const ext = path.extname(resolved).toLowerCase();
    try {
        let mod: unknown;
        if (TS_EXTS.has(ext)) {
            mod = await importWithJiti(resolved);
        } else if (NATIVE_EXTS.has(ext)) {
            delete require.cache[resolved];
            mod = require(resolved);
        } else {
            Utility.error(`Unsupported configFile extension: ${ext}`);
            return null;
        }
        const config = pickConfig(mod);
        if (!config) {
            Utility.error(`configFile ${resolved} did not export a configuration object`);
            return null;
        }
        Utility.log(`Loaded configFile from ${resolved}`);
        return { config, dir: path.dirname(resolved), file: resolved };
    } catch (error) {
        Utility.error(`Failed to load configFile ${resolved}:`, error);
        return null;
    }
}

/** Type guard: detects the structured form `{ from, names?, default?, namespace? }`. */
function isImportDescriptor(value: unknown): value is ImportDescriptor {
    return typeof value === 'object' && value !== null && typeof (value as ImportDescriptor).from === 'string';
}

/** Detects relative `from` paths that should be resolved against the config file directory. */
function isRelativePath(value: string): boolean {
    return value.startsWith('./') || value.startsWith('../');
}

/**
 * Resolves a `from` value: relative paths (`./x`, `../x`) become absolute, anchored at the
 * config file directory; everything else (bare specifiers, aliases, absolute paths) is left untouched.
 */
function resolveFrom(from: string, configFileDir?: string): string {
    if (!configFileDir || !isRelativePath(from)) return from;
    return path.resolve(configFileDir, from);
}

/**
 * Rewrites relative paths embedded in a raw inline-syntax string so they become
 * absolute, anchored at the config file directory. Each `|`-separated group is parsed
 * as `<names>:<path>`; only paths starting with `./` or `../` are rewritten.
 */
function rewriteRelativeInline(statement: string, configFileDir?: string): string {
    if (!configFileDir) return statement;
    return statement
        .split('|')
        .map((group) => {
            const idx = group.lastIndexOf(':');
            if (idx === -1) return group;
            const fromPath = group.substring(idx + 1).trim();
            if (!isRelativePath(fromPath)) return group;
            return `${group.substring(0, idx)}:${path.resolve(configFileDir, fromPath)}`;
        })
        .join('|');
}

/**
 * Serializes an {@link ImportDescriptor} into the inline `Name:path` syntax that
 * {@link Utility.parseImports} consumes downstream. Default + named combinations become
 * two `|`-joined groups (`default as Foo:path|Bar,Baz:path`); rename aliases collapse to
 * the local name since the generator only uses local names for annotation matching and
 * destruct emission. When `configFileDir` is provided, relative paths are resolved
 * against it so the resulting absolute path can later be rewritten per output file.
 */
export function descriptorToImportStatement(descriptor: ImportDescriptor, configFileDir?: string): string {
    const fromPath = resolveFrom(descriptor.from, configFileDir);
    const groups: string[] = [];
    if (descriptor.default) groups.push(`default as ${descriptor.default}:${fromPath}`);
    if (descriptor.namespace) groups.push(`* as ${descriptor.namespace}:${fromPath}`);
    if (descriptor.names && descriptor.names.length > 0) {
        const named = descriptor.names
            .map((entry) => (typeof entry === 'string' ? entry : entry.as))
            .join(',');
        groups.push(`${named}:${fromPath}`);
    }
    if (groups.length === 0) {
        Utility.warn(`Empty ImportDescriptor for '${descriptor.from}' — no names/default/namespace provided.`);
        return '';
    }
    return groups.join('|');
}

/** Coerces any accepted `extra*` form into the string/string[] shape consumed downstream. */
function serializeExtraImport(value: ExtraImportConfig | undefined, configFileDir?: string): string | string[] | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return rewriteRelativeInline(value, configFileDir);
    if (isImportDescriptor(value)) return descriptorToImportStatement(value, configFileDir);
    if (Array.isArray(value)) {
        const out: string[] = [];
        for (const entry of value) {
            if (typeof entry === 'string') out.push(rewriteRelativeInline(entry, configFileDir));
            else if (isImportDescriptor(entry)) out.push(descriptorToImportStatement(entry, configFileDir));
        }
        return out;
    }
    return undefined;
}

/**
 * Merges a {@link GeneratorConfigFile} on top of the raw schema config. Values from the
 * config file override schema values for the keys it declares; everything else passes
 * through untouched. {@link ImportDescriptor} values are serialized into the inline
 * `Name:path` syntax; arrays and booleans are coerced into the string-shaped values
 * that the downstream pipeline expects.
 *
 * When `configFileDir` is provided, relative paths in descriptors and inline strings
 * are anchored to that directory and emitted as absolute paths. The generator later
 * rewrites them as relative to each output file at emit time.
 */
export function applyConfigFile(rawConfig: RawGeneratorConfig, configFile: GeneratorConfigFile | null, configFileDir?: string): RawGeneratorConfig {
    if (!configFile) return rawConfig;
    const merged: RawGeneratorConfig = { ...rawConfig };
    const stringify = (value: unknown): string | string[] | undefined => {
        if (value === undefined || value === null) return undefined;
        if (typeof value === 'string') return value;
        if (typeof value === 'boolean') return String(value);
        if (Array.isArray(value)) return value.map(String);
        return String(value);
    };
    for (const [key, value] of Object.entries(configFile)) {
        let coerced: string | string[] | undefined;
        if (EXTRA_IMPORT_KEYS.has(key)) coerced = serializeExtraImport(value as ExtraImportConfig | undefined, configFileDir);
        else if (key === 'extraScalars' && value && typeof value === 'object') coerced = serializeExtraScalars(value as Record<string, { from?: string }>, configFileDir);
        else coerced = stringify(value);
        if (coerced !== undefined) merged[key] = coerced;
    }
    return merged;
}

/**
 * JSON-serializes the `extraScalars` map, resolving any relative `from` path against
 * the config file directory. The parser on the receiving side ({@link Utility.parseExtraScalars})
 * accepts both raw JSON and pre-parsed objects, so this stays interchangeable with the
 * inline `extraScalars` form (currently unsupported in `schema.prisma`).
 */
function serializeExtraScalars(value: Record<string, { from?: string }>, configFileDir?: string): string {
    const out: Record<string, unknown> = {};
    for (const [scalar, override] of Object.entries(value)) {
        if (!override || typeof override !== 'object') continue;
        out[scalar] = { ...override, from: override.from ? resolveFrom(override.from, configFileDir) : undefined };
    }
    return JSON.stringify(out);
}

/**
 * Builds an {@link ImportDescriptor} for named exports of a module. The `symbols` argument
 * is expected to use ES shorthand property syntax (`{ IsBool, IsUnique }`); only the keys
 * are read, but the IDE will still flag misspellings and propagate refactor renames.
 *
 * @example
 * ```ts
 * import { IsBool, IsUnique } from 'src/common/validators';
 * import { fromModule } from '@tommasomeli/prisma-generator-nestjs-dto';
 *
 * fromModule('src/common/validators', { IsBool, IsUnique });
 * // → { from: 'src/common/validators', names: ['IsBool', 'IsUnique'] }
 * ```
 */
export function fromModule(from: string, symbols: Record<string, unknown>): ImportDescriptor {
    return { from, names: Object.keys(symbols) };
}

/** Extracts the module specifier from a `() => import('...')` closure source. */
const MODULE_PATH_REGEX = /(?:\bimport|\brequire|\bjitiImport|\b__webpack_require__|\b__nccwpck_require__|\b_?_importDefault)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/;

function extractModulePath(importer: () => unknown): string {
    const source = importer.toString();
    const match = MODULE_PATH_REGEX.exec(source);
    if (match && match[1]) return match[1];
    const fallback = source.match(/['"`]([^'"`]+)['"`]/);
    if (fallback && fallback[1]) return fallback[1];
    throw new Error(`Could not extract module path from importer function. Source: ${source.slice(0, 200)}`);
}

/** Module shape inferred from a `() => import('...')` closure type. */
export type ModuleOf<F> = F extends () => Promise<infer M> ? M : never;

/** Internal: resolves the source argument to a module specifier string. */
function resolveSource(source: string | (() => unknown)): string {
    return typeof source === 'function' ? extractModulePath(source) : source;
}

/** Internal: normalizes a `string | string[]` value into an array. */
function toArray<T extends string>(value: T | readonly T[]): T[] {
    return Array.isArray(value) ? [...value] : [value as T];
}

/**
 * Descriptor builder for named imports. Accepts two forms:
 *
 * 1. **Type-safe** — pass a `() => import('path')` callback. TypeScript infers the module
 *    type from the dynamic import, validates `names` against its keys, and the callback
 *    is never invoked at runtime (no side effects). The module path is recovered from
 *    the closure source.
 * 2. **Concise** — pass the module specifier as a plain string. `names` are not validated
 *    by TypeScript, but the result is identical at runtime.
 *
 * @example
 * ```ts
 * from(() => import('src/common/validators'), ['IsBool', 'IsUnique']); // type-safe
 * from(() => import('src/common/validators'), 'IsBool');               // type-safe single
 * from('class-validator', ['IsEmail', 'IsString']);                    // string form
 * ```
 */
export function from(modulePath: string, names: string | readonly string[]): ImportDescriptor;
export function from<F extends () => Promise<unknown>>(
    importer: F,
    names: (keyof ModuleOf<F> & string) | readonly (keyof ModuleOf<F> & string)[]
): ImportDescriptor;
export function from(source: string | (() => unknown), names: string | readonly string[]): ImportDescriptor {
    return { from: resolveSource(source), names: toArray(names) };
}

/**
 * Descriptor builder for `import * as alias from 'path'`. Accepts the same dual form as
 * {@link from}: a `() => import('path')` callback (path validated by TS) or a plain string.
 *
 * @example
 * ```ts
 * fromNamespace(() => import('src/common/constants'), 'CONSTANTS');
 * fromNamespace('lodash', 'Lodash');
 * ```
 */
export function fromNamespace(modulePath: string, alias: string): ImportDescriptor;
export function fromNamespace<F extends () => Promise<unknown>>(importer: F, alias: string): ImportDescriptor;
export function fromNamespace(source: string | (() => unknown), alias: string): ImportDescriptor {
    return { from: resolveSource(source), namespace: alias };
}

/**
 * Descriptor builder for `import Default[, { named }] from 'path'`. Accepts the dual
 * form (closure or string) and an optional `names` payload validated against the module
 * type when the closure form is used.
 *
 * @example
 * ```ts
 * fromDefault(() => import('lodash'), 'Lodash');
 * fromDefault(() => import('src/lib'), 'Lib', ['helperA', 'helperB']);
 * fromDefault('lodash', 'Lodash');
 * ```
 */
export function fromDefault(modulePath: string, defaultName: string, names?: string | readonly string[]): ImportDescriptor;
export function fromDefault<F extends () => Promise<{ default: unknown }>>(
    importer: F,
    defaultName: string,
    names?: (keyof ModuleOf<F> & string) | readonly (keyof ModuleOf<F> & string)[]
): ImportDescriptor;
export function fromDefault(
    source: string | (() => unknown),
    defaultName: string,
    names?: string | readonly string[]
): ImportDescriptor {
    return {
        from: resolveSource(source),
        default: defaultName,
        names: names === undefined ? undefined : toArray(names)
    };
}

/** Convenience for `import * as Alias from 'path'`. */
export function namespaceFrom(from: string, namespaceAlias: string): ImportDescriptor {
    return { from, namespace: namespaceAlias };
}

/** Convenience for `import Default from 'path'`, optionally with named imports. */
export function defaultFrom(from: string, defaultName: string, namedSymbols?: Record<string, unknown>): ImportDescriptor {
    return { from, default: defaultName, names: namedSymbols ? Object.keys(namedSymbols) : undefined };
}
