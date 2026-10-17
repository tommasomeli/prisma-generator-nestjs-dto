/**
 * PSL annotation source for the Prisma ORM 8 adapter (see `docs/prisma-8-plan.md` §5 Phase 2, D2).
 *
 * `contract.json` drops `///` doc comments, so they are recovered from the PSL sources through Prisma's
 * own parser (`@prisma/orm-framework/psl-parser/syntax`, the one the language server uses). The package is
 * an optional peer dependency labelled internal/unstable, so it is loaded lazily, feature-detected, and
 * every API it exposes is touched from this file only. A missing or incompatible parser degrades to "no
 * annotations" with a single warning; a PSL syntax error throws.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Utility } from "../utility";
import type {
  AnnotationMap,
  FieldAnnotations,
  ModelAnnotations,
} from "./types";

/** Module specifier of the PSL syntax parser. */
export const PSL_PARSER_SPECIFIER = "@prisma/orm-framework/psl-parser/syntax";

// ---------------------------------------------------------------------------
// Minimal structural view of the parser API (verified on 8.0.0-rc.18)
// ---------------------------------------------------------------------------

/** CST token (`SyntaxToken`): only what the enum-member doc walker reads. */
type PslSyntaxToken = {
  kind: string;
  text: string;
  prevSiblingOrToken?: unknown;
};

/** CST node (`SyntaxNode`). */
type PslSyntaxNode = { kind: string; prevSiblingOrToken?: unknown };

/** `IdentifierAst`: `name()` returns the identifier text. */
type PslIdentifier = { name(): string | undefined };

/** `FieldDeclarationAst`. */
type PslFieldDeclaration = {
  syntax: PslSyntaxNode;
  name(): PslIdentifier | undefined;
  typeAnnotation(): { syntax: PslSyntaxNode } | undefined;
  docComment(): string | undefined;
};

/** `KeyValuePairAst` (enum member inside a `GenericBlockDeclarationAst`). */
type PslKeyValuePair = {
  syntax: PslSyntaxNode;
  key(): PslIdentifier | undefined;
  docComment?: () => string | undefined;
};

/** Any top-level or namespace-level declaration. Kinds are told apart by `syntax.kind`. */
type PslDeclaration = {
  syntax: PslSyntaxNode;
  keyword?: () => { text: string } | undefined;
  name?: () => PslIdentifier | undefined;
  docComment?: () => string | undefined;
  fields?: () => Iterable<PslFieldDeclaration>;
  entries?: () => Iterable<PslKeyValuePair>;
  declarations?: () => Iterable<PslDeclaration>;
};

/** `ParseDiagnostic`. `range` positions are zero-based. */
type PslDiagnostic = {
  filename?: string;
  code?: string;
  message: string;
  range?: { start?: { line: number; character: number } };
};

/** Subset of `@prisma/orm-framework/psl-parser/syntax` used by the adapter. */
export type PslParserModule = {
  parse(
    source: string,
    filename: string,
  ): {
    document: { declarations(): Iterable<PslDeclaration> };
    diagnostics: readonly PslDiagnostic[];
  };
  printSyntax(node: PslSyntaxNode): string;
};

