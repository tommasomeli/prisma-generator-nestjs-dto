# Prisma ORM 8 + NestJS spike

Test bed for the Prisma 8 (ex "Prisma Next") support described in
[`docs/prisma-8-plan.md`](../../docs/prisma-8-plan.md). It is a standalone npm project; it is **not**
part of the root pnpm workspace.

## What is in here

| Path | Purpose |
| --- | --- |
| `prisma.config.ts` | Stock Prisma 8 config. `contract emit` does not open a DB connection, so the URL is a placeholder. |
| `src/prisma/contract.prisma` | The blog schema in Prisma 8 syntax (`// use prisma-8`, `VarChar(255)?`, `Jsonb?`, `temporal.updatedAt()`) with the `///` annotations the generator must recover (`@DtoHidden`, `@MaxLength(120)`, custom `@Auditable`). |
| `src/prisma/contract.json`, `contract.d.ts` | Written by `npm run emit`. Gitignored. `contract.json` is the generator's input. |
| `nestjs-dto.config.ts` | Generator options. Prisma 8 has no `generator` block, so everything lives here. |
| `src/main.ts`, `src/app.module.ts`, `src/users/`, `src/posts/` | Minimal NestJS 12 app with `ValidationPipe` and Swagger UI at `/docs`. Controllers import the generated DTOs from `./generated`. |

## Commands

```bash
npm install                 # pinned: prisma@8.0.0-rc.23 + @prisma/orm-postgres@8.0.0-rc.18
npm run emit                # prisma contract emit  -> src/prisma/contract.json + contract.d.ts
npm run generate            # prisma-generator-nestjs-dto --contract ... -> ./generated/**
npm run typecheck           # tsc --noEmit over the app and the generated DTOs
npm run start               # tsc build + node: http://localhost:3000/docs (JSON at /docs-json)
npm run dev                 # all of the above in order
```

The whole chain works: `emit`, `generate` and `typecheck` pass and the app boots with Swagger and a
global `ValidationPipe`. The generator depends on the repository root through `file:../..` (a
symlink), so run `pnpm build` at the root after changing the generator sources.

`start` compiles with `tsc` instead of running through `tsx`: esbuild does not emit decorator
metadata, and without it Nest cannot see the DTO type of `@Body()`, so validation and the
request-body schemas in Swagger would silently disappear.

What `./generated` contains in Prisma 8 mode:

- `enums/role.enum.ts`: `export enum Role { ADMIN = 'ADMIN', USER = 'USER' }`. There is no
  `@prisma/client`, so enums are emitted locally and the DTOs import them from `../enums`.
- `user/`, `post/`: entity + `Create`/`Update` DTOs, with no `@prisma/client` import anywhere.
  `Decimal` is typed `string` (Prisma 8's application type, Swagger `format: 'decimal'`) and `Json`
  is `JsonValue` from `@prisma/orm-framework/utils/json` (`import type`). Both can be overridden
  through `extraScalars` in `nestjs-dto.config.ts`.
- `manifest.ts` / `model-entity-map.ts` (`emitManifest: true`), with an inlined `ModelName` union.

## Version pinning

Prisma 8 RC packages are released on different cadences and are not version-locked to each other.
On 2026-10-17 the only pair that runs `contract emit` cleanly is the one in `package.json`. Symptoms
of a mismatch look like contract syntax errors (`CONTRACT.PACK_CONTRIBUTION_INVALID`,
`Invalid authoring type constructor "sql.String"`) but are install problems. Check
`npm view prisma dependencies` for the `@prisma/orm-toolchain` version and pin `@prisma/orm-postgres`
to the same RC.

## Useful probes

Parse the PSL and print doc comments with Prisma's own parser (this is what the annotation adapter does):

```js
import fs from 'node:fs';
import { parse } from '@prisma/orm-framework/psl-parser/syntax';

const { document } = parse(fs.readFileSync('src/prisma/contract.prisma', 'utf8'), 'contract.prisma');
for (const decl of document.declarations()) {
    if (decl.constructor.name !== 'ModelDeclarationAst') continue;
    console.log(decl.docComment());
    for (const field of decl.fields()) console.log('  ', field.docComment());
}
```
