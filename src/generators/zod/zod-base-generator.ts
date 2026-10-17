import path from 'node:path';
import { DTO_OVERRIDE_TYPE, DTO_READ_ONLY, ZOD_CHAIN, ZOD_OVERRIDE } from '../../annotations';
import { BaseGenerator } from '../../base-generator';
import { Field, File, ImportType, Model } from '../../types';
import { Utility } from '../../utility';
import { ServerRuleDraft, ZodAnnotation, ZodBaseKind, resolveZodAnnotations, translateValidators, unquote } from './zod-annotations';

/** Which of the three per-model schemas is being rendered. */
export type ZodSchemaKind = 'entity' | 'create' | 'update';

/** Prisma enum as exposed by the DMMF, reduced to what Zod mode needs. */
export type ZodEnum = {
    name: string;
    values: string[];
    /**
     * Prisma 8 only: `[member, stored value]` pairs, set when a stored value differs from the member
     * name (numeric enums, mapped members). Rendered as `z.enum({ Low: 0, ... })`.
     */
    entries?: [string, string | number][];
};

/** Expression plus its static Zod type (`null` when it cannot be derived). */
type Built = { code: string; type: string | null };

/** Resolved base schema of a field before validators and presence modifiers. */
type BaseSchema = { built: Built; baseKind: ZodBaseKind; isRef: boolean };

/** Per-file accumulator of generated-module imports (absolute file path -> named symbols). */
type RenderState = { file: string; imports: Map<string, Set<string>> };

const PRISMA_SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes']);
const LENGTH_NATIVE_TYPES = new Set(['VarChar', 'Char', 'NVarChar', 'NChar']);
const warnedOnce = new Set<string>();

/**
 * Converts a Prisma model / enum name to PascalCase.
 *
 * @param name Prisma name.
 * @return PascalCase identifier.
 */
export function pascalCase(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1).replace(/_(\w)/g, (_, char: string) => char.toUpperCase());
}

/**
 * Quotes a value as a single-quoted TypeScript string literal.
 *
 * @param value Raw string.
 * @return String literal source.
 */
