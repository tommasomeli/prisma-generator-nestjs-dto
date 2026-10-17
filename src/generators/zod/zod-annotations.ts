import { DTO_CREATE_VALIDATE_IF, DTO_UPDATE_VALIDATE_IF } from '../../annotations';
import { CLASS_VALIDATOR_DECORATORS } from '../../constants';
import { Field, ImportType, ZodMessageStrategy } from '../../types';

/** Annotation with its raw (unparsed) argument source, as written in the `///` comment. */
export type ZodAnnotation = {
    name: string;
    /** Source between the parentheses, or `null` for parameterless annotations. */
    body: string | null;
    /** Top-level arguments of `body`. */
    args: string[];
};

/** Validation rule that Zod cannot express; enforced server-side and exported as plain data. */
export type ServerRuleDraft = {
    rule: string;
    args: string[];
    message?: string;
};

/** Base value schema category, used to decide which validator translations apply. */
export type ZodBaseKind = 'string' | 'number' | 'int' | 'other';

/** Result of translating class-validator annotations into Zod chains. */
export type TranslatedValidators = {
    /** Replacement for the base schema (e.g. `z.email()` instead of `z.string()`). */
    base?: string;
    /** Chains applied to the element schema (the value itself, or each item for lists). */
    element: string[];
    /** Chains applied to the array schema of list fields. */
    array: string[];
    hasMin: boolean;
    hasMax: boolean;
    hasFormat: boolean;
    /** `@IsOptional()`: the field accepts `null` / `undefined`. */
    optional: boolean;
    serverRules: ServerRuleDraft[];
};

/** class-validator decorators with no runtime effect beyond the type already enforced by Zod. */
const NOOP_VALIDATORS = new Set([
    'Allow',
    'IsArray',
    'IsBoolean',
    'IsDate',
    'IsDefined',
    'IsEnum',
    'IsNumber',
    'IsObject',
    'IsString',
    'Transform',
    'Type',
    'ValidateNested'
]);

const QUOTES = new Set(["'", '"', '`']);
const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';']);

/**
 * Returns the index of the character closing the bracket opened at `openIndex`,
 * skipping string literals, regex literals and escaped characters. `-1` when unbalanced.
 *
 * @param text Source text.
 * @param openIndex Index of `(`, `[` or `{`.
 * @return Index of the matching closer.
 */
function findClosing(text: string, openIndex: number): number {
    const stack: string[] = [OPENERS[text[openIndex]]];
    let previous = text[openIndex];
    for (let i = openIndex + 1; i < text.length; i++) {
        const char = text[i];
        if (char === '\\') {
            i++;
            continue;
        }
        if (QUOTES.has(char)) {
            i = skipQuoted(text, i);
            previous = char;
            continue;
        }
        if (char === '/' && REGEX_PRECEDERS.has(previous) && text[i + 1] !== '/' && text[i + 1] !== '*') {
            i = skipRegex(text, i);
            previous = '/';
            continue;
        }
        if (OPENERS[char]) stack.push(OPENERS[char]);
        else if (char === stack[stack.length - 1]) {
            stack.pop();
            if (!stack.length) return i;
        }
        if (!/\s/.test(char)) previous = char;
    }
    return -1;
}

/**
 * Plain parenthesis matching used when {@link findClosing} fails on prose (e.g. an apostrophe
 * in `@description(User's email)`).
 *
 * @param text Source text.
 * @param openIndex Index of `(`.
 * @return Index of the matching `)`, or `-1`.
 */
function findClosingPlain(text: string, openIndex: number): number {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')' && --depth === 0) return i;
    }
    return -1;
}

/**
 * Skips a quoted string literal starting at `start`.
 *
 * @param text Source text.
 * @param start Index of the opening quote.
 * @return Index of the closing quote (or the end of the text).
 */
function skipQuoted(text: string, start: number): number {
    const quote = text[start];
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === quote) return i;
    }
    return text.length - 1;
}

/**
 * Skips a regex literal (including flags) starting at `start`.
 *
 * @param text Source text.
 * @param start Index of the opening slash.
 * @return Index of the last character of the literal.
 */
