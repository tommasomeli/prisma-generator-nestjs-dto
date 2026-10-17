import fs from 'node:fs';
import path from 'node:path';
import type { ContractLocation, Prisma8Contract } from './types';

/** Extensions recognised as a `prisma.config.*` file (also used for TypeScript-authored `contract.ts`). */
const SCRIPT_EXTS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);

/** Directories never descended into while expanding a glob. */
const GLOB_SKIP_DIRS = new Set(['node_modules', '.git']);

/** Hard cap on `prisma.config.ts` → contract indirections, guards against self-referencing configs. */
const MAX_CONFIG_DEPTH = 3;

/** Hint appended to every "contract.json not found" error. */
const EMIT_HINT = 'run `prisma contract emit` first to generate it';

/** `true` when a path segment contains glob magic (`*`, `?`, `[...]`, `{a,b}`). */
function isDynamicSegment(segment: string): boolean {
    return /[*?[\]{}]/.test(segment);
}

/** `true` when the pattern contains glob magic in any segment. */
export function isGlobPattern(pattern: string): boolean {
    return pattern.replace(/\\/g, '/').split('/').some(isDynamicSegment);
}

/**
 * The directory portion of `pattern` before its first wildcard segment, mirroring the Prisma 8
 * CLI (`staticPrefixDirectory` in `@prisma/orm-family-sql`): `./src/prisma/**\/*.prisma` → `./src/prisma`.
 */
export function globStaticPrefix(pattern: string): string {
    const staticSegments: string[] = [];
    for (const segment of pattern.replace(/\\/g, '/').split('/')) {
        if (isDynamicSegment(segment)) break;
        staticSegments.push(segment);
    }
    return staticSegments.join('/');
}

/** Escapes a literal string for use inside a RegExp. */
function escapeRegex(value: string): string {
    return value.replace(/[.+^$()|\\/]/g, '\\$&');
}

/** Translates one glob segment (no `/`) into a RegExp fragment. Supports `*`, `?`, `[...]` and `{a,b}`. */
function segmentToRegex(segment: string): string {
    let out = '';
    for (let i = 0; i < segment.length; i++) {
        const ch = segment[i];
        if (ch === '*') out += '[^/]*';
        else if (ch === '?') out += '[^/]';
        else if (ch === '[') {
            const close = segment.indexOf(']', i + 1);
            if (close === -1) out += '\\[';
            else {
                const body = segment.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\');
                out += `[${body}]`;
                i = close;
            }
        } else if (ch === '{') {
            const close = segment.indexOf('}', i + 1);
            if (close === -1) out += '\\{';
            else {
                out += `(?:${segment
                    .slice(i + 1, close)
                    .split(',')
                    .map((alt) => segmentToRegex(alt))
                    .join('|')})`;
                i = close;
            }
        } else out += escapeRegex(ch);
    }
    return out;
}

/** Compiles the dynamic tail of a glob (relative to its static prefix) into an anchored RegExp. */
function globTailToRegex(tail: string): RegExp {
    const segments = tail.split('/').filter((s) => s.length > 0);
    let source = '';
    segments.forEach((segment, index) => {
        const last = index === segments.length - 1;
        if (segment === '**') source += last ? '.*' : '(?:[^/]+/)*';
        else source += segmentToRegex(segment) + (last ? '' : '/');
    });
    return new RegExp(`^${source}$`);
}

/** Recursively lists every file below `dir` as `/`-separated paths relative to `dir`. */
function walkFiles(dir: string, prefix = ''): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const out: string[] = [];
    for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            if (GLOB_SKIP_DIRS.has(entry.name)) continue;
            out.push(...walkFiles(path.join(dir, entry.name), rel));
        } else if (entry.isFile()) out.push(rel);
    }
    return out;
}

/**
 * Expands a glob into absolute file paths, sorted. Dependency-free (the package targets Node 18,
 * which has no `fs.glob`). `node_modules` and `.git` are skipped.
 */
export function expandGlob(pattern: string, cwd: string = process.cwd()): string[] {
    const normalized = pattern.replace(/\\/g, '/');
    const prefix = globStaticPrefix(normalized);
    const baseDir = path.resolve(cwd, prefix || '.');
    const tail = normalized.slice(prefix.length).replace(/^\/+/, '');
    const regex = globTailToRegex(tail);
    return walkFiles(baseDir)
        .filter((rel) => regex.test(rel))
        .map((rel) => path.join(baseDir, rel))
        .sort();
}