/** Thrown by {@link extractAnnotations} when the parser module does not have the expected shape. */
export class PslParserIncompatibleError extends Error {
  constructor(detail: string) {
    super(`Incompatible ${PSL_PARSER_SPECIFIER} API: ${detail}`);
    this.name = "PslParserIncompatibleError";
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Two ways to run a dynamic `import()`, tried in order:
 * 1. a literal `import()` (tsup 9 / esbuild keep it as-is in the CJS bin for `target: node18`, and Vite/vitest
 *    handle it natively);
 * 2. an `import()` hidden in `new Function`, which no bundler can rewrite into `require()` (a `require()` of an
 *    ESM-only package fails on Node 18/20). It does not work inside `vm` contexts such as vitest workers, hence
 *    the literal form first.
 */
const importers: ((specifier: string) => Promise<unknown>)[] = [
  (specifier) => import(/* @vite-ignore */ /* webpackIgnore: true */ specifier),
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<unknown>,
];

/** Resolves the parser entry from this package first, then from the user's project (`process.cwd()`). */
function resolveParserPath(): string | undefined {
  const bases = [
    typeof __filename === "string" ? __filename : undefined,
    path.join(process.cwd(), "package.json"),
  ];
  for (const base of bases) {
    if (!base) continue;
    try {
      return createRequire(base).resolve(PSL_PARSER_SPECIFIER);
    } catch {
      // try the next base
    }
  }
  return undefined;
}

/** Whether `value` exposes the parser functions this adapter needs. */
function isParserModule(value: unknown): value is PslParserModule {
  const mod = value as Partial<PslParserModule> | null | undefined;
  return (
    !!mod &&
    typeof mod.parse === "function" &&
    typeof mod.printSyntax === "function"
  );
}

/**
 * Loads `@prisma/orm-framework/psl-parser/syntax` with a native dynamic import. Returns `null` when the
 * package is not installed or does not export `parse` / `printSyntax`; never throws.
 */
export async function loadPslParser(): Promise<PslParserModule | null> {
  const candidates: string[] = [];
  const resolved = resolveParserPath();
  if (resolved) candidates.push(pathToFileURL(resolved).href);
  candidates.push(PSL_PARSER_SPECIFIER);
  for (const candidate of candidates) {
    for (const importer of importers) {
      try {
        const mod = await importer(candidate);
        if (isParserModule(mod)) return mod;
        const fallback = (mod as { default?: unknown } | null)?.default;
        if (isParserModule(fallback)) return fallback;
      } catch {
        // try the next importer / candidate
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Builds the field entry from the written type text. */
function fieldAnnotations(
  doc: string | undefined,
  writtenType: string | undefined,
): FieldAnnotations {
  const base = writtenType?.endsWith("?")
    ? writtenType.slice(0, -1)
    : writtenType;
  return {
    doc,
    writtenType,
    isList: !!base && base.trimEnd().endsWith("[]"),
    isUpdatedAt:
      !!writtenType &&
      writtenType.replace(/\s+/g, "") === "temporal.updatedAt()",
  };
}

/**
 * Doc comment of a CST node that has no `docComment()` accessor (enum members). Mirrors the parser's own
 * `readDocComment`: walk preceding sibling tokens, collect `///` comments, stop at a blank line.
 */
function leadingDocComment(node: PslSyntaxNode): string | undefined {
  const lines: string[] = [];
  let current: { prevSiblingOrToken?: unknown } = node;
  let newlines = 0;
  for (;;) {
    const sibling = current.prevSiblingOrToken as PslSyntaxToken | undefined;
    if (!sibling || typeof sibling.text !== "string") break;
    if (sibling.kind === "Whitespace") {
      current = sibling;
      continue;
    }
    if (sibling.kind === "Newline") {
      if (++newlines > 1) break;
      current = sibling;
      continue;
    }
    if (sibling.kind === "Comment" && sibling.text.startsWith("///")) {
      const text = sibling.text.slice(3);
      lines.push(text.startsWith(" ") ? text.slice(1) : text);
      newlines = 0;
      current = sibling;
      continue;
    }
    break;
  }
  return lines.length ? lines.reverse().join("\n") : undefined;
}

/** Returns the entry for `name`, creating it on first sight; a repeated name (multi-file contracts) merges into it. */
function entryFor(
  map: AnnotationMap,
  name: string,
  doc: string | undefined,
): ModelAnnotations {
  const existing = map.get(name);
  if (existing) {
    existing.doc ??= doc;
    return existing;
  }
  const created: ModelAnnotations = { doc, fields: new Map() };
  map.set(name, created);
  return created;
}

/** Records one declaration (model, `type` block, enum, view, namespace) into `map`. */
function visitDeclaration(
  parser: PslParserModule,
  declaration: PslDeclaration,
  map: AnnotationMap,
): void {
  const kind = declaration.syntax?.kind;
  if (kind === "Namespace") {
    for (const member of declaration.declarations?.() ?? [])
      visitDeclaration(parser, member, map);
    return;
  }
  if (
    kind !== "ModelDeclaration" &&
    kind !== "CompositeTypeDeclaration" &&
    kind !== "GenericBlockDeclaration"
  )
    return;
  if (
    typeof declaration.docComment !== "function" ||
    typeof declaration.name !== "function"
  ) {
    throw new PslParserIncompatibleError(`${kind} has no docComment()/name()`);
  }
  const name = declaration.name()?.name();
  if (!name) return;
  // `native_enum` blocks (native Postgres enums, as written by `prisma contract infer`) are enums too.
  const keyword = declaration.keyword?.()?.text;
  const isEnum =
    kind === "GenericBlockDeclaration" &&
    (keyword === "enum" || keyword === "native_enum");
  // Other generic blocks (datasource-like `key = value` blocks) carry no fields; views expose `fields()`.
  const fields = [...(declaration.fields?.() ?? [])];
  if (kind === "GenericBlockDeclaration" && !isEnum && fields.length === 0)
    return;
  const entry = entryFor(map, name, declaration.docComment());
  for (const field of fields) {
    if (
      typeof field.docComment !== "function" ||
      typeof field.name !== "function" ||
      typeof field.typeAnnotation !== "function"
    ) {
      throw new PslParserIncompatibleError(
        "FieldDeclaration has no docComment()/name()/typeAnnotation()",
      );
    }
    const fieldName = field.name()?.name();
    if (!fieldName) continue;
    const typeNode = field.typeAnnotation()?.syntax;
    entry.fields.set(
      fieldName,
      fieldAnnotations(
        field.docComment(),
        typeNode ? parser.printSyntax(typeNode) : undefined,
      ),
    );
  }
  if (isEnum) {
    for (const member of declaration.entries?.() ?? []) {
      const memberName = member.key?.()?.name();
      if (!memberName) continue;
      const doc =
        typeof member.docComment === "function"
          ? member.docComment()
          : leadingDocComment(member.syntax);
      entry.fields.set(memberName, fieldAnnotations(doc, undefined));
    }
  }
}

/** Formats parser diagnostics as `file:line:col message (code)` lines. */
function formatDiagnostics(
  fileName: string,
  diagnostics: readonly PslDiagnostic[],
): string {
  return diagnostics
    .map((d) => {
      const start = d.range?.start;
      const where = start
        ? `${d.filename || fileName}:${start.line + 1}:${start.character + 1}`
        : d.filename || fileName;
      return `  ${where} ${d.message}${d.code ? ` (${d.code})` : ""}`;
    })
    .join("\n");
}

/**
 * Parses one PSL source and adds its models, `type` blocks and enums to `into` (declaration order is kept).
 * Throws with the file name and the parser diagnostics when the PSL has syntax errors, and
 * {@link PslParserIncompatibleError} when the parser does not expose the expected API.
 */
export function extractAnnotations(
  parser: PslParserModule,
  source: string,
  fileName: string,
  into: AnnotationMap = new Map(),
): AnnotationMap {
  let result: ReturnType<PslParserModule["parse"]>;
  try {
    result = parser.parse(source, fileName);
  } catch (error) {
    // `parse` is documented to never throw (malformed input yields diagnostics), so a throw means an API change.
    throw new PslParserIncompatibleError(
      `parse() threw: ${(error as Error)?.message ?? error}`,
    );
  }
  if (
    !result ||
    !result.document ||
    typeof result.document.declarations !== "function" ||
    !Array.isArray(result.diagnostics)
  ) {
    throw new PslParserIncompatibleError(
      "parse() did not return { document, diagnostics }",
    );
  }
  if (result.diagnostics.length > 0) {
    throw new Error(
      `PSL syntax error in ${fileName}:\n${formatDiagnostics(fileName, result.diagnostics)}`,
    );
  }
  try {
    for (const declaration of result.document.declarations())
      visitDeclaration(parser, declaration, into);
  } catch (error) {
    if (error instanceof PslParserIncompatibleError) throw error;
    throw new PslParserIncompatibleError(
      `AST walk failed: ${(error as Error)?.message ?? error}`,
    );
  }
  return into;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export type LoadPslAnnotationsOptions = {
  /** Warning sink; defaults to `Utility.warn`. */
  warn?: (message: string) => void;
  /** Parser loader; defaults to {@link loadPslParser}. Injectable for tests. */
  loadParser?: () => Promise<PslParserModule | null>;
};

/**
 * Parses every PSL file with `@prisma/orm-framework/psl-parser/syntax` and returns the `///` doc comments
 * plus written-type facts per model and field. All files join the same map. Returns an empty map (after a
 * single warning) when the parser package is not installed or its API is incompatible; throws when a file
 * has PSL syntax errors.
 */
export async function loadPslAnnotations(
  files: string[],
  options: LoadPslAnnotationsOptions = {},
): Promise<AnnotationMap> {
  const warn = options.warn ?? ((message: string) => Utility.warn(message));
  const unavailable = (reason: string): AnnotationMap => {
    warn(
      `/// annotations are unavailable (${reason}). Install @prisma/orm-framework (>=8.0.0-rc.18) next to prisma to read them from the PSL sources; continuing without annotations.`,
    );
    return new Map();
  };
  if (files.length === 0) return new Map();
  let parser: PslParserModule | null;
  try {
    parser = await (options.loadParser ?? loadPslParser)();
  } catch {
    parser = null;
  }
  if (!parser)
    return unavailable(`${PSL_PARSER_SPECIFIER} could not be loaded`);
  const map: AnnotationMap = new Map();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    try {
      extractAnnotations(parser, source, file, map);
    } catch (error) {
      if (error instanceof PslParserIncompatibleError)
        return unavailable(error.message);
      throw error;
    }
  }
  return map;
}