function skipRegex(text: string, start: number): number {
    let inClass = false;
    for (let i = start + 1; i < text.length; i++) {
        const char = text[i];
        if (char === '\\') i++;
        else if (char === '[') inClass = true;
        else if (char === ']') inClass = false;
        else if (char === '/' && !inClass) {
            while (/[a-z]/i.test(text[i + 1] ?? '')) i++;
            return i;
        }
        else if (char === '\n') return i - 1;
    }
    return text.length - 1;
}

/**
 * Splits an argument list on top-level commas (ignoring commas nested in brackets,
 * strings and regex literals).
 *
 * @param body Source between the parentheses of a call.
 * @return Trimmed, non-empty arguments.
 */
export function splitArguments(body: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    let previous = '';
    for (let i = 0; i < body.length; i++) {
        const char = body[i];
        if (char === '\\') {
            current += body.slice(i, i + 2);
            i++;
            continue;
        }
        if (QUOTES.has(char)) {
            const end = skipQuoted(body, i);
            current += body.slice(i, end + 1);
            i = end;
            previous = char;
            continue;
        }
        if (char === '/' && REGEX_PRECEDERS.has(previous) && body[i + 1] !== '/' && body[i + 1] !== '*') {
            const end = skipRegex(body, i);
            current += body.slice(i, end + 1);
            i = end;
            previous = '/';
            continue;
        }
        if (OPENERS[char]) depth++;
        else if (char === ')' || char === ']' || char === '}') depth--;
        if (char === ',' && depth === 0) {
            out.push(current.trim());
            current = '';
            previous = ',';
            continue;
        }
        current += char;
        if (!/\s/.test(char)) previous = char;
    }
    if (current.trim()) out.push(current.trim());
    return out.filter(Boolean);
}

/**
 * Parses every `@Name` / `@Name(args)` occurrence of a documentation string, keeping the raw
 * argument source. Text consumed by an annotation's parentheses is not scanned again, so `@`
 * characters inside arguments never produce spurious annotations.
 *
 * @param documentation Prisma `///` documentation.
 * @return Annotations in declaration order.
 */
export function parseZodAnnotations(documentation: string): ZodAnnotation[] {
    const out: ZodAnnotation[] = [];
    const regex = /@([A-Za-z][A-Za-z0-9_]*)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(documentation)) !== null) {
        const openIndex = match.index + match[0].length;
        if (documentation[openIndex] !== '(') {
            out.push({ name: match[1], body: null, args: [] });
            continue;
        }
        const strictClose = findClosing(documentation, openIndex);
        const closeIndex = strictClose === -1 ? findClosingPlain(documentation, openIndex) : strictClose;
        if (closeIndex === -1) {
            out.push({ name: match[1], body: null, args: [] });
            continue;
        }
        const body = documentation.slice(openIndex + 1, closeIndex).trim();
        out.push({ name: match[1], body, args: splitArguments(body) });
        regex.lastIndex = closeIndex + 1;
    }
    return out;
}

/**
 * Resolves the annotations of a field with raw argument sources. The parsed `field.annotations`
 * list stays authoritative (so plugins mutating it in `beforeAll` are honoured); the raw
 * documentation only supplies lossless argument text.
 *
 * @param field Pipeline field.
 * @return Annotations with raw arguments.
 */
export function resolveZodAnnotations(field: Field): ZodAnnotation[] {
    const raw = parseZodAnnotations(field.documentation || '');
    const seen = new Map<string, number>();
    return field.annotations.map((annotation) => {
        const index = seen.get(annotation.name) ?? 0;
        seen.set(annotation.name, index + 1);
        const match = raw.filter((r) => r.name === annotation.name)[index];
        const args = Array.isArray(annotation.params) ? annotation.params.map((p: unknown) => String(p)) : [];
        if (match && (match.body !== null || !args.length)) return match;
        return { name: annotation.name, body: args.length ? args.join(', ') : null, args };
    });
}

/**
 * Parses the top-level `key: value` entries of an object literal source.
 *
 * @param source Object literal source, e.g. `{ message: 'x', each: true }`.
 * @return Entries keyed by property name, or `null` when `source` is not an object literal.
 */
