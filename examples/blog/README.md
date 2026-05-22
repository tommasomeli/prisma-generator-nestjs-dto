# `@tommasomeli/prisma-generator-nestjs-dto` — blog example

Runnable end-to-end example for a custom annotation + plugin:

- **External `configFile`** ([`nestjs-dto.config.ts`](./nestjs-dto.config.ts)) with `from()` to register a TypeScript plugin.
- **Custom annotation** `/// @Auditable("table_name")` on models in [`prisma/schema.prisma`](./prisma/schema.prisma).
- **`extraGenerators`** — [`generators/audit-generator.ts`](./generators/audit-generator.ts) is loaded via `jiti`, no precompilation required.
- **Lifecycle hooks** — the plugin's `afterAll()` aggregates an index of audit tables.

## Run

From the repo root (after `npm run build`):

```bash
cd examples/blog
npx prisma generate
```

Generated output lands under `./generated/`:

```
generated/
  user/
    user.entity.ts
    create-user.dto.ts
    update-user.dto.ts
    user.audit.ts
    index.ts
  post/
    post.entity.ts
    create-post.dto.ts
    update-post.dto.ts
    post.audit.ts
    index.ts
  audit-index.ts        ← emitted by AuditGenerator#afterAll
  index.ts
```

The example assumes a working Prisma toolchain locally; it does **not** open a database connection (`db push` / migrations are not part of this script).
