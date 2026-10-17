# Prisma ORM 8 support — development plan

Status: **implemented in 0.3.0 (2026-10-17)**. Owner: tommasomeli. Target release: `0.3.0`.

Prisma ORM 8 (developed as "Prisma Next") is a release candidate and is what `npm install prisma`
installs today. GA is expected in October 2026; Prisma 7 stays supported for 18 months after that.
This plan makes the generator work on Prisma 8 projects while keeping the Prisma 5–7 path untouched.

## 1. Verified facts that shape the design

Everything below was checked against the published docs, the `prisma/orm` repository and a working
spike in `examples/prisma8-nestjs` (see §7).

| Fact | Consequence |
| --- | --- |
| Prisma 8 CLI has no `prisma generate`, does not read `schema.prisma`, and the `generator` block is gone. Config lives in `prisma.config.ts`. | The `@prisma/generator-helper` entry point never runs on Prisma 8. We need our own CLI entry and our own option source (the existing `configFile` format). |
| `prisma contract emit` reads `contract.prisma` (PSL) or `contract.ts` and writes two files next to it: `contract.json` and `contract.d.ts`. No database connection is needed. | `contract.json` replaces the DMMF as our input. It is deterministic and ships with the app, so reading it from disk is legitimate. |
| The extension API has four layers (contract, query, runtime, migration). None emits arbitrary files. Prisma's own analysis of community generators (`docs/reference/community-generator-migration-analysis.md`) says generator use cases become "consumer libraries" that read the contract IR, with no pack SPI needed. | We do **not** build a Prisma extension. We build a contract consumer. |
| `contract.json` carries no documentation. `///` comments are dropped at emit time. | Annotations must come from a second source: the PSL file itself. |
| `@prisma/orm-framework/psl-parser/syntax` is a published subpath. `parse(source, filename)` returns `{ document, diagnostics, sources }`; `document.declarations()` yields `ModelDeclarationAst` / `GenericBlockDeclarationAst` (enums); models expose `fields()`, and both models and fields expose `docComment()` which returns the joined `///` text. Verified on rc.18. | Annotation extraction is a thin layer over the official parser. No regex parsing of PSL. The package is labelled internal/unstable, so pin and isolate it. |
| Field types are codec ids (`pg/text@1`, `pg/numeric@1`, `sql/varchar@1` with `typeParams.length`), not Prisma scalars. Enums are referenced through `valueSet`. Native DB types are first-class PSL types (`VarChar(255)`, `Jsonb`, `Uuid`). | A codec-id → Prisma-scalar map is the heart of the adapter. `@db.X` disappears; `nativeType` is derived from the codec/dataType instead. |
| Storage data (primary key, uniques, defaults, FKs, checks) lives under `storage.namespaces.<ns>.entries.table.<table>`; domain data (fields, relations, enums, value objects) under `domain.namespaces.<ns>.models`. Relations carry `cardinality` (`N:1`, `1:N`), `on.localFields`/`targetFields` and `to.model`. | `isId`, `isUnique`, `hasDefaultValue`, `default`, `relationFromFields`, `isReadOnly` are all derivable. |
| `@updatedAt` is gone; PSL uses `temporal.updatedAt()` as the field type. Nothing marks it in `contract.json`. | `isUpdatedAt` is read from the PSL AST, not from the JSON. |
| New constructs: `type` blocks (value objects, stored inline), `native_enum`, `@@base` model inheritance, `types {}` named types, extension types (`pgvector.Vector(1536)`), `@@discriminator`. | First release maps value objects to a nested DTO and treats unknown codecs as `Unsupported` unless `extraScalars` overrides them by codec id. Inheritance and discriminators are out of scope for 0.3.0. |
| Runtime application types differ from Prisma 7: `Decimal` → `string`, `DateTime` → `Temporal.Instant`, `BigInt` → `bigint`, `Json` → `JsonValue`. There is no `@prisma/client` package. | Generated entities must stop importing `Prisma.Decimal` / `Prisma.JsonValue` from `@prisma/client` in Prisma 8 mode. See decision D3. |
| RC packages are not version-locked. Working pair on 2026-10-17: `prisma@8.0.0-rc.23` + `@prisma/orm-postgres@8.0.0-rc.18` (toolchain dedupes to rc.18). Other combinations fail `contract emit` with misleading errors. | Pin exact versions in the example and in CI. Re-verify at GA. |

