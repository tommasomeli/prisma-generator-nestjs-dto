import chalk from 'chalk';
import { ImportType } from './types';

/**
 * Stateless helpers used by the generator pipeline: leveled logger with a
 * configurable prefix, boolean parsing, and the import-statement parser used by
 * every `extra*` config option.
 */
export class Utility {
    private static prefix = 'prisma-generator-nestjs-dto';

    /** Override the global log prefix (defaults to the package name). */
    static setLogPrefix(prefix: string): void {
        this.prefix = prefix;
    }

    static log(message: any, ...data: any[]): void {
        console.info(`${chalk.cyan(this.prefix)} ${message}`, ...data);
    }

    static warn(message: any, ...data: any[]): void {
        console.info(chalk.yellowBright(`${this.prefix} ${message}`), ...data);
    }

    static error(message: any, ...data: any[]): void {
        console.error(chalk.redBright(`${this.prefix} ${message}`), ...data);
    }

    /**
     * Parses a string into a boolean. Accepts native booleans and the Prisma-style
     * stringified values that come from `schema.prisma` config options.
     */
    static parseBoolean(value: string | boolean | undefined): boolean {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') return value === 'true' || value === '1' || value === 'yes' || value === 'on';
        return false;
    }

    /**
     * Parses one or more import declarations from the value of an `extra*` config option.
     * The only supported syntax is the compact inline form:
     *
     * ```prisma
     * extraValidators = "IsUnique,IsBool:src/common/validators|IsAdult:src/common/validators/is-adult"
     * ```
     *
     * - `Foo,Bar:path` — named imports.
     * - `* as Foo:path` — namespace import.
     * - `default as Foo:path` — default import.
     * - `|` — separator for multiple groups (different paths).
     *
     * For anything more elaborate (rename, default + named, type-safe paths, ...) use a
     * `configFile` with `ImportDescriptor` or the `from()` / `fromNamespace()` / `fromDefault()`
     * helpers.
     *
     * Also accepts an array of strings, with each entry already containing one or more
     * `|`-separated groups.
     */
    static parseImports(value: string | string[] | undefined): ImportType[] {
        if (value === undefined || value === null) return [];
        const items: string[] = Array.isArray(value) ? value : [value];
        const out: ImportType[] = [];
        for (const item of items) {
            const trimmed = item.trim();
            if (!trimmed) continue;
            if (trimmed.startsWith('import')) {
                this.warn(
                    `ES import syntax is no longer supported in extra* options. Use "Name:path|Other:path2" or move to a configFile with ImportDescriptor / from() helpers. Got: ${trimmed}`
                );
                continue;
            }
            for (const entry of this.parseInlineImport(trimmed)) this.mergeInto(out, entry);
        }
        return out;
    }

    /**
     * Parses `extraAnnotations` into a deduplicated list of annotation names.
     * Accepts a single comma/whitespace-separated string, a string array, or a mix:
     * `"@DtoFoo, DtoBar"`, `["DtoFoo", "DtoBar"]`, `"DtoFoo DtoBar"`. Leading `@`
     * characters are stripped so plugin authors can refer to them either way.
     */
    static parseAnnotationNames(value: string | string[] | undefined): string[] {
        if (value === undefined || value === null) return [];
        const raw = Array.isArray(value) ? value : [value];
        const seen = new Set<string>();
        const out: string[] = [];
        for (const entry of raw) {
            if (typeof entry !== 'string') continue;
            for (const piece of entry.split(/[,\s]+/)) {
                const name = piece.replace(/^@/, '').trim();
                if (!name || seen.has(name)) continue;
                seen.add(name);
                out.push(name);
            }
        }
        return out;
    }

    /**
     * Parses the `extraScalars` config value. Accepts a JSON string (the form emitted by
     * {@link applyConfigFile}) or an already-parsed `Record<string, ScalarOverride>` object.
     * Invalid entries are skipped with a warning rather than throwing.
     */
    static parseExtraScalars(value: unknown): Record<string, { ts: string; from?: string; apiType?: string; format?: string }> {
        if (!value) return {};
        let parsed: unknown = value;
        if (typeof value === 'string') {
            try { parsed = JSON.parse(value); }
            catch (error) {
                Utility.warn('Failed to parse extraScalars JSON, ignoring.', error);
                return {};
            }
        }
        if (!parsed || typeof parsed !== 'object') return {};
        const out: Record<string, { ts: string; from?: string; apiType?: string; format?: string }> = {};
        for (const [scalar, raw] of Object.entries(parsed as Record<string, unknown>)) {
            if (!raw || typeof raw !== 'object') continue;
            const override = raw as { ts?: unknown; from?: unknown; apiType?: unknown; format?: unknown };
            if (typeof override.ts !== 'string') {
                Utility.warn(`extraScalars["${scalar}"] is missing a string \`ts\` field, ignoring.`);
                continue;
            }
            out[scalar] = {
                ts: override.ts,
                from: typeof override.from === 'string' ? override.from : undefined,
                apiType: typeof override.apiType === 'string' ? override.apiType : undefined,
                format: typeof override.format === 'string' ? override.format : undefined
            };
        }
        return out;
    }

    /**
     * @deprecated Use {@link parseImports} instead. Kept for sub-generators that
     * relied on the public name in earlier releases.
     */
    static stringToImports(value: string | string[] | undefined): ImportType[] {
        return this.parseImports(value);
    }

    /** Parses the inline `Name1,Name2:path|Other:path2` syntax. */
    private static parseInlineImport(value: string): ImportType[] {
        const out: ImportType[] = [];
        for (const group of value.split('|')) {
            const lastColonIndex = group.lastIndexOf(':');
            if (lastColonIndex === -1) {
                this.warn(`Invalid import format: ${group}. Missing path after colon.`);
                continue;
            }
            const from = group.substring(lastColonIndex + 1).trim();
            const names = group.substring(0, lastColonIndex).trim();
            if (names.includes('* as ') || names.includes('default as ')) {
                out.push({ from, alias: names });
                continue;
            }
            const destruct = names
                .split(',')
                .map((n) => n.trim())
                .filter(Boolean);
            if (destruct.length === 0) {
                this.warn(`Invalid import format: ${group}. No import names found.`);
                continue;
            }
            out.push({ from, destruct });
        }
        return out;
    }

    /** Merges a new entry into an existing array, deduplicating named imports on the same path. */
    private static mergeInto(imports: ImportType[], next: ImportType): void {
        if (next.alias) {
            const existing = imports.find((i) => i.from === next.from && i.alias);
            if (existing) {
                existing.alias = next.alias;
                return;
            }
            imports.push({ from: next.from, alias: next.alias });
            return;
        }
        if (next.destruct && next.destruct.length) {
            const existing = imports.find((i) => i.from === next.from && i.destruct);
            if (existing) {
                existing.destruct = Array.from(new Set([...(existing.destruct || []), ...next.destruct]));
                return;
            }
            imports.push({ from: next.from, destruct: [...next.destruct] });
        }
    }
}
