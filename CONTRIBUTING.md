# Contributing to prisma-generator-nestjs-dto

Thank you for considering a contribution. PRs against `main` are the standard workflow — no RFC process, no separate dev branch.

## Where to start

- **Found a bug?** Open a [Bug Report](https://github.com/tommasomeli/prisma-generator-nestjs-dto/issues/new?template=bug_report.yml) with a minimal `schema.prisma` snippet and the relevant slice of generated output.
- **Have a feature idea?** Open a [Feature Request](https://github.com/tommasomeli/prisma-generator-nestjs-dto/issues/new?template=feature_request.yml). For API shape or plugin-system changes, start with an issue before writing code so we can agree on the surface.
- **Want to fix something?** Check the [Issues](https://github.com/tommasomeli/prisma-generator-nestjs-dto/issues) tab for anything labeled `good first issue` or `help wanted`.

## Development setup

Requirements: **Node.js 18+**, **npm 9+**.

```bash
git clone https://github.com/tommasomeli/prisma-generator-nestjs-dto.git
cd prisma-generator-nestjs-dto
npm install
npm run build
npm test
```

The package root is this repository; all commands run from the repo root. The runnable example under [`examples/blog/`](./examples/blog) shows `configFile`, custom annotations, and a TS plugin loaded via `jiti`.

## Making changes

- **Create a branch:** `git checkout -b fix/my-bug` or `feature/my-feature`.
- **Write code:** follow the conventions below. Run `npm run lint`, `npm run typecheck`, and `npm test` before pushing.
- **Commit:** clear, concise messages. One logical change per commit when possible.

## Conventions

- **Source language**: TypeScript. The whole pipeline is typed; keep `npm run typecheck` clean.
- **Lint**: `npm run lint` (ESLint). CI is non-strict on `warning`s.
- **Tests**: `npm test` (Vitest). Prefer **table-driven** specs and keep DMMF fixtures minimal — see `test/helpers/build-options.ts`.
- **Formatting**: Prettier via the workspace root. We don't bikeshed style in reviews.
- **No emojis** in source, comments, or PR descriptions.
- **JSDoc**: class-level doc block describing purpose; methods get `@param` / `@returns`. TSX/JS/shell: only where intent is non-obvious.

## What to include in a PR

1. **Tests** for any user-visible change (new option, new annotation, new built-in import, override behaviour, ...). End-to-end specs that drive the public `generate()` entry point are preferred over unit-level mocks where they would replicate.
2. **CHANGELOG** entry under `## [Unreleased]` matching the section (`### Added` / `### Changed` / `### Removed` / `### Fixed`). Breaking changes go in `### Removed` or `### Changed` with a leading `**Breaking**:` tag.
3. **README** updates only if the change affects a documented surface (configuration options, plugin API, annotations). Implementation details stay out.

## Submitting a Pull Request

1. Fork the repo and push your branch to your fork.
2. Open a Pull Request against the `main` branch of [tommasomeli/prisma-generator-nestjs-dto](https://github.com/tommasomeli/prisma-generator-nestjs-dto).
3. Fill in the PR template: summary, linked issue (if any), and the checklist.
4. If your PR fixes an open issue, mention it in the description (e.g. `Fixes #123`).

Once submitted, CI runs lint, typecheck, build, tests (Node 18/20/22), a Prisma version matrix (5/6/7), coverage, and a publish dry-run. I will review your PR as soon as possible.

## Reporting bugs

Use the [Bug Report template](https://github.com/tommasomeli/prisma-generator-nestjs-dto/issues/new?template=bug_report.yml) and include:

- A minimal reproduction: a `schema.prisma` snippet and the relevant slice of generated output.
- Versions: `node --version`, `npx prisma --version`, and the version of this package.
- Expected vs actual output.

For security issues, see [SECURITY.md](./SECURITY.md) — do not open a public issue.

## Releases

Maintainer-only:

1. Add **`NPM_TOKEN`** under GitHub → Repository → Settings → Secrets and variables → Actions.
   Create a [granular npm access token](https://www.npmjs.com/settings/tommasomeli/tokens) with **Read and write** on `@tommasomeli/prisma-generator-nestjs-dto` (or the whole scope). Under **Publish**, enable **Bypass two-factor authentication** — required for CI publishes when 2FA is on your npm account.
2. Bump `version` in `package.json` and add a dated section in `CHANGELOG.md`.
3. Push to `main`. The [`release.yml`](./.github/workflows/release.yml) workflow reads `package.json`, and if tag `v{version}` does not exist yet it runs tests, publishes to npm with provenance, creates the tag, and opens a GitHub Release.

Pushes that do not bump `version` are skipped automatically (the tag for the current version already exists).