## 2. Architecture

```
                 ┌──────────────────────┐
 Prisma 5–7      │ @prisma/generator-   │  DMMF            ┌─────────────────────┐
 prisma generate │ helper (bin, as-is)  │ ───────────────► │                     │
                 └──────────────────────┘                  │  generate(options)  │
                                                           │  BaseGenerator      │
 Prisma 8        ┌──────────────────────┐  synthetic DMMF  │  Create/Update/     │ ──► files
 npx prisma-     │ ContractAdapter      │ ───────────────► │  Entity / Zod /     │
 generator-      │  contract.json  ─┐   │                  │  plugins            │
 nestjs-dto      │  contract.prisma ┴─► │                  │  (unchanged)        │
 --contract ...  │  annotations          │                  └─────────────────────┘
                 └──────────────────────┘
```

Design choice (D1): the adapter produces a **DMMF-shaped datamodel** (`{ models, enums }` with
`DMMF.Model` / `DMMF.Field` fields) and a `GeneratorOptions` shim, exactly what `test/helpers/build-options.ts`
already fabricates for tests. `BaseGenerator`, the three built-in generators, the Zod generators, the
plugin system, `configFile`, barrels and Prettier all run unchanged. A later refactor can introduce an
internal `Datamodel` type if the DMMF shape becomes a burden; it is not needed to ship.

New source files (all under `src/prisma8/`, nothing in `src/generators` changes):

| File | Responsibility |
| --- | --- |
| `contract-reader.ts` | Locate and parse `contract.json`. Accepts an explicit path, a `contract.prisma` path (looks for the sibling JSON), a glob (JSON lives in the folder before the first wildcard, like the CLI), or a `prisma.config.ts` (loaded through jiti, reads `orm.contract`). |
| `codec-map.ts` | `codecId → { scalar, nativeType?, tsType? }` table (§3) plus `resolveScalar(field, column, overrides)`. |
| `contract-to-dmmf.ts` | Pure function `contractToDatamodel(contract, annotations): { models, enums }`. Handles models, enums, value objects, relations, storage-derived flags. |
| `psl-annotations.ts` | Parses every PSL source with `@prisma/orm-framework/psl-parser/syntax`, returns `Map<modelName, { doc, fields: Map<fieldName, { doc, isUpdatedAt, isList, writtenType }> }>`. Isolated behind an interface so a parser API change touches one file. |
| `options-shim.ts` | Builds `GeneratorOptions` (`generator.output.value`, `generator.config` from the config file, `dmmf.datamodel`, `schemaPath`) for `generate()`. |
| `cli.ts` | Argument parsing (`--contract`, `--output`, `--config`, `--prisma-config`, `--watch` later), mode detection, exit codes. |

