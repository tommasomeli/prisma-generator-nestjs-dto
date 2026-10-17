<div align="center">

# Prisma Generator NestJS DTO

[![npm version](https://img.shields.io/npm/v/@tommasomeli/prisma-generator-nestjs-dto.svg)](https://www.npmjs.com/package/@tommasomeli/prisma-generator-nestjs-dto)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/tommasomeli)

A Prisma generator for NestJS DTOs (Prisma 5-7 and **Prisma ORM 8**) with first-class **plugin** and **annotation** APIs.<br/>
Emits `Create*Dto` / `Update*Dto` / `*Entity` classes with `class-validator` + `@nestjs/swagger` decorators, or framework-free **Zod 4 schemas** (`outputType = "zod"`), then gets out of your way.

</div>

## Features

- **Prisma ORM 8 support**: a CLI that reads the `contract.json` written by `prisma contract emit`, keeps `///` annotations, and emits `@prisma/client`-free DTOs (see [Prisma ORM 8](#prisma-orm-8)).
- **Zod mode** (`outputType = "zod"`): plain Zod 4 schemas + inferred types for a shared contracts package, consumable by NestJS (`nestjs-zod`, OpenAPI included) and by frontends (react-hook-form) alike.
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
- [Prisma ORM 8](#prisma-orm-8)
- [Zod mode](#zod-mode)
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

Peers (all optional): `@prisma/generator-helper >= 5` (only for Prisma 5-7), `@prisma/orm-framework >= 8.0.0-rc.18` (only for Prisma 8, see [Prisma ORM 8](#prisma-orm-8)), `prettier >= 3`, `zod ^4.1` (only needed by the package that consumes the Zod mode output).

## Quickstart

This is the Prisma 5-7 setup (`generator` block + `prisma generate`). On Prisma ORM 8 jump to [Prisma ORM 8](#prisma-orm-8).

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

## Prisma ORM 8

Prisma ORM 8 (developed as "Prisma Next"; release candidate today, GA expected in October 2026) has no `prisma generate`, no `generator` block, no DMMF and no `@prisma/client`. The generator therefore reads the `contract.json` that `prisma contract emit` writes, through the same `prisma-generator-nestjs-dto` binary. Prisma 5-7 projects are unaffected: with no arguments the binary is still the Prisma generator described above.

> Prisma 8 itself needs a recent Node (`^22.18 || ^24.11 || >=26`). The generator's runtime still targets Node 18+.

### Install

```bash
npm i -D @tommasomeli/prisma-generator-nestjs-dto @prisma/orm-framework
```

`@prisma/orm-framework` (`>=8.0.0-rc.18`, optional peer) provides the PSL parser used to recover `///` annotations. `@prisma/generator-helper` is **not** needed. Keep your `prisma.config.ts` and `contract.prisma` as they are: nothing in them changes.

### Run

```bash
npx prisma contract emit    # writes contract.json + contract.d.ts next to contract.prisma
npx prisma-generator-nestjs-dto --contract ./src/prisma/contract.prisma --output ./generated --config ./nestjs-dto.config.ts
```

Wire both steps into `package.json` (the pattern used by [`examples/prisma8-nestjs`](./examples/prisma8-nestjs)):

```json
{
    "scripts": {
        "emit": "prisma contract emit",
        "generate": "prisma-generator-nestjs-dto --contract ./src/prisma/contract.prisma --output ./generated --config ./nestjs-dto.config.ts",
        "dev": "npm run emit && npm run generate"
    }
}
```

| Flag                           | Description                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--contract <path>`            | `contract.json`, a `contract.prisma` file, a glob of `.prisma` files (quote it), a `prisma.config.ts` or a directory. Default: `prisma.config.{ts,mts,cts,js,mjs,cjs}` in the cwd, when present. |
| `--output <dir>`               | Output directory. Default: `<contract dir>/../generated/nestjs-dto`.                                                                                  |
| `--config <file>`              | Generator config file. Default: `nestjs-dto.config.{ts,mts,cts,js,mjs,cjs,json}` in the cwd.                                                          |
| `--prisma-config <file>`       | Alias of `--contract` for a `prisma.config.ts`.                                                                                                       |
| `-h, --help` / `-v, --version` | Help / version.                                                                                                                                       |

Exit codes: `0` ok, `1` failure (a missing `contract.json` suggests running `prisma contract emit`), `2` usage error. Set `DEBUG=1` for stack traces.

### Config file

There is no generator block, so every option comes from the config file, in the same [`GeneratorConfigFile`](#external-config-file) format used with `configFile` (`outputType`, `outputStructure`, `extraScalars`, `extraGenerators`, `emitManifest`, ...). CLI flags win over the file.

```ts
// nestjs-dto.config.ts
import { type GeneratorConfigFile } from '@tommasomeli/prisma-generator-nestjs-dto';

export default {
    outputType: 'class',
    outputStructure: 'nestjs',
    fileNamingStrategy: 'kebab',
    swaggerDocs: true,
    emitManifest: true,
    extraAnnotations: ['Auditable']
} satisfies GeneratorConfigFile;
```

### Annotations

Keep writing `///` comments in `contract.prisma`. The generator re-reads the PSL files with Prisma's own parser (`@prisma/orm-framework/psl-parser/syntax`), because `contract.json` carries no documentation. All [existing annotations](#annotations) (`@DtoHidden`, `@MaxLength(120)`, custom names in `extraAnnotations`, ...) work unchanged. Without `@prisma/orm-framework` installed you get one warning and no annotations.

### What differs from Prisma 5-7

| Prisma type | Prisma 8 mode                                                             | Notes                                                                |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `Decimal`   | `string` (Swagger `format: 'decimal'`; `z.string()` in Zod mode)          | Prisma 8's application type; no `Prisma.Decimal` import.             |
| `Json`      | `JsonValue`, `import type` from `@prisma/orm-framework/utils/json`        | No `Prisma.JsonValue` import.                                        |
| `DateTime`  | `Date` + `@IsDateString`                                                  | Unchanged: HTTP carries ISO strings.                                 |
| `BigInt`    | `bigint`                                                                  | Numeric defaults render as `BigInt(n)`.                              |
| Enums       | local files in `<output>/enums/<name>.enum.ts`                            | No `@prisma/client`; numeric members (`Low = 0`) are supported; defaults render as members (`Role.USER`). Zod mode emits `z.enum({...})` for numeric enums. |
| Native types | `VarChar(255)` -> `@MaxLength(255)`, `Uuid` -> `@IsUUID`, ...            | Only PostgreSQL is covered by tests; SQLite and MongoDB codec tables are empty for now. |

All of the scalar defaults can be overridden through [`extraScalars`](#extrascalars--per-scalar-overrides) (including `typeOnly: true` for `import type`, and `format: ''` to drop the Swagger format). `emitManifest` inlines the `ModelName` union instead of importing `Prisma.ModelName`.

**Value objects.** A Prisma 8 `type` block is emitted as its own entity plus `Create<Type>Dto` / `Update<Type>Dto` under `<output>/<type>/`. Parent fields reference it with `@ValidateNested()` and `@Type(() => ...)`: the entity type in the entity, `Create<Type>Dto` in Create DTOs, `Update<Type>Dto` in Update DTOs. Value objects are not part of the manifest `ModelName` union.

**Unsupported codecs.** Fields with a codec the generator does not know (e.g. `pg/vector@1`, extension types) are typed `unknown` in the entity, dropped from Create/Update DTOs, and reported with one warning. Map them with `extraScalars`, whose keys may be full codec ids:

```ts
extraScalars: {
    'pg/vector@1': { ts: 'number[]' }
}
```

### Limitations

- `contract.ts` (TypeScript authoring) is supported, but it has no doc comments, so there are no annotations. A config-file `annotations` map is planned as a follow-up.
- `@@base` inheritance and `@@discriminator` are not supported: child models are emitted flat, with a warning.
- `N:M` relations are rendered as lists on both sides; union field types become `Unsupported`.
- With several namespaces, bare model names are used and prefixed only on collision.

### Version pinning

Prisma 8 RC packages are not version-locked to each other, and a mismatch fails with misleading contract errors (`CONTRACT.PACK_CONTRIBUTION_INVALID`, `Invalid authoring type constructor "sql.String"`). Pin exact versions. The pair verified on 2026-10-17 is `prisma@8.0.0-rc.23` + `@prisma/orm-postgres@8.0.0-rc.18`.

A runnable NestJS 12 + Swagger project, with a CI job (`prisma8-e2e`, non-blocking until GA) that runs emit, generate and typecheck on Node 22 and 24, lives in [`examples/prisma8-nestjs`](./examples/prisma8-nestjs). Design notes: [`docs/prisma-8-plan.md`](./docs/prisma-8-plan.md).

## Zod mode

`outputType = "zod"` replaces the built-in Create/Update/Entity class generators with Zod 4 equivalents. The output is **framework-free**: every file imports only `{ z } from 'zod'`, sibling generated files, and the modules you configure in `extraImports`. No `@nestjs/*`, `class-validator`, Swagger or Prisma imports. It is meant to live in a shared package (e.g. `packages/contracts`) used by:

- the NestJS API, through `createZodDto(schema)` from [`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) (validation + OpenAPI);
- web / mobile clients (Next.js, Expo), through `zodResolver(schema)` and react-hook-form.

### Setup

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

generator contracts {
  provider           = "prisma-generator-nestjs-dto"
  output             = "../../../packages/contracts/src/generated"
  configFile         = "./contracts.config.ts"
  outputType         = "zod"
  outputStructure    = "nestjs"
  fileNamingStrategy = "kebab"
  reExport           = "true"
  prettier           = "true"
  schemaDir          = "src/prisma/schema"
  zodMeta            = "true"
  zodMessageStrategy = "key"
  zodCodecs          = "false"
}
```

```ts
// contracts.config.ts (next to the schema)
import { from, fromNamespace, type GeneratorConfigFile } from '@tommasomeli/prisma-generator-nestjs-dto';

export default {
    // Server-only validators: never imported in Zod mode, listed in server-rules.ts instead.
    extraValidators: from('src/common/validators', ['IsUnique', 'IsImage']),
    extraImports: [
        // Paths must be resolvable from the generated package. Relative paths are resolved
        // against this config file and rewritten relative to every emitted file.
        fromNamespace('../../../packages/contracts/src/constants', 'CONSTANTS'),
        from('../../../packages/contracts/src/media', 'MediaFormatsSchema')
    ]
} satisfies GeneratorConfigFile;
```

`classValidator` / `swaggerDocs` / `extraDecorators` are ignored in Zod mode. `extraGenerators` plugins still run, and `emitManifest` still emits `manifest.ts` / `model-entity-map.ts` (without the `@prisma/client` import; `ModelName` is inlined and entity types come from `*.schema.ts`).

### Output

```
generated/
  enums/
    user-role.enum.ts      UserRoleSchema, UserRole (value + type)
    index.ts
  user/
    user.schema.ts         UserSchema, type User
    create-user.schema.ts  CreateUserSchema, types CreateUser / CreateUserOutput
    update-user.schema.ts  UpdateUserSchema, types UpdateUser / UpdateUserOutput
    index.ts
  scalars.ts               DateTimeSchema, BigIntSchema, BytesSchema (+ *EntitySchema variants)
  server-rules.ts          serverRules: validators Zod cannot express
  index.ts
```

With `outputStructure = "flat"` everything lands in `output` (`user.schema.ts`, `user-role.enum.ts`, ...). `fileNamingStrategy` and `reExport` behave as in class mode.

Generated from the `User` model of the test fixture (`test/fixtures/real-world/schema/user.prisma`), shortened:

```prisma
model User {
  id        Int       @id @default(autoincrement())
  createdAt DateTime? @default(now()) /// @createdAt
  email     String?   @unique @db.VarChar(255)
  role      UserRole? @default(guest)
  /// @Length(6, 20, { message: i18nValidationMessage('validation.fields.password') })
  /// @Matches(CONSTANTS.PASS_REGEX, { message: i18nValidationMessage('validation.fields.password') })
  password  String?   @db.VarChar(255)
  /// @DtoHidden
  avatarId  Int?      @unique
  avatar    Media?    @relation(fields: [avatarId], references: [id])
  /// @DtoHidden
  mfaSecret String?
  mfaEnabled Boolean  @default(false)
}
```

```ts
// user/user.schema.ts
export const UserSchema = z.object({
    id: z.int(),
    createdAt: DateTimeEntitySchema.nullish(),
    email: z.string().nullish(),
    role: UserRoleSchema.nullish(),
    password: z.string().nullish(),
    get avatar(): z.ZodOptional<z.ZodNullable<typeof MediaSchema>> {
        return MediaSchema.nullish();
    },
    mfaEnabled: z.boolean()
}).meta({ id: 'User' });

export type User = z.infer<typeof UserSchema>;

// user/create-user.schema.ts
export const CreateUserSchema = z.object({
    email: z.string().max(255).nullish(),
    role: UserRoleSchema.nullable().default('guest'),
    password: z.string().min(6, { error: 'validation.fields.password' }).max(20, { error: 'validation.fields.password' }).regex(CONSTANTS.PASS_REGEX, { error: 'validation.fields.password' }).nullish(),
    avatar: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).nullish(),
    mfaEnabled: z.boolean().default(false)
}).meta({ id: 'CreateUser' });

export type CreateUser = z.input<typeof CreateUserSchema>;
export type CreateUserOutput = z.output<typeof CreateUserSchema>;

// user/update-user.schema.ts
export const UpdateUserSchema = z.object({
    id: z.int(),
    email: z.string().max(255).nullish(),
    role: UserRoleSchema.nullish(),
    password: z.string().min(6, { error: 'validation.fields.password' }).max(20, { error: 'validation.fields.password' }).regex(CONSTANTS.PASS_REGEX, { error: 'validation.fields.password' }).nullish(),
    avatar: z.union([z.int(), z.looseObject({ id: z.int().optional() })]).nullish(),
    mfaEnabled: z.boolean().optional()
}).meta({ id: 'UpdateUser' });
```

### Types: input vs output

- `User = z.infer<typeof UserSchema>`: the read shape (what a client holds after parsing a response).
- `CreateUser = z.input<typeof CreateUserSchema>`: what a client **sends** and what a form **holds**. Fields with a Prisma default stay optional here.
- `CreateUserOutput = z.output<typeof CreateUserSchema>`: what the server receives **after** parsing (defaults applied). This is the instance type of `createZodDto(CreateUserSchema)`.

With react-hook-form, pass both: `useForm<CreateUser, unknown, CreateUserOutput>`. `zodResolver` infers the same pair.

### NestJS (`nestjs-zod`)

```ts
import { createZodDto, ZodResponse, ZodValidationPipe, ZodSerializerInterceptor, cleanupOpenApiDoc } from 'nestjs-zod';
import { CreateUserSchema, UpdateUserSchema, UserSchema, serverRules } from '@acme/contracts';

export class CreateUserDto extends createZodDto(CreateUserSchema) {}
export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
export class UserDto extends createZodDto(UserSchema) {}

@Controller('users')
export class UsersController {
    @Post()
    @ZodResponse({ type: UserDto })
    create(@Body() body: CreateUserDto) {
        return this.users.create(body); // Prisma rows (Date objects) are serialized by UserSchema
    }
}

// app.module.ts
providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor }
];

// main.ts
SwaggerModule.setup('docs', app, cleanupOpenApiDoc(SwaggerModule.createDocument(app, config)));
```

`.meta({ id })` gives every schema (and enum) a stable OpenAPI component name (`User`, `CreateUser`, `UserRole`, `Media`, ...). Turn it off with `zodMeta = "false"`; recursive relations then fall back to anonymous `$defs` names, so keep it on when you publish OpenAPI.

### Frontend (react-hook-form)

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateUserSchema, type CreateUser, type CreateUserOutput } from '@acme/contracts';

export function SignUpForm() {
    const form = useForm<CreateUser, unknown, CreateUserOutput>({ resolver: zodResolver(CreateUserSchema) });
    const onSubmit = form.handleSubmit((values) => api.post('/users', values));
    return (
        <form onSubmit={onSubmit}>
            <input {...form.register('email')} />
            <input type="password" {...form.register('password')} />
            {/* errors carry the i18n key, e.g. t(form.formState.errors.password?.message ?? '') */}
            <button type="submit">Sign up</button>
        </form>
    );
}
```

### Field mapping

Which fields appear in each schema, and whether they are optional / nullable, mirrors class mode (the same selection code is shared):

| Schema | Fields | Optional | Nullable |
| ------ | ------ | -------- | -------- |
| `<Model>Schema` | all but `@DtoHidden` / `@DtoEntityHidden` / `@DtoApiHidden` | not required, or list | optional column, or list |
| `Create<Model>Schema` | drops ids, `@updatedAt`, `@createdAt`, relation foreign keys, `@DtoHidden`, `@DtoCreateHidden` | not required, list, has a Prisma default, `@DtoCreateOptional`, `@IsOptional` | as above, plus `@DtoCreateOptional` / `@IsOptional` |
| `Update<Model>Schema` | like Create but keeps the id (required) and drops `@DtoUpdateHidden` | everything except the id (and `@DtoUpdateRequired`) | as above, plus `@DtoUpdateOptional` / `@IsOptional` |

- **Defaults**: literal Prisma defaults (`@default(false)`, enum values, numbers, strings, `[]`, JSON) become `.default(...)` in the Create schema only. Function defaults (`now()`, `uuid()`, `autoincrement()`, ...) just make the field optional. The Update schema never applies defaults, so a partial update cannot silently reset a column (class mode assigns property initializers there).
- **Non-empty strings**: required, non-nullable `String` fields get `.min(1)` in Create/Update, mirroring the `@IsNotEmpty()` that class mode adds.
- **`@db.VarChar(n)` / `@db.Char(n)`**: `.max(n)` in Create/Update, unless an annotation already sets a max length.
- **`@DtoReadOnly`**: `.readonly()` (OpenAPI `readOnly: true`), in every schema, like the `readonly` modifier of class mode.
- **`@ignore`d fields** read through `schemaDir` are included exactly as in class mode.
- **Relations**: entity schemas reference the related entity schema through a getter (`get avatar() { return MediaSchema.nullish(); }`) with an explicit return type, so recursive and cross-file cycles work with both TypeScript inference and `z.toJSONSchema`. Create/Update schemas accept the related primary key or an object with an optional primary key (`5`, `{ id: 5 }`, extra keys pass through for nested writes). Class mode types these as the related entity but never validates them; this keeps the payloads that worked before while staying non-recursive.
- **Enums**: `z.enum([...])` in `enums/`, plus `UserRole` as both value (`UserRole.admin`) and type.

| Prisma scalar | Create / Update | Entity | Notes |
| ------------- | --------------- | ------ | ----- |
| `String` | `z.string()` | `z.string()` | |
| `Int` | `z.int()` | `z.int()` | safe integer range |
| `Float` | `z.number()` | `z.number()` | |
| `Decimal` | `z.number()` | `DecimalEntitySchema` (Decimal.js -> number) | override with `extraScalars` |
| `Boolean` | `z.boolean()` | `z.boolean()` | |
| `DateTime` | `DateTimeSchema` (ISO 8601 string) | `DateTimeEntitySchema` (`Date` -> ISO string) | Prisma accepts ISO strings on writes |
| `BigInt` | `BigIntSchema` (integer string) | `BigIntEntitySchema` (`bigint` -> string) | convert with `BigInt()` before writing |
| `Bytes` | `BytesSchema` (base64) | `BytesEntitySchema` (`Uint8Array` -> base64) | |
| `Json` | `z.json()` | `z.json()` | |

**Why strings for dates by default?** JSON carries ISO strings, and `nestjs-zod` builds OpenAPI with `z.toJSONSchema`, which throws on `z.date()` / `z.coerce.date()` / `z.bigint()` ("Date cannot be represented in JSON Schema"). `z.coerce.*` also types its input as `unknown`, which breaks form typing. The default schemas describe the wire format, are representable in both `io: "input"` and `io: "output"`, and the entity variants still accept the `Date` / `bigint` / `Uint8Array` values Prisma returns, so `@ZodResponse` / `ZodSerializerInterceptor` work without codecs.

**`zodCodecs = "true"`** switches `DateTime` / `BigInt` / `Bytes` to [Zod codecs](https://zod.dev/codecs): parsing decodes to `Date` / `bigint` / `Uint8Array`, `schema.encode()` produces the wire format. Use `createZodDto(schema, { codec: true })` on the API (responses are encoded and documented with the input JSON Schema) and `z.toJSONSchema(schema, { io: 'input' })` yourself: the output side of a codec is not representable in JSON Schema. In codec mode `Decimal` stays a plain number.

`extraScalars` accepts a `zod` expression per scalar, e.g. `{ Decimal: { zod: 'z.string().regex(/^\\d+(\\.\\d+)?$/)' } }`; identifiers it references are imported via `extraImports`.

### Annotations in Zod mode

class-validator annotations are translated in Create/Update schemas (entity schemas carry types only, like class mode):

| Annotation | Zod |
| ---------- | --- |
| `@IsEmail()` / `@IsUrl()` / `@IsUUID('4')` | `z.email()` / `z.url()` / `z.uuid({ version: 'v4' })` |
| `@IsDateString()` / `@IsISO8601()` on a `String` | `z.iso.datetime({ offset: true })` |
| `@Length(min, max)` / `@MinLength(n)` / `@MaxLength(n)` | `.min()` / `.max()` |
| `@Matches(regex)` / `@Matches('pattern', 'flags')` | `.regex(regex)` / `.regex(new RegExp('pattern', 'flags'))` |
| `@Min(n)` / `@Max(n)` / `@IsPositive()` / `@IsNegative()` / `@IsDivisibleBy(n)` | `.min()` / `.max()` / `.positive()` / `.negative()` / `.multipleOf()` |
| `@IsInt()` on a `Float` | `z.int()` |
| `@IsNotEmpty()` | `.min(1)` (strings, arrays) |
| `@ArrayMinSize(n)` / `@ArrayMaxSize(n)` / `@ArrayNotEmpty()` / `@ArrayUnique()` | array `.min()` / `.max()` / `.min(1)` / `.refine(...)` |
| `@IsIn([...])` / `@IsNotIn([...])` / `@Equals(v)` / `@NotEquals(v)` | `z.literal([...])` / `.refine(...)` / `z.literal(v)` / `.refine(...)` |
| `@Contains(s)` / `@IsLowercase()` / `@IsUppercase()` / `@IsAlpha()` / `@IsAlphanumeric()` / `@IsNumberString()` | `.includes()` / `.lowercase()` / `.uppercase()` / `.regex(...)` |
| `@IsOptional()` | `.nullish()` |
| `@IsString()`, `@IsBoolean()`, `@IsNumber()`, `@IsArray()`, `@ValidateNested()`, `@Type()`, ... | nothing (the type already enforces it) |

For list fields, value validators apply to each item (as with `{ each: true }`) and `Array*` validators to the array.

**Messages.** `{ message: 'literal' }` becomes `{ error: 'literal' }`. Expression messages follow `zodMessageStrategy`:

- `key` (default): the first string literal of the expression, so `i18nValidationMessage('validation.fields.password')` becomes `{ error: 'validation.fields.password' }`. Clients translate the key (`t(issue.message)`); the API can do the same in its exception filter.
- `expression`: emitted verbatim; its identifiers must be importable from the contracts package via `extraImports`.
- `none`: messages are dropped.

**Server-only rules.** Validators that Zod cannot express (anything from `extraValidators` such as `@IsUnique` / `@IsImage`, other class-validator decorators without a mapping such as `@IsStrongPassword`, and `@DtoCreateValidateIf` / `@DtoUpdateValidateIf`) are not emitted. They are exported as data in `server-rules.ts`, and the generator prints one warning per run:

```ts
export const serverRules: readonly ServerRule[] = [
    {
        model: 'User',
        field: 'email',
        rule: 'IsUnique',
        args: ["{ message: i18nValidationMessage('validation.fields.email_exists') }"],
        message: 'validation.fields.email_exists',
        schemas: ['create', 'update']
    }
];
```

**Zod-specific annotations.**

| Annotation | Effect |
| ---------- | ------ |
| `/// @Zod(.min(2).trim())` | Appends a raw chain to the field schema in Create/Update (the array for list fields), after the translated validators and before optional/nullable/default. |
| `/// @ZodOverride(z.string().email())` | Replaces the field value schema in every schema (no translated validators, no list wrapping); optional/nullable/default still follow the table above. References to generated entity schemas (`MediaSchema`) are imported automatically. |

**`@DtoOverrideType(<Type>)`** resolves to a Zod schema: a generated model maps to its entity schema (`@DtoOverrideType(Media)` -> `MediaSchema`), TS primitives map to Zod primitives (`string`, `number`, `boolean`, `Date`, `bigint`, `unknown`), and any other name follows the convention `FooDto` -> `FooSchema`, `Foo` -> `FooSchema` (`FooSchema` stays as is). Declare that identifier in `extraImports` (the generator warns when it is missing). Example: `@DtoOverrideType(MediaFormatsDto)` on an `@ignore`d `Json` field renders `MediaFormatsSchema.readonly().nullish()`.

**Imports.** In Zod mode an `extraImports` entry is imported in a file only when one of its identifiers appears in the rendered code (validator arguments, `@Zod` / `@ZodOverride`, override schemas, `extraScalars.zod`). `@description(...)` / `@example(...)` become `.meta({ description, examples })`.

### Limitations

- `@ValidateIf`-style conditional validation is not translated (listed in `server-rules.ts`).
- Raw `@Zod(...)` / `@ZodOverride(...)` code is copied verbatim: it is not type-checked by the generator, and a `.transform()` in it makes the schema unrepresentable in JSON Schema.
- `@ZodOverride` on a relation that takes part in a cycle produces a getter without a return type annotation; TypeScript may then ask for one (TS7023).
- Fields hidden with `@DtoApiHidden` are still accepted by Create/Update schemas (class mode only hides them from Swagger).

## Configuration


| Option               | Type                        | Default                       | Description                                                                                                                                     |
| -------------------- | --------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `output`             | string                      | `../src/generated/nestjs-dto` | Destination directory.                                                                                                                          |
| `configFile`         | string                      | —                             | Path to an external `.ts` / `.cts` / `.mts` / `.js` / `.cjs` / `.mjs` / `.json` config file (Prisma 5-7; on Prisma 8 pass `--config` to the CLI instead). See [External config file](#external-config-file). |
| `outputType`         | `class` | `interface` | `zod` | `class`                 | TypeScript classes (with decorators), plain interfaces, or Zod schemas (see [Zod mode](#zod-mode)).                                             |
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
| `zodMeta`            | `"true"` | `"false"`        | `"true"`                      | Zod mode: add `.meta({ id })` to every schema (stable OpenAPI component names).                                                                 |
| `zodMessageStrategy` | `key` | `expression` | `none` | `key`                    | Zod mode: how expression messages (`i18nValidationMessage('k')`) are rendered.                                                                  |
| `zodCodecs`          | `"true"` | `"false"`        | `"false"`                     | Zod mode: decode `DateTime` / `BigInt` / `Bytes` to `Date` / `bigint` / `Uint8Array` with Zod codecs instead of JSON wire types.                |


> `extra*` options accept simple strings in `schema.prisma`. Anything more elaborate (arrays, descriptors, mixed forms) belongs in a [`configFile`](#external-config-file) — Prisma's generator block does not support multi-line arrays or nested objects.

## Plugin system - custom generator

A plugin is a class extending `BaseGenerator`. The base class hands you the parsed model graph, the user config, and the import-merging machinery used by the built-in generators — so a plugin stays short, plugs into the same pipeline, and emits any TypeScript file. Register the annotations it recognises via `extraAnnotations` (the parser is always on; this is the discovery list `this.config.extraAnnotations` exposes).

### Basic example — transform a `Model` and reuse the built-in renderer

The shortest plugin filters/transforms a `Model` and lets `getTemplate(...)` do the rest. This is equivalent to the built-in **`EntityDtoGenerator`** (which uses the exported `selectEntityFields(model)` helper; `selectCreateFields` / `selectUpdateFields` expose the Create/Update rules too):

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

Plugins are loaded with `require()` from the cwd — point at a **compiled JS/CJS** file. A plugin re-exporting a built-in name (`CreateDtoGenerator`, `EntityGenerator`, `UpdateDtoGenerator`; in Zod mode `ZodSupportGenerator`, `CreateZodGenerator`, `EntityZodGenerator`, `UpdateZodGenerator`) **replaces** it in the registry.

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

The built-in `Prisma.Json` / `Prisma.Decimal` import from `@prisma/client` is skipped automatically for any scalar the user has overridden. `typeOnly` *(optional)* renders the import as `import type { ts } from 'from'`; `format: ''` drops the Swagger `format` of the scalar. In Prisma 8 mode `Decimal` and `Json` have defaults (see [Prisma ORM 8](#prisma-orm-8)).

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
| field  | `@Zod(<chain>)`                             | Zod mode: append a raw chain (`.min(2).trim()`) to the Create/Update field schema.    |
| field  | `@ZodOverride(<schema>)`                    | Zod mode: replace the field value schema (`z.string().email()`) everywhere.           |


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

Both honour `fileNamingStrategy` and `outputStructure`. In Zod mode and in Prisma 8 mode there is no `@prisma/client`, so the `ModelName` union is inlined.

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
