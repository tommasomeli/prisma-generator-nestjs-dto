<div align="center">

# Prisma Generator NestJS DTO

[![npm version](https://img.shields.io/npm/v/@tommasomeli/prisma-generator-nestjs-dto.svg)](https://www.npmjs.com/package/@tommasomeli/prisma-generator-nestjs-dto)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/tommasomeli)

A Prisma generator for NestJS DTOs with first-class **plugin** and **annotation** APIs.<br/>
Emits `Create*Dto` / `Update*Dto` / `*Entity` classes with `class-validator` + `@nestjs/swagger` decorators, then gets out of your way.

</div>

## Features

- **Pluggable sub-generators** — drop in any `BaseGenerator` subclass next to the built-in DTOs (`extraGenerators`). TypeScript plugin files are loaded directly via `jiti`, no precompilation needed.
- **Lifecycle hooks** — optional `beforeAll(models)` / `afterAll(files)` on every generator for shared pre/post-passes (model mutation, aggregated barrels, audit reports).
- **Custom annotations** — register `@MyAnnotation(args)` names and read them inside your plugins (`extraAnnotations`).
- **Per-name override of built-in imports** — swap `@IsBoolean` for a permissive variant without touching the DTOs.
- **Scalar overrides** (`extraScalars`) — reroute Prisma scalars (`Decimal`, `Json`, ...) to your own TS types + import + Swagger metadata.
- **Type-safe external config** — `.ts` / `.json` config with `from()` / `fromNamespace()` helpers that validate paths and named exports at compile time.
- **Annotation-driven decorators / validators / imports** — bind any `///` annotation to a user module via `extraDecorators` / `extraValidators` / `extraImports`.
- **Optional runtime manifest** (`emitManifest`) for select builders, audit middleware, RBAC field lists.
- **Auto-imports** for `@DtoOverrideType`, relation DTOs and annotation arguments — emitted files are always self-contained.

## Contents

- [Install](#install)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [Plugin system - custom generator](#plugin-system---custom-generator)
- [Extra features](#extra-features)
- [External config file](#external-config-file)
- [Annotations](#annotations)
- [Manifest output (opt-in)](#manifest-output-opt-in)
- [Comparison](#comparison)
- [Contributing](#contributing)
- [How it works](#how-it-works)
- [License](#license)

## Install

```bash
npm i -D @tommasomeli/prisma-generator-nestjs-dto
```

Peers: `@prisma/generator-helper >= 5`, `prettier >= 3` (optional).

## Quickstart

```prisma
generator nestjsDto {
  provider           = "prisma-generator-nestjs-dto"
  output             = "../src/generated/nestjs-dto"
  outputType         = "class"
  outputStructure    = "nestjs"
  fileNamingStrategy = "kebab"
  reExport           = "true"
  classValidator     = "true"
  swaggerDocs        = "true"
  prettier           = "true"
}
```

```bash
npx prisma generate
```

For every model `User` you get:

```
src/generated/nestjs-dto/
  user/
    user.entity.ts
    create-user.dto.ts
    update-user.dto.ts
    index.ts
  index.ts
```

## Configuration


| Option               | Type                        | Default                       | Description                                                                                                                                     |
| -------------------- | --------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `output`             | string                      | `../src/generated/nestjs-dto` | Destination directory.                                                                                                                          |
| `configFile`         | string                      | —                             | Path to an external `.ts` / `.cts` / `.mts` / `.js` / `.cjs` / `.mjs` / `.json` config file. See [External config file](#external-config-file). |
| `outputType`         | `class` | `interface`       | `class`                       | TypeScript classes (with decorators) or plain interfaces.                                                                                       |
| `outputStructure`    | `nestjs` | `flat`           | `nestjs`                      | `nestjs` puts each model in its own folder, `flat` keeps everything in `output`.                                                                |
| `fileNamingStrategy` | `camel` | `snake` | `kebab` | `camel`                       | File name casing.                                                                                                                               |
| `reExport`           | `"true"` | `"false"`        | `"true"`                      | Emit `index.ts` barrels.                                                                                                                        |
| `classValidator`     | `"true"` | `"false"`        | `"true"`                      | Emit `class-validator` decorators.                                                                                                              |
| `swaggerDocs`        | `"true"` | `"false"`        | `"true"`                      | Emit `@nestjs/swagger` `@ApiProperty` decorators.                                                                                               |
| `prettier`           | `"true"` | `"false"`        | `"false"`                     | Format the output with Prettier (auto-resolves config).                                                                                         |
| `schemaDir`          | string                      | —                             | Directory of additional `.prisma` files to scan for `@ignore`d fields.                                                                          |
| `emitManifest`       | `"true"` | `"false"`        | `"false"`                     | Emit `manifest.ts` and `model-entity-map.ts` alongside the DTOs.                                                                                |
| `extraGenerators`    | string | string[]           | —                             | Additional sub-generators. See [Plugin system](#plugin-system---custom-generator).                                                              |
| `extraAnnotations`   | string | string[]           | —                             | Names of user-defined annotations consumed by custom sub-generators.                                                                            |
| `extraDecorators`    | string | string[]           | —                             | Field-level decorators triggered by matching `@Annotation` names. See [Extra features](#extra-features).                                        |
| `extraValidators`    | string | string[]           | —                             | Same as `extraDecorators`, also drives `class-validator` override-by-name.                                                                      |
| `extraImports`       | string | string[]           | —                             | Imports referenced **inside annotation parameters** (e.g. `@ApiProperty({ example: USER_EXAMPLE })`).                                           |
| `extraScalars`       | object (configFile only)    | —                             | Per-scalar overrides for TS type, Swagger `type`/`format`, and the imported module. See [Extra features](#extra-features).                      |


> `extra*` options accept simple strings in `schema.prisma`. Anything more elaborate (arrays, descriptors, mixed forms) belongs in a [`configFile`](#external-config-file) — Prisma's generator block does not support multi-line arrays or nested objects.

## Plugin system - custom generator

A plugin is a class extending `BaseGenerator`. The base class hands you the parsed model graph, the user config, and the import-merging machinery used by the built-in generators — so a plugin stays short, plugs into the same pipeline, and emits any TypeScript file. Register the annotations it recognises via `extraAnnotations` (the parser is always on; this is the discovery list `this.config.extraAnnotations` exposes).

### Basic example — transform a `Model` and reuse the built-in renderer

The shortest plugin filters/transforms a `Model` and lets `getTemplate(...)` do the rest. This is the built-in **`EntityDtoGenerator`** verbatim:

```ts
import { isEntityHidden } from '../annotations';
import { BaseGenerator } from '../base-generator';
import { Field, File, Model } from '../types';

export default class EntityDtoGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.entity';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        return this.models.map((model) => {
            const filteredFields = model.fields.filter((field: Field) => !isEntityHidden(field));
            const processedModel: Model = { ...model, fields: filteredFields as Field[] };
            const outputPath = this.getPath(model);
            return {
                path: outputPath,
                content: this.getTemplate({ model: processedModel, classValidator: false, outputPath })
            };
        });
    }
}
```

`isEntityHidden` respects `@DtoHidden` / `@DtoEntityHidden` / `@DtoApiHidden`. `getTemplate({ classValidator: false })` opts the entity out of `class-validator` decorators while keeping Swagger ones.

### Advanced example: `GqlDtoGenerator`

Opt-in GraphQL plugin: emits a `@nestjs/graphql` `@ObjectType` for every model annotated with `@GqlObjectType`, reacts to `@GqlField` / `@GqlHidden`, honours the built-in `@DtoIgnoreModel` / `@DtoHidden` / `@DtoEntityHidden`, and reuses `addImport` / `formatImports` for import management:

```ts
// my-generators/gql-generator.ts
import {
    BaseGenerator,
    DTO_ENTITY_HIDDEN,
    DTO_HIDDEN,
    DTO_IGNORE_MODEL,
    Field,
    File,
    ImportType,
    Model
} from '@tommasomeli/prisma-generator-nestjs-dto';

const PRISMA_TO_GQL_SCALAR: Record<string, string> = {
    String: 'String', Boolean: 'Boolean', Int: 'Int', BigInt: 'Int',
    Float: 'Float', Decimal: 'Float', DateTime: 'Date', Json: 'GraphQLJSON'
};
const PRIMITIVE_GQL_TYPES = new Set(['ID', 'Int', 'Float']);

export class GqlDtoGenerator extends BaseGenerator {
    filePrefix = '';
    fileSuffix = '.gql';
    classPrefix = '';
    classSuffix = '';

    async generate(): Promise<File[]> {
        return this.models
            .filter((model) => this.hasAnnotation(model, 'GqlObjectType') && !this.hasAnnotation(model, DTO_IGNORE_MODEL))
            .map((model) => this.renderModel(model));
    }

    private renderModel(model: Model): File {
        const typeName = String(this.getAnnotation(model, 'GqlObjectType')?.params?.[0] ?? model.name);
        const visibleFields = model.fields.filter(
            (f) => !this.hasAnnotation(f, 'GqlHidden') && !this.hasAnnotation(f, DTO_HIDDEN) && !this.hasAnnotation(f, DTO_ENTITY_HIDDEN)
        );
        const outputPath = this.getPath(model);

        const imports: ImportType[] = [];
        const gqlSymbols = new Set<string>(['ObjectType', 'Field']);

        const fieldLines = visibleFields.map((f) => {
            const gqlType = this.gqlTypeOf(f);
            if (PRIMITIVE_GQL_TYPES.has(gqlType)) gqlSymbols.add(gqlType);

            if (f.kind === 'object') {
                const related = this.models.find((m) => m.name === f.type);
                if (related && this.hasAnnotation(related, 'GqlObjectType')) {
                    this.addImport(imports, { from: this.getImportPath(related, outputPath), destruct: [f.type] });
                }
            } else if (f.kind === 'enum') {
                this.addImport(imports, { from: '@prisma/client', destruct: [f.type] });
            }

            return this.renderField(f, gqlType);
        });

        this.addImport(imports, { from: '@nestjs/graphql', destruct: [...gqlSymbols] });

        return {
            path: outputPath,
            content: `${this.formatImports(imports, outputPath)}

@ObjectType('${typeName}')
export class ${typeName} {
${fieldLines.join('\n\n')}
}
`
        };
    }

    private renderField(f: Field, gqlType: string): string {
        const ref = f.isList ? `[${gqlType}]` : gqlType;
        const opts = !f.isRequired ? ', { nullable: true }' : '';
        const tsBase = f.kind === 'object' || f.kind === 'enum' ? f.type : this.tsScalar(f.type);
        const tsType = `${tsBase}${f.isList ? '[]' : ''}${f.isRequired ? '' : ' | null'}`;
        return `    @Field(() => ${ref}${opts})\n    ${f.name}${f.isRequired ? '!' : '?'}: ${tsType};`;
    }

    private gqlTypeOf(f: Field): string {
        const forced = this.getAnnotation(f, 'GqlField')?.params?.[0] as string | undefined;
        if (forced) return forced;
        if (f.isId && (f.type === 'Int' || f.type === 'String')) return 'ID';
        if (f.kind === 'enum' || f.kind === 'object') return f.type;
        return PRISMA_TO_GQL_SCALAR[f.type] ?? f.type;
    }

    private tsScalar(t: string): string {
        return t === 'Boolean' ? 'boolean' : t === 'Int' || t === 'Float' ? 'number' : t === 'DateTime' ? 'Date' : t === 'Json' ? 'unknown' : 'string';
    }
}
```

Annotate the Prisma schema and wire the plugin from the `configFile`:

```prisma
/// @GqlObjectType("User")
model User {
  /// @GqlField(ID)
  id           Int    @id @default(autoincrement())
  email        String @unique
  name         String
  /// @GqlHidden
  passwordHash String
  posts        Post[]
}

/// @GqlObjectType("Post")
model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
}
```

```ts
// nestjs-dto.config.ts
export default {
    extraAnnotations: ['GqlObjectType', 'GqlField', 'GqlHidden'],
    extraGenerators: from('./dist/my-generators/gql-generator.cjs', ['GqlDtoGenerator'])
} satisfies GeneratorConfigFile;
```

Plugins are loaded with `require()` from the cwd — point at a **compiled JS/CJS** file. A plugin re-exporting a built-in name (`CreateDtoGenerator`, `EntityGenerator`, `UpdateDtoGenerator`) **replaces** it in the registry.

`npx prisma generate` emits one file per opted-in model:

```ts
// src/generated/nestjs-dto/user/user.gql.ts
import { Post } from '../post/post.gql';
import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType('User')
export class User {
    @Field(() => ID)
    id!: number;
    @Field(() => String)
    email!: string;
    @Field(() => String)
    name!: string;
    @Field(() => [Post])
    posts!: Post[];
}
```

`passwordHash` is dropped (`@GqlHidden`), `id` becomes `ID` (`@GqlField(ID)`), and the `Post` import is resolved relative to the emitted file by `formatImports`. Drop `@GqlObjectType` on `Post` and the `posts` field stays but the import is omitted (guard in `renderModel`).

### Types used by plugins

All plugin-facing types are re-exported from the package root; full shapes live in `dist/index.d.ts`. The fields you'll touch most:

- **`Annotation`** — `{ name, params }`. `name` is the bare identifier (no `@`); `params` is pre-parsed (numbers stay numbers, identifiers stay strings, `{ ... }` literals stay raw).
- **`Field`** — `name`, `type`, `kind` (`'scalar' | 'object' | 'enum' | 'unsupported'`), `isList`, `isRequired`, `isId`, `isUnique`, `annotations`, plus the usual Prisma relation metadata.
- **`Model`** — `name`, `fields`, `annotations`, `primaryKey`, `uniqueFields`.
- **`File`** — `{ path, content }`, what your `generate()` returns.
- **`ImportType`** — `{ from, destruct?, alias? }`, what `addImport` / `formatImports` consume.

`this.config.extraValidators` / `extraDecorators` / `extraImports` are pre-parsed into `ImportType[]`; `this.config.extraAnnotations` is the registered `string[]`.

### `BaseGenerator` API at a glance

| Member                                                               | Kind     | Purpose                                                                                                                                                                       |
| -------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `this.models: Model[]`                                               | property | All non-`@DtoIgnoreModel` models, with parsed `annotations` on each `Field` / `Model`.                                                                                        |
| `this.config: GeneratorConfig`                                       | property | Resolved config: paths, output options, parsed `extraDecorators` / `extraValidators` / `extraImports` / `extraAnnotations`.                                                   |
| `this.options: GeneratorOptions`                                     | property | Raw Prisma `GeneratorOptions` (incl. DMMF) — for advanced use cases.                                                                                                          |
| `filePrefix` / `fileSuffix` / `classPrefix` / `classSuffix`          | abstract | Naming hooks every subclass must declare.                                                                                                                                     |
| `generate(): Promise<File[]>`                                        | abstract | Your plugin's body. Return one or more `{ path, content }` entries.                                                                                                           |
| `beforeAll(models): Promise<void>`                                   | method   | Optional pre-pass invoked once before any `generate()`. Receives the **shared** `Model[]`; mutating it is visible to every later hook and `generate()` call. Defaults to no-op. |
| `afterAll(files): Promise<File[] \| void>`                           | method   | Optional post-pass invoked once after every `generate()`. Receives the full list of files produced in the run; return a non-empty `File[]` to append more files (barrels, audit reports, schema exports). |
| `getAnnotation(target, name)`                                        | method   | Returns `Annotation \| undefined` (with `.params`) for any field/model.                                                                                                       |
| `hasAnnotation(target, name)`                                        | method   | Boolean form of the above.                                                                                                                                                    |
| `getPath(model, relativeFrom?)`                                      | method   | Output path for a model on disk (with `.ts`). Pass the current file's path as `relativeFrom` to get a relative path.                                                          |
| `getImportPath(model, fromOutputPath?)`                              | method   | Same as `getPath` but stripped of the `.ts` extension — use it when building an `ImportType.from` that references a peer-generated file.                                      |
| `getModelName(name)`                                                 | method   | Applies the configured naming strategy (`camel` / `snake` / `kebab`) to a model name.                                                                                         |
| `addImport(imports, next)`                                           | method   | Merges an `ImportType` into an array (dedup + alias/destruct separation, same rules as the built-in pipeline).                                                                |
| `formatImports(imports, outputPath?)`                                | method   | Renders an `ImportType[]` as a multi-line `import ... from '...'` block. Rewrites absolute paths relative to `outputPath` and strips `.ts` / `.mts` / `.cts` / `.tsx`.        |
| `getTemplate({ model, classValidator?, swaggerDocs?, outputPath? })` | method   | Renders the full class body (imports + decorators + fields) you'd get from a built-in generator. Useful as escape hatch when your plugin only needs to **transform** a model. |

> **Naming gotcha.** Built-in barrel emission and the `re-export` machinery assume your plugin's `fileSuffix` ends with a single segment matching the file's role (`.entity`, `.dto`, `.gql`, ...). If you pick an unusual or empty suffix and use `reExport: "true"`, you may see duplicate `export * from './foo';` lines in the per-model `index.ts` when two generators land on the same path. Choose distinct suffixes (`.audit`, `.cqrs.command`, ...) or set `reExport: "false"` and emit your own barrel from `afterAll` to avoid the collision.

## Extra features

The `extra*` config fields share the same [declaration syntax](#declaration-syntax); they differ in **how the generator wires them in**.

### `extraValidators` / `extraDecorators` — annotation-driven decorators

Bind any `@Annotation` placed on a `///` comment to a symbol imported from a user module. Same lookup, different intent: `extraValidators` for `class-validator` rules, `extraDecorators` for everything else (Swagger, `class-transformer`, custom NestJS metadata, ...). Pick the one that matches the override module (see [Override of built-in imports](#override-of-built-in-imports)).

```ts
extraValidators: from(() => import('src/common/validators'), ['IsUnique', 'IsStrongPassword']),
extraDecorators: from(() => import('src/common/decorators'), ['Trim', 'Sanitize'])
```

```prisma
model User {
  /// @IsUnique()
  email    String @unique
  /// @IsStrongPassword({ minLength: 10 })
  password String
  /// @Trim()
  /// @Sanitize('xss')
  name     String
}
```

If a local name **collides with a built-in symbol** (`IsBoolean`, `ApiProperty`, ...), the user module wins — see below.

### `extraImports` — symbols referenced inside annotation parameters

While `extraDecorators` / `extraValidators` resolve annotation **names**, `extraImports` resolves identifiers used **inside** annotation parameters (and inside `@DtoApiExtraModels(...)` at the model level). Declare the source module, the generator imports the symbol in every file that references it.

```prisma
/// @ApiProperty({ example: USER_EXAMPLE })
/// @Matches(USERNAME_REGEX)
name String
```

```ts
extraImports: [
    from(() => import('src/users/user.fixtures'), 'USER_EXAMPLE'),
    from(() => import('src/users/user.regex'), 'USERNAME_REGEX')
]
```

### `extraGenerators` — pluggable sub-generators

`BaseGenerator` subclasses that run alongside the built-ins. See [Plugin system](#plugin-system---custom-generator) for the API and an end-to-end example. Re-exporting a built-in name (`CreateDtoGenerator`, `UpdateDtoGenerator`, `EntityGenerator`) **replaces** it. `.ts` / `.cts` / `.mts` / `.tsx` paths are loaded via [`jiti`](https://github.com/unjs/jiti) (no precompilation); everything else goes through native `require`.

```ts
extraGenerators: from('./generators/audit-generator.ts', ['AuditGenerator'])
```

### `extraScalars` — per-scalar overrides

Reroute a Prisma scalar to your own TS type, with optional Swagger metadata and an automatically-emitted import. Only available from a [`configFile`](#external-config-file) (the schema block cannot express nested objects).

```ts
extraScalars: {
    Decimal: { ts: 'Decimal', from: 'decimal.js' },
    Json:    { ts: 'MyJson', from: 'src/json', apiType: 'Object' },
    BigInt:  { ts: 'bigint' } // no import needed for ambient types
}
```

- `ts` — TypeScript type used in field declarations.
- `from` *(optional)* — module to import `ts` from. When set, every DTO that references the scalar gets the import.
- `apiType` *(optional)* — value used in `@ApiProperty({ type: ... })`. Defaults to `() => ts` when `from` is set, `'<ts>'` otherwise.
- `format` *(optional)* — value used in `@ApiProperty({ format })`.

The built-in `Prisma.Json` / `Prisma.Decimal` import from `@prisma/client` is skipped automatically for any scalar the user has overridden.

### `extraAnnotations` — custom annotation discovery

The parser is always on: any `@Name(args)` in a `///` comment ends up as `{ name, params }` on the `Field` / `Model`. `extraAnnotations` is the **discovery list** your plugins read from `this.config.extraAnnotations` — for warnings, iteration, feature toggles.

```ts
extraAnnotations: ['DtoAuditable', 'DtoIndexed']

// inside a plugin
const indexed = this.getAnnotation(field, 'DtoIndexed');
```

### Override of built-in imports

A descriptor exporting a name that collides with a symbol the generator would normally pull from a built-in module **wins** for that name only; unrelated symbols still come from the default.

| `extra*` field    | Default modules it can override                                               |
| ----------------- | ----------------------------------------------------------------------------- |
| `extraValidators` | `class-validator` (`IsBoolean`, `IsString`, `IsInt`, `IsOptional`, ...)       |
| `extraDecorators` | `@nestjs/swagger` (`ApiProperty`, `ApiExtraModels`, ...), `class-transformer` |
| `extraImports`    | `@prisma/client` (`Prisma`, enum types), generated relation DTOs              |
| `extraGenerators` | Built-in sub-generators (`CreateDtoGenerator`, `EntityGenerator`, ...)        |

```ts
// example: permissive IsBoolean that also accepts "true" / 1 from query strings
extraValidators: from(() => import('src/common/validators'), ['IsBoolean'])
```

### Declaration syntax

| Form                      | Where           | Type-safety | Example                                                               |
| ------------------------- | --------------- | ----------- | --------------------------------------------------------------------- |
| Inline `Name:path`        | `schema.prisma` | none        | `extraValidators = "IsUnique,IsStrongPassword:src/common/validators"` |
| `ImportDescriptor` object | `configFile`    | shape only  | `{ from: 'src/common/decorators', names: ['Trim'] }`                  |
| `from()` helpers          | `configFile`    | full        | `from(() => import('src/common/decorators'), ['Trim'])`               |

Inline groups: `Foo,Bar:path` (named), `* as X:path` (namespace), `default as X:path` (default); join multiple with `|`. The closure form `from(() => import('path'), names)` validates both the path and the named exports at compile time (the closure is never invoked at runtime, so module side effects never fire).

## External config file

```prisma
generator nestjsDto {
  provider   = "prisma-generator-nestjs-dto"
  output     = "../generated"
  configFile = "../nestjs-dto.config.ts"
}
```

```ts
// nestjs-dto.config.ts
import { from, fromNamespace, type GeneratorConfigFile } from '@tommasomeli/prisma-generator-nestjs-dto';

export default {
    extraValidators: from(() => import('src/common/validators'), ['IsUnique', 'IsStrongPassword']),
    extraImports: [
        fromNamespace('src/common/constants', 'CONSTANTS'),
        from(() => import('src/users/user.fixtures'), 'USER_EXAMPLE')
    ],
    extraDecorators: from(() => import('src/common/decorators'), ['Trim', 'Sanitize']),
    extraAnnotations: ['DtoAuditable', 'DtoIndexed']
} satisfies GeneratorConfigFile;
```

- Path resolved against the schema location first, then the cwd. `.ts` / `.cts` / `.mts` use [`jiti`](https://github.com/unjs/jiti) (no precompilation); `.js` / `.cjs` / `.mjs` / `.json` use `require`.
- `export default` or `export const config = ...` are both accepted. Values override the schema for the same key.
- Relative `from` paths (`./my-validators`, `../shared/lib`) are anchored to the config file's directory and rewritten relative to each emitted file. Bare specifiers, TS path aliases (`src/...`), and absolute paths pass through unchanged.

A runnable end-to-end example (`configFile`, custom `@Auditable` annotation, TS plugin, `afterAll` aggregation) lives under [`examples/blog/`](./examples/blog).

## Annotations

Triple-slash comments (`///`) above a model or field. Multiple annotations per target are fine.

### Built-in


| Target | Annotation                                  | Effect                                                                                |
| ------ | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| model  | `@DtoIgnoreModel`                           | Skip the model entirely.                                                              |
| model  | `@DtoApiExtraModels(A, B)`                  | Emit `@ApiExtraModels(A, B)` on the entity class.                                     |
| field  | `@DtoReadOnly`                              | Exclude from Create and Update DTOs.                                                  |
| field  | `@DtoCreateHidden` / `@DtoUpdateHidden`     | Hide in Create / Update DTOs.                                                         |
| field  | `@DtoEntityHidden`                          | Hide in the Entity DTO (= API response).                                              |
| field  | `@DtoApiHidden`                             | Emit `@ApiHideProperty()` and exclude from the Entity DTO.                            |
| field  | `@DtoHidden`                                | Hide everywhere.                                                                      |
| field  | `@DtoCreateOptional` / `@DtoCreateRequired` | Force the field's presence/optionality in Create DTOs.                                |
| field  | `@DtoUpdateOptional` / `@DtoUpdateRequired` | Same, for Update DTOs.                                                                |
| field  | `@DtoOverrideType(<Type>)`                  | Override the TypeScript type. Auto-imports the matching generated model DTO if found. |
| field  | `@DtoOverrideApiPropertyType(<Type>)`       | Override only the Swagger `type` parameter.                                           |
| field  | `@DtoCreateValidateIf(<expr>)`              | Emit `class-validator`'s `@ValidateIf(<expr>)` in the Create DTO.                     |
| field  | `@DtoUpdateValidateIf(<expr>)`              | Same, for the Update DTO.                                                             |


### Custom (read by your plugins)

Any name declared in `extraAnnotations` is parsed the same way. The `params` array is pre-parsed: bare identifiers stay strings, numeric literals become numbers, `{ ... }` blocks stay as raw strings.

```prisma
/// @DtoAuditable("user_audit")
/// @DtoIndexed(5, { strategy: 'btree' })
model User { ... }
```

Inside a plugin:

```ts
const auditable = this.getAnnotation(model, 'DtoAuditable');
// auditable?.params[0] === 'user_audit'

const indexed = this.getAnnotation(model, 'DtoIndexed');
// indexed?.params === [5, "{ strategy: 'btree' }"]
```

## Manifest output (opt-in)

`emitManifest = "true"` emits two extra files in `output`:

- `manifest.ts` — `PrismaManifest: Record<Prisma.ModelName, { primaryKey, entityFields, relations }>`. Useful for `select` builders, audit middleware, RBAC field lists.
- `model-entity-map.ts` — type-only `ModelEntityMap: Prisma.ModelName -> EntityClass`. Useful for typing dynamic select paths.

Both honour `fileNamingStrategy` and `outputStructure`.

## Comparison

How this generator stacks up against the other NestJS-oriented DTO generators in the Prisma ecosystem (typical feature set across the most popular alternatives at the time of writing):

|                                                              | this | other Prisma NestJS DTO generators |
| ------------------------------------------------------------ | ---- | ---------------------------------- |
| Create / Update / Entity DTOs                                | yes  | yes                                |
| Swagger / `class-validator` decorators                       | yes  | yes                                |
| Annotations for hide / readonly / optional / type override   | yes  | partial                            |
| Pluggable sub-generators (`extraGenerators`)                 | yes  | no                                 |
| Custom annotations for plugins (`extraAnnotations`)          | yes  | no                                 |
| Annotation → custom decorator / validator / namespace import | yes  | partial                            |
| Override of built-in imports by colliding name               | yes  | no                                 |
| Optional runtime manifest (`emitManifest`)                   | yes  | no                                 |
| Auto-import for `@DtoOverrideType`                           | yes  | no                                 |
| External TypeScript `configFile` with type-safe helpers      | yes  | no                                 |


## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, conventions, and the PR checklist.

```bash
npm install
npm test
npm run build
```

Issues and PRs welcome — use the [bug](https://github.com/tommasomeli/prisma-generator-nestjs-dto/issues/new?template=bug_report.yml) or [feature](https://github.com/tommasomeli/prisma-generator-nestjs-dto/issues/new?template=feature_request.yml) templates when opening an issue.

## License

[MIT](./LICENSE)