`src/bin.ts` becomes a dispatcher: when invoked with CLI arguments it runs `cli.ts`; when invoked with
no arguments (Prisma's generator protocol speaks JSON-RPC over stdin) it registers `generatorHandler`
exactly as today. `@prisma/generator-helper` stays a peer dependency for the legacy path and is
imported lazily so Prisma 8 users do not need it installed.

## 3. Codec → scalar mapping (PostgreSQL target)

Source of truth: `docs/reference/scalar-types.md` in `prisma/orm`. `nativeType` keeps the
`[name, params]` tuple shape the Swagger/validator code already understands.

| Codec id | Prisma scalar | `nativeType` | Notes |
| --- | --- | --- | --- |
| `pg/text@1` | `String` | `null` | Also the storage of plain `enum` members. |
| `sql/varchar@1` | `String` | `['VarChar', [length]]` | `typeParams.length` → `@MaxLength` in class-validator mode, `.max()` in Zod. |
| `sql/char@1` | `String` | `['Char', [length]]` | |
| `pg/uuid@1` | `String` | `['Uuid', []]` | Drives `@IsUUID` / `format: 'uuid'`. |
| `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/interval@1`, `pg/time-temporal@1` | `String` | `['Inet'|'Bit'|'VarBit'|'Interval'|'Time', [p?]]` | Transport as string. |
| `pg/timestamptz-string@1`, `pg/timestamp-string@1`, `pg/date-string@1`, `pg/time-string@1`, `pg/timetz@1` | `DateTime` | `['Timestamptz'|'Timestamp'|'Date'|'Time'|'Timetz', [p?]]` | String-backed temporal codecs (`prisma contract infer`, Prisma 7 schemas) are treated as `DateTime` for DTO purposes (0.3.1). There is no `pg/timetz-string@1`: `pg/timetz@1` is already string-backed. |
| `pg/bool@1` | `Boolean` | `null` | |
| `pg/int2@1`, `pg/int4@1`, `pg/int8number@1` | `Int` | `['SmallInt'|null|'BigIntNumber', []]` | `int8number` is read as a JS number by Prisma 8; keep `Int`. |
| `pg/int8@1`, `pg/unboundedint@1` | `BigInt` | `null` / `['UnboundedInt', []]` | |
| `pg/float4@1`, `pg/float8@1` | `Float` | `['Real', []]` / `null` | |
| `pg/numeric@1` | `Decimal` | `['Decimal', [p, s]]` when `typeParams` present | TS type per D3. |
| `pg/timestamptz-temporal@1`, `pg/timestamptz-date@1`, `pg/timestamp-temporal@1`, `pg/date-temporal@1` | `DateTime` | `['Timestamptz'|'Timestamp'|'Date', [p?]]` | Transport stays `Date` + `@IsDateString`; see D3. |
| `pg/json@1`, `pg/jsonb@1` | `Json` | `['Json'|'JsonB', []]` | |
| `pg/bytea@1` | `Bytes` | `null` | |
| any field with `valueSet.entityKind === 'enum'` | enum reference | `null` | `kind: 'enum'`, `type: <enum name>`; `enums[]` built from `domain.namespaces.*.enum` (members may be numeric — emit `enum` with explicit values). |
| `pg/enum@1` (native Postgres enum) | enum reference | `null` | `kind: 'enum'`, `type`: the storage column's `valueSet.entityName`, else `typeParams.typeName`. The enum is built from `storage.namespaces.<ns>.entries.valueSet.<Name>` (`{ kind: 'valueSet', values: [...] }`, members in order; falls back to `entries.native_enum.<Name>.members`). A name that is also a domain enum is emitted once, from the domain. No enum-array codec exists: enum lists are `pg/enum@1` + `many` (0.3.1). |
| `kind: 'valueObject'` | object reference | `null` | `kind: 'object'`, `type: <TypeName>`; the value object is emitted as its own DTO model with no Create/Update variants (D4). |
| anything else (`pg/vector@1`, extension codecs) | `Unsupported` unless `extraScalars[codecId]` | `[dataType, []]` | `extraScalars` keys accept full codec ids in addition to Prisma scalar names. Field is skipped from Create/Update and typed `unknown` in the entity, with a one-line warning. |

SQLite (`sqlite/*`) and MongoDB (`mongo/*`) rows are added as separate tables in the same file; they are
small and the family is in `contract.targetFamily`. Only PostgreSQL is covered by tests in 0.3.0.

## 4. Field and model flag derivation

| DMMF flag | Source in Prisma 8 |
| --- | --- |
| `name`, `type`, `kind` | domain field + codec map |
| `isRequired` | `!field.nullable` |
| `isList` | PSL written type ends with `[]` (not in JSON for scalars). Relation fields: `cardinality === '1:N'` on the back-relation side. |
| `isId` | `storage.entries.table[<table>].primaryKey.columns` contains the field's `storage.fields[name].column` |
| `isUnique` | single-column entry in `storage...uniques` |
| `hasDefaultValue` / `default` | `storage...columns[col].default` (`{kind:'function', expression}` → `{ name: 'now'|'autoincrement'|'uuid'|'dbgenerated', args }`, `{kind:'literal', value}` → value) |
| `isUpdatedAt` | PSL written type is `temporal.updatedAt()` |
| `isReadOnly` | field is in `localFields` of an `N:1` relation on the same model (FK scalar), same rule DMMF applies |
| `relationName`, `relationFromFields`, `relationToFields` | domain relation `on.localFields` / `on.targetFields`; `relationName` synthesised as `<A>To<B>` |
| `documentation` | PSL `docComment()` matched by model and field name |
| `dbName` | `storage.table` |
| `primaryKey`, `uniqueFields` | storage `primaryKey.columns` (when composite) and multi-column `uniques` |
| Model inheritance `@@base`, `@@discriminator` | Out of scope for 0.3.0. Child models are emitted as flat models with their own fields plus the base's (the JSON already contains the base `id` column); a warning is logged. |

## 5. Phases

Estimates assume focused work; each phase ends green (`pnpm test`, `pnpm typecheck`, `pnpm lint`).

### Phase 0 — Spike (done 2026-10-17)

- `examples/prisma8-nestjs` created: pinned Prisma 8 packages, `prisma.config.ts`, a `contract.prisma`
  ported from `examples/blog` with `///` annotations, `contract emit` verified, parser probe verified,
  minimal NestJS app with Swagger + `ValidationPipe` whose controllers import from `./generated`.
- Findings recorded in §1.

### Phase 1 — Contract adapter core (2–3 days)

1. Copy the emitted `contract.json` and `contract.prisma` from the spike into `test/fixtures/prisma8/blog/`
   (committed fixtures; the example's own emitted files stay gitignored).
2. Implement `codec-map.ts` and `contract-to-dmmf.ts` without annotations (empty map).
3. Tests (`test/prisma8-adapter.spec.ts`): every row of §3 and §4 against the fixture, plus a
   hand-written fixture with a value object, a numeric enum, a composite PK and a `pg/vector@1` field.
4. Acceptance: `contractToDatamodel(fixture)` fed to the existing `buildOptions` helper produces the same
   `CreateUserDto`/`UpdateUserDto`/`User` output as the DMMF route for the equivalent Prisma 7 schema
   (snapshot comparison, ignoring the `@prisma/client` import line).

### Phase 2 — PSL annotation source (1–2 days)

1. Implement `psl-annotations.ts` on `@prisma/orm-framework/psl-parser/syntax` (dynamic import, optional
   peer dependency; if missing, log once and continue without annotations).
2. Support the `contract` option shapes: single file, glob (`./src/prisma/**/*.prisma`), and the
   `prisma.config.ts` path. Every file that starts with `// use prisma-8` joins the same document set.
3. Extract per model/field: `docComment()`, written type text (for `isList` and `temporal.updatedAt()`).
4. Tests: annotations reach `Field.annotations` through the existing `extractAnnotations`; `@DtoHidden`,
   `@MaxLength(120)` and the custom `@Auditable` from the fixture behave exactly as in class mode today.
5. Acceptance: `isEntityHidden` and the `schemaDir` ignore logic (`getIgnoredFields`, which greps schema
   files for `@ignore`) work with `contract.prisma` as the schema dir.

### Phase 3 — CLI entry and options (1 day)

1. `src/prisma8/cli.ts`: `prisma-generator-nestjs-dto --contract <path|glob|prisma.config.ts> --output <dir> [--config <file>]`.
   `--output` defaults to `<contract dir>/../generated/nestjs-dto` to mirror today's `defaultOutput`.
2. `src/bin.ts` dispatches on `process.argv.length > 2`; legacy path unchanged, `@prisma/generator-helper`
   imported lazily.
3. Options come only from the config file (`GeneratorConfigFile`) plus CLI flags; flags win. Reuse
   `loadConfigFile`/`applyConfigFile`; add a `loadConfigFileFromPath` overload since there is no
   generator block to carry `configFile`.
4. Tests: CLI argument parsing, mode detection, exit code 1 on missing `contract.json` with a hint to run
   `prisma contract emit`.

### Phase 4 — Prisma 8 output adjustments (1 day)

1. D3: in Prisma 8 mode the default `extraScalars` become `Decimal → string` and `Json → JsonValue`
   (type-only import from `@prisma/orm-framework/utils/json`, verified to exist in rc.18 exports) so no
   file imports `@prisma/client`. Users can still override via `extraScalars`.
2. `ManifestGenerator`: inline the `ModelName` union in Prisma 8 mode (same branch Zod mode already uses).
3. Enums with numeric members: emit `export enum Role { Low = 0, ... }` and `@ApiProperty({ enum })` /
   `z.enum`/`z.nativeEnum` accordingly.
4. Value objects (D4): emitted under `<output>/<type>/` as entity + `Create`/`Update` DTOs reused by the
   parent field (`@ValidateNested`, `@Type(() => AddressDto)`).
5. Zod mode: run the full `zod-real-world` snapshot through the adapter to confirm parity.

### Phase 5 — End-to-end example and CI (1 day)

1. `examples/prisma8-nestjs`: `npm run dev` = `contract emit` → `generate` → `tsc --noEmit` → start Nest
   with Swagger at `/docs`. The controllers already import `CreateUserDto`, `UpdateUserDto`, `User`,
   `CreatePostDto`, `Post`.
2. Snapshot test of the example's generated folder (`test/__snapshots__/prisma8-blog`).
3. CI job `prisma8-e2e` (Node 22/24): install the pinned pair, run the example's `emit`, `generate`,
   `typecheck`. Marked `continue-on-error` until Prisma 8 GA, then required.

### Phase 6 — Docs and release (half a day)

1. README: new "Prisma ORM 8" section (install, `prisma.config.ts` untouched, `contract emit`, CLI,
   config file, what differs: Decimal/Json/DateTime types, value objects, unsupported codecs,
   `contract.ts` authoring limitation).
2. CHANGELOG `0.3.0`: Added Prisma 8 mode; peer deps: `@prisma/generator-helper` becomes optional,
   `@prisma/orm-framework >=8.0.0-rc.18` optional.
3. `package.json`: keywords `prisma-8`, `prisma-next`, `contract`; `bin` unchanged.
4. Reply in the Prisma Discord thread with the release and the `examples/prisma8-nestjs` link.

Total: roughly 7–9 working days.

## 6. Decisions

- **D1 — Synthetic DMMF, not a BaseGenerator refactor.** Zero risk to the Prisma 5–7 path, every existing
  test and plugin keeps working, and the adapter is testable in isolation.
- **D2 — Annotations stay in `///` comments, read through Prisma's own PSL parser.** No regex parser of
  our own; the parser is the one the Prisma language server uses. The dependency is optional and
  isolated in one file because the package is labelled unstable.
- **D3 — Transport types in Prisma 8 mode.** `DateTime` stays `Date` + `@IsDateString` in DTOs (HTTP
  carries ISO strings regardless of `Temporal.Instant` at runtime). `Decimal` defaults to `string`
  (Prisma 8's own application type). `Json` defaults to `JsonValue` from `@prisma/orm-framework`.
  `BigInt` stays `bigint`. All overridable through `extraScalars`.
- **D4 — Value objects become nested DTO classes**, emitted once and referenced from parents. They have no
  table so no `id`/relations; Create/Update variants are generated so nested validation works.
- **D5 — TypeScript authoring (`contract.ts`) is supported without annotations in 0.3.0.** Doc comments
  do not exist there. A follow-up adds an `annotations` map in the config file keyed `Model.field` as a
  comment-free alternative that also works for PSL users who prefer configuration over schema comments.
- **D6 — No Vite/Webpack plugin yet.** Prisma pushes "invisible emit" through build-tool plugins; our CLI
  can later be wrapped the same way (`@prisma/orm-toolchain/vite-plugin-contract-emit` exposes the hook),
  but the explicit CLI is the baseline NestJS projects need.

## 7. Spike folder: `examples/prisma8-nestjs`

See its README for commands. Summary of what is there and why:

- `package.json` pins `prisma@8.0.0-rc.23` and `@prisma/orm-postgres@8.0.0-rc.18` (see §1, last row),
  depends on the generator via `file:../..`, and on NestJS 12 + Swagger 12 + class-validator.
- `prisma.config.ts` is a stock Prisma 8 config; the DB URL is a placeholder because `contract emit`
  does not connect.
- `src/prisma/contract.prisma` is the blog schema in Prisma 8 syntax: `// use prisma-8`, `VarChar(255)?`,
  `Jsonb?`, `temporal.updatedAt()`, plus the `///` annotations the generator must recover.
- `src/prisma/contract.json` and `contract.d.ts` are produced by `npm run emit` and gitignored.
- `src/main.ts`, `src/app.module.ts`, `src/users/*`, `src/posts/*`: a Nest app with `ValidationPipe`
  and Swagger whose controllers import the DTOs the generator will write to `./generated`. It fails
  `tsc` until Phase 3 lands, which is the point: it is the acceptance test for the whole chain.
- `nestjs-dto.config.ts`: all generator options, since there is no generator block to hold them.

## 8. Risks and open questions

| Risk | Mitigation |
| --- | --- |
| `contract.json` schema changes before GA (`schemaVersion` is `"1"` today). | Adapter checks `schemaVersion`; fixtures are regenerated by a script (`scripts/refresh-prisma8-fixtures.sh`) and the CI job is non-blocking until GA. |
| `@prisma/orm-framework/psl-parser` API changes (internal package). | One file, dynamic import, feature-detected (`docComment` presence); degrade to "no annotations" with a warning instead of crashing. |
| Field name access on `FieldDeclarationAst` (`name()` returns an AST node; the probe did not print the text). | Resolve in Phase 2 via `name().syntax.text`/`printSyntax`; fall back to the token at the first non-trivia child. |
| Prisma 8 projects with several namespaces (PostgreSQL schemas). | Model names are prefixed by namespace in `contract.d.ts` (`public_User`). We keep bare names and prefix only on collision, mirroring Prisma 7 multi-schema behaviour. |
| MongoDB family (early access): codecs `mongo/*`, embedded documents, `ObjectId`. | Table in §3 reserved; not tested in 0.3.0. |
| Users on `contract.ts` lose annotations (D5). | Documented limitation plus the config-file `annotations` map as follow-up. |
| Discord interest was one person. | The change is required for the package to survive GA regardless of demand, and the adapter is small. |

## 9. Implementation notes

Findings made while implementing Phases 1-5. Where they contradict §1 or §4, this section wins.

### `contract.json` facts that differ from §1 / §4

- `isUpdatedAt` and the id generators (`uuidv4`, `uuidv7`, `cuid2`, `ulid`, `nanoid`) are not on the
  field or column: they live in `execution.mutations.defaults`.
- `isList` is encoded in the field type as `many: { elementNullable }`.
- `dbgenerated()` no longer exists. Raw SQL defaults are tagged literals.
- Value objects live under `valueObjects` and fields reference them with `{ kind: 'valueObject', name }`.
- To-one relations carry their own `nullable`; it is not derived from the foreign-key columns.
- `N:M` relations (with `through`) and field types of `kind: 'union'` exist. 0.3.0 renders `N:M` as lists
  on both sides and maps unions to `Unsupported`.

- Contracts from `prisma contract infer` (or derived from a Prisma 7 schema) have no `domain.namespaces.<ns>.enum`:
  native enums are fields `{ codecId: 'pg/enum@1', typeParams: { typeName } }` with no `valueSet`, and the
  members live in `storage.namespaces.<ns>.entries.valueSet.<Name>` = `{ kind: 'valueSet', values: string[] }`
  (also mirrored in `entries.native_enum.<Name>` = `{ kind: 'postgres-enum', members, typeName }`). The storage
  column carries `typeParams.typeName` and `valueSet: { entityKind: 'valueSet', entityName, namespaceId, plane: 'storage' }`.
  Every storage value set without a domain enum of the same name is emitted (unreferenced ones included). The
  same contracts use the string-backed temporal codecs (`pg/timestamptz-string@1`, ...) for `DateTime` columns.

- Tables may carry expression indexes (`{ expression, unique, where?, type?, options? }`, no `columns`) and partial
  indexes (`columns` + `where`). Neither maps to a DMMF unique: only column-tuple, non-partial unique entries feed
  `isUnique` / `uniqueFields` / `uniqueIndexes` (0.3.1).
- `contract.json` sorts models and enums alphabetically. When PSL sources are read, models, enums (`enum` and
  `native_enum` blocks) and value objects follow the PSL declaration order; entities absent from the PSL are appended
  in JSON order (0.3.1).

### PSL parser API used (`@prisma/orm-framework/psl-parser/syntax`)

- `parse(source, filename)` and `printSyntax(node)`.
- Declarations are discriminated by `decl.syntax.kind`, not by constructor name.
- Field name: `field.name()?.name()`. Field type text: `printSyntax(field.typeAnnotation().syntax)`.
- `docComment()` on models and fields returns the joined `///` text, as noted in §1.

### Left open

- Zod mode: `Decimal` is now `z.string()` (Prisma 8's wire type), overridable with `extraScalars.Decimal.zod`.
- No `@IsEnum` is generated for enum fields.
- Numeric-enum detection is a heuristic.
- The `@ignore` detection regex does not understand Prisma 8 type syntax, so `@ignore` on Prisma 8-only types is not reliable.
