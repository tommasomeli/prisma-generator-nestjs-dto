# Changelog

## [Unreleased]

## [0.3.0] - 2026-10-17

### Added

- Prisma ORM 8 ("Prisma Next") support. Prisma 8 has no `prisma generate`, `generator` block, DMMF or `@prisma/client`, so the existing `prisma-generator-nestjs-dto` binary now also works as a CLI: run `prisma contract emit`, then `prisma-generator-nestjs-dto --contract <contract.json | contract.prisma | glob | prisma.config.ts | directory> [--output <dir>] [--config <file>] [--prisma-config <file>]`. With no arguments the binary is still the Prisma 5-7 generator, unchanged. Exit codes: 0 ok, 1 failure, 2 usage error. See the "Prisma ORM 8" section of the README and `examples/prisma8-nestjs`.
- Options in Prisma 8 mode come from the config file (`--config`, default `nestjs-dto.config.{ts,mts,cts,js,mjs,cjs,json}` in the cwd), in the same `GeneratorConfigFile` format as before.
- `///` annotations are recovered from the PSL sources with Prisma's own parser (`@prisma/orm-framework/psl-parser/syntax`, optional peer dependency `>=8.0.0-rc.18`; without it a single warning is printed and annotations are skipped). Every existing annotation, including custom ones, keeps working. `contract.ts` authoring is supported but has no doc comments, hence no annotations.
- Prisma 8 type mapping: `Decimal` -> `string` (Swagger `format: 'decimal'`; `z.string()` in Zod mode), `Json` -> `JsonValue` imported with `import type` from `@prisma/orm-framework/utils/json`, `DateTime` stays `Date`, `BigInt` stays `bigint`. All overridable through `extraScalars`. Native types map as in Prisma 5-7 (`VarChar(255)` -> `@MaxLength(255)`, `Uuid` -> `@IsUUID`, ...); only PostgreSQL is covered by tests.
- Local enum files in class / interface mode (`<output>/enums/<name>.enum.ts`), including numeric enums; Zod mode emits `z.enum({...})` for numeric enums.
- Value objects (Prisma 8 `type` blocks) are emitted as their own entity plus `Create<Type>Dto` / `Update<Type>Dto` and referenced from parents with `@ValidateNested()` + `@Type(() => ...)`. They are not part of the manifest `ModelName` union.
- Unsupported codecs (e.g. `pg/vector@1`) are typed `unknown` in entities, dropped from Create/Update DTOs, with one warning. `extraScalars` keys may be full codec ids (`'pg/vector@1': { ts: 'number[]' }`).
- `ScalarOverride.typeOnly` and `ImportType.typeOnly` render `import type { ... }`.
- `extraScalars[...].format: ''` drops the Swagger `format` of a scalar.
- Public exports: `loadConfigFileFromPath` and the `src/prisma8` API (`runCli`, `parseArgs`, `locateContract`, `readContract`, `contractToDatamodel`, `buildPrisma8Options`, `loadPslAnnotations`, ...).
- CI: non-blocking `prisma8-e2e` job (emit, generate, typecheck of `examples/prisma8-nestjs` on Node 22 and 24). `scripts/refresh-prisma8-fixtures.sh` regenerates `test/fixtures/prisma8/blog`.

### Changed

- `@prisma/generator-helper` is now an optional peer dependency (needed only for Prisma 5-7); `@prisma/orm-framework >=8.0.0-rc.18` is added as an optional peer dependency.
- `emitManifest` in Prisma 8 mode inlines the `ModelName` union instead of importing `Prisma.ModelName`.
- New keywords `prisma-8`, `prisma-next`, `prisma-contract`.

### Fixed

- A numeric `Decimal` default now renders as a string literal when `extraScalars.Decimal.ts === 'string'` (it was `new Prisma.Decimal(n)`). Affects Prisma 5-7 users with that override.
- The `IsOptional` import could be missing for required list fields.

## [0.2.0] - 2026-10-16

### Added

- Zod output mode (`outputType = "zod"`): emits framework-free Zod 4 schemas per model (`<Model>Schema`, `Create<Model>Schema`, `Update<Model>Schema`) with inferred types (`<Model>`, `Create<Model>` / `Create<Model>Output`, `Update<Model>` / `Update<Model>Output`), enum schemas in `enums/`, shared scalar helpers in `scalars.ts`, and `server-rules.ts` listing validators Zod cannot express. Field selection, optionality and nullability mirror class mode.
- Translation of common class-validator annotations to Zod (`IsEmail`, `IsUrl`, `IsUUID`, `Length`, `MinLength`, `MaxLength`, `Matches`, `Min`, `Max`, `IsPositive`, `IsInt`, `IsNotEmpty`, `ArrayMinSize`, `ArrayMaxSize`, `IsIn`, `IsOptional`, ...), with `{ message }` mapped to `{ error }`.
- New options: `zodMeta` (stable `.meta({ id })` OpenAPI names), `zodMessageStrategy` (`key` | `expression` | `none`, for messages like `i18nValidationMessage('key')`), `zodCodecs` (Zod codecs for `DateTime` / `BigInt` / `Bytes`).
- New annotations `@Zod(<chain>)` and `@ZodOverride(<schema>)`; `@DtoOverrideType` resolves to Zod schema identifiers in Zod mode (`FooDto` -> `FooSchema`).
- `extraScalars` entries accept a `zod` expression.
- `selectCreateFields` / `selectUpdateFields` / `selectEntityFields` helpers exported for plugins.

### Changed

- Dev toolchain: `@prisma/generator-helper` and `prisma` 7.10.1, TypeScript 6.0.3, tsup 9, vitest 5, zod 4.6 (dev). `zod ^4.1` added as an optional peer dependency. CI runs on Node 22 and 24 (the toolchain needs Node 22.18+); the published runtime still targets Node 18+.
- `emitManifest` in Zod mode inlines the `ModelName` union instead of importing `@prisma/client` and maps entities to `*.schema.ts`.
- `getTemplate()` renders `interface` for any non-`class` output type.

### Fixed

- Root-level files emitted by plugins (e.g. from `afterAll`) are exported from the main `index.ts` barrel instead of producing a self-referencing `export * from './<output>'`.
- Barrel export lines strip only a trailing `.ts` (suffixes such as `.ts-plugin` were mangled).

## [0.1.0] - 2026-05-21

First release.
