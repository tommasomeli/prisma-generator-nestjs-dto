import path from 'node:path';
import fs from 'node:fs';
import {
    DTO_API_EXTRA_MODELS,
    DTO_API_HIDDEN,
    DTO_IGNORE_MODEL,
    DTO_OVERRIDE_API_PROPERTY_TYPE,
    DTO_OVERRIDE_TYPE,
    DTO_READ_ONLY
} from './annotations';
import {
    ANNOTATION_NAME_REGEX,
    ANNOTATION_PARAMS_REGEX,
    ANNOTATION_PARAMS_SPLIT_REGEX,
    CLASS_TRANSFORMER_DECORATORS,
    CLASS_VALIDATOR_DECORATORS,
    PRISMA_SCALAR,
    PRISMA_SCALAR_FORMAT,
    PRISMA_SCALAR_TYPE,
    SWAGGER_API_PROPERTY_DECORATORS,
    SWAGGER_DECORATORS
} from './constants';
import { Annotation, Field, File, GeneratorConfig, GeneratorOptions, ImportType, Model, NamingStrategy, OutputStructure, OutputType, RawGeneratorConfig } from './types';
import { Utility } from './utility';

/**
 * Base class for every sub-generator. Concrete generators describe how their files
 * are named (prefix/suffix) and contribute a `generate()` that yields `File[]`.
 * Subclasses normally only override `generate()` and rely on `getTemplate()` to
 * render the class body (imports, decorators, validators, field declarations).
 */
export abstract class BaseGenerator {
    protected options: GeneratorOptions;
    protected config: GeneratorConfig;
    public models: Model[];

    constructor(options: GeneratorOptions) {
        this.options = options;
        const raw = options.generator.config as RawGeneratorConfig;
        const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
        this.config = {
            provider: options.generator.provider?.value || '',
            output: options.generator.output?.value || '',
            outputType: (asString(raw.outputType) as OutputType) || 'class',
            outputStructure: (asString(raw.outputStructure) as OutputStructure) || 'nestjs',
            reExport: Utility.parseBoolean(asString(raw.reExport)),
            fileNamingStrategy: (asString(raw.fileNamingStrategy) as NamingStrategy) || 'camel',
            classValidator: Utility.parseBoolean(asString(raw.classValidator)),
            swaggerDocs: Utility.parseBoolean(asString(raw.swaggerDocs)),
            prettier: Utility.parseBoolean(asString(raw.prettier)),
            schemaDir: asString(raw.schemaDir),
            emitManifest: Utility.parseBoolean(asString(raw.emitManifest)),
            extraDecorators: Utility.parseImports(raw.extraDecorators),
            extraValidators: Utility.parseImports(raw.extraValidators),
            extraImports: Utility.parseImports(raw.extraImports),
            extraGenerators: raw.extraGenerators,
            extraScalars: Utility.parseExtraScalars(raw.extraScalars),
            extraAnnotations: Utility.parseAnnotationNames(raw.extraAnnotations)
        };
        this.models = this.options.dmmf.datamodel.models
            .map<Model>((model) => ({
                name: model.name,
                dbName: model.dbName,
                documentation: model.documentation,
                primaryKey: model.primaryKey,
                uniqueFields: model.uniqueFields as readonly (readonly string[])[],
                uniqueIndexes: model.uniqueIndexes,
                isGenerated: model.isGenerated,
                annotations: this.extractAnnotations(model.documentation || ''),
                outputType: this.config.outputType,
                fields: [
                    ...model.fields.map<Field>((field) => ({
                        name: field.name,
                        type: field.type,
                        kind: field.kind as Field['kind'],
                        isList: field.isList,
                        isRequired: field.isRequired,
                        isUnique: field.isUnique,
                        isId: field.isId,
                        isReadOnly: field.isReadOnly,
                        isGenerated: field.isGenerated,
                        isUpdatedAt: field.isUpdatedAt,
                        hasDefaultValue: field.hasDefaultValue,
                        default: field.default,
                        relationName: field.relationName,
                        relationFromFields: field.relationFromFields as readonly string[] | string[],
                        relationToFields: field.relationToFields as readonly string[] | string[],
                        relationOnDelete: field.relationOnDelete,
                        documentation: field.documentation,
                        isNullable: !field.isRequired || field.isList,
                        annotations: this.extractAnnotations(field.documentation || '')
                    })),
                    ...this.getIgnoredFields(model.name)
                ]
            }))
            .filter((model) => !model.annotations.some((a) => a.name === DTO_IGNORE_MODEL));
    }

