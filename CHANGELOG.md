# Changelog

## [Unreleased]

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