export function parseObjectLiteral(source: string): Record<string, string> | null {
    const trimmed = source.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
    const out: Record<string, string> = {};
    for (const entry of splitArguments(trimmed.slice(1, -1))) {
        const colon = entry.indexOf(':');
        if (colon === -1) continue;
        out[entry.slice(0, colon).trim().replace(/^['"]|['"]$/g, '')] = entry.slice(colon + 1).trim();
    }
    return out;
}

/** Returns `true` when `source` is a single string literal. */
function isStringLiteral(source: string): boolean {
    const quote = source[0];
    return QUOTES.has(quote) && skipQuoted(source, 0) === source.length - 1 && !(quote === '`' && source.includes('${'));
}

/**
 * Resolves the Zod error message expression from a class-validator `message` value.
 *
 * @param message Raw `message` source (string literal or expression).
 * @param strategy Rendering strategy for expressions.
 * @return Expression to emit as `{ error }`, or `undefined` to drop the message.
 */
export function resolveMessage(message: string | undefined, strategy: ZodMessageStrategy): string | undefined {
    if (!message || strategy === 'none') return undefined;
    if (isStringLiteral(message) || strategy === 'expression') return message;
    const literal = /(['"])((?:\\.|(?!\1)[^\\])*)\1|`([^`$]*)`/.exec(message);
    return literal ? literal[0] : message;
}

/**
 * Converts a string literal source to its plain value (best effort).
 *
 * @param source String literal source.
 * @return Unquoted value.
 */
export function unquote(source: string): string {
    return isStringLiteral(source) ? source.slice(1, -1).replace(/\\(.)/g, '$1') : source;
}

/** Positional arguments and options (`message`, `each`) of a class-validator call. */
function splitValidatorArgs(args: string[]): { positional: string[]; message?: string; each: boolean } {
    const positional: string[] = [];
    let message: string | undefined;
    let each = false;
    args.forEach((arg, index) => {
        const object = parseObjectLiteral(arg);
        const isOptionsSlot = object && (index === args.length - 1 || 'message' in object || 'each' in object);
        if (object && isOptionsSlot) {
            if (object.message !== undefined) message = object.message;
            if (object.each === 'true') each = true;
            return;
        }
        positional.push(arg);
    });
    return { positional, message, each };
}

/**
 * Translates the class-validator annotations of a field into Zod chains. Unknown or
 * server-only validators (custom `extraValidators`, async/DB rules, `ValidateIf`) are returned
 * as {@link ServerRuleDraft}s instead of being emitted.
 *
 * @param annotations Field annotations with raw arguments.
 * @param options Base kind, list flag, message strategy and custom validator imports.
 * @return Translated chains and server-only rules.
 */
export function translateValidators(
    annotations: ZodAnnotation[],
    options: { baseKind: ZodBaseKind; isList: boolean; strategy: ZodMessageStrategy; extraValidators: ImportType[] }
): TranslatedValidators {
    const result: TranslatedValidators = { element: [], array: [], hasMin: false, hasMax: false, hasFormat: false, optional: false, serverRules: [] };
    const { baseKind, isList, strategy } = options;
    const customNames = new Set(options.extraValidators.flatMap((v) => [...(v.destruct ?? []), ...(v.alias ? [v.alias.split(' as ').pop()!.trim()] : [])]));
    const isString = baseKind === 'string';
    const isNumeric = baseKind === 'number' || baseKind === 'int';
    for (const annotation of annotations) {
        const { name, args } = annotation;
        if (name === DTO_CREATE_VALIDATE_IF || name === DTO_UPDATE_VALIDATE_IF) {
            result.serverRules.push({ rule: 'ValidateIf', args });
            continue;
        }
        if (!CLASS_VALIDATOR_DECORATORS.includes(name) && !customNames.has(name)) continue;
        if (NOOP_VALIDATORS.has(name)) continue;
        const { positional, message, each } = splitValidatorArgs(args);
        const error = resolveMessage(message, strategy);
        const params = error ? `{ error: ${error} }` : '';
        const withParams = (...values: string[]) => [...values, ...(params ? [params] : [])].join(', ');
        const format = (factory: string, extra: string[] = []) => {
            if (!isString) return;
            const entries = [...extra, ...(error ? [`error: ${error}`] : [])];
            result.base = `${factory}(${entries.length ? `{ ${entries.join(', ')} }` : ''})`;
            result.hasFormat = true;
        };
        switch (name) {
            case 'IsEmail':
                format('z.email');
                break;
            case 'IsUrl':
                format('z.url');
                break;
            case 'IsUUID': {
                const version = positional[0] ? unquote(positional[0]) : undefined;
                format('z.uuid', version && /^[1-8]$/.test(version) ? [`version: 'v${version}'`] : []);
                break;
            }
            case 'IsDateString':
            case 'IsISO8601':
                format('z.iso.datetime', ['offset: true']);
                break;
            case 'Length':
                if (positional[0] !== undefined) {
                    result.element.push(`.min(${withParams(positional[0])})`);
                    result.hasMin = true;
                }
                if (positional[1] !== undefined) {
                    result.element.push(`.max(${withParams(positional[1])})`);
                    result.hasMax = true;
                }
                break;
            case 'MinLength':
                result.element.push(`.min(${withParams(positional[0])})`);
                result.hasMin = true;
                break;
            case 'MaxLength':
                result.element.push(`.max(${withParams(positional[0])})`);
                result.hasMax = true;
                break;
            case 'Matches': {
                const [pattern, modifiers] = positional;
                if (!pattern) break;
                const regex = isStringLiteral(pattern) ? `new RegExp(${pattern}${modifiers && isStringLiteral(modifiers) ? `, ${modifiers}` : ''})` : pattern;
                result.element.push(`.regex(${withParams(regex)})`);
                break;
            }
            case 'Contains':
                result.element.push(`.includes(${withParams(positional[0])})`);
                break;
            case 'IsLowercase':
                result.element.push(`.lowercase(${params})`);
                break;
            case 'IsUppercase':
                result.element.push(`.uppercase(${params})`);
                break;
            case 'IsAlpha':
                result.element.push(`.regex(${withParams('/^[A-Za-z]+$/')})`);
                break;
            case 'IsAlphanumeric':
                result.element.push(`.regex(${withParams('/^[A-Za-z0-9]+$/')})`);
                break;
            case 'IsNumberString':
                result.element.push(`.regex(${withParams('/^-?\\d+(\\.\\d+)?$/')})`);
                break;
            case 'Min':
                if (isNumeric) result.element.push(`.min(${withParams(positional[0])})`);
                break;
            case 'Max':
                if (isNumeric) result.element.push(`.max(${withParams(positional[0])})`);
                break;
            case 'IsPositive':
                if (isNumeric) result.element.push(`.positive(${params})`);
                break;
            case 'IsNegative':
                if (isNumeric) result.element.push(`.negative(${params})`);
                break;
            case 'IsDivisibleBy':
                if (isNumeric) result.element.push(`.multipleOf(${withParams(positional[0])})`);
                break;
            case 'IsInt':
                if (baseKind === 'number') result.base = `z.int(${params})`;
                break;
            case 'IsNotEmpty':
                if (isList && !each) {
                    result.array.push(`.min(${withParams('1')})`);
                } else if (isString) {
                    result.element.push(`.min(${withParams('1')})`);
                    result.hasMin = true;
                }
                break;
            case 'ArrayMinSize':
                result.array.push(`.min(${withParams(positional[0])})`);
                break;
            case 'ArrayMaxSize':
                result.array.push(`.max(${withParams(positional[0])})`);
                break;
            case 'ArrayNotEmpty':
                result.array.push(`.min(${withParams('1')})`);
                break;
            case 'ArrayUnique':
                result.array.push(`.refine(${withParams('(items) => new Set(items).size === items.length')})`);
                break;
            case 'IsIn':
                if (positional[0]?.startsWith('[')) result.base = `z.literal(${withParams(positional[0])})`;
                else if (positional[0]) result.element.push(`.refine(${withParams(`(value) => ${positional[0]}.includes(value)`)})`);
                break;
            case 'IsNotIn':
                if (positional[0]) result.element.push(`.refine(${withParams(`(value) => !${positional[0]}.includes(value)`)})`);
                break;
            case 'Equals':
                if (positional[0] !== undefined) result.base = `z.literal(${withParams(positional[0])})`;
                break;
            case 'NotEquals':
                if (positional[0] !== undefined) result.element.push(`.refine(${withParams(`(value) => value !== ${positional[0]}`)})`);
                break;
            case 'IsOptional':
                result.optional = true;
                break;
            default: {
                const resolved = resolveMessage(message, strategy === 'none' ? 'key' : strategy);
                result.serverRules.push({ rule: name, args, ...(resolved ? { message: unquote(resolved) } : {}) });
            }
        }
    }
    return result;
}