    abstract filePrefix: string;
    abstract fileSuffix: string;
    abstract classPrefix: string;
    abstract classSuffix: string;

    /** Produces the list of files this generator wants to emit. */
    abstract generate(): Promise<File[]>;

    /**
     * Optional pre-pass invoked once before any built-in or plugin `generate()` runs.
     * Receives the **shared** `Model[]` array (already filtered for `@DtoIgnoreModel`);
     * mutating it (e.g. injecting synthetic fields, rewriting annotations) is supported
     * and visible to every generator that runs afterwards. Defaults to no-op.
     */
    async beforeAll(_models: Model[]): Promise<void> {}

    /**
     * Optional post-pass invoked once after every generator's `generate()` completes,
     * receiving the **complete** list of files produced in the run (built-ins + plugins).
     * Return a non-empty `File[]` to append extra files (e.g. an aggregated barrel,
     * audit report, schema export); return `void` to leave the run untouched. Defaults to no-op.
     */
    async afterAll(_files: File[]): Promise<File[] | void> {}

    /**
     * Reads `@ignore` fields from `.prisma` files inside `schemaDir`. Prisma
     * strips ignored fields from the DMMF but we still want them visible to
     * annotations like `@DtoApiHidden`, so we re-parse the raw schema.
     */
    private getIgnoredFields(modelName: string): Field[] {
        try {
            if (!this.config.schemaDir) return [];
            const schemaDir = path.resolve(process.cwd(), this.config.schemaDir);
            if (!fs.existsSync(schemaDir)) {
                Utility.warn(`Configured schemaDir does not exist: ${schemaDir}`);
                return [];
            }
            const findPrismaFilesRecursively = (dir: string): string[] => {
                const files: string[] = [];
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) files.push(...findPrismaFilesRecursively(fullPath));
                        else if (entry.isFile() && entry.name.endsWith('.prisma') && entry.name !== 'schema.prisma') files.push(fullPath);
                    }
                } catch (error) {
                    Utility.warn(`Could not read directory ${dir}:`, error);
                }
                return files;
            };
            const schemaFiles = findPrismaFilesRecursively(schemaDir);
            const ignoredFields: Field[] = [];
            for (const schemaFile of schemaFiles) {
                const schemaContent = fs.readFileSync(schemaFile, 'utf8');
                const modelRegex = new RegExp(`model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\}`, 'g');
                const modelMatch = modelRegex.exec(schemaContent);
                if (!modelMatch) continue;
                const modelContent = modelMatch[1];
                const fieldRegex = /((?:[ \t]*\/\/\/[^\n]*\n)*)([ \t]*)([a-zA-Z_][a-zA-Z0-9_]*)\s+([a-zA-Z0-9\[\]?]+)([^@\n]*@ignore)/g;
                let fieldMatch;
                while ((fieldMatch = fieldRegex.exec(modelContent)) !== null) {
                    const documentation = fieldMatch[1]?.trim() || '';
                    const fieldName = fieldMatch[3];
                    const fieldType = fieldMatch[4];
                    const isOptional = fieldType.includes('?');
                    const isList = fieldType.includes('[]');
                    const cleanType = fieldType.replace(/[\[\]?]/g, '');
                    const kind: 'scalar' | 'object' | 'enum' = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt', 'Bytes'].includes(cleanType) ? 'scalar' : 'object';
                    ignoredFields.push({
                        name: fieldName,
                        type: cleanType,
                        kind,
                        isList,
                        isRequired: !isOptional,
                        isNullable: isOptional || isList,
                        annotations: this.extractAnnotations(documentation),
                        isId: false,
                        isUnique: false,
                        isReadOnly: false,
                        hasDefaultValue: false
                    });
                }
            }
            return ignoredFields;
        } catch (error) {
            Utility.warn(`Could not read ignored fields for model ${modelName}:`, error);
            return [];
        }
    }

    /** Parses `/// @Foo(arg, {object})` documentation strings into structured annotations. */
    private extractAnnotations(documentation: string): Annotation[] {
        const annotations: Annotation[] = [];
        let nameMatch;
        while ((nameMatch = ANNOTATION_NAME_REGEX.exec(documentation)) !== null) {
            const annotationName = nameMatch[1];
            const startPosition = nameMatch.index + ('@' + annotationName).length;
            const remainingText = documentation.substring(startPosition);
            if (!remainingText.startsWith('(')) {
                annotations.push({ name: annotationName, params: [] });
                continue;
            }
            ANNOTATION_PARAMS_REGEX.lastIndex = 0;
            const paramsMatch = ANNOTATION_PARAMS_REGEX.exec(remainingText);
            let params: any[] = [];
            if (paramsMatch && paramsMatch[1]) {
                const paramsString = paramsMatch[1].trim();
                params = paramsString
                    .split(ANNOTATION_PARAMS_SPLIT_REGEX)
                    .map((param) => param.trim())
                    .map((param) => {
                        if (param.startsWith('{') && param.endsWith('}')) return param;
                        return isNaN(Number(param)) ? param : Number(param);
                    })
                    .filter(Boolean);
            }
            annotations.push({ name: annotationName, params });
        }
        return annotations;
    }

    /**
     * Returns the first annotation matching `name` on a field or model, or `undefined`.
     * Use from custom sub-generators to react to user-defined annotations declared via
     * `extraAnnotations` (or any built-in `@Dto*` name).
     */
    public getAnnotation(target: { annotations: Annotation[] }, name: string): Annotation | undefined {
        return target.annotations.find((a) => a.name === name);
    }

    /** Convenience boolean form of {@link getAnnotation}. */
    public hasAnnotation(target: { annotations: Annotation[] }, name: string): boolean {
        return this.getAnnotation(target, name) !== undefined;
    }

    /**
     * Adds (and merges) an import descriptor into an `ImportType[]` array, honouring
     * the same dedup/merge rules used by the built-in pipeline. Repeated calls with
     * the same `from` collapse named imports together; `alias` entries are stored
     * separately from `destruct` entries on the same path.
     */
    protected addImport(imports: ImportType[], next: ImportType): void {
        this.mergeImport(imports, next);
    }

    /**
     * Renders an `ImportType[]` array as a multi-line `import ... from '...'` block.
     * Absolute paths (e.g. produced by `getPath(relatedModel, outputPath)`) are rewritten
     * as POSIX-style relative paths anchored at `outputPath`; TypeScript file extensions
     * (`.ts` / `.mts` / `.cts` / `.tsx`) on the `from` path are stripped automatically
     * since they are never desired in import statements.
     */
    protected formatImports(imports: ImportType[], outputPath?: string): string {
        return imports
            .map((i) => {
                const from = this.stripTsExtension(this.rewriteImportPath(i.from, outputPath));
                return `import ${i.alias ? i.alias : `{ ${(i.destruct || []).join(', ')} }`} from '${from}';`;
            })
            .join('\n');
    }

    /**
     * Returns the output path of a `model` formatted for use as an `import` specifier:
     * same as {@link getPath} but with the TypeScript file extension stripped and a
     * `./` prefix added when the result would otherwise look like a bare module specifier
     * (`flat` outputStructure case). Use this when a custom sub-generator needs to
     * reference a peer-generated file (e.g. for relations between models) and you would
     * otherwise hand-strip `.ts` from `getPath`.
     */
    protected getImportPath(model: Model, fromOutputPath?: string): string {
        const stripped = this.stripTsExtension(this.getPath(model, fromOutputPath));
        if (fromOutputPath && !stripped.startsWith('.') && !path.isAbsolute(stripped)) return `./${stripped}`;
        return stripped;
    }

    /** Strips `.ts` / `.mts` / `.cts` / `.tsx` suffixes from an `import` specifier. */
    private stripTsExtension(from: string): string {
        return from.replace(/\.(ts|mts|cts|tsx)$/, '');
    }

    /** File / class name transformer. Defaults to camelCase. */
    protected getModelName(name: string): string {
        switch (this.config.fileNamingStrategy) {
            case 'snake':
                return name.charAt(0).toLowerCase() + name.slice(1).replace(/[A-Z]/g, (char) => '_' + char.toLowerCase());
            case 'kebab':
                return (
                    name.charAt(0).toLowerCase() +
                    name
                        .slice(1)
                        .replace(/[A-Z]/g, (char) => '-' + char.toLowerCase())
                        .replace(/_/g, '-')
                );
            default:
            case 'camel':
                return name.charAt(0).toLowerCase() + name.slice(1).replace(/_(\w)/g, (_, char) => char.toUpperCase());
        }
    }

    /**
     * Applies `@DtoOverrideType(<type>)` non-destructively. The original `model`
     * is left untouched; callers receive a model with cloned fields whose `kind`
     * and `type` reflect the override.
     */
    private applyOverrides(model: Model): Model {
        const fields = model.fields.map((field) => {
            const overrideType = field.annotations.find((a) => a.name === DTO_OVERRIDE_TYPE);
            if (overrideType && overrideType.params?.[0]) {
                const clone: Field = { ...field };
                delete (clone as { kind?: unknown }).kind;
                clone.type = String(overrideType.params[0]);
                return clone;
            }
            return field;
        });
        return { ...model, fields };
    }

    /**
     * Merges a new `ImportType` into the existing array. Distinct concerns are kept
     * as separate entries (i.e. an `alias` import and a `destruct` import from the
     * same path will not collide).
     */
    private mergeImport(imports: ImportType[], next: ImportType): void {
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

    /** Collects every import the rendered class will need. */
    private getImports(args: { model: Model; classValidator?: boolean; swaggerDocs?: boolean }): ImportType[] {
        const { model, classValidator = Utility.parseBoolean(this.config.classValidator) || false, swaggerDocs = Utility.parseBoolean(this.config.swaggerDocs) || false } = args;
        const imports: ImportType[] = [];
        // Any descriptor in extraValidators / extraDecorators / extraImports that exports
        // a name colliding with a built-in import (`class-validator`, `@nestjs/swagger`,
        // `class-transformer`, `@prisma/client`, ...) wins: the symbol is routed through
        // the user module instead of the default one.
        const findOverride = (name: string): ImportType | undefined =>
            [...this.config.extraValidators, ...this.config.extraDecorators, ...this.config.extraImports]
                .find((v) => v.destruct?.includes(name));
        const addImport = (importParams: ImportType) => {
            if (!importParams.destruct?.length || importParams.alias) {
                this.mergeImport(imports, importParams);
                return;
            }
            const grouped = new Map<string, string[]>();
            importParams.destruct.forEach((name) => {
                const from = findOverride(name)?.from ?? importParams.from;
                grouped.set(from, [...(grouped.get(from) ?? []), name]);
            });
            grouped.forEach((destruct, from) => this.mergeImport(imports, { from, destruct }));
        };
        const scalarOverrides = this.config.extraScalars ?? {};
        model.fields.forEach((field: Field) => {
            if (field.kind === 'object' && field.type && field.type !== `${this.classPrefix}${model.name}${this.classSuffix}`) {
                const relationModel = this.models.find((m) => m.name === field.type);
                if (relationModel) {
                    const importPath = this.getPath(relationModel, this.getPath(model));
                    addImport({ from: Utility.parseBoolean(this.config.reExport) ? path.dirname(importPath) : importPath, destruct: [relationModel.name] });
                }
            }
            if (field.kind === 'enum') addImport({ from: '@prisma/client', destruct: [field.type] });
            const override = scalarOverrides[field.type];
            if (override && override.from) addImport({ from: override.from, destruct: [override.ts] });
            // Built-in `Prisma.Json` / `Prisma.Decimal` are only needed when the user has NOT overridden the scalar.
            else if (field.type === 'Json' || field.type === 'Decimal') addImport({ from: '@prisma/client', destruct: ['Prisma'] });
        });
        if (this.config.outputType === 'class' && swaggerDocs) {
            const addSwaggerDecorator = (decorator: string) => addImport({ from: '@nestjs/swagger', destruct: [decorator] });
            addSwaggerDecorator('ApiProperty');
            const extraModelsAnnotation = model.annotations.find((a) => a.name === DTO_API_EXTRA_MODELS);
            if (extraModelsAnnotation?.params?.length) addSwaggerDecorator('ApiExtraModels');
            model.fields.forEach((field: Field) => {
                field.annotations.forEach((annotation) => {
                    if (SWAGGER_DECORATORS.includes(annotation.name)) addSwaggerDecorator(annotation.name);
                });
            });
        }
        if (this.config.outputType === 'class' && classValidator) {
            const addValidator = (decorator: string) => addImport({ from: 'class-validator', destruct: [decorator] });
            model.fields.forEach((field: Field) => {
                if (!field.isRequired) addValidator('IsOptional');
                if (!field.isNullable) addValidator('IsNotEmpty');
                if (field.isList) addValidator('IsArray');
                switch (field.type) {
                    case 'String':
                        addValidator('IsString');
                        break;
                    case 'Int':
                        addValidator('IsInt');
                        break;
                    case 'Float':
                        addValidator('IsNumber');
                        break;
                    case 'Boolean':
                        addValidator('IsBoolean');
                        break;
                    case 'DateTime':
                        addValidator('IsDateString');
                        break;
                    case 'Json':
                        addValidator('IsObject');
                        break;
                }
                if (field.kind === 'object') {
                    addValidator('ValidateNested');
                    addImport({ from: 'class-transformer', destruct: ['Type'] });
                }
                field.annotations.forEach((annotation) => {
                    if (CLASS_VALIDATOR_DECORATORS.includes(annotation.name)) addValidator(annotation.name);
                });
                field.annotations.forEach((annotation) => {
                    if (CLASS_TRANSFORMER_DECORATORS.includes(annotation.name)) addImport({ from: 'class-transformer', destruct: [annotation.name] });
                });
                if (this.config.extraValidators.length) {
                    field.annotations.forEach((annotation) => {
                        this.config.extraValidators.forEach((validatorImport) => {
                            if (annotation.name === validatorImport.alias || (validatorImport.destruct && validatorImport.destruct.includes(annotation.name))) {
                                if (validatorImport.alias) addImport({ from: validatorImport.from, alias: validatorImport.alias });
                                else if (validatorImport.destruct) addImport({ from: validatorImport.from, destruct: [annotation.name] });
                            }
                        });
                    });
                }
            });
        }
        if (this.config.extraDecorators.length) {
            model.fields.forEach((field: Field) => {
                field.annotations.forEach((annotation) => {
                    this.config.extraDecorators.forEach((decoratorImport) => {
                        if (annotation.name === decoratorImport.alias || (decoratorImport.destruct && decoratorImport.destruct.includes(annotation.name))) {
                            if (decoratorImport.alias) addImport({ from: decoratorImport.from, alias: decoratorImport.alias });
                            else if (decoratorImport.destruct) addImport({ from: decoratorImport.from, destruct: [annotation.name] });
                        }
                    });
                });
            });
        }
        if (this.config.extraImports.length) {
            model.fields.forEach((field: Field) => {
                field.annotations.forEach((annotation) => {
                    const isValidatorAnnotation =
                        CLASS_VALIDATOR_DECORATORS.includes(annotation.name) ||
                        CLASS_TRANSFORMER_DECORATORS.includes(annotation.name) ||
                        this.config.extraValidators.some((v) => annotation.name === v.alias || (v.destruct && v.destruct.includes(annotation.name)));
                    const isSwaggerAnnotation = SWAGGER_DECORATORS.includes(annotation.name) || SWAGGER_API_PROPERTY_DECORATORS.includes(annotation.name);
                    if ((isValidatorAnnotation && !classValidator) || (isSwaggerAnnotation && !swaggerDocs)) return;
                    if (!annotation.params) return;
                    this.config.extraImports.forEach((importConfig) => {
                        if (importConfig.alias) {
                            const aliasName = importConfig.alias.split(' as ')[1] || importConfig.alias;
                            const isUsed = annotation.params.some((param: any) => typeof param === 'string' && param.includes(aliasName));
                            if (isUsed) addImport({ from: importConfig.from, alias: importConfig.alias });
                        } else if (importConfig.destruct) {
                            importConfig.destruct.forEach((item) => {
                                const isUsed = annotation.params.some((param: any) => typeof param === 'string' && param.includes(item));
                                if (isUsed) addImport({ from: importConfig.from, destruct: [item] });
                            });
                        }
                    });
                });
            });
            const extraModelsAnnotation = model.annotations.find((a) => a.name === DTO_API_EXTRA_MODELS);
            if (extraModelsAnnotation?.params?.length) {
                extraModelsAnnotation.params.forEach((param: any) => {
                    if (typeof param !== 'string') return;
                    const typeName = param.trim();
                    this.config.extraImports.forEach((importConfig) => {
                        if (importConfig.destruct && importConfig.destruct.includes(typeName)) addImport({ from: importConfig.from, destruct: [typeName] });
                    });
                });
            }
        }
        model.fields.forEach((field: Field) => {
            const overrideType = field.annotations.find((a) => a.name === DTO_OVERRIDE_TYPE);
            if (overrideType && overrideType.params?.[0]) {
                const overrideModel = this.models.find((m) => m.name === String(overrideType.params[0]));
                if (overrideModel) {
                    const importPath = this.getPath(overrideModel, this.getPath(model));
                    addImport({ from: Utility.parseBoolean(this.config.reExport) ? path.dirname(importPath) : importPath, destruct: [overrideModel.name] });
                }
            }
            const overrideApiPropertyType = field.annotations.find((a) => a.name === DTO_OVERRIDE_API_PROPERTY_TYPE);
            if (overrideApiPropertyType && overrideApiPropertyType.params?.[0]) {
                const overrideModel = this.models.find((m) => m.name === String(overrideApiPropertyType.params[0]));
                if (overrideModel) {
                    const importPath = this.getPath(overrideModel, this.getPath(model));
                    addImport({ from: Utility.parseBoolean(this.config.reExport) ? path.dirname(importPath) : importPath, destruct: [overrideModel.name] });
                }
            }
        });
        return imports;
    }

    /**
     * Resolves an import `from` value for the file being emitted. Absolute paths
     * (typically produced when a relative `from` was declared in the external config file)
     * are rewritten as POSIX-style relative paths anchored at the output file's directory.
     */
    private rewriteImportPath(from: string, outputPath?: string): string {
        if (!outputPath || !path.isAbsolute(from)) return from;
        const absoluteOutput = path.resolve(outputPath);
        let relative = path.relative(path.dirname(absoluteOutput), from);
        if (!relative.startsWith('.') && !path.isAbsolute(relative)) relative = `./${relative}`;
        return relative.split(path.sep).join('/');
    }

    /** Renders the `import ... from ...` block. */
    private getImportsTemplate(args: { model: Model; classValidator?: boolean; swaggerDocs?: boolean; outputPath?: string }): string {
        return this.formatImports(this.getImports(args), args.outputPath);
    }

    /**
     * Renders the full class body (imports + class declaration with decorators and fields).
     * Sub-generators usually feed it a `model` they already pre-filtered.
     */
    public getTemplate(args: { model: Model; classValidator?: boolean; swaggerDocs?: boolean; outputPath?: string }): string {
        const classValidator = Utility.parseBoolean(args.classValidator ?? this.config.classValidator) || false;
        const swaggerDocs = Utility.parseBoolean(args.swaggerDocs ?? this.config.swaggerDocs) || false;
        const model = this.applyOverrides(args.model);
        const scalarOverrides = this.config.extraScalars ?? {};
        const getPropertyType = (field: Field, isDecorator = false): string => {
            const override = field.kind === 'scalar' ? scalarOverrides[field.type] : undefined;
            if (override) {
                if (!isDecorator) return override.ts;
                if (override.apiType) return override.apiType;
                // No explicit `apiType`: assume `ts` is a class identifier when it has a source module,
                // otherwise treat it as a primitive name ('string', 'number', ...).
                return override.from ? `() => ${override.ts}` : `'${override.ts}'`;
            }
            const SCALAR_TYPE = isDecorator ? Object.fromEntries(Object.entries(PRISMA_SCALAR_TYPE).map(([key, value]) => [key, value.startsWith('() =>') ? value : `'${value}'`])) : PRISMA_SCALAR;
            if (field.kind === 'scalar') return SCALAR_TYPE[field.type] || 'any';
            else if ((field.kind === 'enum' || field.kind === 'object') && isDecorator) return `() => ${field.type}`;
            return field.type;
        };
        const getDefaultValue = (field: Field): any => {
            if (!field.hasDefaultValue) return undefined;
            if (Array.isArray(field.default)) return JSON.stringify(field.default);
            switch (typeof field.default) {
                case 'string':
                case 'number':
                case 'boolean':
                    if (field.type === 'Decimal' && typeof field.default === 'number') return `new Prisma.Decimal(${field.default})`;
                    return field.default;
                case 'object':
                    if (field.default && typeof field.default === 'object' && 'name' in field.default) {
                        if (field.default.name === 'now' && field.type === 'DateTime') return undefined;
                        if (field.default.name === 'autoincrement') return undefined;
                        return field.default.name;
                    }
                    return undefined;
                default:
                    return undefined;
            }
        };
        const encapsulateString = (value: string): string => {
            if (value === 'true' || value === 'false' || value === 'null' || /^-?\d+(?:\.\d+)?$/.test(value) || /^\[.*]$/.test(value)) return value;
            return `'${value.replace(/'/g, "\\'")}'`;
        };
        const fields = model.fields
            .map((field: Field) => {
                const decorators: string[] = [];
                if (this.config.outputType === 'class' && swaggerDocs) {
                    if (field.annotations.some((a) => a.name === DTO_API_HIDDEN)) {
                        decorators.push('@ApiHideProperty()');
                    } else {
                        const apiPropertyParams: string[] = [];
                        if (field.kind === 'enum') {
                            apiPropertyParams.push(`enum: ${field.type}`);
                            apiPropertyParams.push(`enumName: ${encapsulateString(field.type)}`);
                        } else {
                            const overrideApiPropertyType = field.annotations.find((a) => a.name === DTO_OVERRIDE_API_PROPERTY_TYPE);
                            if (overrideApiPropertyType && overrideApiPropertyType.params && overrideApiPropertyType.params.length > 0) {
                                apiPropertyParams.push(`type: () => ${overrideApiPropertyType.params[0]}`);
                            } else {
                                apiPropertyParams.push(`type: ${getPropertyType(field, true)}`);
                            }
                        }
                        if (field.isList) apiPropertyParams.push(`isArray: true`);
                        apiPropertyParams.push(`required: ${!field.isList && field.isRequired}`);
                        if (field.isNullable) apiPropertyParams.push(`nullable: ${field.isNullable}`);
                        const formatOverride = scalarOverrides[field.type]?.format;
                        const scalarFormat = formatOverride ?? PRISMA_SCALAR_FORMAT[field.type]?.format;
                        if (scalarFormat) apiPropertyParams.push(`format: ${encapsulateString(scalarFormat)}`);
                        const defaultValue = getDefaultValue(field);
                        if (defaultValue !== undefined) apiPropertyParams.push(`default: ${typeof defaultValue === 'string' ? encapsulateString(defaultValue) : defaultValue}`);
                        SWAGGER_API_PROPERTY_DECORATORS.forEach((prop) => {
                            const annotation = field.annotations.find((a) => a.name === prop);
                            if (annotation) {
                                const value = annotation.params ? annotation.params[0] : '';
                                apiPropertyParams.push(`${prop}: ${encapsulateString(String(value))}`);
                            }
                        });
                        decorators.push(`@ApiProperty({ ${apiPropertyParams.join(', ')} })`);
                        field.annotations
                            .filter((annotation) => SWAGGER_DECORATORS.includes(annotation.name))
                            .forEach((annotation) => {
                                const params = annotation.params ? `(${annotation.params.join(', ')})` : '';
                                decorators.push(`@${annotation.name}${params}`);
                            });
                    }
                }
                if (this.config.outputType === 'class' && classValidator) {
                    if (field.isList || !field.isRequired) decorators.push('@IsOptional()');
                    if (!field.isNullable) decorators.push('@IsNotEmpty()');
                    if (field.isList) decorators.push('@IsArray()');
                    switch (field.type) {
                        case 'String':
                            decorators.push(field.isList ? '@IsString({ each: true })' : '@IsString()');
                            break;
                        case 'Int':
                            decorators.push(field.isList ? '@IsInt({ each: true })' : '@IsInt()');
                            break;
                        case 'Float':
                            decorators.push(field.isList ? '@IsNumber({}, { each: true })' : '@IsNumber()');
                            break;
                        case 'Boolean':
                            decorators.push(field.isList ? '@IsBoolean({ each: true })' : '@IsBoolean()');
                            break;
                        case 'DateTime':
                            decorators.push(field.isList ? '@IsDateString({}, { each: true })' : '@IsDateString()');
                            break;
                        case 'Json':
                            decorators.push(field.isList ? '@IsObject({ each: true })' : '@IsObject()');
                            break;
                    }
                    if (field.kind === 'object') {
                        decorators.push(field.isList ? '@ValidateNested({ each: true })' : '@ValidateNested()');
                        decorators.push(`@Type(() => ${field.type})`);
                    }
                    field.annotations
                        .filter((annotation) => CLASS_VALIDATOR_DECORATORS.includes(annotation.name) || CLASS_TRANSFORMER_DECORATORS.includes(annotation.name))
                        .forEach((annotation) => {
                            const params = annotation.params ? `(${annotation.params.join(', ')})` : '';
                            decorators.push(`@${annotation.name}${params}`);
                        });
                    if (this.config.extraValidators.length) {
                        field.annotations.forEach((annotation) => {
                            const validator = this.config.extraValidators.find((d) => annotation.name === d.alias || (d.destruct ? d.destruct.includes(annotation.name) : false));
                            if (validator) decorators.push(`@${annotation.name}(${annotation.params})`);
                        });
                    }
                }
                if (this.config.extraDecorators.length) {
                    field.annotations.forEach((annotation) => {
                        const decorator = this.config.extraDecorators.find((d) => annotation.name === d.alias || (d.destruct ? d.destruct.includes(annotation.name) : false));
                        if (decorator) decorators.push(`@${annotation.name}(${annotation.params})`);
                    });
                }
                const isReadOnly = field.annotations.some((a) => a.name === DTO_READ_ONLY);
                const defaultValue = getDefaultValue(field);
                const hasDefault = defaultValue !== undefined && this.config.outputType === 'class';
                let fieldType = getPropertyType(field);
                if (field.isList) fieldType += '[]';
                if (field.isNullable && !hasDefault) fieldType += ' | null';
                return `\t${decorators.length ? decorators.join('\n\t') + '\n' : ''}\t${isReadOnly ? ' readonly' : ''} ${field.name}${!field.isRequired || (field.isNullable && !hasDefault) || hasDefault ? '?' : this.config.outputType === 'class' ? '!' : ''}: ${fieldType}${hasDefault ? ` = ${typeof defaultValue === 'string' && !defaultValue.startsWith('new') ? `'${defaultValue}'` : defaultValue}` : ''};\n`;
            })
            .join('\n');
        const className = `${this.classPrefix}${model.name}${this.classSuffix}`;
        const classDecorators: string[] = [];
        if (swaggerDocs) {
            const extraModelsAnnotation = model.annotations.find((a) => a.name === DTO_API_EXTRA_MODELS);
            if (extraModelsAnnotation?.params?.length) classDecorators.push(`@ApiExtraModels(${extraModelsAnnotation.params.join(', ')})`);
        }
        const decoratorsString = classDecorators.length ? `${classDecorators.join('\n')}\n` : '';
        return `${this.getImportsTemplate({ model, classValidator, swaggerDocs, outputPath: args.outputPath })}\n\n${decoratorsString}export ${this.config.outputType} ${className.charAt(0).toUpperCase() + className.slice(1).replace(/_(\w)/g, (_, char) => char.toUpperCase())} {\n${fields}}`;
    }

    /** Returns the absolute (or relative-to-`relativeFrom`) output path for `model`. */
    public getPath(model: Model, relativeFrom?: string): string {
        const modelName = this.getModelName(model.name);
        const fileName = `${this.filePrefix}${modelName}${this.fileSuffix}`;
        let outputPath = '';
        switch (this.config.outputStructure) {
            case 'nestjs':
                outputPath = `${this.config.output}/${modelName}/${fileName}.ts`;
                break;
            default:
            case 'flat':
                outputPath = `${this.config.output}/${fileName}.ts`;
                break;
        }
        return relativeFrom ? path.relative(path.dirname(relativeFrom), outputPath) : outputPath;
    }
}