/** Builds the error thrown when `contract.json` is missing. */
function missingContractError(jsonPath: string): Error {
    return new Error(`contract.json not found at ${jsonPath}: ${EMIT_HINT}.`);
}

/** Finalises a location: absolute paths, existence check on the JSON. */
function finalize(jsonPath: string, pslFiles: string[]): ContractLocation {
    const abs = path.resolve(jsonPath);
    if (!fs.existsSync(abs)) throw missingContractError(abs);
    return { jsonPath: abs, dir: path.dirname(abs), pslFiles: pslFiles.map((f) => path.resolve(f)) };
}

/** `true` for `prisma.config.ts`, `prisma.config.mjs`, `my.config.ts`… as opposed to a TS-authored `contract.ts`. */
function isConfigFileName(filePath: string): boolean {
    return /(^|\.)config\.[cm]?[jt]s$/i.test(path.basename(filePath));
}

/** Imports a `prisma.config.*` file through jiti (TypeScript-aware, ESM/CJS agnostic). */
async function importPrismaConfig(filePath: string): Promise<unknown> {
    const { createJiti } = await import('jiti');
    const jiti = createJiti(filePath, { interopDefault: true, moduleCache: false });
    return jiti.import(filePath, { default: true });
}

/**
 * Reads the contract setting out of a loaded `prisma.config.*` module. Verified on
 * `prisma@8.0.0-rc.23` + `@prisma/orm-postgres@8.0.0-rc.18`: `definePrismaConfig({ orm: ormConfig({ contract }) })`
 * returns a plain object `{ orm: { family, target, adapter, driver, extensions, contract, db }, $prismaConfig: 1 }`
 * where `ormConfig` has already normalised `contract` into `{ source: { format, inputs, load, interpret }, output }`:
 * `inputs` holds the paths (or globs) as written and `output` the derived `contract.json` path, both relative to the
 * config file. A plain string `contract` (unnormalised config objects) is accepted too.
 */
function extractContractSetting(mod: unknown, configPath: string): { output?: string; inputs: string[] } | string {
    const root = mod && typeof mod === 'object' ? ((mod as { default?: unknown }).default ?? mod) : undefined;
    if (!root || typeof root !== 'object') throw new Error(`${configPath} did not export a configuration object.`);
    const orm = (root as { orm?: unknown }).orm;
    const contract = (orm && typeof orm === 'object' ? (orm as { contract?: unknown }).contract : undefined) ?? (root as { contract?: unknown }).contract;
    if (typeof contract === 'string') return contract;
    if (contract && typeof contract === 'object') {
        const output = (contract as { output?: unknown }).output;
        const source = (contract as { source?: unknown }).source;
        const rawInputs = source && typeof source === 'object' ? (source as { inputs?: unknown }).inputs : undefined;
        const inputs = Array.isArray(rawInputs) ? rawInputs.filter((i): i is string => typeof i === 'string') : typeof rawInputs === 'string' ? [rawInputs] : [];
        if (typeof output === 'string' || inputs.length > 0) return { output: typeof output === 'string' ? output : undefined, inputs };
    }
    const found = orm && typeof orm === 'object' ? `orm keys: ${Object.keys(orm).join(', ') || '(none)'}` : `top-level keys: ${Object.keys(root).join(', ') || '(none)'}`;
    throw new Error(
        `Could not read the contract location from ${configPath} (${found}). Expected \`definePrismaConfig({ orm: defineConfig({ contract: './path/to/contract.prisma' }) })\`; ` +
            'pass the contract path directly with --contract instead.'
    );
}

