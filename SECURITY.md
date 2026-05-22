# Security policy

## Supported versions

Only the latest **minor** version line is supported with security fixes. Older lines may receive patches at the maintainer's discretion.

## Reporting a vulnerability

Do **not** open a public GitHub issue for security problems. Instead, email the maintainer at `tommasomeli@users.noreply.github.com` (or the address listed on the npm page) with:

1. A description of the issue and the affected component (e.g. `configFile` loader, `extraGenerators` `require()`, annotation parser).
2. A reproduction or proof-of-concept — preferably a minimal `schema.prisma` and config that demonstrates the behaviour locally.
3. Your assessment of impact and any mitigations you've identified.

You'll receive an acknowledgement within 7 days. Coordinated disclosure timelines are agreed case-by-case but typically aim for a fix within 30 days of confirmation, followed by a CVE / advisory.

## Threat model

The generator is a **build-time tool** consuming files you control:

- Your `schema.prisma`.
- Your `configFile` (a JS/TS module loaded with [`jiti`](https://github.com/unjs/jiti) or `require()`).
- Your `extraGenerators` modules (loaded with `jiti` for `.ts` / `.cts` / `.mts` and `require()` otherwise).

Loading any of these executes user code with the privileges of the developer running `npx prisma generate`. **Never** point the generator at modules you do not trust. The package itself does not open network connections, write outside the configured `output` directory, or read files outside the schema directory and the cwd.