function quote(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Shared machinery of the Zod output mode: file layout, field-to-schema rendering, imports.
 * Concrete generators only pick which fields go into their schema.
 */
export abstract class ZodBaseGenerator extends BaseGenerator {
    abstract readonly schemaKind: ZodSchemaKind;

    /**
     * Name of the exported schema constant.
     *
     * @param modelName Prisma model name.
     * @param kind Schema kind.
     * @return Identifier such as `CreateUserSchema`.
     */
    public schemaName(modelName: string, kind: ZodSchemaKind = 'entity'): string {
        const prefix = kind === 'create' ? 'Create' : kind === 'update' ? 'Update' : '';
        return `${prefix}${pascalCase(modelName)}Schema`;
    }

    /**
     * Path of the entity schema file of `model`.
     *
     * @param model Prisma model.
     * @return Output file path.
     */
    public entitySchemaPath(model: Model): string {
        const name = this.getModelName(model.name);
        const file = `${name}.schema.ts`;
        return this.config.outputStructure === 'nestjs' ? `${this.config.output}/${name}/${file}` : `${this.config.output}/${file}`;
    }

    /**
     * Path of the file holding the schema of a Prisma enum.
     *
     * @param enumName Prisma enum name.
     * @return Output file path.
     */
    public enumSchemaPath(enumName: string): string {
        const name = this.getModelName(enumName);
        return this.config.outputStructure === 'nestjs' ? `${this.config.output}/enums/${name}.enum.ts` : `${this.config.output}/${name}.enum.ts`;
    }

    /**
     * Path of the shared scalar helpers (`DateTimeSchema`, `BigIntSchema`, ...).
     *
     * @return Output file path.
     */
    public scalarsPath(): string {
        return `${this.config.output}/scalars.ts`;
    }

    /**
     * Path of the exported list of validation rules that only the server can enforce.
     *
     * @return Output file path.
     */
    public serverRulesPath(): string {
        return `${this.config.output}/server-rules.ts`;
    }

    /**
     * Prisma enums from the DMMF.
     *
     * @return Enum names with their values.
     */
    protected getEnums(): ZodEnum[] {
        const enums = (this.options.dmmf?.datamodel?.enums ?? []) as readonly { name: string; values: readonly { name: string; dbName?: string | null }[] }[];
        return enums.map((e) => {
            const out: ZodEnum = { name: e.name, values: e.values.map((v) => v.name) };
            // Prisma 8 returns the stored value at runtime (contract member `value`, carried as `dbName`).
            if (this.config.prisma8 && e.values.some((v) => v.dbName !== null && v.dbName !== undefined && v.dbName !== v.name)) {
                const stored = e.values.map((v) => v.dbName ?? v.name);
                const numeric = stored.every((value) => /^-?\d+(?:\.\d+)?$/.test(value));
                out.entries = e.values.map((v, i) => [v.name, numeric ? Number(stored[i]) : stored[i]]);
            }
            return out;
        });
    }

    /**
     * Relative module specifier from one generated file to another.
     *
     * @param fromFile Importing file.
     * @param toFile Imported file.
     * @return Specifier without extension, always starting with `.`.
     */
    protected relativeImport(fromFile: string, toFile: string): string {
        const relative = path.relative(path.dirname(fromFile), toFile).split(path.sep).join('/').replace(/\.ts$/, '');
        return relative.startsWith('.') ? relative : `./${relative}`;
    }

    /**
     * Server-only rules (validators Zod cannot express) declared on a field.
     *
     * @param field Pipeline field.
     * @return Rule drafts.
     */
    public collectServerRules(field: Field): ServerRuleDraft[] {
        return translateValidators(resolveZodAnnotations(field), {
            baseKind: 'other',
            isList: field.isList,
            strategy: this.config.zodMessageStrategy,
            extraValidators: this.config.extraValidators
        }).serverRules;
    }

    /**
     * Renders one schema file for `model` with the given (already selected) fields.
     *
     * @param model Prisma model.
     * @param fields Fields included in this schema.
     * @return Emitted file.
     */
    protected renderModel(model: Model, fields: Field[]): File {
        const outputPath = this.getPath(model);
        const state: RenderState = { file: outputPath, imports: new Map() };
        const schemaName = this.schemaName(model.name, this.schemaKind);
        const properties = fields.map((field) => this.renderField(model, field, state));
        const meta = this.config.zodMeta ? `.meta({ id: ${quote(schemaName.replace(/Schema$/, ''))} })` : '';
        const object = properties.length ? `z.object({\n${properties.join(',\n')}\n})` : 'z.object({})';
        const typeName = schemaName.replace(/Schema$/, '');
        const types =
            this.schemaKind === 'entity'
                ? `export type ${typeName} = z.infer<typeof ${schemaName}>;`
                : `/** Payload / form values accepted by \`${schemaName}\` (fields with defaults stay optional). */\nexport type ${typeName} = z.input<typeof ${schemaName}>;\n\n/** Result of parsing with \`${schemaName}\` (defaults applied). */\nexport type ${typeName}Output = z.output<typeof ${schemaName}>;`;
        const body = `export const ${schemaName} = ${object}${meta};\n\n${types}\n`;
        return { path: outputPath, content: `${this.renderImports(state, body, [schemaName, typeName, `${typeName}Output`])}\n\n${body}` };
    }

    /**
     * Renders the import block: `zod`, generated modules, then `extraImports` entries whose
     * symbols are referenced in `body`.
     *
     * @param state Generated-module imports collected while rendering.
     * @param body Rendered file body.
     * @param localNames Identifiers declared by the file itself.
     * @return Import statements.
     */
    protected renderImports(state: RenderState, body: string, localNames: string[]): string {
        const imports: ImportType[] = [{ from: 'zod', destruct: ['z'] }];
        for (const [file, names] of state.imports) imports.push({ from: this.relativeImport(state.file, file), destruct: [...names] });
        const isUsed = (name: string) => !localNames.includes(name) && new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, '\\$')}\\b`).test(body);
        for (const entry of this.config.extraImports) {
            if (entry.alias) {
                const [kind, local] = entry.alias.split(' as ').map((s) => s.trim());
                if (!local || !isUsed(local)) continue;
                if (kind === 'default') this.addImport(imports, { from: entry.from, destruct: [`default as ${local}`] });
                else this.addImport(imports, { from: entry.from, alias: entry.alias });
                continue;
            }
            const used = (entry.destruct ?? []).filter(isUsed);
            if (used.length) this.addImport(imports, { from: entry.from, destruct: used });
        }
        return this.formatImports(imports, state.file);
    }

    /** Registers a named import from another generated file (skipped for the file itself). */
    private importFrom(state: RenderState, file: string, name: string): void {
        if (path.resolve(file) === path.resolve(state.file)) return;
        const names = state.imports.get(file) ?? new Set<string>();
        names.add(name);
        state.imports.set(file, names);
    }

    /**
     * Renders one object property (plain or getter) of the schema.
     *
     * @param model Owning model.
     * @param field Field to render.
     * @param state Import accumulator.
     * @return Property source.
     */
    protected renderField(model: Model, field: Field, state: RenderState): string {
        const isInput = this.schemaKind !== 'entity';
        const annotations = resolveZodAnnotations(field);
        const find = (name: string) => annotations.find((a) => a.name === name);
        const zodOverride = find(ZOD_OVERRIDE);
        const typeOverride = find(DTO_OVERRIDE_TYPE);
        let base: BaseSchema;
        if (zodOverride?.body) base = { built: { code: zodOverride.body, type: null }, baseKind: 'other', isRef: this.importReferencedSchemas(zodOverride.body, state) };
        else if (typeOverride?.args[0]) base = this.resolveOverrideType(unquote(typeOverride.args[0]), state);
        else base = this.resolveBase(field, state);
        let built: Built = { ...base.built };
        let arrayChains: string[] = [];
        let forceOptional = false;
        if (isInput && !zodOverride) {
            const translated = translateValidators(annotations, {
                baseKind: base.baseKind,
                isList: field.isList,
                strategy: this.config.zodMessageStrategy,
                extraValidators: this.config.extraValidators
            });
            const element = [...translated.element];
            const maxLength = this.nativeLength(field);
            if (base.baseKind === 'string' && maxLength && !translated.hasMax) element.push(`.max(${maxLength})`);
            if (base.baseKind === 'string' && !field.isNullable && !translated.hasMin && !translated.base) element.push('.min(1)');
            if (translated.base || element.length) built = { code: `${translated.base ?? built.code}${element.join('')}`, type: null };
            arrayChains = translated.array;
            forceOptional = translated.optional;
        }
        if (field.isList && !zodOverride) built = { code: `z.array(${built.code})${arrayChains.join('')}`, type: built.type && !arrayChains.length ? `z.ZodArray<${built.type}>` : null };
        if (isInput) {
            for (const chain of annotations.filter((a) => a.name === ZOD_CHAIN && a.body)) built = { code: `${built.code}${chain.body!.startsWith('.') ? '' : '.'}${chain.body}`, type: null };
        }
        if (field.annotations.some((a) => a.name === DTO_READ_ONLY)) built = { code: `${built.code}.readonly()`, type: built.type && `z.ZodReadonly<${built.type}>` };
        built = this.applyPresence(field, built, forceOptional);
        const meta = this.renderMeta(annotations);
        if (meta) built = { code: `${built.code}${meta}`, type: built.type };
        if (!base.isRef) return `    ${field.name}: ${built.code}`;
        const annotation = this.schemaKind === 'entity' && built.type ? `: ${built.type}` : '';
        return `    get ${field.name}()${annotation} {\n        return ${built.code};\n    }`;
    }

    /** Applies optional / nullable / default modifiers according to the schema kind. */
    private applyPresence(field: Field, built: Built, forceOptional: boolean): Built {
        const isCreate = this.schemaKind === 'create';
        const optional = field.isList || !field.isRequired || forceOptional || (isCreate && field.hasDefaultValue);
        const nullable = Boolean(field.isNullable) || forceOptional;
        const defaultValue = isCreate ? this.defaultLiteral(field) : undefined;
        if (defaultValue !== undefined) return { code: `${built.code}${nullable ? '.nullable()' : ''}.default(${defaultValue})`, type: null };
        if (optional && nullable) return { code: `${built.code}.nullish()`, type: built.type && `z.ZodOptional<z.ZodNullable<${built.type}>>` };
        if (optional) return { code: `${built.code}.optional()`, type: built.type && `z.ZodOptional<${built.type}>` };
        if (nullable) return { code: `${built.code}.nullable()`, type: built.type && `z.ZodNullable<${built.type}>` };
        return built;
    }

    /** Renders `.meta({ description, examples })` from the Swagger `@description` / `@example` annotations. */
    private renderMeta(annotations: ZodAnnotation[]): string {
        const entries: string[] = [];
        const literal = (source: string) => (/^(['"`]|-?\d|true$|false$|null$|\[|\{)/.test(source) ? source : quote(source));
        const description = annotations.find((a) => a.name === 'description')?.body;
        const example = annotations.find((a) => a.name === 'example')?.body;
        if (description) entries.push(`description: ${literal(description)}`);
        if (example) entries.push(`examples: [${literal(example)}]`);
        return entries.length ? `.meta({ ${entries.join(', ')} })` : '';
    }

    /** Literal passed to `.default()` in Create schemas; function defaults (`now()`, `uuid()`, ...) are left to the database. */
    private defaultLiteral(field: Field): string | undefined {
        if (!field.hasDefaultValue) return undefined;
        const value = field.default;
        if (Array.isArray(value)) return JSON.stringify(value);
        if (value === null || value === undefined || typeof value === 'object') return undefined;
        const codecs = this.config.zodCodecs;
        switch (field.type) {
            case 'Json':
                try {
                    return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value);
                } catch {
                    return undefined;
                }
            case 'DateTime':
                return codecs ? `() => new Date(${quote(String(value))})` : quote(String(value));
            case 'BigInt':
                return codecs ? `${value}n` : quote(String(value));
            case 'Decimal':
                // Prisma 8 D3 default (`Decimal` as `z.string()`, `ts: 'string'`): the default is a string too.
                if (this.config.prisma8 && this.config.extraScalars.Decimal?.ts === 'string') return quote(String(value));
                return String(Number(value));
            case 'Float':
            case 'Int':
                return String(Number(value));
        }
        return typeof value === 'string' ? quote(value) : String(value);
    }

    /** `@db.VarChar(n)` / `@db.Char(n)` length, if any. */
    private nativeLength(field: Field): number | undefined {
        const [name, args] = field.nativeType ?? [];
        if (!name || !LENGTH_NATIVE_TYPES.has(name)) return undefined;
        const length = Number(args?.[0]);
        return Number.isInteger(length) && length > 0 ? length : undefined;
    }

    /** Imports every generated entity schema referenced by a raw expression; returns `true` if any was found. */
    private importReferencedSchemas(code: string, state: RenderState): boolean {
        let found = false;
        for (const model of this.models) {
            const name = this.schemaName(model.name);
            if (!new RegExp(`\\b${name}\\b`).test(code)) continue;
            this.importFrom(state, this.entitySchemaPath(model), name);
            found = true;
        }
        return found;
    }

    /** Maps a Prisma scalar to its Zod expression for the current schema kind. */
    private scalarSchema(type: string, state: RenderState): { code: string; baseKind: ZodBaseKind } {
        const override = this.config.extraScalars[type]?.zod;
        if (override) return { code: override, baseKind: 'other' };
        const isInput = this.schemaKind !== 'entity';
        const helper = (input: string, entity: string) => {
            const name = isInput ? input : entity;
            this.importFrom(state, this.scalarsPath(), name);
            return name;
        };
        switch (type) {
            case 'String':
                return { code: 'z.string()', baseKind: 'string' };
            case 'Boolean':
                return { code: 'z.boolean()', baseKind: 'other' };
            case 'Int':
                return { code: 'z.int()', baseKind: 'int' };
            case 'Float':
                return { code: 'z.number()', baseKind: 'number' };
            case 'Decimal':
                return { code: isInput ? 'z.number()' : helper('', 'DecimalEntitySchema'), baseKind: 'number' };
            case 'BigInt':
                return { code: helper('BigIntSchema', 'BigIntEntitySchema'), baseKind: 'other' };
            case 'DateTime':
                return { code: helper('DateTimeSchema', 'DateTimeEntitySchema'), baseKind: 'other' };
            case 'Bytes':
                return { code: helper('BytesSchema', 'BytesEntitySchema'), baseKind: 'other' };
            case 'Json':
                return { code: 'z.json()', baseKind: 'other' };
            default:
                return { code: 'z.unknown()', baseKind: 'other' };
        }
    }

    /** Resolves the base schema from the Prisma field kind (enum, relation, scalar). */
    private resolveBase(field: Field, state: RenderState): BaseSchema {
        const enumDef = this.getEnums().find((e) => e.name === field.type);
        if (field.kind === 'enum' || (enumDef && field.kind !== 'scalar')) {
            if (!enumDef) {
                this.warnOnce(`enum:${field.type}`, `Enum ${field.type} not found in the DMMF, falling back to z.string() in Zod mode.`);
                return { built: { code: 'z.string()', type: null }, baseKind: 'string', isRef: false };
            }
            const name = `${pascalCase(enumDef.name)}Schema`;
            this.importFrom(state, this.enumSchemaPath(enumDef.name), name);
            return { built: { code: name, type: `typeof ${name}` }, baseKind: 'other', isRef: false };
        }
        if (field.kind === 'object' || (!field.kind && !PRISMA_SCALARS.has(field.type))) {
            const related = this.models.find((m) => m.name === field.type);
            if (!related) return { built: { code: 'z.unknown()', type: null }, baseKind: 'other', isRef: false };
            // Prisma 8 value objects are stored inline (no id to connect by): each schema kind embeds the same kind of the value object.
            if (related.isValueObject && this.schemaKind !== 'entity') {
                const name = this.schemaName(related.name, this.schemaKind);
                this.importFrom(state, this.getPath(related), name);
                return { built: { code: name, type: `typeof ${name}` }, baseKind: 'other', isRef: true };
            }
            if (this.schemaKind === 'entity') {
                const name = this.schemaName(related.name);
                this.importFrom(state, this.entitySchemaPath(related), name);
                return { built: { code: name, type: `typeof ${name}` }, baseKind: 'other', isRef: true };
            }
            const ids = related.fields.filter((f) => f.isId);
            if (ids.length !== 1 || ids[0].kind === 'object') return { built: { code: 'z.looseObject({})', type: null }, baseKind: 'other', isRef: false };
            const pk = this.scalarSchema(ids[0].type, state).code;
            return { built: { code: `z.union([${pk}, z.looseObject({ ${ids[0].name}: ${pk}.optional() })])`, type: null }, baseKind: 'other', isRef: false };
        }
        if (field.kind === 'unsupported') return { built: { code: 'z.unknown()', type: null }, baseKind: 'other', isRef: false };
        const scalar = this.scalarSchema(field.type, state);
        return { built: { code: scalar.code, type: null }, baseKind: scalar.baseKind, isRef: false };
    }

    /**
     * Resolves `@DtoOverrideType(<Type>)` in Zod mode: generated models map to their entity
     * schema, TS primitives to the matching Zod schema, anything else to a Zod schema identifier
     * (`FooDto` -> `FooSchema`, `Foo` -> `FooSchema`, `FooSchema` unchanged) that must be
     * provided via `extraImports`.
     */
    private resolveOverrideType(type: string, state: RenderState): BaseSchema {
        const related = this.models.find((m) => m.name === type);
        if (related) {
            const name = this.schemaName(related.name);
            this.importFrom(state, this.entitySchemaPath(related), name);
            return { built: { code: name, type: `typeof ${name}` }, baseKind: 'other', isRef: true };
        }
        const primitives: Record<string, string> = { string: 'String', number: 'Float', boolean: 'Boolean', Date: 'DateTime', bigint: 'BigInt', Buffer: 'Bytes', Uint8Array: 'Bytes' };
        if (primitives[type]) {
            const scalar = this.scalarSchema(primitives[type], state);
            return { built: { code: scalar.code, type: null }, baseKind: scalar.baseKind, isRef: false };
        }
        if (['any', 'unknown', 'object', 'Object'].includes(type)) return { built: { code: 'z.unknown()', type: null }, baseKind: 'other', isRef: false };
        const identifier = type.endsWith('Schema') ? type : type.endsWith('Dto') ? `${type.slice(0, -3)}Schema` : `${type}Schema`;
        const declared = this.config.extraImports.some((i) => i.destruct?.includes(identifier) || i.alias?.split(' as ').pop()?.trim() === identifier);
        if (!declared) this.warnOnce(`override:${identifier}`, `@DtoOverrideType(${type}) maps to ${identifier} in Zod mode; declare it in extraImports so the generated files can import it.`);
        return { built: { code: identifier, type: null }, baseKind: 'other', isRef: false };
    }

    /** Logs a warning only once per process for the given key. */
    protected warnOnce(key: string, message: string): void {
        if (warnedOnce.has(key)) return;
        warnedOnce.add(key);
        Utility.warn(message);
    }
}