/** Resolves a `prisma.config.*` file into a {@link ContractLocation}. */
async function locateFromPrismaConfig(configPath: string, depth: number): Promise<ContractLocation> {
    if (!fs.existsSync(configPath)) throw new Error(`Prisma config file not found: ${configPath}`);
    let mod: unknown;
    try {
        mod = await importPrismaConfig(configPath);
    } catch (error) {
        throw new Error(`Failed to load ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const setting = extractContractSetting(mod, configPath);
    const configDir = path.dirname(configPath);
    if (typeof setting === 'string') return locate(setting, configDir, depth + 1);

    const pslFiles: string[] = [];
    for (const input of setting.inputs) {
        if (isGlobPattern(input)) pslFiles.push(...expandGlob(input, configDir).filter((f) => f.endsWith('.prisma')));
        else if (input.endsWith('.prisma')) pslFiles.push(path.resolve(configDir, input));
    }
    if (setting.output) return finalize(path.resolve(configDir, setting.output), [...new Set(pslFiles)].sort());
    // No explicit output: derive it from the first input exactly as a direct --contract would.
    const derived = await locate(setting.inputs[0], configDir, depth + 1);
    return { ...derived, pslFiles: pslFiles.length > 0 ? [...new Set(pslFiles)].sort() : derived.pslFiles };
}

/** Recursive worker for {@link locateContract}. */
async function locate(input: string, cwd: string, depth: number): Promise<ContractLocation> {
    if (depth > MAX_CONFIG_DEPTH) throw new Error(`Too many prisma.config indirections while resolving '${input}'.`);

    // (c) glob: JSON lives in the static prefix directory, every matching .prisma file is a PSL source.
    if (isGlobPattern(input)) {
        const prefix = globStaticPrefix(input);
        const jsonPath = path.resolve(cwd, prefix || '.', 'contract.json');
        const pslFiles = expandGlob(input, cwd).filter((f) => f.endsWith('.prisma'));
        return finalize(jsonPath, pslFiles);
    }

    const abs = path.resolve(cwd, input);
    const ext = path.extname(abs).toLowerCase();

    // (a) explicit contract.json. The sibling contract.prisma, when present, provides the annotations.
    if (ext === '.json') {
        const sibling = path.join(path.dirname(abs), 'contract.prisma');
        return finalize(abs, fs.existsSync(sibling) ? [sibling] : []);
    }

    // (b) a single PSL file: the CLI emits `contract.json` next to it whatever its basename.
    if (ext === '.prisma') {
        if (!fs.existsSync(abs)) throw new Error(`PSL contract not found: ${abs}`);
        return finalize(path.join(path.dirname(abs), 'contract.json'), [abs]);
    }

    if (SCRIPT_EXTS.has(ext)) {
        // (d) prisma.config.ts / .js / .mjs …
        if (isConfigFileName(abs)) return locateFromPrismaConfig(abs, depth);
        // TypeScript-authored contract (`contract.ts` → `contract.json`, same basename). No doc comments there (D5).
        return finalize(abs.slice(0, -ext.length) + '.json', []);
    }

    // A directory: look for contract.json (and contract.prisma) inside it.
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        const sibling = path.join(abs, 'contract.prisma');
        return finalize(path.join(abs, 'contract.json'), fs.existsSync(sibling) ? [sibling] : []);
    }

    throw new Error(`Unsupported --contract value '${input}': expected a contract.json, a .prisma file, a glob of .prisma files or a prisma.config.ts.`);
}

/**
 * Locates the `contract.json` emitted by `prisma contract emit` and the PSL sources it came from.
 *
 * `input` may be:
 * - an explicit `contract.json` path (the sibling `contract.prisma`, if any, becomes the PSL source);
 * - a `.prisma` file (`contract.json` is its sibling);
 * - a glob such as `./src/prisma/**\/*.prisma` (`contract.json` lives in the directory before the first
 *   wildcard segment, like the Prisma 8 CLI; every match is a PSL source, sorted);
 * - a `prisma.config.ts` / `.js` / `.mjs` (loaded through jiti; its `orm.contract` setting is resolved
 *   relative to the config file).
 *
 * @throws when the JSON does not exist (the message names the path and hints at `prisma contract emit`)
 *         or the input cannot be interpreted.
 */
export async function locateContract(input: string, cwd: string = process.cwd()): Promise<ContractLocation> {
    return locate(input, cwd, 0);
}

/**
 * Reads and sanity-checks `contract.json`. Only the presence of `domain` and `storage` is validated;
 * the adapter feature-detects everything else.
 */
export function readContract(location: ContractLocation): Prisma8Contract {
    if (!fs.existsSync(location.jsonPath)) throw missingContractError(location.jsonPath);
    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(location.jsonPath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to parse ${location.jsonPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== 'object') throw new Error(`${location.jsonPath} is not a Prisma 8 contract: expected a JSON object.`);
    const missing = (['domain', 'storage'] as const).filter((key) => {
        const value = (parsed as Record<string, unknown>)[key];
        return !value || typeof value !== 'object';
    });
    if (missing.length > 0) {
        throw new Error(`${location.jsonPath} is not a Prisma 8 contract: missing ${missing.map((k) => `'${k}'`).join(' and ')}. Re-run \`prisma contract emit\` with Prisma ORM 8.`);
    }
    return parsed as Prisma8Contract;
}
